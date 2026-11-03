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
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(256),
});

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!isSupabaseConfigured()) {
    return { error: "Supabase is not configured. Copy .env.example to .env.local and fill it in." };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid credentials" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Deliberately generic: do not reveal whether the account exists.
    return { error: "Invalid email or password." };
  }

  const ctx = await getAuthContext();
  if (ctx) {
    await writeAuditLog(supabase, {
      organizationId: ctx.organizationId,
      action: "auth.login",
      entityType: "user",
      entityId: ctx.user.id,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email ?? null,
    });
  }

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
