import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listReplies } from "@/lib/data";
import { requirePageSession } from "@/lib/session";
import { InboxView } from "./InboxView";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; handled?: string }>;
}) {
  const session = await requirePageSession();
  const resolvedSearchParams = await searchParams;
  const page = Number(resolvedSearchParams.page ?? "1");
  const handled = resolvedSearchParams.handled === "true" ? true : resolvedSearchParams.handled === "false" ? false : false;

  const repliesData = await listReplies(session, { page, handled });

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Inbound reply triage. Any human response immediately pauses automation so you never talk over a real prospect."
      />

      <div className="p-4">
        {repliesData.rows.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              title="Inbox zero! No replies awaiting triage."
              description="When prospects respond to emails, replies are ingested via webhook, AI-classified by intent, and surfaced here for one-click human handoff."
            />
          </Card>
        ) : (
          <InboxView replies={repliesData.rows} />
        )}
      </div>
    </>
  );
}
