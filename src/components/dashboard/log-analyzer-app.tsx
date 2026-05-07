"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Upload, 
  FileText, 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  XCircle,
  Activity,
  Server,
  Globe,
  User,
  TrendingUp,
  BarChart3,
  RefreshCw,
  Download,
  Trash2,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import type {
  CollectorStatus,
  EvaluationMetrics,
  ParsedEntry,
  PipelineMetadata,
} from "@/lib/pipeline-types";

// Types
interface SuspiciousActivity {
  id: string;
  activityType: string;
  severity: string;
  timestamp: string;
  sourceIp: string | null;
  username: string | null;
  description: string;
  rawLog: string;
  metadata: string | null;
  createdAt: string;
}

interface LogFile {
  id: string;
  filename: string;
  originalName: string;
  fileType: string;
  logSource: string;
  fileSize: number;
  status: string;
  pipelineMetadata: string | null;
  createdAt: string;
  activities: SuspiciousActivity[];
  parsedEntries?: ParsedEntry[];
}

interface AnalysisResult {
  logFile: LogFile;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  pipeline?: PipelineMetadata;
}

interface DemoLogSummary {
  id: string;
  filename: string;
  title: string;
  description: string;
}

interface SessionState {
  authenticated: boolean;
  user?: {
    name: string;
  };
}

interface ApiErrorPayload {
  error?: string;
  details?: string;
}

const DEFAULT_EVALUATION_DATASET_DIR = "examples/evaluation-dataset";
const DEFAULT_NORMAL_LOG_DIR = "examples/normal-training-dataset";
const SAMPLE_UPLOAD_LOG_PATH = "/sample-logs/loghub-linux-2k.log";

export type DashboardPage = "dashboard" | "upload" | "pipeline" | "logs" | "results";

interface LogAnalyzerAppProps {
  activePage: DashboardPage;
}

interface CollectorRunResponse {
  success: boolean;
  filesScanned: number;
  linesIngested: number;
  logFilesCreated: number;
  errors?: string[];
}

const DASHBOARD_NAV_ITEMS: Array<{
  href: string;
  label: string;
  page: DashboardPage;
  icon: typeof Shield;
}> = [
  { href: "/dashboard", label: "Dashboard", page: "dashboard", icon: Shield },
  { href: "/upload", label: "Upload", page: "upload", icon: Upload },
  { href: "/pipeline", label: "Pipeline", page: "pipeline", icon: Activity },
  { href: "/logs", label: "Log Files", page: "logs", icon: FileText },
  { href: "/results", label: "Results", page: "results", icon: BarChart3 },
];

function parseMetadata(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parsePipelineMetadata(value: string | null): PipelineMetadata | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as PipelineMetadata;
  } catch {
    return null;
  }
}

function formatRatio(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

export default function LogAnalyzerApp({ activePage }: LogAnalyzerAppProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogFile | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatus | null>(null);
  const [isTrainingModel, setIsTrainingModel] = useState(false);
  const [isCollectorRunning, setIsCollectorRunning] = useState(false);
  const [isRunningEvaluation, setIsRunningEvaluation] = useState(false);
  const [latestEvaluation, setLatestEvaluation] = useState<EvaluationMetrics | null>(null);
  const [demoLogs, setDemoLogs] = useState<DemoLogSummary[]>([]);
  const [demoLoadingId, setDemoLoadingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [trainingDatasetDir, setTrainingDatasetDir] = useState(DEFAULT_NORMAL_LOG_DIR);
  const [evaluationDatasetDir, setEvaluationDatasetDir] = useState(DEFAULT_EVALUATION_DATASET_DIR);
  const [lastCollectorResult, setLastCollectorResult] = useState<CollectorRunResponse | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const isDashboardPage = activePage === "dashboard";
  const isLogsPage = activePage === "logs";
  const showUploadPanel = isDashboardPage || activePage === "upload";
  const showPipelinePanel = isDashboardPage || activePage === "pipeline";
  const showLogFilesPanel = isDashboardPage || activePage === "logs";
  const showResultsPanel = isDashboardPage || activePage === "results";
  const showLeftColumn = showUploadPanel || showPipelinePanel || showLogFilesPanel;

  // Fetch log files on mount
  const fetchLogFiles = useCallback(async () => {
    try {
      const response = await fetch("/api/logs");
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as ApiErrorPayload;
        const message = [error.error, error.details].filter(Boolean).join(": ") || "Failed to load log files";
        setPipelineError(message);
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setLogFiles(data.logFiles || []);
        setPipelineError(null);
      }
    } catch (error) {
      console.error("Error fetching log files:", error);
    }
  }, []);

  const fetchCollectorStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/collector/status");
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as ApiErrorPayload;
        const message = [error.error, error.details].filter(Boolean).join(": ") || "Failed to load collector status";
        setPipelineError(message);
        return;
      }
      const data = await response.json();
      setCollectorStatus(data);
      setPipelineError(null);
    } catch (error) {
      console.error("Error fetching collector status:", error);
    }
  }, []);

  const fetchDemoLogs = useCallback(async () => {
    try {
      const response = await fetch("/api/demo-logs");
      if (!response.ok) return;
      const data = await response.json();
      setDemoLogs(data.demoLogs || []);
    } catch (error) {
      console.error("Error fetching demo logs:", error);
    }
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session");
      if (!response.ok) {
        setSession(null);
        return;
      }
      const data = (await response.json()) as SessionState;
      setSession(data);
    } catch (error) {
      console.error("Error fetching session:", error);
      setSession(null);
    }
  }, []);

  const loadLogDetails = useCallback(async (logId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/logs/${logId}`);
      if (!response.ok) {
        toast.error("Failed to load log details");
        return;
      }

      const result = await response.json();
      setSelectedLog(result.logFile);
      setAnalysisResult({
        logFile: result.logFile,
        summary: result.summary,
        pipeline: parsePipelineMetadata(result.logFile?.pipelineMetadata || null) || undefined,
      });
    } catch (error) {
      console.error("Error loading log details:", error);
      toast.error("An error occurred while loading log details");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogFiles();
    fetchCollectorStatus();
    fetchDemoLogs();
    fetchSession();
  }, [fetchLogFiles, fetchCollectorStatus, fetchDemoLogs, fetchSession]);

  useEffect(() => {
    const logId = searchParams.get("logId");
    if (activePage === "results" && logId) {
      void loadLogDetails(logId);
    }
  }, [activePage, loadLogDetails, searchParams]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleFileUpload(files[0]);
    }
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await handleFileUpload(files[0]);
    }
  }, []);

  async function handleFileUpload(file: File) {
    // Validate file type
    const validTypes = [".log", ".txt", ".json"];
    const fileExt = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!validTypes.includes(fileExt)) {
      toast.error("Invalid file type. Please upload .log, .txt, or .json files.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 100);

      const response = await fetch("/api/logs/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (response.ok) {
        const result = await response.json();
        setAnalysisResult(result);
        setSelectedLog(result.logFile);
        toast.success(`Successfully analyzed ${file.name}`);
        fetchLogFiles();
        if (!isDashboardPage) {
          router.push(`/results?logId=${result.logFile.id}`);
        }
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to analyze log file");
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("An error occurred during upload");
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(0), 500);
    }
  }

  const handleAnalyzeLog = async (logId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/logs/${logId}/analyze`, {
        method: "POST",
      });

      if (response.ok) {
        const result = await response.json();
        setAnalysisResult(result);
        setSelectedLog(result.logFile);
        toast.success("Analysis completed");
        fetchLogFiles();
        if (!isDashboardPage) {
          router.push(`/results?logId=${result.logFile.id}`);
        }
      } else {
        toast.error("Failed to analyze log file");
      }
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error("An error occurred during analysis");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeDemoLog = async (demoLogId: string) => {
    setDemoLoadingId(demoLogId);
    try {
      const response = await fetch(`/api/demo-logs/${demoLogId}/analyze`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        toast.error(error.error || "Failed to analyze demo log");
        return;
      }

      const result = await response.json();
      setAnalysisResult(result);
      setSelectedLog(result.logFile);
      toast.success("Demo log analyzed");
      fetchLogFiles();
      if (!isDashboardPage) {
        router.push(`/results?logId=${result.logFile.id}`);
      }
    } catch (error) {
      console.error("Demo log analysis error:", error);
      toast.error("An error occurred while analyzing the demo log");
    } finally {
      setDemoLoadingId(null);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    try {
      const response = await fetch(`/api/logs/${logId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Log file deleted");
        fetchLogFiles();
        if (selectedLog?.id === logId) {
          setSelectedLog(null);
          setAnalysisResult(null);
        }
      } else {
        toast.error("Failed to delete log file");
      }
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("An error occurred");
    }
  };

  const handleTrainModel = async () => {
    setIsTrainingModel(true);
    try {
      const response = await fetch("/api/model/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          normalLogDir: trainingDatasetDir.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as ApiErrorPayload;
        const message = [error.error, error.details].filter(Boolean).join(": ") || "Failed to train model";
        setPipelineError(message);
        toast.error(message);
        return;
      }

      const result = await response.json();
      setPipelineError(null);
      toast.success(`Model trained with ${result.trainedSamples ?? 0} samples`);
    } catch (error) {
      console.error("Train model error:", error);
      toast.error("An error occurred during model training");
    } finally {
      setIsTrainingModel(false);
    }
  };

  const handleRunCollector = async () => {
    setIsCollectorRunning(true);
    try {
      const response = await fetch("/api/collector/run", {
        method: "POST",
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as ApiErrorPayload;
        const message = [error.error, error.details].filter(Boolean).join(": ") || "Failed to run collector";
        setPipelineError(message);
        toast.error(message);
        return;
      }

      const result = await response.json();
      setLastCollectorResult(result);
      setPipelineError(null);
      if ((result.filesScanned ?? 0) === 0) {
        toast.warning("Collector completed, but no readable log paths were found.");
      } else {
        toast.success(
          `Collector finished: ${result.filesScanned ?? 0} files, ${result.linesIngested ?? 0} lines ingested`
        );
      }
      fetchLogFiles();
      fetchCollectorStatus();
    } catch (error) {
      console.error("Collector run error:", error);
      toast.error("An error occurred while running collector");
    } finally {
      setIsCollectorRunning(false);
    }
  };

  const handleRunEvaluation = async () => {
    setIsRunningEvaluation(true);
    try {
      const response = await fetch("/api/evaluation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetDir: evaluationDatasetDir.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as ApiErrorPayload;
        const message = [error.error, error.details].filter(Boolean).join(": ") || "Failed to run evaluation";
        setPipelineError(message);
        toast.error(message);
        return;
      }

      const result = await response.json();
      setLatestEvaluation(result.metrics || null);
      setPipelineError(null);
      const sampleCount = result.metrics?.sampleCount ?? result.metrics?.ruleSampleCount ?? "n/a";
      const templateCount = result.metrics?.templateCount ?? "n/a";
      toast.success(`Evaluation completed: ${sampleCount} samples, ${templateCount} templates`);
    } catch (error) {
      console.error("Evaluation error:", error);
      toast.error("An error occurred while running evaluation");
    } finally {
      setIsRunningEvaluation(false);
    }
  };

  const handleExport = async () => {
    const logId = analysisResult?.logFile.id;
    if (!logId) {
      toast.error("No analysis result available to export");
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch(`/api/logs/${logId}/export`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        toast.error(error.error || "Failed to export analysis");
        return;
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || "analysis.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Analysis exported");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("An error occurred during export");
    } finally {
      setIsExporting(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Failed to log out");
      setIsLoggingOut(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-red-500 text-white";
      case "high": return "bg-orange-500 text-white";
      case "medium": return "bg-yellow-500 text-black";
      case "low": return "bg-green-500 text-white";
      default: return "bg-gray-500 text-white";
    }
  };

  const getActivityTypeIcon = (type: string) => {
    switch (type) {
      case "failed_login": return <User className="h-4 w-4" />;
      case "privilege_escalation": return <TrendingUp className="h-4 w-4" />;
      case "brute_force": return <Activity className="h-4 w-4" />;
      case "unauthorized_access": return <Shield className="h-4 w-4" />;
      case "web_attack": return <Globe className="h-4 w-4" />;
      case "reconnaissance": return <BarChart3 className="h-4 w-4" />;
      case "data_exfiltration": return <Download className="h-4 w-4" />;
      case "multi_step_attack": return <AlertTriangle className="h-4 w-4" />;
      case "anomaly": return <AlertTriangle className="h-4 w-4" />;
      case "suspicious_ip": return <Globe className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "processing": return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case "error": return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getFileTypeLabel = (type: string) => {
    switch (type) {
      case "auth": return "Auth Log";
      case "syslog": return "System Log";
      case "web_access": return "Web Access";
      case "web_error": return "Web Error";
      case "mixed": return "Mixed Sources";
      default: return "Unknown";
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const summaryFromLog = (log: LogFile) => ({
    total: log.activities.length,
    critical: log.activities.filter((a) => a.severity === "critical").length,
    high: log.activities.filter((a) => a.severity === "high").length,
    medium: log.activities.filter((a) => a.severity === "medium").length,
    low: log.activities.filter((a) => a.severity === "low").length,
  });

  const currentPipelineMeta =
    analysisResult?.pipeline ||
    parsePipelineMetadata(analysisResult?.logFile?.pipelineMetadata || null);
  const templatesGenerated =
    (currentPipelineMeta && Number(currentPipelineMeta.templatesGenerated || 0)) || 0;
  const mlAnomalyCount =
    (currentPipelineMeta && Number(currentPipelineMeta.mlAnomalyCount || 0)) || 0;
  const mlServiceStatus = currentPipelineMeta?.mlServiceStatus || "unavailable";
  const mlServiceError = currentPipelineMeta?.mlServiceError || null;
  const privacy = currentPipelineMeta?.privacy || null;
  const ruleSummary = currentPipelineMeta?.ruleSummary || null;
  const parsedEntries = analysisResult?.logFile.parsedEntries || [];
  const collectorStatusLabel = collectorStatus?.status || "idle";

  return (
    <div className="min-h-screen bg-background relative overflow-hidden font-sans">
      {/* Dynamic Background Elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-chart-2/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Header */}
      <motion.header 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="border-b border-border/50 bg-background/50 backdrop-blur-xl sticky top-0 z-50 shadow-sm"
      >
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-xl border border-primary/30 glow-border">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground tracking-tight glow-text">Log Analysis System</h1>
                <p className="text-sm text-muted-foreground">Advanced Threat Detection</p>
              </div>
            </div>
            <nav className="flex w-full flex-wrap items-center gap-2 xl:w-auto" aria-label="Dashboard sections">
              {DASHBOARD_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.page;

                return (
                  <Button
                    key={item.href}
                    asChild
                    variant="ghost"
                    size="sm"
                    className={`rounded-md border transition-all ${
                      isActive
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-transparent text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                    }`}
                  >
                    <Link href={item.href}>
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </Button>
                );
              })}
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-border text-foreground bg-secondary/30 backdrop-blur-md">
                <Server className="h-3 w-3 mr-1 text-primary" />
                Hybrid Environment
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="border-border bg-secondary/30 text-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
              >
                <LogOut className="h-4 w-4 mr-2" />
                {isLoggingOut ? "Signing out..." : session?.user?.name || "Sign out"}
              </Button>
            </div>
          </div>
        </div>
      </motion.header>

      <main className="container mx-auto px-4 py-6 relative z-10">
        <div className={isDashboardPage ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : "grid grid-cols-1 gap-6"}>
          {/* Left Column - Upload & History */}
          {showLeftColumn && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className={isDashboardPage ? "lg:col-span-1 space-y-6" : "space-y-6"}
          >
            {/* Upload Section */}
            {showUploadPanel && (
            <Card className="glass-panel overflow-hidden border-0 glow-border">
                <CardHeader className="bg-card/40 border-b border-border/50 pb-4">
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Upload className="h-5 w-5 text-primary" />
                    Upload Log File
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                  Upload your own log file, download the prepared sample, or start with a bundled demo.
                  </CardDescription>
                </CardHeader>
              <CardContent className="pt-6">
                <div
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 ${
                    isDragging
                      ? "border-primary bg-primary/10 scale-[1.02]"
                      : "border-border hover:border-primary/50 hover:bg-primary/10"
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    accept=".log,.txt,.json"
                    onChange={handleFileSelect}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={isUploading}
                  />
                  <div className="space-y-4">
                    <motion.div 
                      animate={isDragging ? { y: -5, scale: 1.1 } : { y: 0, scale: 1 }}
                      className="mx-auto w-12 h-12 rounded-full bg-secondary flex items-center justify-center shadow-inner border border-border/50"
                    >
                      <FileText className="h-6 w-6 text-primary" />
                    </motion.div>
                    <div>
                      <p className="text-foreground font-medium">
                        {isDragging ? "Drop file here to analyze" : "Drag & drop or click to upload"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Supports auth.log, syslog, Apache/Nginx logs
                      </p>
                    </div>
                  </div>
                </div>
                <Button
                  asChild
                  variant="outline"
                  className="mt-4 w-full border-border bg-secondary/30 text-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                >
                  <a href={SAMPLE_UPLOAD_LOG_PATH} download>
                    <Download className="h-4 w-4" />
                    Download real Loghub Linux log
                  </a>
                </Button>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Open-access Linux system log from Loghub, suitable for testing the upload flow with real auth events.
                </p>
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">Try A Demo Log</p>
                    <p className="text-xs text-muted-foreground">Useful when you do not have your own file yet.</p>
                  </div>
                  <div className="grid gap-2">
                    {demoLogs.map((demoLog) => (
                      <button
                        key={demoLog.id}
                        type="button"
                        onClick={() => handleAnalyzeDemoLog(demoLog.id)}
                        disabled={Boolean(demoLoadingId)}
                        className="w-full cursor-pointer rounded-xl border border-border bg-card/40 px-4 py-3 text-left transition-all hover:border-primary/30 hover:bg-primary/10 disabled:opacity-60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">{demoLog.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{demoLog.description}</p>
                          </div>
                          <span className="text-xs font-mono text-primary">
                            {demoLoadingId === demoLog.id ? "Loading..." : "Run"}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <AnimatePresence>
                  {isUploading && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-6 space-y-2"
                    >
                      <Progress value={uploadProgress} className="h-2 bg-secondary" />
                      <p className="text-sm text-muted-foreground text-center font-mono">
                        {uploadProgress < 100 ? "Analyzing heuristics & ML models..." : "Processing complete"}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
            )}

            {/* Pipeline Controls */}
            {showPipelinePanel && (
            <Card className="glass-panel border-0">
              <CardHeader className="bg-card/40 border-b border-border/50 pb-4">
                <CardTitle className="text-foreground flex items-center gap-2">
                  <Activity className="h-5 w-5 text-chart-2" />
                  Pipeline Controls
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  Train the anomaly model, run the collector, and execute evaluation jobs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-6">
                <Button
                  type="button"
                  onClick={handleTrainModel}
                  disabled={isTrainingModel}
                  className="w-full bg-primary hover:bg-primary/80 text-primary-foreground shadow-lg shadow-primary/20 transition-all"
                >
                  {isTrainingModel ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Shield className="h-4 w-4 mr-2" />
                  )}
                  Train Model
                </Button>
                <div className="space-y-2 pt-2">
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">
                    Training Dataset
                  </label>
                  <Input
                    value={trainingDatasetDir}
                    onChange={(event) => setTrainingDatasetDir(event.target.value)}
                    placeholder={DEFAULT_NORMAL_LOG_DIR}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave the bundled baseline in place or point to another directory of normal logs.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    onClick={handleRunCollector}
                    disabled={isCollectorRunning}
                    variant="outline"
                    className="w-full border-border bg-secondary/30 text-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                  >
                    {isCollectorRunning ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Server className="h-4 w-4 mr-2 text-chart-3" />
                    )}
                    Collector
                  </Button>
                  <Button
                    type="button"
                    onClick={handleRunEvaluation}
                    disabled={isRunningEvaluation}
                    variant="outline"
                    className="w-full border-border bg-secondary/30 text-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                  >
                    {isRunningEvaluation ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <BarChart3 className="h-4 w-4 mr-2 text-chart-4" />
                    )}
                    Evaluation
                  </Button>
                </div>
                <div className="space-y-2 pt-2">
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">
                    Evaluation Dataset
                  </label>
                  <Input
                    value={evaluationDatasetDir}
                    onChange={(event) => setEvaluationDatasetDir(event.target.value)}
                    placeholder={DEFAULT_EVALUATION_DATASET_DIR}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Keep the bundled default or replace it with another dataset directory.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Collector paths are most useful on self-hosted Linux deployments where real server logs are readable.
                </p>
                <p className="text-xs text-muted-foreground">
                  Model training and evaluation run inside the app by default, including on Netlify. Set <span className="font-mono">ML_SERVICE_MODE=external</span> only if you want the optional Python service.
                </p>
                <div className="text-xs text-muted-foreground space-y-1 pt-3 border-t border-border/50 font-mono mt-2">
                  <div className="flex justify-between items-center">
                    <span>Status:</span> 
                    <span className="text-foreground flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${collectorStatusLabel === 'running' ? 'bg-chart-3 animate-pulse' : 'bg-muted-foreground'}`}></span>
                      {collectorStatusLabel}
                    </span>
                  </div>
                  {collectorStatus?.lastRunAt && (
                    <div className="flex justify-between">
                      <span>Last run:</span>
                      <span>{new Date(collectorStatus.lastRunAt).toLocaleTimeString()}</span>
                    </div>
                  )}
                  {collectorStatus?.lastError && (
                    <p className="text-destructive mt-1 truncate">Error: {collectorStatus.lastError}</p>
                  )}
                </div>
                {(lastCollectorResult || latestEvaluation) && (
                  <div className="space-y-3 rounded-xl border border-border bg-background/35 p-4">
                    {lastCollectorResult && (
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-widest text-muted-foreground">Collector Result</p>
                        <p className="text-sm text-foreground">
                          {lastCollectorResult.filesScanned} files scanned, {lastCollectorResult.linesIngested} lines ingested, {lastCollectorResult.logFilesCreated} log files created.
                        </p>
                        {lastCollectorResult.filesScanned === 0 && (
                          <p className="text-xs leading-5 text-chart-4">
                            No default Linux log paths were readable on this machine. Set LOG_COLLECTOR_PATHS to a readable local file path or use the upload page sample.
                          </p>
                        )}
                      </div>
                    )}
                    {latestEvaluation && (
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-widest text-muted-foreground">Evaluation Result</p>
                        <p className="text-sm text-foreground">
                          Samples: {String(latestEvaluation.sampleCount ?? latestEvaluation.ruleSampleCount ?? "n/a")} | Templates: {String(latestEvaluation.templateCount ?? "n/a")} | Anomaly rate: {typeof latestEvaluation.anomalyRate === "number" ? latestEvaluation.anomalyRate.toFixed(4) : "n/a"}
                        </p>
                        {latestEvaluation.confusionMatrix && (
                          <p className="text-xs leading-5 text-muted-foreground">
                            Labelled: {String(latestEvaluation.labelledSampleCount ?? "manual")} | Accuracy: {formatRatio(latestEvaluation.confusionMatrix.accuracy)} | Precision: {formatRatio(latestEvaluation.confusionMatrix.precision)} | Recall: {formatRatio(latestEvaluation.confusionMatrix.recall)} | F1: {formatRatio(latestEvaluation.confusionMatrix.f1Score)}
                          </p>
                        )}
                        {typeof latestEvaluation.multiclassAccuracy === "number" && (
                          <p className="text-xs leading-5 text-muted-foreground">
                            Class accuracy: {formatRatio(latestEvaluation.multiclassAccuracy)} across {latestEvaluation.classLabels?.join(", ") || "truth-table labels"}.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {pipelineError && (
                  <Alert className="border-destructive/40 bg-destructive/10 backdrop-blur-md">
                    <AlertTitle className="text-destructive font-semibold">Pipeline Action Failed</AlertTitle>
                    <AlertDescription className="text-sm text-foreground/85">
                      {pipelineError}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
            )}

            {/* Log Files History */}
            {showLogFilesPanel && (
            <Card
              className={`glass-panel border-0 flex flex-col overflow-hidden ${
                isLogsPage ? "h-[70vh] min-h-[540px]" : "max-h-[400px]"
              }`}
            >
              <CardHeader className="bg-card/40 border-b border-border/50 pb-4 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <FileText className="h-5 w-5 text-chart-1" />
                    Log Files
                  </CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={fetchLogFiles}
                    className="text-muted-foreground hover:text-foreground h-8 w-8 p-0 rounded-full"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className={`h-full ${isLogsPage ? "p-4 pr-3" : "p-4"}`}>
                  {logFiles.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" />
                      <p className="text-sm font-medium">No log files uploaded yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <AnimatePresence>
                        {logFiles.map((log) => (
                          <motion.div
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            key={log.id}
                            className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 group ${
                              selectedLog?.id === log.id
                                ? "border-primary bg-primary/10 shadow-[0_0_15px_oklch(var(--color-primary)/0.15)]"
                                : "border-border bg-card/40 hover:border-primary/30 hover:bg-primary/10"
                            }`}
                            onClick={() => {
                              if (activePage === "logs") {
                                router.push(`/results?logId=${log.id}`);
                                return;
                              }
                              void loadLogDetails(log.id);
                            }}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0 pr-2">
                                <div className="flex items-center gap-2">
                                  {getStatusIcon(log.status)}
                                  <p className="text-foreground text-sm font-medium truncate group-hover:text-primary transition-colors">
                                    {log.originalName}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-border bg-background/50 text-muted-foreground font-mono">
                                    {getFileTypeLabel(log.fileType)}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {formatFileSize(log.fileSize)}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2 shrink-0">
                                {log.status === "completed" && (
                                  <Badge className="bg-destructive/20 text-destructive border-destructive/30 border shadow-[0_0_10px_oklch(var(--color-destructive)/0.2)]">
                                    {log.activities?.length || 0} alerts
                                  </Badge>
                                )}
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAnalyzeLog(log.id);
                                    }}
                                    disabled={isLoading}
                                  >
                                    <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteLog(log.id);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
            )}
          </motion.div>
          )}

          {/* Right Column - Analysis Results */}
          {showResultsPanel && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className={isDashboardPage ? "lg:col-span-2 space-y-6" : "space-y-6"}
          >
            {/* Analysis Result */}
            {analysisResult ? (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
                    <Card className="glass-panel border-0">
                      <CardContent className="p-4">
                        <div className="min-w-0 text-center">
                          <p className="text-2xl font-bold leading-tight text-foreground glow-text">{analysisResult.summary.total}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground font-mono">Total Alerts</p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
                    <Card className="bg-destructive/10 border-destructive/30 border shadow-[0_0_15px_oklch(var(--color-destructive)/0.15)]">
                      <CardContent className="p-4">
                        <div className="min-w-0 text-center">
                          <p className="text-2xl font-bold leading-tight text-destructive" style={{ textShadow: "0 0 10px oklch(var(--color-destructive)/0.5)" }}>{analysisResult.summary.critical}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-wide text-destructive/80 font-mono">Critical</p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
                    <Card className="bg-chart-4/10 border-chart-4/30 border shadow-[0_0_15px_oklch(var(--color-chart-4)/0.15)]">
                      <CardContent className="p-4">
                        <div className="min-w-0 text-center">
                          <p className="text-2xl font-bold leading-tight text-chart-4" style={{ textShadow: "0 0 10px oklch(var(--color-chart-4)/0.5)" }}>{analysisResult.summary.high}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-wide text-chart-4/80 font-mono">High</p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
                    <Card className="bg-chart-5/10 border-chart-5/30 border shadow-[0_0_15px_oklch(var(--color-chart-5)/0.15)]">
                      <CardContent className="p-4">
                        <div className="min-w-0 text-center">
                          <p className="text-2xl font-bold leading-tight text-chart-5" style={{ textShadow: "0 0 10px oklch(var(--color-chart-5)/0.5)" }}>{analysisResult.summary.medium}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-wide text-chart-5/80 font-mono">Medium</p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}>
                    <Card className="bg-chart-3/10 border-chart-3/30 border shadow-[0_0_15px_oklch(var(--color-chart-3)/0.15)]">
                      <CardContent className="p-4">
                        <div className="min-w-0 text-center">
                          <p className="text-2xl font-bold leading-tight text-chart-3" style={{ textShadow: "0 0 10px oklch(var(--color-chart-3)/0.5)" }}>{analysisResult.summary.low}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-wide text-chart-3/80 font-mono">Low</p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  <Card className="glass-panel border-0">
                    <CardContent className="min-w-0 p-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Normalized Lines</p>
                      <p className="mt-1 font-mono text-lg font-semibold leading-tight text-foreground break-words">
                        {ruleSummary?.normalizedEntries ?? parsedEntries.length}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="glass-panel border-0">
                    <CardContent className="min-w-0 p-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Templates Generated</p>
                      <p className="mt-1 font-mono text-lg font-semibold leading-tight text-chart-1 break-words">{templatesGenerated}</p>
                    </CardContent>
                  </Card>
                  <Card className="glass-panel border-0">
                    <CardContent className="min-w-0 p-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">ML Anomalies</p>
                      <p className="mt-1 font-mono text-lg font-semibold leading-tight text-chart-4 break-words">{mlAnomalyCount}</p>
                    </CardContent>
                  </Card>
                  <Card className="glass-panel border-0">
                    <CardContent className="min-w-0 p-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">ML Service</p>
                      <p className={`mt-1 font-mono text-sm font-semibold capitalize leading-tight break-words ${mlServiceStatus === "available" ? "text-chart-3" : "text-destructive"}`}>
                        {mlServiceStatus}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="glass-panel border-0">
                    <CardContent className="min-w-0 p-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Correlations</p>
                      <p className="mt-1 font-mono text-lg font-semibold leading-tight text-destructive break-words">
                        {ruleSummary?.correlatedAlerts ?? 0}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="glass-panel border-0">
                    <CardContent className="min-w-0 p-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Collector Status</p>
                      <p className="mt-1 font-mono text-sm font-semibold capitalize leading-tight text-foreground break-words">{collectorStatusLabel}</p>
                    </CardContent>
                  </Card>
                </div>

                {mlServiceError && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                    <Alert className="border-chart-4/40 bg-chart-4/10 backdrop-blur-md">
                      <AlertTitle className="text-chart-4 font-semibold">ML Service Fallback Active</AlertTitle>
                      <AlertDescription className="text-foreground/80 text-sm">
                        Rule-based analysis completed, but the ML service was unavailable: {mlServiceError}
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                {privacy && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                    <Alert className="border-chart-3/40 bg-chart-3/10 backdrop-blur-md">
                      <AlertTitle className="text-chart-3 font-semibold">Privacy Guard</AlertTitle>
                      <AlertDescription className="text-foreground/80 text-sm">
                        AI/ML input sanitized: IPs {privacy.replacements.ipAddresses}, users {privacy.replacements.usernames}, emails {privacy.replacements.emails}, hosts {privacy.replacements.hostnames}
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                {latestEvaluation && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                    <Alert className="border-primary/40 bg-primary/10 backdrop-blur-md">
                      <AlertTitle className="text-primary font-semibold">Latest Evaluation</AlertTitle>
                      <AlertDescription className="text-foreground/80 text-sm">
                        Samples: {String(latestEvaluation.sampleCount ?? "n/a")} | Templates: {String(latestEvaluation.templateCount ?? "n/a")} | Anomaly rate: {typeof latestEvaluation.anomalyRate === "number" ? latestEvaluation.anomalyRate.toFixed(4) : "n/a"}
                        {latestEvaluation.confusionMatrix && (
                          <>
                            {" | Accuracy: "}{formatRatio(latestEvaluation.confusionMatrix.accuracy)}
                            {" | Precision: "}{formatRatio(latestEvaluation.confusionMatrix.precision)}
                            {" | Recall: "}{formatRatio(latestEvaluation.confusionMatrix.recall)}
                            {" | F1: "}{formatRatio(latestEvaluation.confusionMatrix.f1Score)}
                          </>
                        )}
                        {typeof latestEvaluation.multiclassAccuracy === "number" && (
                          <>
                            {" | Class accuracy: "}{formatRatio(latestEvaluation.multiclassAccuracy)}
                          </>
                        )}
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                <Card className="glass-panel border-0">
                  <CardHeader className="bg-card/40 border-b border-border/50 pb-4">
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-chart-1" />
                      Structured Parsing Output
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Drain3 templates and Isolation Forest per-line scores
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-72 p-4">
                      {parsedEntries.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground">
                          <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-20" />
                          <p className="text-sm">No structured ML entries are stored for this log.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {parsedEntries.slice(0, 200).map((entry) => (
                            <div
                              key={entry.id || `${entry.lineNumber}-${entry.templateId || "template"}`}
                              className="rounded-xl border border-border bg-card/30 p-4 transition-all hover:bg-secondary/40"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="border-border bg-background/50 font-mono text-muted-foreground">
                                  Line {entry.lineNumber}
                                </Badge>
                                {entry.detector && (
                                  <Badge variant="outline" className="border-primary/50 text-primary bg-primary/5">
                                    {entry.detector}
                                  </Badge>
                                )}
                                {entry.anomalyFlag && (
                                  <Badge className="bg-chart-4 text-chart-4-foreground shadow-[0_0_10px_oklch(var(--color-chart-4)/0.3)]">Anomaly</Badge>
                                )}
                                {typeof entry.anomalyScore === "number" && (
                                  <span className="text-primary font-mono bg-primary/10 px-2 py-0.5 rounded">Score: {entry.anomalyScore.toFixed(4)}</span>
                                )}
                                {entry.templateId && <span className="font-mono bg-secondary px-2 py-0.5 rounded">TID: {entry.templateId}</span>}
                              </div>
                              {entry.templateText && (
                                <p className="mt-3 text-sm text-foreground/90 font-mono bg-background/50 p-2 rounded-md border border-border/50">{entry.templateText}</p>
                              )}
                              <p className="mt-3 text-xs text-muted-foreground font-mono truncate px-2 border-l-2 border-border/50">
                                {entry.normalizedText || entry.rawLine}
                              </p>
                            </div>
                          ))}
                          {parsedEntries.length > 200 && (
                            <p className="pt-4 text-center text-xs text-muted-foreground font-mono">
                              Showing first 200 of {parsedEntries.length} parsed entries.
                            </p>
                          )}
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Results Table */}
                <Card className="glass-panel border-0">
                  <CardHeader className="bg-card/40 border-b border-border/50 pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-foreground flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive glow-text" />
                        Detected Suspicious Activities
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleExport}
                          disabled={isExporting}
                          className="border-border bg-secondary/30 text-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                        >
                          <Download className="h-4 w-4 mr-1 text-primary" />
                          {isExporting ? "Exporting..." : "Export"}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[500px] p-4">
                      {analysisResult.logFile.activities.length === 0 ? (
                        <div className="text-center py-12">
                          <CheckCircle className="h-16 w-16 mx-auto text-chart-3 mb-4 drop-shadow-[0_0_15px_oklch(var(--color-chart-3)/0.3)]" />
                          <p className="text-foreground text-lg font-medium">No suspicious activities detected</p>
                          <p className="text-sm text-muted-foreground mt-2">This log file appears to be clean</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <AnimatePresence>
                            {analysisResult.logFile.activities.map((activity, index) => {
                              const metadata = parseMetadata(activity.metadata);
                              const detector = typeof metadata?.detector === "string" ? metadata.detector : "rule";
                              const anomalyScoreRaw = metadata?.anomalyScore;
                              const anomalyScore =
                                typeof anomalyScoreRaw === "number"
                                  ? anomalyScoreRaw
                                  : typeof anomalyScoreRaw === "string"
                                  ? Number(anomalyScoreRaw)
                                  : null;
                              const templateId = typeof metadata?.templateId === "string" ? metadata.templateId : null;
                              const templateText = typeof metadata?.templateText === "string" ? metadata.templateText : null;

                              return (
                                <motion.div
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: index * 0.05 }}
                                  key={activity.id}
                                  className="p-5 rounded-xl bg-card/30 border border-border hover:border-border/80 transition-colors shadow-sm"
                                >
                                  <div className="flex items-start gap-4">
                                    <div className="p-3 rounded-xl bg-background/50 border border-border/50">
                                      {getActivityTypeIcon(activity.activityType)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <Badge className={`shadow-sm ${getSeverityColor(activity.severity)}`}>
                                          {activity.severity.toUpperCase()}
                                        </Badge>
                                        <Badge variant="outline" className="border-border bg-background/50 text-foreground font-mono text-[10px] uppercase">
                                          {activity.activityType.replace(/_/g, " ")}
                                        </Badge>
                                        <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 font-mono text-[10px] uppercase">
                                          {detector}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground font-mono bg-secondary/50 px-2 py-0.5 rounded-full">
                                          #{index + 1}
                                        </span>
                                      </div>
                                      <p className="text-foreground text-sm mb-3 font-medium">{activity.description}</p>
                                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap font-mono bg-background/30 p-2 rounded-lg border border-border/30">
                                        {activity.timestamp && (
                                          <span className="flex items-center gap-1.5">
                                            <Clock className="h-3 w-3 text-primary" />
                                            {activity.timestamp}
                                          </span>
                                        )}
                                        {activity.sourceIp && (
                                          <span className="flex items-center gap-1.5">
                                            <Globe className="h-3 w-3 text-chart-2" />
                                            {activity.sourceIp}
                                          </span>
                                        )}
                                        {activity.username && (
                                          <span className="flex items-center gap-1.5">
                                            <User className="h-3 w-3 text-chart-4" />
                                            {activity.username}
                                          </span>
                                        )}
                                        {Number.isFinite(anomalyScore) && (
                                          <span className="text-chart-1 font-bold">
                                            Score: {(anomalyScore as number).toFixed(4)}
                                          </span>
                                        )}
                                        {templateId && (
                                          <span className="text-muted-foreground">TID: {templateId}</span>
                                        )}
                                      </div>
                                      {templateText && (
                                        <p className="text-xs text-muted-foreground mt-3 font-mono bg-background/50 p-2 rounded border border-border/30">
                                          <span className="text-foreground/70">Template:</span> {templateText}
                                        </p>
                                      )}
                                      <details className="mt-4 group">
                                        <summary className="text-xs text-primary font-medium cursor-pointer hover:text-primary/80 transition-colors focus:outline-none list-none flex items-center gap-1">
                                          <span className="group-open:hidden">▶ View raw log</span>
                                          <span className="hidden group-open:inline">▼ Hide raw log</span>
                                        </summary>
                                        <pre className="mt-3 p-3 bg-[#0a0a0c] border border-border/50 rounded-lg text-[11px] text-muted-foreground overflow-x-auto font-mono shadow-inner">
                                          {activity.rawLog}
                                        </pre>
                                      </details>
                                    </div>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </AnimatePresence>
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            ) : (
              /* Empty State */
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="h-full"
              >
                <Card className="glass-panel border-0 h-full min-h-[600px] flex items-center justify-center glow-border relative overflow-hidden">
                  {/* Subtle background glow in empty state */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/5 blur-[80px] rounded-full pointer-events-none" />
                  
                  <CardContent className="text-center relative z-10 w-full max-w-2xl mx-auto">
                    <motion.div 
                      animate={{ y: [0, -10, 0] }} 
                      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                      className="mx-auto w-28 h-28 rounded-full bg-secondary/50 flex items-center justify-center mb-8 border border-border shadow-[0_0_30px_oklch(var(--color-primary)/0.1)]"
                    >
                      <BarChart3 className="h-12 w-12 text-primary/80" />
                    </motion.div>
                    <h3 className="text-3xl font-bold text-foreground mb-4 tracking-tight glow-text">No Analysis Yet</h3>
                    <p className="text-muted-foreground mb-10 max-w-lg mx-auto text-lg leading-relaxed">
                      Upload a log file, run one of the bundled demo incidents, or collect from configured server paths.
                      The system detects failed logins, brute force attempts, privilege escalation, and related anomalies
                      with a hybrid rules-plus-ML pipeline.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-medium">
                      <div className="p-4 rounded-xl bg-card/40 border border-border hover:border-primary/30 hover:bg-primary/10 transition-all hover:-translate-y-1">
                        <User className="h-6 w-6 mx-auto mb-3 text-chart-1" />
                        <p className="text-foreground">Failed Logins</p>
                      </div>
                      <div className="p-4 rounded-xl bg-card/40 border border-border hover:border-primary/30 hover:bg-primary/10 transition-all hover:-translate-y-1">
                        <Activity className="h-6 w-6 mx-auto mb-3 text-chart-4" />
                        <p className="text-foreground">Brute Force</p>
                      </div>
                      <div className="p-4 rounded-xl bg-card/40 border border-border hover:border-primary/30 hover:bg-primary/10 transition-all hover:-translate-y-1">
                        <TrendingUp className="h-6 w-6 mx-auto mb-3 text-destructive" />
                        <p className="text-foreground">Privilege Escalation</p>
                      </div>
                      <div className="p-4 rounded-xl bg-card/40 border border-border hover:border-primary/30 hover:bg-primary/10 transition-all hover:-translate-y-1">
                        <AlertTriangle className="h-6 w-6 mx-auto mb-3 text-chart-3" />
                        <p className="text-foreground">Anomalies</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </motion.div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-background/50 backdrop-blur-xl mt-auto relative z-10">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground font-mono">
            <p className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Log Analysis System for Detecting Suspicious Activities
            </p>
            <p className="px-3 py-1 bg-secondary/50 rounded-full border border-border/50">
              Based on ABUAD Research Proposal
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
