import Link from "next/link";
import { notFound as nextNotFound } from "next/navigation";
import { isAppError } from "@outreach/shared";
import { PageHeader } from "@/components/ui";
import { getIcp } from "@/lib/data";
import { requirePageSession } from "@/lib/session";
import { updateIcp } from "../actions";
import { DeleteIcpButton } from "./DeleteIcpButton";
import { IcpForm } from "../IcpForm";

export default async function EditIcpPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  const { id } = await params;

  let icp;
  try {
    icp = await getIcp(session, id);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") nextNotFound();
    throw err;
  }

  return (
    <>
      <PageHeader
        title={icp.name}
        description="Changes apply to the next discovery run and the next scoring pass. Existing scores are not recomputed automatically."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/discovery/new?icp=${icp.id}`}
              className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Run discovery
            </Link>
            <DeleteIcpButton id={icp.id} />
          </div>
        }
      />
      <IcpForm icp={icp} action={updateIcp} submitLabel="Save changes" />
    </>
  );
}
