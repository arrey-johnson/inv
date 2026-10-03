import "server-only";
import { isDemoMode } from "@/lib/env";
import { DisabledEmailProvider, type EmailProvider } from "./index";
import { DemoOutboxEmailProvider, ResendEmailProvider } from "./providers";

/** The configured provider (see `.env.example`). Reads the environment directly so demo mode needs no secrets. */
export function getEmailProvider(): EmailProvider {
  const choice = process.env.EMAIL_PROVIDER || "none";
  const from = process.env.EMAIL_FROM;
  const apiKey = process.env.RESEND_API_KEY;

  if (choice === "resend") {
    if (!apiKey || !from) {
      return new DisabledEmailProvider("resend", "Resend is selected but RESEND_API_KEY or EMAIL_FROM is missing.");
    }
    return new ResendEmailProvider(apiKey, from);
  }
  if (choice === "smtp") {
    return new DisabledEmailProvider("smtp", "SMTP delivery is not implemented. Use EMAIL_PROVIDER=resend.");
  }
  if (isDemoMode()) return new DemoOutboxEmailProvider();
  return new DisabledEmailProvider();
}
