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

interface AccessHelpItem {
  title: string;
  body: ReactNode;
}

interface AccessHelpPageProps {
  description: string;
  icon: LucideIcon;
  items: AccessHelpItem[];
  note: ReactNode;
  title: string;
}

export function AccessHelpPage({
  description,
  icon: Icon,
  items,
  note,
  title,
}: AccessHelpPageProps) {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-2xl glass-panel border-0 glow-border">
        <CardHeader className="space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 glow-border">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl tracking-tight glow-text">{title}</CardTitle>
            <CardDescription className="text-muted-foreground">{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3">
            {items.map((item) => (
              <section key={item.title} className="rounded-lg border border-border/70 bg-background/35 p-4">
                <h2 className="text-sm font-semibold text-foreground">{item.title}</h2>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</div>
              </section>
            ))}
          </div>
          <p className="rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm leading-6 text-muted-foreground">
            {note}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button asChild>
              <Link href="/login">
                <LogIn className="h-4 w-4" />
                Back to sign in
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">
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
