"use client";

import { useActionState, useState } from "react";
import type { Icp } from "@outreach/db";
import {
  Button,
  Card,
  Field,
  InlineError,
  Input,
  Notice,
  SectionHeading,
  Select,
  Textarea,
} from "@/components/ui";
import { ActionResult, SubmitButton, TagInput } from "@/components/ui-client";
import { IDLE } from "@/lib/action-state";
import type { ActionState } from "@/lib/action-state";

/**
 * The ICP builder.
 *
 * Grouped the way the system reads it: who the company is, who the person is,
 * what makes now the right moment, and who is explicitly out. The disqualifier
 * section is not an afterthought — it is evaluated before anything else, and an
 * existing customer receiving a cold pitch is the worst single outcome this
 * product can produce.
 */
export function IcpForm({
  icp,
  action,
  submitLabel,
}: {
  icp?: Icp;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);

  const [signals, setSignals] = useState<{ label: string; weight: number }[]>(
    icp?.qualifyingSignals.map((s) => ({ label: s.label, weight: s.weight })) ?? [],
  );

  const geo = {
    countries: icp?.geographies.map((g) => g.country).filter(Boolean) as string[] | undefined,
    regions: icp?.geographies.map((g) => g.region).filter(Boolean) as string[] | undefined,
    cities: icp?.geographies.map((g) => g.city).filter(Boolean) as string[] | undefined,
  };

  return (
    <form action={formAction} className="flex flex-col gap-4 p-6">
      {icp ? <input type="hidden" name="id" value={icp.id} /> : null}

      <InlineError>{state.error}</InlineError>

      <Card>
        <SectionHeading title="Identity" />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <Field label="Name" required help="How you will refer to this profile.">
            <Input name="name" defaultValue={icp?.name} placeholder="UK dental practices, 5-30 staff" required />
          </Field>
          <Field label="Description" help="Optional. Context for whoever reads this next.">
            <Input name="description" defaultValue={icp?.description ?? ""} />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionHeading
          title="Company"
          note="What kind of business. The source strategist plans its searches from these fields."
        />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <Field label="Industries" help="Press Enter after each.">
            <TagInput name="industries" defaultValue={icp?.industries} placeholder="Dentistry, Veterinary…" />
          </Field>
          <Field label="Sub-industries">
            <TagInput name="subIndustries" defaultValue={icp?.subIndustries} placeholder="Orthodontics…" />
          </Field>
          <Field label="Company size bands" help="Free text, e.g. 1-10, 11-50, 51-200.">
            <TagInput name="companySizeBands" defaultValue={icp?.companySizeBands} placeholder="11-50" />
          </Field>
          <Field label="Revenue bands">
            <TagInput name="revenueBands" defaultValue={icp?.revenueBands} placeholder="£1M-£5M" />
          </Field>
          <Field label="Tech stack" help="Technologies they must be using.">
            <TagInput name="techStack" defaultValue={icp?.techStack} placeholder="Shopify" />
          </Field>
          <Field label="Business models">
            <TagInput name="businessModels" defaultValue={icp?.businessModels} placeholder="B2B SaaS" />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionHeading
          title="Geography"
          note="Place-based sources search a bounding box, so a city is a far better target than a country."
        />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
          <Field label="Countries">
            <TagInput name="geo_country" defaultValue={geo.countries} placeholder="United Kingdom" />
          </Field>
          <Field label="Regions">
            <TagInput name="geo_region" defaultValue={geo.regions} placeholder="Greater Manchester" />
          </Field>
          <Field label="Cities">
            <TagInput name="geo_city" defaultValue={geo.cities} placeholder="Manchester" />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionHeading title="Persona" note="Who inside that company you actually want to reach." />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <Field label="Titles">
            <TagInput name="titles" defaultValue={icp?.titles} placeholder="Practice Manager" />
          </Field>
          <Field label="Seniority levels">
            <TagInput name="seniorityLevels" defaultValue={icp?.seniorityLevels} placeholder="Owner, Director" />
          </Field>
          <Field label="Departments">
            <TagInput name="departments" defaultValue={icp?.departments} placeholder="Operations" />
          </Field>
          <Field label="Decision role">
            <Select name="decisionRole" defaultValue={icp?.decisionRole ?? ""}>
              <option value="">Not specified</option>
              <option value="decision_maker">Decision maker</option>
              <option value="influencer">Influencer</option>
              <option value="champion">Champion</option>
            </Select>
          </Field>
          <Field
            label="Excluded titles"
            help="Never contact these, even at a matching company."
          >
            <TagInput name="exclusionTitles" defaultValue={icp?.exclusionTitles} placeholder="Intern" />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionHeading
          title="Qualifying signals"
          note="Why now. Each signal contributes its weight to the fit score, and only signals found with a source can be cited in a message."
          actions={
            <Button
              type="button"
              size="sm"
              onClick={() => setSignals((s) => [...s, { label: "", weight: 0.5 }])}
            >
              Add signal
            </Button>
          }
        />
        {signals.length === 0 ? (
          <p className="px-4 py-4 text-sm text-fg-muted">
            None. The scorer will fall back to firmographic fit alone, which is weaker — a company
            that matches on paper and a company that just posted three job ads score the same.
          </p>
        ) : (
          <div className="flex flex-col gap-2 px-4 py-3">
            {signals.map((s, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    name="signal_type"
                    defaultValue={s.label}
                    placeholder="Hiring for the role we replace"
                    aria-label="Signal"
                  />
                </div>
                <div className="w-28">
                  <Select name="signal_weight" defaultValue={String(s.weight)} aria-label="Weight">
                    <option value="0.25">Weight 0.25</option>
                    <option value="0.5">Weight 0.5</option>
                    <option value="0.75">Weight 0.75</option>
                    <option value="1">Weight 1.0</option>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => setSignals((all) => all.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionHeading
          title="Disqualifiers"
          note="Evaluated before everything else. A hard exclude is never overridden by a high score."
        />
        <div className="px-4 pt-3">
          <Notice tone="warn">
            Put your existing customers&apos; domains here. A cold pitch to a current customer is the
            single most damaging message this system can send, and nothing downstream will catch it.
          </Notice>
        </div>
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
          <Field label="Excluded domains" help="Customers, partners, yourselves.">
            <TagInput
              name="excludedDomains"
              defaultValue={icp?.excludedDomains}
              placeholder="acme.com"
              transform={(v) => v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")}
            />
          </Field>
          <Field label="Excluded industries">
            <TagInput name="excludedIndustries" defaultValue={icp?.excludedIndustries} placeholder="Gambling" />
          </Field>
          <Field label="Competitor domains" help="Used for the 'uses a competitor' signal.">
            <TagInput
              name="competitorDomains"
              defaultValue={icp?.competitorDomains}
              placeholder="competitor.com"
              transform={(v) => v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionHeading
          title="Positioning"
          note="Read by the message composer. Specific beats polished — this is the raw material for what gets said."
        />
        <div className="grid gap-3 px-4 py-3">
          <Field
            label="Pain hypothesis"
            help="What is going wrong for this person today, in their words rather than yours."
          >
            <Textarea name="painHypothesis" rows={3} defaultValue={icp?.painHypothesis ?? ""} />
          </Field>
          <Field label="Value proposition" help="What you do about it, and the evidence you can point to.">
            <Textarea name="valueProposition" rows={3} defaultValue={icp?.valueProposition ?? ""} />
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <ActionResult tone="ok">{state.ok ? state.message : null}</ActionResult>
      </div>
    </form>
  );
}
