"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  ClipboardCopy,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  Shield,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AccessRequest {
  approvedUsername?: string | null;
  createdAt: string;
  department?: string | null;
  email: string;
  fullName: string;
  id: string;
  notificationError?: string | null;
  notificationStatus?: string | null;
  processedAt?: string | null;
  reference: string;
  status: string;
  useCase: string;
}

interface RecoveryRequest {
  createdAt: string;
  email: string;
  fullName?: string | null;
  id: string;
  note?: string | null;
  notificationError?: string | null;
  notificationStatus?: string | null;
  processedAt?: string | null;
  reference: string;
  resolvedUsername?: string | null;
  status: string;
  username: string;
}

interface CredentialNotification {
  body: string;
  error?: string;
  from: string;
  mailtoUrl: string;
  status: "sent" | "not_configured" | "failed";
  subject: string;
  to: string;
}

interface ActionResult {
  credentials: {
    password: string;
    username: string;
  };
  notification: CredentialNotification;
  reference: string;
}

interface RequestsPayload {
  accessRequests: AccessRequest[];
  email: {
    adminEmail: string;
    automaticDeliveryConfigured: boolean;
  };
  recoveryRequests: RecoveryRequest[];
}

interface AdminRequestsDashboardProps {
  adminName: string;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
    case "completed":
      return "border-chart-3/40 bg-chart-3/10 text-chart-3";
    case "denied":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "reviewed":
      return "border-muted-foreground/30 bg-secondary/40 text-muted-foreground";
    default:
      return "border-primary/30 bg-primary/10 text-primary";
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminRequestsDashboard({ adminName }: AdminRequestsDashboardProps) {
  const [payload, setPayload] = useState<RequestsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/requests");
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(error.error || "Unable to load admin requests");
        return;
      }

      setPayload((await response.json()) as RequestsPayload);
    } catch {
      toast.error("Unable to load admin requests");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  async function runAction<T extends object>(input: {
    actionId: string;
    successMessage: string;
    url: string;
  }): Promise<T | null> {
    setBusyAction(input.actionId);
    try {
      const response = await fetch(input.url, {
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) {
        toast.error(result.error || "Admin action failed");
        return null;
      }

      toast.success(input.successMessage);
      await fetchRequests();
      return result;
    } catch {
      toast.error("Admin action failed");
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function approveAccess(request: AccessRequest) {
    const result = await runAction<{
      credentials: ActionResult["credentials"];
      notification: CredentialNotification;
    }>({
      actionId: `access-approve-${request.id}`,
      successMessage: "Access approved",
      url: `/api/admin/access-requests/${request.id}/approve`,
    });

    if (result) {
      setLastResult({
        credentials: result.credentials,
        notification: result.notification,
        reference: request.reference,
      });
    }
  }

  async function denyAccess(request: AccessRequest) {
    await runAction({
      actionId: `access-deny-${request.id}`,
      successMessage: "Access request denied",
      url: `/api/admin/access-requests/${request.id}/deny`,
    });
  }

  async function recoverCredentials(request: RecoveryRequest) {
    const result = await runAction<{
      credentials: ActionResult["credentials"];
      notification: CredentialNotification;
    }>({
      actionId: `recovery-${request.id}`,
      successMessage: "Credentials recovered",
      url: `/api/admin/password-reset-requests/${request.id}/recover`,
    });

    if (result) {
      setLastResult({
        credentials: result.credentials,
        notification: result.notification,
        reference: request.reference,
      });
    }
  }

  async function closeRecovery(request: RecoveryRequest) {
    await runAction({
      actionId: `recovery-close-${request.id}`,
      successMessage: "Recovery request marked reviewed",
      url: `/api/admin/password-reset-requests/${request.id}/close`,
    });
  }

  async function copyLastCredentials() {
    if (!lastResult) return;

    await navigator.clipboard.writeText(
      `Reference: ${lastResult.reference}\nUsername: ${lastResult.credentials.username}\nPassword: ${lastResult.credentials.password}`,
    );
    toast.success("Credentials copied");
  }

  const pendingAccessCount =
    payload?.accessRequests.filter((request) => request.status === "pending").length || 0;
  const pendingRecoveryCount =
    payload?.recoveryRequests.filter((request) => request.status === "pending").length || 0;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="absolute top-[-20%] left-[-10%] h-[50%] w-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] h-[40%] w-[40%] rounded-full bg-chart-2/10 blur-[100px] pointer-events-none" />
      <div className="container relative z-10 mx-auto px-4 py-6">
        <header className="mb-6 rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/15">
                <LockKeyhole className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Admin Console
                </p>
                <h1 className="text-2xl font-semibold tracking-tight">Access Review</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Signed in as {adminName}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-border bg-secondary/40">
                <Mail className="h-3.5 w-3.5" />
                {payload?.email.adminEmail || "akababatundebasit28@gmail.com"}
              </Badge>
              <Button asChild variant="outline">
                <Link href="/dashboard">
                  <Shield className="h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
            </div>
          </div>
        </header>

        {lastResult && (
          <Card className="mb-6 glass-panel border-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-5 w-5 text-chart-3" />
                Credentials generated
              </CardTitle>
              <CardDescription>
                {lastResult.notification.status === "sent"
                  ? `Email sent to ${lastResult.notification.to}.`
                  : `Open the email draft for ${lastResult.notification.to} if automatic SMTP delivery is not configured.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    Username
                  </p>
                  <p className="mt-2 break-words font-mono text-sm">{lastResult.credentials.username}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    Password
                  </p>
                  <p className="mt-2 break-words font-mono text-sm">{lastResult.credentials.password}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={copyLastCredentials}>
                  <ClipboardCopy className="h-4 w-4" />
                  Copy
                </Button>
                {lastResult.notification.status !== "sent" && (
                  <Button asChild type="button">
                    <a href={lastResult.notification.mailtoUrl}>
                      <Mail className="h-4 w-4" />
                      Email Draft
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="access" className="space-y-4">
          <TabsList>
            <TabsTrigger value="access">Access Requests ({pendingAccessCount})</TabsTrigger>
            <TabsTrigger value="recovery">Recovery Requests ({pendingRecoveryCount})</TabsTrigger>
          </TabsList>

          <TabsContent value="access">
            <Card className="glass-panel border-0">
              <CardHeader>
                <CardTitle>Access Requests</CardTitle>
                <CardDescription>Review pending account requests and generate credentials.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[620px] pr-3">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading requests
                    </div>
                  ) : payload?.accessRequests.length ? (
                    <div className="space-y-3">
                      {payload.accessRequests.map((request) => (
                        <div key={request.id} className="rounded-lg border border-border/70 bg-card/40 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge className={statusBadgeClass(request.status)}>{request.status}</Badge>
                                <span className="font-mono text-xs text-muted-foreground">{request.reference}</span>
                                <span className="text-xs text-muted-foreground">{formatDate(request.createdAt)}</span>
                              </div>
                              <div>
                                <p className="font-medium">{request.fullName}</p>
                                <p className="text-sm text-muted-foreground">{request.email}</p>
                                {request.department && (
                                  <p className="text-xs text-muted-foreground">{request.department}</p>
                                )}
                              </div>
                              <p className="max-w-3xl text-sm text-muted-foreground">{request.useCase}</p>
                              {request.approvedUsername && (
                                <p className="text-xs text-muted-foreground">
                                  Username: <span className="font-mono text-foreground">{request.approvedUsername}</span>
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button
                                type="button"
                                onClick={() => approveAccess(request)}
                                disabled={Boolean(busyAction)}
                              >
                                {busyAction === `access-approve-${request.id}` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <UserCheck className="h-4 w-4" />
                                )}
                                Grant
                              </Button>
                              {request.status === "pending" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => denyAccess(request)}
                                  disabled={Boolean(busyAction)}
                                >
                                  {busyAction === `access-deny-${request.id}` ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <UserX className="h-4 w-4" />
                                  )}
                                  Deny
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-12 text-center text-sm text-muted-foreground">No access requests yet.</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="recovery">
            <Card className="glass-panel border-0">
              <CardHeader>
                <CardTitle>Recovery Requests</CardTitle>
                <CardDescription>Reset credentials and send the updated login details.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[620px] pr-3">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading requests
                    </div>
                  ) : payload?.recoveryRequests.length ? (
                    <div className="space-y-3">
                      {payload.recoveryRequests.map((request) => (
                        <div key={request.id} className="rounded-lg border border-border/70 bg-card/40 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge className={statusBadgeClass(request.status)}>{request.status}</Badge>
                                <span className="font-mono text-xs text-muted-foreground">{request.reference}</span>
                                <span className="text-xs text-muted-foreground">{formatDate(request.createdAt)}</span>
                              </div>
                              <div>
                                <p className="font-medium">{request.fullName || request.username}</p>
                                <p className="text-sm text-muted-foreground">{request.email}</p>
                                <p className="text-xs text-muted-foreground">
                                  Requested username: <span className="font-mono text-foreground">{request.username}</span>
                                </p>
                              </div>
                              {request.note && (
                                <p className="max-w-3xl text-sm text-muted-foreground">{request.note}</p>
                              )}
                              {request.resolvedUsername && (
                                <p className="text-xs text-muted-foreground">
                                  Resolved username: <span className="font-mono text-foreground">{request.resolvedUsername}</span>
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button
                                type="button"
                                onClick={() => recoverCredentials(request)}
                                disabled={Boolean(busyAction)}
                              >
                                {busyAction === `recovery-${request.id}` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <KeyRound className="h-4 w-4" />
                                )}
                                Recover
                              </Button>
                              {request.status === "pending" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => closeRecovery(request)}
                                  disabled={Boolean(busyAction)}
                                >
                                  {busyAction === `recovery-close-${request.id}` ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="h-4 w-4" />
                                  )}
                                  Mark Reviewed
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-12 text-center text-sm text-muted-foreground">No recovery requests yet.</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
