"use client";

import { useState } from "react";
import { CheckCircle2, UserPlus } from "lucide-react";
import { AuthFlowShell } from "@/components/auth/auth-flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface AccessRequestResponse {
  error?: string;
  reference?: string;
}

export function RequestAccessForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [useCase, setUseCase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          department,
          useCase,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as AccessRequestResponse;
      if (!response.ok) {
        setError(payload.error || "Failed to submit request.");
        return;
      }

      setReference(payload.reference || null);
    } catch {
      setError("Failed to submit request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthFlowShell
      icon={UserPlus}
      title="Request Access"
      description="Submit your details and the app will log an access request for administrator review."
    >
      {reference ? (
        <div className="rounded-xl border border-chart-3/30 bg-chart-3/10 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-chart-3" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Request submitted</p>
              <p className="text-sm text-muted-foreground">
                Your access request has been recorded under reference <span className="font-mono text-foreground">{reference}</span>.
              </p>
              <p className="text-sm text-muted-foreground">
                This workflow uses the app&apos;s existing data store, so no paid email service is required to capture the request.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="full-name">Full name</Label>
              <Input
                id="full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Institutional email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="department">Department or unit</Label>
            <Input
              id="department"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="Computer Science, Security Lab, ICT Unit"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="use-case">Why do you need access?</Label>
            <Textarea
              id="use-case"
              value={useCase}
              onChange={(event) => setUseCase(event.target.value)}
              placeholder="Briefly describe the work you need to do in the platform."
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit Access Request"}
          </Button>
        </form>
      )}
    </AuthFlowShell>
  );
}
