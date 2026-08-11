import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getApprovalGate, listApprovals } from "@/lib/data";
import { requirePageSession } from "@/lib/session";
import { ApprovalCard } from "./ApprovalCard";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePageSession();
  const resolvedSearchParams = await searchParams;
  const page = Number(resolvedSearchParams.page ?? "1");

  const [approvalsData, gate] = await Promise.all([
    listApprovals(session, { page }),
    getApprovalGate(session),
  ]);

  return (
    <>
      <PageHeader
        title="Human Approval Queue"
        description="Review generated outbound emails before sending. Ensure voice, citations, and restraint criteria are met."
        actions={
          <div className="flex items-center gap-2 rounded bg-surface border border-border px-3 py-1 text-xs">
            <span className="text-fg-subtle">Auto-send Unlock Gate:</span>
            <span className="font-mono font-bold text-accent">
              {gate.approved} / {gate.required}
            </span>
            <span className="text-fg-subtle">drafts approved</span>
          </div>
        }
      />

      <div className="mx-auto max-w-4xl p-4 flex flex-col gap-4">
        {approvalsData.rows.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              title="No pending drafts awaiting approval"
              description="When a campaign is active in Approval Mode, AI message composer outputs will queue here for one-click review before delivery."
              action={
                <Link
                  href="/campaigns"
                  prefetch
                  className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
                >
                  View Campaigns
                </Link>
              }
            />
          </Card>
        ) : (
          approvalsData.rows.map((draft) => (
            <ApprovalCard key={draft.id} draft={draft} />
          ))
        )}
      </div>
    </>
  );
}
