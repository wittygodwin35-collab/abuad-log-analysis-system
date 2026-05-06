"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, KeyRound } from "lucide-react";
import { AuthFlowShell } from "@/components/auth/auth-flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface ForgotPasswordResponse {
  error?: string;
  reference?: string;
  sharedCredentials?: {
    username: string;
    password: string;
  };
}

export function ForgotPasswordForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [sharedCredentials, setSharedCredentials] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;

    const timeout = window.setTimeout(() => setIsCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [isCopied]);

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
      setSharedCredentials(payload.sharedCredentials || null);
    } catch {
      setError("Failed to submit reset request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyCredentials() {
    if (!sharedCredentials) return;

    try {
      await navigator.clipboard.writeText(
        `Username: ${sharedCredentials.username}\nPassword: ${sharedCredentials.password}`,
      );
      setIsCopied(true);
      toast.success("Credentials copied to clipboard");
    } catch {
      toast.error("Unable to copy credentials");
    }
  }

  return (
    <AuthFlowShell
      icon={KeyRound}
      title="Forgot Password"
      description="Recover the shared operator credentials and log the reset request for audit."
    >
      {reference && sharedCredentials ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-chart-3/30 bg-chart-3/10 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-chart-3" />
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">Recovery request logged</p>
                <p className="text-sm text-muted-foreground">
                  Your password recovery request has been recorded under reference <span className="font-mono text-foreground">{reference}</span>.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-primary/25 bg-primary/10 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Current shared credentials</p>
                <p className="text-sm text-muted-foreground">
                  These are the maintained default credentials for the shared dashboard account.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={copyCredentials}>
                {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {isCopied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Username</p>
                <p className="mt-2 break-words font-mono text-sm text-foreground">{sharedCredentials.username}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Password</p>
                <p className="mt-2 break-words font-mono text-sm text-foreground">{sharedCredentials.password}</p>
              </div>
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
