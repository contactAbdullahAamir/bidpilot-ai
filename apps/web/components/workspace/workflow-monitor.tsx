"use client";

import type { Workflow } from "@bidpilot/contracts";
import { useEffect, useRef, useState } from "react";
import { api, relativeTime } from "../../lib/api";
import { Icons } from "../icons";
import { Button, Spinner, StatusBadge, useToast } from "../ui";

const STEP_LABELS: Record<string, { label: string; detail: string }> = {
  analysis: { label: "Read the RFP", detail: "Requirements, deadlines, criteria" },
  qualification: { label: "Check eligibility", detail: "Mandatory criteria vs. credentials" },
  retrieval: { label: "Gather evidence", detail: "Approved knowledge search" },
  planning: { label: "Plan the response", detail: "Map requirements to sections" },
  writing: { label: "Write sections", detail: "Technical + management writers" },
  validation: { label: "Validate", detail: "Coverage and claim checks" }
};

export function WorkflowMonitor({ workflow, onChange, canRun }: { workflow: Workflow; onChange: () => void; canRun: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(workflow.status === "running" || workflow.status === "queued");
  const logRef = useRef<HTMLOListElement>(null);
  const active = workflow.status === "queued" || workflow.status === "running";
  const done = workflow.steps.filter((s) => s.status === "completed").length;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [workflow.events.length, showLog]);

  async function act(action: "cancel" | "retry") {
    setBusy(true);
    try {
      await api(`/workflows/${workflow.id}/${action}`, { method: "POST" });
      toast.info(action === "cancel" ? "Workflow cancelled" : "Retrying. Completed steps will be reused.");
      onChange();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`monitor ${active ? "monitor-active" : ""}`}>
      <header className="monitor-header">
        <div>
          <div className="monitor-title">
            {active ? <Spinner size={14} /> : workflow.status === "failed" ? <Icons.alert size={16} /> : <Icons.checkCircle size={16} />}
            <strong>{workflow.type === "revision" ? "Revision run" : "AI analysis"}</strong>
            <StatusBadge status={workflow.status} />
          </div>
          <span className="muted small">
            Started {relativeTime(workflow.createdAt)} · {done}/{workflow.steps.length} steps
            {workflow.mode && ` · ${workflow.mode === "claude" ? "Claude" : workflow.mode === "openai" ? "external model" : "offline engine"}`}
            {workflow.usage.estimatedCostUsd > 0 && ` · ~$${workflow.usage.estimatedCostUsd.toFixed(2)} (${Math.round((workflow.usage.inputTokens + workflow.usage.outputTokens) / 1000)}k tokens)`}
          </span>
        </div>
        <div className="row-actions">
          {active && canRun && <Button size="sm" variant="ghost" icon="stop" loading={busy} onClick={() => act("cancel")}>Cancel</Button>}
          {(workflow.status === "failed" || workflow.status === "cancelled") && canRun && <Button size="sm" icon="refresh" loading={busy} onClick={() => act("retry")}>Retry</Button>}
          <Button size="sm" variant="ghost" onClick={() => setShowLog(!showLog)}>{showLog ? "Hide log" : "Show log"}</Button>
        </div>
      </header>
      {workflow.error && <div className="alert alert-danger">{workflow.error}</div>}
      <ol className="steps">
        {workflow.steps.map((step) => {
          const meta = STEP_LABELS[step.step];
          return (
            <li key={step.step} className={`step step-${step.status}`}>
              <span className="step-icon">
                {step.status === "completed" ? <Icons.check size={13} /> : step.status === "running" ? <Spinner size={12} /> : step.status === "failed" ? <Icons.x size={13} /> : null}
              </span>
              <span className="step-text"><strong>{meta.label}</strong><small>{step.error ?? meta.detail}</small></span>
            </li>
          );
        })}
      </ol>
      {showLog && (
        <ol className="log" ref={logRef}>
          {workflow.events.map((event) => (
            <li key={event.sequence} className={`log-${event.level}`}>
              <time>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
