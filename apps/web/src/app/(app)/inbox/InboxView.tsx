"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { markReplyHandledAction } from "./actions";

interface ReplyItem {
  id: string;
  intent: string;
  sentiment: string | null;
  fromEmail: string;
  parsedBody: string | null;
  rawBody: string;
  classificationReasoning: string | null;
  referredName: string | null;
  referredEmail: string | null;
  oooReturnDate: string | null;
  handledAt: Date | null;
  receivedAt: Date;
  prospectId: string | null;
  prospectName: string | null;
  prospectStatus: string | null;
  companyName: string | null;
}

export function InboxView({ replies }: { replies: ReplyItem[] }) {
  const [selectedId, setSelectedId] = useState(replies[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  const selected = replies.find((r) => r.id === selectedId) ?? replies[0];

  function handleAction(status?: "engaged" | "meeting_booked" | "disqualified" | "unsubscribed") {
    if (!selected) return;
    startTransition(async () => {
      await markReplyHandledAction(selected.id, status);
    });
  }

  const INTENT_BADGES: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "accent" | "neutral" }> = {
    interested: { label: "🔥 Interested", tone: "ok" },
    question: { label: "❓ Question", tone: "accent" },
    objection: { label: "⚡ Objection", tone: "warn" },
    referral: { label: "🔄 Referral", tone: "accent" },
    not_now: { label: "⏳ Not Now", tone: "neutral" },
    not_interested: { label: "🛑 Not Interested", tone: "danger" },
    unsubscribe: { label: "🚫 Unsubscribe", tone: "danger" },
    ooo: { label: "✈️ Out of Office", tone: "neutral" },
    bounce: { label: "💥 Hard Bounce", tone: "danger" },
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left List Pane */}
      <div className="flex flex-col gap-2 lg:col-span-5 border-r border-border pr-2">
        {replies.map((r) => {
          const badge = INTENT_BADGES[r.intent] ?? { label: r.intent, tone: "neutral" };
          const active = r.id === selectedId;

          return (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`flex flex-col gap-1.5 rounded border p-3 text-left transition-colors ${
                active ? "border-accent bg-surface-hover" : "border-border bg-surface hover:bg-surface-hover"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-fg">
                  {r.prospectName ?? r.fromEmail}
                </span>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>
              <span className="text-2xs text-fg-subtle">
                {r.companyName ?? r.fromEmail} · {formatDateTime(r.receivedAt)}
              </span>
              <p className="line-clamp-2 text-xs text-fg-muted">
                {r.parsedBody ?? r.rawBody}
              </p>
            </button>
          );
        })}
      </div>

      {/* Right Detail Pane */}
      {selected ? (
        <Card className="p-4 flex flex-col gap-4 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="text-xs font-bold text-fg">{selected.prospectName ?? selected.fromEmail}</h3>
              <p className="text-2xs text-fg-subtle">From: {selected.fromEmail} · {selected.companyName ?? "Unknown Company"}</p>
            </div>
            {selected.prospectId ? (
              <Link href={`/prospects/${selected.prospectId}`} className="text-xs text-accent hover:underline">
                View Full Prospect Profile →
              </Link>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">Inbound Message Body:</span>
            <div className="rounded bg-surface p-3 text-xs text-fg leading-relaxed font-sans whitespace-pre-wrap border border-border">
              {selected.parsedBody ?? selected.rawBody}
            </div>
          </div>

          {selected.classificationReasoning ? (
            <div className="rounded bg-surface-muted p-3 text-2xs text-fg-subtle border border-border flex flex-col gap-1">
              <span className="font-semibold text-fg">🤖 Intent Classifier Reasoning:</span>
              <p>{selected.classificationReasoning}</p>
              {selected.oooReturnDate ? (
                <span className="font-mono text-accent">OOO Return Date Parsed: {selected.oooReturnDate}</span>
              ) : null}
            </div>
          ) : null}

          {/* Quick Action Toolbar */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <span className="text-xs text-fg-subtle">Mark Handled & Update Status:</span>
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => handleAction("disqualified")}
              >
                Disqualify & Suppress
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={pending}
                onClick={() => handleAction("engaged")}
              >
                Mark Engaged
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={pending}
                onClick={() => handleAction("meeting_booked")}
              >
                🎯 Book Meeting
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
