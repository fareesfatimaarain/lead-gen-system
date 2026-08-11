import { deleteCredential } from "@/lib/credentials";
import { handle } from "@/lib/route";
import { requireCapability } from "@/lib/session";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireCapability("manage_credentials");
    const { id } = await params;
    await deleteCredential(session, id);
    return { ok: true };
  });
}
