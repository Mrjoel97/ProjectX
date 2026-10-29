import { SERVICE_KNOWLEDGE_KEYS, type ServiceKnowledgeKey } from "@pikar/core/serviceKnowledge";
import type { TestConvex } from "convex-test";
import { api } from "../convex/_generated/api";
import type schema from "../convex/schema";

/** Offline synthetic user statements through the actual public review/confirm API.
 * Callers register auditCounts and enable existing Foundation admission in their test only.
 * No paid work, document publication, fabricated confirmation, grant or service setup occurs. */
export async function confirmServiceKnowledgeFixture(
  t: TestConvex<typeof schema>,
  tenantId: string,
  serviceId = "social-marketing",
) {
  const user = t.withIdentity({ subject: `${tenantId}|knowledge-fixture` });
  const initial = await user.query(api.serviceConversations.read, { serviceId });
  if (!initial) throw new Error("SERVICE_KNOWLEDGE_FIXTURE_REQUIRES_SETUP");
  let view = initial;
  const cas = () => ({
    serviceId,
    expectedRevision: view.revision,
    expectedControlRevision: view.controlRevision,
    expectedConversationRevision: view.conversationRevision,
  });
  view = await user.mutation(api.serviceConversations.begin, cas());
  const answers: Record<ServiceKnowledgeKey, string> = {
    offering: "Offline synthetic locally made notebooks",
    targetCustomer: "Offline synthetic neighbourhood shop customers",
    brandVoice: "Friendly and clear, with practical examples",
    publishingBoundaries: "Do not invent prices, discounts or delivery guarantees",
  };
  for (const key of SERVICE_KNOWLEDGE_KEYS)
    view = await user.mutation(api.serviceConversations.save, {
      ...cas(),
      key,
      value: answers[key],
    });
  view = await user.mutation(api.serviceConversations.confirm, {
    ...cas(),
    reviewHash: view.reviewHash,
  });
  if (view.state !== "ready") throw new Error("SERVICE_KNOWLEDGE_FIXTURE_NOT_READY");
  return view;
}
