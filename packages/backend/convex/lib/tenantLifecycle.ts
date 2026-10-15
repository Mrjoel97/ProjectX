import { TENANT_TABLE_CLASSIFICATION } from "@pikar/core/tenantData";
import {
  createFunctionHandle,
  type FunctionHandle,
  getFunctionName,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { customAction, customCtx, customMutation } from "convex-helpers/server/customFunctions";
import {
  type ActionCtx,
  type MutationCtx,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
} from "../_generated/server";

/** Read in the same transaction as the write: erasure and a late writer conflict/retry. */
export async function assertTenantWritable(
  ctx: MutationCtx,
  tenantId: string,
  terminationReceipt = false,
) {
  const state = await ctx.db
    .query("authRevocations")
    .withIndex("by_userId", (q) => q.eq("userId", tenantId))
    .unique();
  if (state?.state && !(state.state === "deleting" && terminationReceipt))
    throw new Error("TENANT_ERASURE_IN_PROGRESS");
}

export function lifecycleDatabase(ctx: MutationCtx): MutationCtx["db"] {
  const db = ctx.db;
  const check = async (table: string, value: Record<string, unknown>) => {
    const category = TENANT_TABLE_CLASSIFICATION[table as keyof typeof TENANT_TABLE_CLASSIFICATION];
    if (category !== "tenant_owned" && category !== "tenant_credential") return;
    const tenantId = table === "users" ? value._id : value.tenantId;
    if (typeof tenantId === "string") await assertTenantWritable(ctx, tenantId);
  };
  // Deletes remain permitted for erasure/retention. Immutable audit/security metadata is retained.
  return new Proxy(db, {
    get(target, key) {
      if (key === "insert")
        return async (table: string, value: Record<string, unknown>) => {
          await check(table, value);
          return target.insert(table as never, value as never);
        };
      if (key === "patch" || key === "replace")
        return async (
          first: string,
          second: string | Record<string, unknown>,
          third?: Record<string, unknown>,
        ) => {
          const id = typeof second === "string" ? second : first;
          const value = typeof second === "string" ? third! : second;
          if (typeof second === "string" && !target.normalizeId(first as never, id))
            throw new Error("INVALID_DOCUMENT_ID");
          const old = await target.get(id as never);
          const protectedTable = Object.entries(TENANT_TABLE_CLASSIFICATION).some(
            ([table, category]) =>
              (category === "tenant_owned" || category === "tenant_credential") &&
              target.normalizeId(table as never, id),
          );
          if (old && protectedTable) {
            // Tenant ids cannot be moved to evade the old owner's lifecycle boundary.
            const tenantId =
              "tenantId" in old ? old.tenantId : target.normalizeId("users", id) ? id : null;
            const terminationReceipt =
              key === "patch" &&
              !!target.normalizeId("voiceSessions", id) &&
              Object.keys(value).length > 0 &&
              (Object.keys(value).every((field) =>
                ["hangupAttempts", "hangupConfirmedAt", "hangupUnresolved"].includes(field),
              ) ||
                Object.entries(value).every(
                  ([field, next]) =>
                    next === undefined &&
                    ["controlEvents", "controlCommands", "controlExpiresAt"].includes(field),
                ));
            if (typeof tenantId === "string")
              await assertTenantWritable(ctx, tenantId, terminationReceipt);
            if (typeof value.tenantId === "string") await assertTenantWritable(ctx, value.tenantId);
          }
          return key === "patch"
            ? target.patch(id as never, value as never)
            : target.replace(id as never, value as never);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** All application internal mutations use this builder; component-owned auth remains upstream. */
export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx((ctx) => ({ db: lifecycleDatabase(ctx) })),
);

// Internal transport only. The referenced mutation validates its own arguments.
export const commitComponentWrite = internalMutation({
  args: { tenantId: v.string(), handle: v.string(), args: v.any() },
  handler: async (ctx, args): Promise<unknown> => {
    await assertTenantWritable(ctx, args.tenantId);
    return ctx.runMutation(args.handle as FunctionHandle<"mutation">, args.args);
  },
});

const commitRef = makeFunctionReference<
  "mutation",
  { tenantId: string; handle: string; args: Record<string, unknown> },
  unknown
>("lib/tenantLifecycle:commitComponentWrite");
const erasureRef = makeFunctionReference<"query", { userId: string }, boolean>(
  "authRevocations:erasureInProgress",
);

/** Component writes join the transaction containing the lifecycle read. */
export function lifecycleActionContext(
  ctx: ActionCtx,
  tenantId: string,
): Pick<ActionCtx, "runMutation" | "storage"> {
  const runMutation: ActionCtx["runMutation"] = async (reference, ...args) => {
    let native = false;
    try {
      getFunctionName(reference);
      native = true;
    } catch {
      /* Components have no native name. */
    }
    if (native) return ctx.runMutation(reference, ...args);
    const handle = await createFunctionHandle(reference);
    return ctx.runMutation(commitRef, { tenantId, handle, args: args[0] ?? {} }) as never;
  };
  const assertActive = async () => {
    if (await ctx.runQuery(erasureRef, { userId: tenantId }))
      throw new Error("TENANT_ERASURE_IN_PROGRESS");
  };
  const storage = new Proxy(ctx.storage, {
    get(target, key) {
      if (key === "store")
        return async (blob: Blob) => {
          await assertActive();
          const id = await target.store(blob);
          try {
            await assertActive();
          } catch (error) {
            await target.delete(id);
            throw error;
          }
          return id;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { runMutation, storage };
}

export const internalAction = customAction(
  rawInternalAction,
  customCtx((ctx, args) =>
    typeof args.tenantId === "string" ? lifecycleActionContext(ctx, args.tenantId) : {},
  ),
);
