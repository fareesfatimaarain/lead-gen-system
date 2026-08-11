import { z } from "zod";
import { eq, schema, withOrg } from "@outreach/db";
import { handle, readJson } from "@/lib/route";
import { requireCapability } from "@/lib/session";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  kind: z.enum(["lead_source", "enrichment", "verification", "search", "crm"]).optional(),
  status: z.enum(["active", "paused", "disabled"]).optional(),
  weight: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const session = await requireCapability("read");
    const rows = await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx.select().from(schema.dataSources).where(eq(schema.dataSources.id, id)).limit(1),
    );
    if (rows.length === 0) return { ok: false, error: "Source not found" };
    return rows[0];
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireCapability("write");
    const { id } = await params;
    const body = patchSchema.parse(await readJson(request));

    const [row] = await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx.update(schema.dataSources).set({ ...body, updatedAt: new Date() }).where(eq(schema.dataSources.id, id)).returning(),
    );

    if (!row) throw new Error("Source not found");
    return row;
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireCapability("write");
    const { id } = await params;
    await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx.delete(schema.dataSources).where(eq(schema.dataSources.id, id)),
    );
    return { ok: true };
  });
}
