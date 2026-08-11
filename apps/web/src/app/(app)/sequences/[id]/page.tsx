import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getSequence } from "@/lib/data";
import { requirePageSession } from "@/lib/session";
import { StepAddForm } from "./StepAddForm";

export default async function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  const resolvedParams = await params;
  const { sequence, steps } = await getSequence(session, resolvedParams.id);

  return (
    <>
      <PageHeader
        title={sequence.name}
        description="Multi-touch outbound sequence workflow"
      />

      <div className="mx-auto max-w-4xl p-4 flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-fg">Sequence Cadence Timeline</h3>

          {steps.length === 0 ? (
            <Card className="p-4 text-center text-xs text-fg-subtle">
              No steps in sequence yet. Add your first step below.
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {steps.map((st, idx) => (
                <div key={st.id} className="relative flex items-start gap-4 rounded border border-border bg-surface p-4">
                  <div className="grid size-7 shrink-0 place-items-center rounded bg-accent-muted font-mono text-xs font-bold text-accent">
                    {st.position}
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-fg">
                        {st.type === "email" ? "✉️ Step 1: AI Personalized Email" : st.type === "call" ? "📞 Step 2: Dynamic Vapi Voice Call" : st.type === "wait" ? "⏱️ Wait Delay" : st.type}
                      </span>
                      {st.delayHours > 0 ? (
                        <span className="text-2xs font-mono text-fg-subtle">
                          Delay: {st.delayHours} hrs after prior step
                        </span>
                      ) : (
                        <span className="text-2xs font-mono text-accent">Immediate initial touch</span>
                      )}
                    </div>
                    <p className="text-xs text-fg-muted">
                      {st.type === "email"
                        ? "Generates fresh plain text (<120 words), cites verified signal, zero banned phrases, soft low-commitment ask."
                        : st.type === "call"
                        ? "Injects prospect researched intel, identifies AI agent within 2 sentences, 1-turn deep objection handling, updates CRM."
                        : `Pauses automation for ${st.delayHours} hours before executing next touchpoint.`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Card className="p-4">
          <h4 className="text-xs font-semibold text-fg mb-3">Add Step to Sequence</h4>
          <StepAddForm sequenceId={sequence.id} />
        </Card>
      </div>
    </>
  );
}
