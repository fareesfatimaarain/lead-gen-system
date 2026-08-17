import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { schema, withOrg } from "@outreach/db";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requirePageSession } from "@/lib/session";
import { DEMO_BLOCKER_MESSAGE, demoReadiness } from "@/lib/vapi-demo";
import { DemoCall } from "./DemoCall";

/**
 * Test call.
 *
 * Hearing the agent should not require dialling a real person. This connects to
 * the same assistant a sequence uses, over WebRTC, so the voice, the script and
 * the objection handling can be checked before a prospect is on the other end.
 *
 * Readiness is resolved on the server so the page can explain what is missing
 * instead of rendering a button that fails on click. Only whether the fields are
 * present is read here — never their values; the browser gets those from
 * `/api/calls/demo-session`, which is capability-checked and rate-limited.
 */
export default async function DemoCallPage() {
  const session = await requirePageSession();

  const rows = await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({ config: schema.credentials.config })
      .from(schema.credentials)
      .where(eq(schema.credentials.provider, "vapi"))
      .orderBy(desc(schema.credentials.lastVerifiedAt))
      .limit(1),
  );

  const { ready, blocker } = demoReadiness(rows[0]?.config ?? null);

  return (
    <>
      <PageHeader
        title="Test Call"
        description="Speak to the calling agent in your browser, using the same assistant that phones prospects."
      />

      <div className="flex flex-col gap-4 p-4">
        {ready ? (
          <DemoCall />
        ) : (
          <Card>
            <div className="flex flex-col gap-3 p-4">
              <Notice tone="warn">{blocker ? DEMO_BLOCKER_MESSAGE[blocker] : ""}</Notice>
              <p className="text-sm text-fg-muted">
                {blocker === "not_connected" ? (
                  <>
                    Add it on the <Link href="/connections" className="text-accent underline">Connections</Link> page.
                    You will need the private API key, a phone number ID, an assistant ID and a webhook secret.
                  </>
                ) : (
                  <>
                    Open Vapi on the{" "}
                    <Link href="/connections" className="text-accent underline">Connections</Link> page and fill in the
                    missing field. The public key is in the Vapi dashboard under Settings → API Keys, alongside the
                    private one.
                  </>
                )}
              </p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
