import { Suspense } from "react";
import LogAnalyzerApp from "@/components/dashboard/log-analyzer-app";

export default function ResultsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <LogAnalyzerApp activePage="results" />
    </Suspense>
  );
}
