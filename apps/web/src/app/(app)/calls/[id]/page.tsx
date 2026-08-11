import { notFound as nextNotFound } from "next/navigation";
import { isAppError } from "@outreach/shared";
import type { TranscriptTurn } from "@outreach/db";
import { Badge, Card, Notice, PageHeader, Stat, StatRow } from "@/components/ui";
import { getCall } from "@/lib/data";
import { formatDateTime, formatDuration, formatUsd, humanize } from "@/lib/format";
import { callTone } from "@/lib/tone";
import { requirePageSession } from "@/lib/session";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  const resolvedParams = await params;

  let data;
  try {
    data = await getCall(session, resolvedParams.id);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") nextNotFound();
    throw err;
  }

  const { call, prospect, company } = data;
  const transcriptTurns: TranscriptTurn[] = Array.isArray(call.transcript)
    ? call.transcript
    : [];

  return (
    <>
      <PageHeader
        title={`Call with ${prospect?.fullName ?? "Prospect"}`}
        description={
          [
            company?.name ? `Company: ${company.name}` : null,
            prospect?.phone ? `Phone: ${prospect.phone}` : null,
            formatDateTime(call.startedAt ?? call.createdAt),
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        actions={
          call.disposition ? (
            <Badge tone={callTone[call.disposition]}>{humanize(call.disposition)}</Badge>
          ) : undefined
        }
      />

      {call.permissionGranted === false ? (
        <div className="px-6 pt-4">
          <Notice tone="danger">
            The prospect declined to continue after the permission ask. The call ended there — no
            rebuttal, and this prospect is suppressed from further calling.
          </Notice>
        </div>
      ) : null}

      <div className="flex flex-col gap-6 p-4">
        <StatRow>
          <Stat label="Disposition" value={call.disposition ? humanize(call.disposition) : humanize(call.status ?? "placed")} />
          <Stat label="Duration" value={call.durationSeconds ? formatDuration(call.durationSeconds) : "—"} />
          <Stat label="Cost USD" value={formatUsd(call.costUsd)} />
          <Stat label="Voicemail" value={call.voicemailLeft ? "Left" : "No"} />
          <Stat label="Vapi Call ID" value={call.vapiCallId ?? "—"} />
        </StatRow>

        {call.endedReason ? (
          <div className="px-2">
            <Notice tone="neutral">Ended: {humanize(call.endedReason)}</Notice>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Audio & intel */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            {call.recordingUrl ? (
              <Card className="p-4 flex flex-col gap-2">
                <h4 className="text-xs font-semibold text-fg">Audio Recording Playback</h4>
                <audio controls src={call.recordingUrl} className="w-full h-8 mt-1" />
              </Card>
            ) : null}

            <Card className="p-4 flex flex-col gap-3">
              <h4 className="text-xs font-semibold text-fg">AI Extracted Insights</h4>
              <div className="flex flex-col gap-3 text-xs">
                <div>
                  <span className="font-semibold text-fg-muted">Summary</span>
                  <p className="text-fg-subtle mt-0.5">{call.summary ?? "No summary extracted"}</p>
                </div>
                <div>
                  <span className="font-semibold text-fg-muted">Objections Raised</span>
                  <p className="text-fg-subtle mt-0.5">
                    {call.objections.length > 0 ? call.objections.join(" · ") : "None"}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-fg-muted">Commitments</span>
                  <p className="text-fg-subtle mt-0.5">
                    {call.commitments.length > 0 ? call.commitments.join(" · ") : "None"}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-fg-muted">Next Step</span>
                  <p className="text-accent mt-0.5">{call.nextStep ?? "None"}</p>
                </div>
                {call.callbackRequestedAt ? (
                  <div>
                    <span className="font-semibold text-fg-muted">Callback Requested</span>
                    <p className="text-fg mt-0.5">{formatDateTime(call.callbackRequestedAt)}</p>
                  </div>
                ) : null}
              </div>
            </Card>
          </div>

          {/* Transcript */}
          <div className="flex flex-col gap-3 lg:col-span-7">
            <h4 className="text-xs font-semibold text-fg">Turn-by-Turn Call Transcript</h4>
            <Card className="p-4 flex flex-col gap-3 max-h-[600px] overflow-y-auto">
              {transcriptTurns.length === 0 ? (
                <span className="text-xs text-fg-subtle">No transcript recorded for this call.</span>
              ) : (
                transcriptTurns.map((turn, i) => (
                  <div
                    key={i}
                    className={`flex flex-col gap-1 rounded p-2.5 text-xs ${
                      turn.role === "assistant"
                        ? "bg-accent-muted/20 border border-accent/20 text-fg"
                        : "bg-surface border border-border text-fg-muted"
                    }`}
                  >
                    <span className="font-mono text-2xs font-bold uppercase tracking-wider text-fg-subtle">
                      {turn.role === "assistant"
                        ? "AI Call Agent"
                        : (prospect?.fullName ?? "Prospect")}
                    </span>
                    <p className="whitespace-pre-wrap">{turn.text}</p>
                  </div>
                ))
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
