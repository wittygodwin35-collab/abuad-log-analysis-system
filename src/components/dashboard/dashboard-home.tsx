"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  ChevronRight,
  FileText,
  LogOut,
  Shield,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DASHBOARD_LINKS = [
  {
    href: "/upload",
    title: "Upload",
    description: "Bring in a real log file, try a demo incident, or download the prepared sample.",
    icon: Upload,
  },
  {
    href: "/pipeline",
    title: "Pipeline",
    description: "Train the model, run the collector, and launch evaluation jobs from one place.",
    icon: Activity,
  },
  {
    href: "/logs",
    title: "Log Files",
    description: "Review analyzed files, reopen a specific incident, or manage the saved history.",
    icon: FileText,
  },
  {
    href: "/results",
    title: "Results",
    description: "Inspect alerts, parsing output, templates, and anomaly metrics in the results workspace.",
    icon: BarChart3,
  },
];

export function DashboardHome() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch {
      setIsLoggingOut(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] h-[50%] w-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] h-[40%] w-[40%] rounded-full bg-chart-2/10 blur-[100px] pointer-events-none" />
      <header className="border-b border-border/50 bg-background/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 glow-border">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight glow-text">Log Analysis Dashboard</h1>
              <p className="text-sm text-muted-foreground">Choose where you want to work next.</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="border-border bg-secondary/30 text-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
          >
            <LogOut className="h-4 w-4" />
            {isLoggingOut ? "Signing out..." : "Sign out"}
          </Button>
        </div>
      </header>

      <section className="container mx-auto px-4 py-10 relative z-10">
        <div className="max-w-3xl">
          <p className="text-sm uppercase tracking-[0.3em] text-primary/80">Workspace</p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight text-foreground">Navigate directly to the task you want.</h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Start with the task you need, then move between uploads, pipeline actions, log history, and results whenever you are ready.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {DASHBOARD_LINKS.map((item) => {
            const Icon = item.icon;

            return (
              <Card key={item.href} className="glass-panel border-0 transition-all hover:-translate-y-1 hover:border-primary/30 hover:bg-primary/10">
                <CardHeader className="space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl text-foreground">{item.title}</CardTitle>
                    <CardDescription className="mt-2 text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button asChild className="w-full justify-between">
                    <Link href={item.href}>
                      Open {item.title}
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </main>
  );
}
