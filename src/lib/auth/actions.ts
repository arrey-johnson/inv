"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/log";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getAuthContext } from "@/lib/auth/session";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface LoginState {
  error?: string;
  info?: string;
  /** After a code is sent, the form shows the OTP step. */
  step?: "email" | "code";
  email?: string;
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");

/** Supabase Auth OTP length is 6–10; we use 6. */
const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your email");

async function auditLogin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const ctx = await getAuthContext();
  if (!ctx) return;
  await writeAuditLog(supabase, {
    organizationId: ctx.organizationId,
    action: "auth.login",
    entityType: "user",
    entityId: ctx.user.id,
    actorId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
  });
}

/** Step 1: email a one-time code (invite-only — no auto-signup). */
export async function requestEmailOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!isSupabaseConfigured()) {
    return { error: "Supabase is not configured. Copy .env.example to .env.local and fill it in." };
  }

  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email address", step: "email" };
  }
  const email = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Staff accounts are provisioned by an admin; never create users from the login form.
      shouldCreateUser: false,
    },
  });

  // Always advance to the code step with a generic message so we do not reveal whether the
  // address is registered (Supabase errors on unknown emails when shouldCreateUser is false).
  if (error) {
    console.warn("[auth] OTP send:", error.message);
  }

  return {
    step: "code",
    email,
    info: `If ${email} is registered, we sent a 6-digit code. It expires in a few minutes.`,
  };
}

/** Step 2: verify the emailed code and establish the session. */
export async function verifyEmailOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!isSupabaseConfigured()) {
    return { error: "Supabase is not configured. Copy .env.example to .env.local and fill it in." };
  }

  const emailParsed = emailSchema.safeParse(formData.get("email"));
  const otpParsed = otpSchema.safeParse(formData.get("token"));
  if (!emailParsed.success) {
    return { error: "Enter a valid email address", step: "email" };
  }
  if (!otpParsed.success) {
    return {
      error: otpParsed.error.issues[0]?.message ?? "Enter the 6-digit code",
      step: "code",
      email: emailParsed.data,
    };
  }

  const email = emailParsed.data;
  const token = otpParsed.data;
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    return {
      error: "Invalid or expired code. Request a new one if needed.",
      step: "code",
      email,
    };
  }

  await auditLogin(supabase);
  redirect(safeRedirectPath(formData.get("next")));
}

export async function signOutAction(): Promise<void> {
  // Demo mode has no session to end.
  if (isDemoMode()) redirect("/dashboard");
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const ctx = await getAuthContext();
    if (ctx) {
      await writeAuditLog(supabase, {
        organizationId: ctx.organizationId,
        action: "auth.logout",
        entityType: "user",
        entityId: ctx.user.id,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email ?? null,
      });
    }
    await supabase.auth.signOut();
  }
  redirect("/login");
}
