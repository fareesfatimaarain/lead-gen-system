import { z } from "zod";
import { saveCredential } from "@/lib/credentials";
import { handle, readJson } from "@/lib/route";
import { requireCapability } from "@/lib/session";

const bodySchema = z.object({
  provider: z.string().min(1),
  label: z.string().default("Default"),
  secret: z.string().min(1),
  config: z.record(z.unknown()).default({}),
});

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireCapability("manage_credentials");
    const body = bodySchema.parse(await readJson(request));
    // The response deliberately carries the summary, never the secret.
    return saveCredential(session, body);
  });
}
