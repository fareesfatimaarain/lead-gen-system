"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ValidatorReport } from "@outreach/db";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { approveDraftAction, rejectDraftAction, updateDraftTextAction } from "./actions";

interface Draft {
  id: string;
  subject: string;
  bodyText: string;
  reasoning: string | null;
  citedSignalIds: string[] | null;
  validatorReport: ValidatorReport | null;
  regenerationCount: number;
  model: string | null;
  generationCostUsd: string | null;
  createdAt: Date;
  prospectId: string;
  prospectName: string | null;
  prospectEmail: string | null;
  prospectTitle: string | null;
  companyName: string | null;
  campaignName: string | null;
}

export function ApprovalCard({ draft }: { draft: Draft }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [bodyText, setBodyText] = useState(draft.bodyText);
  const [pending, startTransition] = useTransition();

  function handleApprove(sendNow = false) {
    startTransition(async () => {
      if (editing) {
        await updateDraftTextAction(draft.id, subject, bodyText);
      }
      await approveDraftAction(draft.id, sendNow);
    });
  }

  function handleReject() {
    startTransition(async () => {
      await rejectDraftAction(draft.id);
    });
  }

  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  return (
    <Card className="p-4 flex flex-col gap-3">
      {/* Header identity */}
      <div className="flex items-start justify-between border-b border-border pb-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Link
              href={`/prospects/${draft.prospectId}`}
              className="text-xs font-bold text-fg hover:text-accent hover:underline"
            >
              {draft.prospectName ?? "Unknown Prospect"}
            </Link>
            <span className="text-2xs text-fg-subtle">
              {draft.prospectTitle ? `${draft.prospectTitle} at ` : ""}
              {draft.companyName ?? "Unknown Company"}
            </span>
          </div>
          <span className="text-2xs font-mono text-fg-subtle">
            To: {draft.prospectEmail} · Campaign: {draft.campaignName ?? "Default"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{wordCount} words</Badge>
          <Badge tone="neutral">{draft.model ?? "claude-3-5-sonnet"}</Badge>
          <span className="text-2xs text-fg-subtle">{formatDateTime(draft.createdAt)}</span>
        </div>
      </div>

      {/* Message content */}
      <div className="flex flex-col gap-2 rounded bg-surface p-3 border border-border">
        {editing ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded border border-border bg-bg px-2 py-1 text-xs font-semibold text-fg"
            />
            <Textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={5}
              className="text-xs font-mono"
            />
          </div>
        ) : (
          <>
            <div className="text-xs font-semibold text-fg">Subject: {subject}</div>
            <div className="whitespace-pre-wrap text-xs text-fg-muted font-sans leading-relaxed">
              {bodyText}
            </div>
          </>
        )}
      </div>

      {/* Reasoning Trace & Signals */}
      {draft.reasoning ? (
        <div className="rounded bg-surface-muted p-2.5 text-2xs text-fg-subtle flex flex-col gap-1 border border-border">
          <span className="font-semibold text-fg-muted uppercase tracking-wider">
            🧠 Agent Composer Reasoning & Citations:
          </span>
          <p>{draft.reasoning}</p>
          {draft.citedSignalIds && draft.citedSignalIds.length > 0 ? (
            <span className="font-mono text-accent">
              Cited Signals: {draft.citedSignalIds.join(", ")}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Action controls */}
      <div className="flex items-center justify-between pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Cancel Editing" : "✏️ Edit Draft"}
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={handleReject}
          >
            Reject Draft
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={pending}
            onClick={() => handleApprove(false)}
          >
            Approve & Queue
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => handleApprove(true)}
          >
            Approve & Send Now
          </Button>
        </div>
      </div>
    </Card>
  );
}
