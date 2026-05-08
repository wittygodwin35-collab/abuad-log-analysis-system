"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EvaluationMetrics } from "@/lib/pipeline-types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface EvaluationReportProps {
  metrics: EvaluationMetrics;
}

const CHART_COLORS = {
  baseline: "var(--muted-foreground)",
  f1Score: "var(--chart-3)",
  precision: "var(--chart-1)",
  recall: "var(--chart-4)",
  rocCurve: "var(--chart-5)",
};

function asPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function asRatio(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

function matrixIntensity(value: number, max: number): string {
  if (!value || !max) {
    return "transparent";
  }
  const weight = Math.min(22, Math.max(6, Math.round((value / max) * 22)));
  return `color-mix(in oklch, var(--foreground) ${weight}%, transparent)`;
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background/45 px-3 py-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function CurveChart({
  data,
  lines,
  showReferenceDiagonal = false,
  title,
  xKey,
}: {
  data: Array<Record<string, number>>;
  lines: Array<{ dataKey: string; label: string; stroke: string }>;
  showReferenceDiagonal?: boolean;
  title: string;
  xKey: string;
}) {
  if (!data.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background/35 p-4 text-sm text-muted-foreground">
        Companion label records are required for {title.toLowerCase()}.
      </div>
    );
  }

  return (
    <div className="h-64 rounded-md border border-border bg-background/35 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ bottom: 8, left: 0, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey={xKey}
            tickFormatter={(value) => Number(value).toFixed(2)}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(value) => Number(value).toFixed(1)}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value) => asRatio(Number(value))}
            labelFormatter={(value) => `${xKey}: ${Number(value).toFixed(3)}`}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--popover-foreground)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {showReferenceDiagonal ? (
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ]}
              stroke={CHART_COLORS.baseline}
              strokeDasharray="4 4"
            />
          ) : null}
          {lines.map((line) => (
            <Line
              key={line.dataKey}
              dataKey={line.dataKey}
              dot={false}
              isAnimationActive={false}
              name={line.label}
              stroke={line.stroke}
              strokeWidth={2}
              type="monotone"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EvaluationReport({ metrics }: EvaluationReportProps) {
  const confusion = metrics.confusionMatrix;
  const classLabels = metrics.classLabels || [];
  const matrix = metrics.classConfusionMatrix || {};
  const modelMeta = metrics.modelMeta;
  const ruleHitRows = Object.entries(metrics.ruleHitCounts || {}).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
  const metricTiles = [
    {
      label: "Sample Window",
      value: String(metrics.sampleCount ?? metrics.ruleSampleCount ?? "n/a"),
    },
    ...(typeof metrics.labelledSampleCount === "number"
      ? [
          {
            label: "Labelled Rows",
            value: String(metrics.labelledSampleCount),
          },
        ]
      : []),
    { label: "Accuracy", value: asPercent(confusion?.accuracy) },
    { label: "Precision", value: asPercent(confusion?.precision) },
    { label: "Recall", value: asPercent(confusion?.recall) },
    { label: "F1", value: asPercent(confusion?.f1Score) },
  ];
  const maxMatrixValue = classLabels.reduce((max, actual) => {
    return Math.max(
      max,
      ...classLabels.map((predicted) => matrix[actual]?.[predicted] || 0),
    );
  }, 0);

  return (
    <section className="rounded-md border border-border bg-card/70 shadow-sm">
      <div className="border-b border-border/60 bg-card/50 px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">Evaluation Report</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Parsing, rule-hit counts, template clustering, and anomaly scoring are always shown. Classification metrics and confidence curves appear when companion labels are available.
        </p>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {metricTiles.map((tile) => (
            <MetricTile key={tile.label} label={tile.label} value={tile.value} />
          ))}
        </div>

        {modelMeta ? (
          <div className="rounded-md border border-border bg-background/35 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Model Used For This Run</h3>
              <span className="rounded border border-border bg-background/60 px-2 py-0.5 font-mono text-[11px] text-foreground">
                {modelMeta.modelVersion}
              </span>
              {modelMeta.bootstrapModel ? (
                <span className="rounded border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                  bootstrapped baseline
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Trained on {modelMeta.trainedSamples} baseline lines at {new Date(modelMeta.trainedAt).toLocaleString()} from
              {" "}
              <span className="font-mono text-[12px] text-foreground">{modelMeta.normalLogDir}</span>.
            </p>
          </div>
        ) : null}

        {ruleHitRows.length ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Rule Detection Summary</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ruleHitRows.map(([label, value]) => (
                <MetricTile
                  key={label}
                  label={label.replace(/_/g, " ")}
                  value={String(value)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {metrics.classificationReport?.length ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Classification Report</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Precision</TableHead>
                  <TableHead className="text-right">Recall</TableHead>
                  <TableHead className="text-right">F1</TableHead>
                  <TableHead className="text-right">Support</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.classificationReport.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-mono text-xs">{row.label}</TableCell>
                    <TableCell className="text-right font-mono">{asRatio(row.precision)}</TableCell>
                    <TableCell className="text-right font-mono">{asRatio(row.recall)}</TableCell>
                    <TableCell className="text-right font-mono">{asRatio(row.f1Score)}</TableCell>
                    <TableCell className="text-right font-mono">{row.support}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border bg-background/35 p-4 text-sm text-muted-foreground">
            This dataset ran through parsing, rule detection, template clustering, and anomaly scoring, but supervised metrics need companion label records such as
            {" "}
            <span className="font-mono">*.labels.jsonl</span>
            {" "}
            or
            {" "}
            <span className="font-mono">*.truth.jsonl</span>
            .
          </p>
        )}

        {classLabels.length ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Confusion Matrix</h3>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/35">
                  <tr>
                    <th className="p-2 text-left font-medium text-muted-foreground">Actual / Predicted</th>
                    {classLabels.map((label) => (
                      <th key={label} className="p-2 text-right font-mono text-xs font-medium text-muted-foreground">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {classLabels.map((actual) => (
                    <tr key={actual} className="border-t border-border">
                      <th className="p-2 text-left font-mono text-xs font-medium text-foreground">{actual}</th>
                      {classLabels.map((predicted) => {
                        const value = matrix[actual]?.[predicted] || 0;
                        return (
                          <td
                            key={predicted}
                            className="p-2 text-right font-mono text-foreground"
                            style={{ backgroundColor: matrixIntensity(value, maxMatrixValue) }}
                          >
                            {value}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Precision-Recall Curve</h3>
            <CurveChart
              data={(metrics.precisionRecallCurve || []).map((point) => ({
                precision: point.precision,
                recall: point.recall,
                threshold: point.threshold,
              }))}
              lines={[{ dataKey: "precision", label: "Precision", stroke: CHART_COLORS.precision }]}
              title="Precision-Recall Curve"
              xKey="recall"
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">ROC Curve</h3>
            <CurveChart
              data={(metrics.rocCurve || []).map((point) => ({
                falsePositiveRate: point.falsePositiveRate,
                threshold: point.threshold,
                truePositiveRate: point.truePositiveRate,
              }))}
              lines={[{ dataKey: "truePositiveRate", label: "True positive rate", stroke: CHART_COLORS.rocCurve }]}
              showReferenceDiagonal
              title="ROC Curve"
              xKey="falsePositiveRate"
            />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Precision, Recall, And F1 By Confidence</h3>
          <CurveChart
            data={(metrics.confidenceCurve || []).map((point) => ({
              f1Score: point.f1Score,
              precision: point.precision,
              recall: point.recall,
              threshold: point.threshold,
            }))}
            lines={[
              { dataKey: "precision", label: "Precision", stroke: CHART_COLORS.precision },
              { dataKey: "recall", label: "Recall", stroke: CHART_COLORS.recall },
              { dataKey: "f1Score", label: "F1", stroke: CHART_COLORS.f1Score },
            ]}
            title="Precision, Recall, And F1 By Confidence"
            xKey="threshold"
          />
        </div>
      </div>
    </section>
  );
}
