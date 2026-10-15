import { Email } from "@convex-dev/auth/providers/Email";
import type { EmailConfig, GenericActionCtxWithAuthConfig } from "@convex-dev/auth/server";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import type { GenericDataModel } from "convex/server";
import { components } from "../_generated/api";

// Separate from model budgets. Component keys contain a digest, never a mailbox address.
const limits = new RateLimiter(components.rateLimiter, {
  authEmailAddress: { kind: "token bucket", rate: 5, period: HOUR, capacity: 3 },
  authEmailDeployment: { kind: "token bucket", rate: 100, period: HOUR, capacity: 20 },
});

export function requireAuthEmailConfiguration() {
  const apiKey = process.env.AUTH_RESEND_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from || /[\r\n]/.test(from)) throw new Error("AUTH_EMAIL_NOT_CONFIGURED");
  return { apiKey, from };
}

export async function reserveAuthEmail(
  ctx: GenericActionCtxWithAuthConfig<GenericDataModel>,
  email: string,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  if (!(await limits.limit(ctx, "authEmailAddress", { key })).ok) {
    throw new Error("AUTH_EMAIL_RATE_LIMITED");
  }
  if (!(await limits.limit(ctx, "authEmailDeployment")).ok) {
    throw new Error("AUTH_EMAIL_RATE_LIMITED");
  }
}

/** OTP only: no account identifiers or codes in URLs, logs, or provider error bodies. */
export function authEmailProvider(purpose: "verify" | "reset") {
  return Email({
    id: `password-${purpose}`,
    maxAge: 15 * 60,
    async sendVerificationRequest(
      { identifier, token }: Parameters<EmailConfig["sendVerificationRequest"]>[0],
      ctx?: GenericActionCtxWithAuthConfig<GenericDataModel>,
    ) {
      const { apiKey, from } = requireAuthEmailConfiguration();
      if (!ctx) throw new Error("AUTH_EMAIL_CONTEXT_REQUIRED");
      // Reset admission already reserves before account lookup, including unknown accounts.
      if (purpose === "verify") await reserveAuthEmail(ctx, identifier);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          from,
          to: identifier,
          subject:
            purpose === "verify" ? "Verify your Pikar AI email" : "Reset your Pikar AI password",
          text: `Your ${purpose === "verify" ? "email verification" : "password reset"} code is:\n\n${token}\n\nIt expires in 15 minutes. If you did not request this, ignore this email.`,
        }),
      }).catch(() => {
        throw new Error("AUTH_EMAIL_SEND_FAILED");
      });
      if (!response.ok) throw new Error("AUTH_EMAIL_SEND_FAILED");
    },
  });
}
