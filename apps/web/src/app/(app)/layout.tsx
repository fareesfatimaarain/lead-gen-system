import { redirect } from "next/navigation";
import { count, eq, isNull, schema, withOrg } from "@outreach/db";
import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/session";

/**
 * The signed-in shell.
 *
 * The two nav counts are queried here rather than on each screen because they
 * are the two things a user needs to see without navigating: drafts waiting on a
 * human, and replies nobody has answered. Both are counts of work owed to a
 * person, which is the only kind of number this product puts in a badge.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const counts = await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
    const [approvals] = await tx
      .select({ n: count() })
      .from(schema.emails)
      .where(eq(schema.emails.state, "pending_approval"));
    const [inbox] = await tx
      .select({ n: count() })
      .from(schema.emailReplies)
      .where(isNull(schema.emailReplies.handledAt));
    return { approvals: Number(approvals?.n ?? 0), inbox: Number(inbox?.n ?? 0) };
  });

  return (
    <AppShell
      orgName={session.orgName}
      userEmail={session.userEmail}
      role={session.role}
      counts={counts}
    >
      {children}
    </AppShell>
  );
}
