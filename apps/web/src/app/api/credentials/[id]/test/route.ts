import { testCredential } from "@/lib/credentials";
import { handle } from "@/lib/route";
import { requireCapability } from "@/lib/session";

/**
 * Runs the provider's real test call.
 *
 * Requires `manage_credentials` rather than plain read access: a test decrypts
 * the secret and makes an authenticated request as the customer, so it is a
 * privileged action even though it changes nothing.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireCapability("manage_credentials");
    const { id } = await params;
    return testCredential(session, id);
  });
}
