import { z } from "zod";
import { schema, withOrg } from "@outreach/db";
import { handle, readJson } from "@/lib/route";
import { requireCapability, requireSession } from "@/lib/session";

const bodySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["lead_source", "enrichment", "verification", "search", "crm"]),
  status: z.enum(["active", "paused", "disabled"]).default("active"),
  weight: z.coerce.number().min(0).max(100).default(50),
  notes: z.string().optional(),
});

export async function GET() {
  return handle(async () => {
    const session = await requireSession();
    return withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx.select().from(schema.dataSources).orderBy(schema.dataSources.updatedAt),
    );
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireCapability("write");
    const body = bodySchema.parse(await readJson(request));
    const [row] = await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx
        .insert(schema.dataSources)
        .values({
          orgId: session.orgId,
          name: body.name.trim(),
          kind: body.kind,
          status: body.status,
          weight: body.weight,
          notes: body.notes?.trim() || null,
          createdBy: session.userId,
        })
        .returning(),
    );

    return row;
  });
}
