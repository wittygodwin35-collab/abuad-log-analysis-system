"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, LogIn, Shield, UserPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Login failed.");
        return;
      }

      const callbackUrl = searchParams.get("callbackUrl") || "/";
      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError("Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-chart-2/10 blur-[100px] rounded-full pointer-events-none" />
      <Card className="w-full max-w-md glass-panel border-0 glow-border relative z-10">
        <CardHeader className="space-y-3">
          <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center glow-border">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl tracking-tight glow-text">Sign In</CardTitle>
            <CardDescription className="text-muted-foreground">
              Access the ABUAD log analysis dashboard.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Use the locally configured application credentials.
              </p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              <LogIn className={`h-4 w-4 mr-2 ${isSubmitting ? "animate-pulse" : ""}`} />
              {isSubmitting ? "Signing In..." : "Sign In"}
            </Button>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button asChild variant="outline" type="button" className="w-full">
                <Link href="/signup">
                  <UserPlus className="h-4 w-4" />
                  Request access
                </Link>
              </Button>
              <Button asChild variant="ghost" type="button" className="w-full">
                <Link href="/forgot-password">
                  <KeyRound className="h-4 w-4" />
                  Forgot password
                </Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <LoginForm />
    </Suspense>
  );
}
