import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { PromptstackLogo } from "@/components/brand/promptstack-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/lib/auth/actions";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getAuthContext } from "@/lib/auth/session";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // DEMO_MODE has no login screen.
  if (isDemoMode()) redirect("/dashboard");
  const configured = isSupabaseConfigured();

  let signedInWithoutAccess = false;
  if (configured) {
    const ctx = await getAuthContext();
    if (ctx) redirect(safeRedirectPath(next));

    // Signed in at Supabase but no role assigned yet -> explain instead of looping.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedInWithoutAccess = Boolean(user);
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="items-center space-y-4 text-center">
        <PromptstackLogo variant="color" priority className="mx-auto h-12 w-auto max-w-[260px]" />
        <div className="space-y-1">
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Manage invoices, proformas and payments for Promptstack Technologies.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured && (
          <Alert>
            <TriangleAlert className="size-4" />
            <AlertTitle>Setup required</AlertTitle>
            <AlertDescription>
              Supabase is not configured. Copy <code className="font-mono">.env.example</code> to{" "}
              <code className="font-mono">.env.local</code> and set the Supabase URL and keys.
            </AlertDescription>
          </Alert>
        )}

        {signedInWithoutAccess ? (
          <div className="space-y-4">
            <Alert>
              <ShieldAlert className="size-4" />
              <AlertTitle>Waiting for access</AlertTitle>
              <AlertDescription>
                Your account exists but no role has been assigned yet. Ask a Promptstack administrator to grant you
                access, then sign in again.
              </AlertDescription>
            </Alert>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" className="h-9 w-full">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <LoginForm next={next && safeRedirectPath(next, "") ? next : undefined} />
        )}
      </CardContent>
    </Card>
  );
}
