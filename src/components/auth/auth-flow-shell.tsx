"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthFlowShellProps {
  children: ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}

export function AuthFlowShell({
  children,
  description,
  icon: Icon,
  title,
}: AuthFlowShellProps) {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-10">
      <div className="absolute top-[-20%] left-[-10%] h-[50%] w-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] h-[40%] w-[40%] rounded-full bg-chart-2/10 blur-[100px] pointer-events-none" />
      <Card className="relative z-10 w-full max-w-2xl glass-panel border-0 glow-border">
        <CardHeader className="space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 glow-border">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl tracking-tight glow-text">{title}</CardTitle>
            <CardDescription className="text-muted-foreground">{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {children}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button asChild>
              <Link href="/login">
                <LogIn className="h-4 w-4" />
                Back to sign in
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" />
                Dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
