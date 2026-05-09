"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { AuthFlowShell } from "@/components/auth/auth-flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ForgotPasswordResponse {
  error?: string;
  reference?: string;
}

export function ForgotPasswordForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/password-reset-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          username,
          note,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ForgotPasswordResponse;
      if (!response.ok) {
        setError(payload.error || "Failed to submit reset request.");
        return;
      }

      setReference(payload.reference || null);
    } catch {
      setError("Failed to submit reset request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthFlowShell
      icon={KeyRound}
      title="Forgot Password"
      description="Log a recovery request for administrator review."
    >
      {reference ? (
        <div className="rounded-xl border border-chart-3/30 bg-chart-3/10 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-chart-3" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Recovery request logged</p>
              <p className="text-sm text-muted-foreground">
                Your password recovery request has been recorded under reference <span className="font-mono text-foreground">{reference}</span>.
              </p>
              <p className="text-sm text-muted-foreground">
                An administrator will review it and send updated credentials to your email address.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reset-full-name">Full name</Label>
              <Input
                id="reset-full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Institutional email</Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-username">Username you tried to use</Label>
            <Input
              id="reset-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-note">Optional note</Label>
            <Textarea
              id="reset-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add any context that might help the administrator process the request."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Processing..." : "Recover Shared Credentials"}
          </Button>
        </form>
      )}
    </AuthFlowShell>
  );
}
