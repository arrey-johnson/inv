"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestEmailOtpAction,
  verifyEmailOtpAction,
  type LoginState,
} from "@/lib/auth/actions";

const initialState: LoginState = { step: "email" };

export function LoginForm({ next }: { next?: string }) {
  const [sendState, sendAction, sendPending] = useActionState(requestEmailOtpAction, initialState);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyEmailOtpAction, initialState);
  const [forceEmailStep, setForceEmailStep] = useState(false);

  const pending = sendPending || verifyPending;
  const onCodeStep = !forceEmailStep && (sendState.step === "code" || verifyState.step === "code");
  const email = verifyState.email ?? sendState.email ?? "";
  const error = onCodeStep ? verifyState.error : sendState.error;
  const info = onCodeStep ? (sendState.info ?? verifyState.info) : undefined;

  if (onCodeStep) {
    return (
      <div className="space-y-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {info && !error && (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        )}

        <form action={verifyAction} className="space-y-4" noValidate>
          {next && <input type="hidden" name="next" value={next} />}
          <input type="hidden" name="email" value={email} />

          <div className="space-y-2">
            <Label htmlFor="token">6-digit code</Label>
            <Input
              id="token"
              name="token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              className="text-center font-mono text-lg tracking-[0.35em]"
              required
              disabled={pending}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Sent to {email}</p>
          </div>

          <Button type="submit" className="h-9 w-full" disabled={pending}>
            {verifyPending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Verifying...
              </>
            ) : (
              "Verify and sign in"
            )}
          </Button>
        </form>

        <form action={sendAction} className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="email" value={email} />
          <Button type="submit" variant="outline" className="h-9 flex-1" disabled={pending}>
            {sendPending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Sending...
              </>
            ) : (
              "Resend code"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 flex-1"
            disabled={pending}
            onClick={() => setForceEmailStep(true)}
          >
            Use a different email
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form
      action={sendAction}
      className="space-y-4"
      noValidate
      onSubmit={() => setForceEmailStep(false)}
    >
      {next && <input type="hidden" name="next" value={next} />}

      {sendState.error && (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" />
          <AlertDescription>{sendState.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@promptstack.tech"
          defaultValue={email || undefined}
          required
          disabled={pending}
          autoFocus
        />
      </div>

      <Button type="submit" className="h-9 w-full" disabled={pending}>
        {sendPending ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Sending code...
          </>
        ) : (
          "Send sign-in code"
        )}
      </Button>
    </form>
  );
}
