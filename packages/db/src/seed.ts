import { and, eq, sql } from "drizzle-orm";
import { closeDb, db } from "./client";
import { hashPassword } from "./crypto";
import * as schema from "./schema/index";

const EMAIL = process.env.SEED_EMAIL ?? "owner@example.com";
const PASSWORD = process.env.SEED_PASSWORD ?? "development-password";
const ORG_NAME = process.env.SEED_ORG ?? "Demo Workspace";
const ORG_SLUG = "demo-workspace";

async function main(): Promise<void> {
  await db().transaction(async (tx) => {
    const [existingUser] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, EMAIL))
      .limit(1);

    const user = existingUser ?? (
      await tx
        .insert(schema.users)
        .values({ email: EMAIL, name: "Demo Owner", passwordHash: hashPassword(PASSWORD) })
        .returning({ id: schema.users.id })
      )[0];

    if (!user) throw new Error("Could not create or resolve demo user.");

    const [existingOrg] = await tx
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.slug, ORG_SLUG))
      .limit(1);

    const org = existingOrg ?? (
      await tx
        .insert(schema.orgs)
        .values({ name: ORG_NAME, slug: ORG_SLUG })
        .returning({ id: schema.orgs.id })
      )[0];

    if (!org) throw new Error("Could not create or resolve demo org.");

    await tx
      .insert(schema.orgMembers)
      .values({ orgId: org.id, userId: user.id, role: "owner" })
      .onConflictDoNothing();

    await tx.execute(sql`SELECT set_config('app.org_id', ${org.id}, true)`);
    await tx.insert(schema.settings).values({ orgId: org.id }).onConflictDoNothing();

    const [existingIcp] = await tx
      .select({ id: schema.icps.id })
      .from(schema.icps)
      .where(and(eq(schema.icps.orgId, org.id), eq(schema.icps.name, "Mid-market SaaS operators")))
      .limit(1);

    const icp =
      existingIcp ??
      (
        await tx
          .insert(schema.icps)
          .values({
            orgId: org.id,
            name: "Mid-market SaaS operators",
            description: "Operations leaders in B2B SaaS companies expanding from 50 to 500 employees.",
            industries: ["Software", "SaaS", "B2B Services"],
            subIndustries: ["Revenue operations", "Customer support", "Automation"],
            companySizeBands: ["50-200", "201-500"],
            revenueBands: ["$5M-$25M"],
            geographies: [{ country: "United States", region: "Northeast" }, { country: "United Kingdom", region: "London" }],
            techStack: ["HubSpot", "Salesforce", "Notion", "Slack"],
            businessModels: ["B2B SaaS"],
            titles: ["VP Operations", "Head of Revenue Operations", "COO", "Director of Customer Success"],
            seniorityLevels: ["Director", "VP", "C-level"],
            departments: ["Operations", "Revenue", "Customer Success"],
            decisionRole: "decision_maker",
            exclusionTitles: ["Intern", "Recruiter"],
            qualifyingSignals: [
              { type: "hiring", label: "Recently hired in operations or revenue roles", weight: 0.75 },
              { type: "expanding", label: "Expanding to new regions or products", weight: 0.9 },
              { type: "poor_web_presence", label: "Weak digital positioning or fragmented site", weight: 0.7 },
            ],
            excludedDomains: ["competitor.com", "existing-client.co"],
            excludedIndustries: ["Education", "Nonprofit"],
            competitorDomains: ["salesloft.com", "gong.io"],
            painHypothesis:
              "They are growing quickly, the tooling is fragmented, and operations leaders need tighter visibility into pipeline flow and customer retention.",
            valueProposition:
              "We help teams replace spreadsheet-heavy ops with a tighter, more measurable process that increases conversion and customer retention without slowing down sales.",
            createdBy: user.id,
          })
          .returning({ id: schema.icps.id })
      )[0];

    if (!icp) throw new Error("Could not create demo ICP.");

    const [existingSequence] = await tx
      .select({ id: schema.sequences.id })
      .from(schema.sequences)
      .where(and(eq(schema.sequences.orgId, org.id), eq(schema.sequences.name, "3-touch ops cadence")))
      .limit(1);

    const sequence =
      existingSequence ??
      (
        await tx
          .insert(schema.sequences)
          .values({ orgId: org.id, name: "3-touch ops cadence" })
          .returning({ id: schema.sequences.id })
      )[0];

    if (!sequence) throw new Error("Could not create demo sequence.");

    const hasSequenceSteps = await tx
      .select({ id: schema.sequenceSteps.id })
      .from(schema.sequenceSteps)
      .where(eq(schema.sequenceSteps.sequenceId, sequence.id))
      .limit(1);

    if (hasSequenceSteps.length === 0) {
      await tx.insert(schema.sequenceSteps).values([
        { orgId: org.id, sequenceId: sequence.id, position: 1, type: "email", delayHours: 0, instruction: "Use the ops gap and growth signal in the first email." },
        { orgId: org.id, sequenceId: sequence.id, position: 2, type: "wait", delayHours: 72, instruction: "Wait for a reply or a meaningful open pattern." },
        { orgId: org.id, sequenceId: sequence.id, position: 3, type: "call", delayHours: 24, instruction: "Reference the earlier email and ask permission to continue." },
      ]);
    }

    const [existingMailbox] = await tx
      .select({ id: schema.mailboxes.id })
      .from(schema.mailboxes)
      .where(and(eq(schema.mailboxes.orgId, org.id), eq(schema.mailboxes.email, "demo@northstarops.com")))
      .limit(1);

    const mailbox =
      existingMailbox ??
      (
        await tx
          .insert(schema.mailboxes)
          .values({
            orgId: org.id,
            email: "demo@northstarops.com",
            displayName: "Northstar Ops",
            status: "healthy",
            spfPass: true,
            dkimPass: true,
            dmarcPass: true,
            currentDailyCap: 30,
            sentToday: 8,
            bounceRatePct: "0.16",
            complaintRatePct: "0.00",
          })
          .returning({ id: schema.mailboxes.id })
      )[0];

    if (!mailbox) throw new Error("Could not create demo mailbox.");

    const [existingCampaign] = await tx
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.orgId, org.id), eq(schema.campaigns.name, "Q3 expansion campaign")))
      .limit(1);

    const campaign =
      existingCampaign ??
      (
        await tx
          .insert(schema.campaigns)
          .values({
            orgId: org.id,
            name: "Q3 expansion campaign",
            status: "active",
            icpId: icp.id,
            sequenceId: sequence.id,
            autoSendEnabled: false,
            callFirst: false,
            createdBy: user.id,
          })
          .returning({ id: schema.campaigns.id })
      )[0];

    if (!campaign) throw new Error("Could not create demo campaign.");

    await tx
      .insert(schema.campaignMailboxes)
      .values({ orgId: org.id, campaignId: campaign.id, mailboxId: mailbox.id })
      .onConflictDoNothing();

    const companyRows = await Promise.all([
      tx
        .insert(schema.companies)
        .values({
          orgId: org.id,
          name: "North Peak Studio",
          domain: "northpeakstudio.com",
          websiteUrl: "https://northpeakstudio.com",
          linkedinUrl: "https://www.linkedin.com/company/north-peak-studio",
          industry: "Software",
          subIndustry: "Operations software",
          employeeCount: 160,
          sizeBand: "101-250",
          revenueBand: "$10M-$25M",
          country: "United States",
          region: "New York",
          city: "New York",
          timezone: "America/New_York",
          techStack: ["HubSpot", "Salesforce", "Notion"],
          description: "A growing B2B software company with revenue operations complexity.",
          source: "demo_seed",
        })
        .onConflictDoNothing()
        .returning({ id: schema.companies.id, domain: schema.companies.domain }),
      tx
        .insert(schema.companies)
        .values({
          orgId: org.id,
          name: "Harbor & Co",
          domain: "harborandco.com",
          websiteUrl: "https://harborandco.com",
          linkedinUrl: "https://www.linkedin.com/company/harbor-and-co",
          industry: "Professional services",
          subIndustry: "Customer operations",
          employeeCount: 280,
          sizeBand: "201-500",
          revenueBand: "$20M-$50M",
          country: "United Kingdom",
          region: "London",
          city: "London",
          timezone: "Europe/London",
          techStack: ["Salesforce", "Slack", "Notion"],
          description: "A customer-heavy services company whose operations team is scaling rapidly.",
          source: "demo_seed",
        })
        .onConflictDoNothing()
        .returning({ id: schema.companies.id, domain: schema.companies.domain }),
      tx
        .insert(schema.companies)
        .values({
          orgId: org.id,
          name: "Signal Forge",
          domain: "signalforge.ai",
          websiteUrl: "https://signalforge.ai",
          linkedinUrl: "https://www.linkedin.com/company/signalforge",
          industry: "Software",
          subIndustry: "AI tooling",
          employeeCount: 110,
          sizeBand: "51-200",
          revenueBand: "$5M-$15M",
          country: "United States",
          region: "California",
          city: "San Francisco",
          timezone: "America/Los_Angeles",
          techStack: ["HubSpot", "Slack", "Notion"],
          description: "AnAI-enabled company growing headcount in operations and CX.",
          source: "demo_seed",
        })
        .onConflictDoNothing()
        .returning({ id: schema.companies.id, domain: schema.companies.domain }),
    ]);

    const fetchCompany = async (domain: string) =>
      tx
        .select({ id: schema.companies.id })
        .from(schema.companies)
        .where(and(eq(schema.companies.orgId, org.id), eq(schema.companies.domain, domain)))
        .limit(1);

    const [companyA] = await fetchCompany("northpeakstudio.com");
    const [companyB] = await fetchCompany("harborandco.com");
    const [companyC] = await fetchCompany("signalforge.ai");

    const findProspect = async (email: string) =>
      tx
        .select({ id: schema.prospects.id })
        .from(schema.prospects)
        .where(and(eq(schema.prospects.orgId, org.id), eq(schema.prospects.email, email)))
        .limit(1);

    const prospectRows = [
      {
        email: "mara@northpeakstudio.com",
        companyId: companyA?.id,
        firstName: "Mara",
        lastName: "Chen",
        fullName: "Mara Chen",
        title: "VP Operations",
        department: "Operations",
        seniority: "VP",
        emailVerification: "valid",
        status: "qualified",
        nextActionAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        nextActionType: "email",
        phone: "+12125550198",
        timezone: "America/New_York",
        country: "United States",
        city: "New York",
        source: "demo_seed",
      },
      {
        email: "oliver@harborandco.com",
        companyId: companyB?.id,
        firstName: "Oliver",
        lastName: "Bennett",
        fullName: "Oliver Bennett",
        title: "Director of Customer Success",
        department: "Customer Success",
        seniority: "Director",
        emailVerification: "valid",
        status: "engaged",
        nextActionAt: new Date(Date.now() + 1000 * 60 * 60 * 30),
        nextActionType: "call",
        phone: "+447700900321",
        timezone: "Europe/London",
        country: "United Kingdom",
        city: "London",
        source: "demo_seed",
      },
      {
        email: "nina@signalforge.ai",
        companyId: companyC?.id,
        firstName: "Nina",
        lastName: "Park",
        fullName: "Nina Park",
        title: "Head of Revenue Operations",
        department: "Revenue",
        seniority: "Head",
        emailVerification: "risky",
        status: "needs_review",
        nextActionAt: null,
        nextActionType: null,
        phone: "+14155550677",
        timezone: "America/Los_Angeles",
        country: "United States",
        city: "San Francisco",
        source: "demo_seed",
      },
      {
        email: "leah@northpeakstudio.com",
        companyId: companyA?.id,
        firstName: "Leah",
        lastName: "Morris",
        fullName: "Leah Morris",
        title: "COO",
        department: "Operations",
        seniority: "C-level",
        emailVerification: "valid",
        status: "contacted",
        nextActionAt: new Date(Date.now() + 1000 * 60 * 60 * 18),
        nextActionType: "email",
        phone: "+12125550142",
        timezone: "America/New_York",
        country: "United States",
        city: "New York",
        source: "demo_seed",
      },
    ] as const;

    const insertedProspects = await Promise.all(
      prospectRows.map(async (row) => {
        const [existingProspect] = await findProspect(row.email);
        if (existingProspect) {
          return { id: existingProspect.id, email: row.email };
        }

        const [prospect] = await tx
          .insert(schema.prospects)
          .values({
            orgId: org.id,
            companyId: row.companyId ?? null,
            campaignId: campaign.id,
            firstName: row.firstName,
            lastName: row.lastName,
            fullName: row.fullName,
            title: row.title,
            department: row.department,
            seniority: row.seniority,
            email: row.email,
            emailVerification: row.emailVerification,
            phone: row.phone,
            timezone: row.timezone,
            country: row.country,
            city: row.city,
            status: row.status,
            nextActionAt: row.nextActionAt,
            nextActionType: row.nextActionType,
            source: row.source,
          })
          .returning({ id: schema.prospects.id, email: schema.prospects.email });

        return prospect!;
      }),
    );

    const prospectMap = new Map(insertedProspects.map((p) => [p.email, p.id]));

    await tx
      .insert(schema.prospectScores)
      .values([
        {
          orgId: org.id,
          prospectId: prospectMap.get("mara@northpeakstudio.com")!,
          icpId: icp.id,
          icpFitScore: 89,
          intentScore: 76,
          reachabilityScore: 84,
          breakdown: [
            { criterion: "Industry fit", weight: 0.25, matched: true, note: "Software and SaaS vertical match." },
            { criterion: "Title fit", weight: 0.3, matched: true, note: "VP Operations is in target persona." },
            { criterion: "Hiring signal", weight: 0.2, matched: true, note: "Operations hiring is active." },
            { criterion: "Expansion signal", weight: 0.25, matched: true, note: "New regional expansion indicates urgency." },
          ],
          reasoning: "Strong fit across title, market stage, and timing signals.",
          model: "gpt-4o-mini",
        },
        {
          orgId: org.id,
          prospectId: prospectMap.get("oliver@harborandco.com")!,
          icpId: icp.id,
          icpFitScore: 82,
          intentScore: 64,
          reachabilityScore: 80,
          breakdown: [
            { criterion: "Industry fit", weight: 0.25, matched: true, note: "Service-heavy B2B operations team." },
            { criterion: "Title fit", weight: 0.3, matched: true, note: "Customer Success is in scope." },
            { criterion: "Hiring signal", weight: 0.2, matched: false, note: "No active hiring signal found." },
            { criterion: "Expansion signal", weight: 0.25, matched: true, note: "Scaling operations suggests a real need." },
          ],
          reasoning: "Good fit with a realistic learning angle around process cleanup and retention.",
          model: "gpt-4o-mini",
        },
      ])
      .onConflictDoNothing();

    await tx.insert(schema.prospectSignals).values([
      {
        orgId: org.id,
        prospectId: prospectMap.get("mara@northpeakstudio.com")!,
        companyId: companyA?.id ?? null,
        type: "hiring",
        category: "persona",
        value: "North Peak Studio recently hired two operations managers in the last 90 days.",
        sourceUrl: "https://www.linkedin.com/company/north-peak-studio",
        sourceName: "LinkedIn",
        confidence: "0.92",
        discoveredAt: new Date(Date.now() - 2 * 86400000),
        discoveredBy: "demo_seed",
      },
      {
        orgId: org.id,
        prospectId: prospectMap.get("mara@northpeakstudio.com")!,
        companyId: companyA?.id ?? null,
        type: "expanding",
        category: "company",
        value: "The company is expanding into a new APAC market and has new regional process gaps.",
        sourceUrl: "https://northpeakstudio.com",
        sourceName: "Company site",
        confidence: "0.83",
        discoveredAt: new Date(Date.now() - 5 * 86400000),
        discoveredBy: "demo_seed",
      },
      {
        orgId: org.id,
        prospectId: prospectMap.get("oliver@harborandco.com")!,
        companyId: companyB?.id ?? null,
        type: "review_volume",
        category: "customer_experience",
        value: "Customer review themes highlight handoff and response-time issues.",
        sourceUrl: "https://www.g2.com/products/harbor-and-co",
        sourceName: "Review site",
        confidence: "0.79",
        discoveredAt: new Date(Date.now() - 3 * 86400000),
        discoveredBy: "demo_seed",
      },
    ]).onConflictDoNothing();

    await tx.insert(schema.emails).values([
      {
        orgId: org.id,
        prospectId: prospectMap.get("mara@northpeakstudio.com")!,
        campaignId: campaign.id,
        mailboxId: mailbox.id,
        direction: "outbound",
        state: "pending_approval",
        subject: "Ops bottleneck in the new region",
        bodyText:
          "Hi Mara — I noticed you are expanding into the new APAC region while adding operations capacity. A lot of companies hit the same issue: handoffs get fragmented fast. I’d be happy to share a few specific ideas if useful.",
        reasoning: "Used the expansion and hiring signals to justify the message; kept it low-commitment and specific.",
        model: "claude-3.5-sonnet",
        scheduledFor: new Date(Date.now() + 3600000),
        generated: undefined,
      } as any,
      {
        orgId: org.id,
        prospectId: prospectMap.get("oliver@harborandco.com")!,
        campaignId: campaign.id,
        mailboxId: mailbox.id,
        direction: "outbound",
        state: "sent",
        subject: "Customer success handoff friction",
        bodyText:
          "Hi Oliver — I saw a pattern in customer reviews that your team is dealing with handoff delays between onboarding and support. I’m sharing one idea we’ve seen work elsewhere, and I’d be glad to send it over if that’s useful.",
        reasoning: "Grounded in review themes and customer journey issues on the account.",
        model: "claude-3.5-sonnet",
        sentAt: new Date(Date.now() - 86400000),
      } as any,
    ] as any[]).onConflictDoNothing();

    await tx.insert(schema.emailReplies).values([
      {
        orgId: org.id,
        prospectId: prospectMap.get("oliver@harborandco.com")!,
        fromEmail: "oliver@harborandco.com",
        rawBody: "Thanks, I’m interested. Could you send a short overview?",
        parsedBody: "Thanks, I’m interested. Could you send a short overview?",
        intent: "interested",
        sentiment: "0.82",
        classificationReasoning: "Prospect asked for more information and is clearly engaged.",
        model: "claude-3.5-sonnet",
        handledAt: null,
        receivedAt: new Date(Date.now() - 2 * 3600000),
      },
    ] as any).onConflictDoNothing();

    await tx.insert(schema.calls).values([
      {
        orgId: org.id,
        prospectId: prospectMap.get("mara@northpeakstudio.com")!,
        campaignId: campaign.id,
        provider: "vapi",
        vapiCallId: "demo-call-123",
        status: "ended",
        disposition: "answered",
        durationSeconds: 243,
        recordingUrl: "https://example.com/demo-recording.mp3",
        transcriptText: "Hi Mara, this is the AI outreach assistant calling on behalf of Northstar Ops about the operations challenges in your growth plans.",
        summary: "Prospect listened and asked for more detail after a brief explanation.",
        sentiment: "0.74",
        permissionGranted: true,
        voicemailLeft: false,
        startedAt: new Date(Date.now() - 6 * 3600000),
        endedAt: new Date(Date.now() - 5 * 3600000),
      },
    ] as any).onConflictDoNothing();

    await tx.insert(schema.activities).values([
      {
        orgId: org.id,
        prospectId: prospectMap.get("mara@northpeakstudio.com")!,
        campaignId: campaign.id,
        type: "email_sent",
        actor: "system",
        summary: "Draft queued for review for Mara Chen.",
        occurredAt: new Date(Date.now() - 3600000),
      },
      {
        orgId: org.id,
        prospectId: prospectMap.get("oliver@harborandco.com")!,
        campaignId: campaign.id,
        type: "email_replied",
        actor: "system",
        summary: "Oliver Bennett replied with interest.",
        occurredAt: new Date(Date.now() - 2 * 3600000),
      },
      {
        orgId: org.id,
        prospectId: prospectMap.get("mara@northpeakstudio.com")!,
        campaignId: campaign.id,
        type: "call_completed",
        actor: "system",
        summary: "Call completed and follow-up is queued.",
        occurredAt: new Date(Date.now() - 5 * 3600000),
      },
    ]).onConflictDoNothing();

    await tx.insert(schema.guardrailEvents).values([
      {
        orgId: org.id,
        prospectId: prospectMap.get("nina@signalforge.ai")!,
        campaignId: campaign.id,
        mailboxId: mailbox.id,
        channel: "email",
        rule: "email_verification",
        reason: "Address flagged as risky; no outbound send was authorized.",
        retryAfter: new Date(Date.now() + 36 * 3600000),
      },
    ]).onConflictDoNothing();

    await tx.insert(schema.sourcePerformance).values([
      {
        orgId: org.id,
        icpId: icp.id,
        source: "apollo",
        query: "VP operations SaaS north america",
        leadsReturned: 82,
        leadsNew: 30,
        leadsQualified: 7,
        avgFitScore: "82.00",
        costUsd: "0.0",
        latencyMs: 1800,
        ranAt: new Date(Date.now() - 86400000),
      },
      {
        orgId: org.id,
        icpId: icp.id,
        source: "linkedin",
        query: "SaaS operations leadership",
        leadsReturned: 48,
        leadsNew: 18,
        leadsQualified: 6,
        avgFitScore: "79.50",
        costUsd: "12.00",
        latencyMs: 2200,
        ranAt: new Date(Date.now() - 2 * 86400000),
      },
    ]).onConflictDoNothing();
  });

  console.log(`Seeded ${ORG_NAME}.`);
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log("\nSign in at http://localhost:3100/sign-in and you will see a populated dashboard.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
