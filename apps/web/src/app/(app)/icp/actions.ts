"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, schema, withOrg } from "@outreach/db";
import type { IcpGeography, QualifyingSignal } from "@outreach/db";
import { conflict, notFound, validationFailed } from "@outreach/shared";
import { action, bool, list, optionalStr, str } from "@/lib/action";
import type { ActionState } from "@/lib/action";

/**
 * ICP writes.
 *
 * The ICP is the one configuration object every agent reads — the strategist
 * plans sources from it, the scorer scores against it, the composer draws its
 * angle from it. So the validation here is about completeness rather than
 * formatting: an ICP with no industry, no geography and no title is not a
 * profile, it is "everyone", and it would produce exactly the untargeted volume
 * this product refuses to send.
 */

const MAX_LIST = 60;

function parseGeographies(form: FormData): IcpGeography[] {
  const countries = list(form, "geo_country");
  const regions = list(form, "geo_region");
  const cities = list(form, "geo_city");

  const entries: IcpGeography[] = [];
  for (const country of countries) entries.push({ country });
  for (const region of regions) entries.push({ region });
  for (const city of cities) entries.push({ city });
  return entries;
}

function parseSignals(form: FormData): QualifyingSignal[] {
  // Each signal posts as `signal_type` / `signal_weight` pairs in document order.
  const types = form.getAll("signal_type").filter((v): v is string => typeof v === "string");
  const weights = form.getAll("signal_weight").filter((v): v is string => typeof v === "string");

  const signals: QualifyingSignal[] = [];
  types.forEach((type, i) => {
    const trimmed = type.trim();
    if (!trimmed) return;
    const weight = Number(weights[i] ?? "0.5");
    signals.push({
      type: trimmed.toLowerCase().replace(/\s+/g, "_"),
      label: trimmed,
      weight: Number.isFinite(weight) ? Math.min(Math.max(weight, 0), 1) : 0.5,
    });
  });
  return signals;
}

function readForm(form: FormData) {
  const name = str(form, "name");
  if (!name) throw validationFailed("Give this ICP a name.");

  const industries = list(form, "industries").slice(0, MAX_LIST);
  const titles = list(form, "titles").slice(0, MAX_LIST);
  const geographies = parseGeographies(form).slice(0, MAX_LIST);

  // Deliberately blocking rather than a warning. An ICP that matches everything
  // produces discovery runs that match everything.
  if (industries.length === 0 && titles.length === 0 && geographies.length === 0) {
    throw validationFailed(
      "An ICP needs at least one industry, title or geography. Without a constraint it matches every company in every source.",
    );
  }

  return {
    name,
    description: optionalStr(form, "description"),
    industries,
    subIndustries: list(form, "subIndustries").slice(0, MAX_LIST),
    companySizeBands: list(form, "companySizeBands").slice(0, MAX_LIST),
    revenueBands: list(form, "revenueBands").slice(0, MAX_LIST),
    geographies,
    techStack: list(form, "techStack").slice(0, MAX_LIST),
    businessModels: list(form, "businessModels").slice(0, MAX_LIST),
    titles,
    seniorityLevels: list(form, "seniorityLevels").slice(0, MAX_LIST),
    departments: list(form, "departments").slice(0, MAX_LIST),
    decisionRole: optionalStr(form, "decisionRole"),
    exclusionTitles: list(form, "exclusionTitles").slice(0, MAX_LIST),
    qualifyingSignals: parseSignals(form).slice(0, MAX_LIST),
    excludedDomains: list(form, "excludedDomains").map(normalizeDomain).slice(0, MAX_LIST),
    excludedIndustries: list(form, "excludedIndustries").slice(0, MAX_LIST),
    competitorDomains: list(form, "competitorDomains").map(normalizeDomain).slice(0, MAX_LIST),
    painHypothesis: optionalStr(form, "painHypothesis"),
    valueProposition: optionalStr(form, "valueProposition"),
  };
}

/** Apex only, lowercased — matching how `companies.domain` is stored. */
function normalizeDomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
    .trim();
}

export async function createIcp(_prev: ActionState, form: FormData): Promise<ActionState> {
  let createdId: string | undefined;

  const result = await action("write", async (session) => {
    const values = readForm(form);

    const rows = await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const existing = await tx
        .select({ id: schema.icps.id })
        .from(schema.icps)
        .where(eq(schema.icps.name, values.name))
        .limit(1);
      if (existing.length > 0) throw conflict(`An ICP named "${values.name}" already exists.`);

      return tx
        .insert(schema.icps)
        .values({ ...values, orgId: session.orgId, createdBy: session.userId })
        .returning({ id: schema.icps.id });
    });

    createdId = rows[0]?.id;
  });

  if (result.error) return result;
  revalidatePath("/icp");
  redirect(`/icp/${createdId}`);
}

export async function updateIcp(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");

  const result = await action("write", async (session) => {
    const values = readForm(form);

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const updated = await tx
        .update(schema.icps)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(schema.icps.id, id))
        .returning({ id: schema.icps.id });
      if (updated.length === 0) throw notFound("ICP");
    });

    return { ok: true, message: "Saved." };
  });

  if (!result.error) revalidatePath(`/icp/${id}`);
  return result;
}

export async function deleteIcp(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");

  const result = await action("write", async (session) => {
    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      // A campaign holds `icp_id` with ON DELETE RESTRICT, so this would fail at
      // the database anyway. Catching it here means the user gets told which
      // campaign is in the way instead of a constraint name.
      const campaigns = await tx
        .select({ name: schema.campaigns.name })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.icpId, id));
      if (campaigns.length > 0) {
        throw conflict(
          `This ICP is used by ${campaigns.length === 1 ? `the campaign "${campaigns[0]!.name}"` : `${campaigns.length} campaigns`}. Archive those first.`,
        );
      }
      await tx.delete(schema.icps).where(eq(schema.icps.id, id));
    });
  });

  if (result.error) return result;
  revalidatePath("/icp");
  redirect("/icp");
}

export async function saveProofAsset(_prev: ActionState, form: FormData): Promise<ActionState> {
  const icpId = str(form, "icpId");

  const result = await action("write", async (session) => {
    const title = str(form, "title");
    const body = str(form, "body");
    if (!title || !body) throw validationFailed("A proof asset needs a title and a body.");

    await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx.insert(schema.proofAssets).values({
        orgId: session.orgId,
        icpId: bool(form, "allIcps") ? null : icpId || null,
        kind: str(form, "kind") || "case_study",
        title,
        body,
        metricValue: optionalStr(form, "metricValue"),
        sourceUrl: optionalStr(form, "sourceUrl"),
        segmentTags: list(form, "segmentTags"),
      }),
    );

    return { ok: true, message: "Added." };
  });

  if (!result.error) revalidatePath(`/icp/${icpId}`);
  return result;
}
