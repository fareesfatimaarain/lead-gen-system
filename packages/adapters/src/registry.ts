import { z } from "zod";
import { anthropicProvider, SUPPORTED_MODELS } from "./providers/anthropic";
import { apolloProvider } from "./providers/apollo";
import { bayutProvider } from "./providers/bayut";
import { dubaiPulseProvider } from "./providers/dubai-pulse";
import { propertyFinderProvider } from "./providers/propertyfinder";
import { googlePlacesProvider } from "./providers/google-places";
import { hubspotProvider } from "./providers/hubspot";
import { hunterDomainSearchProvider, hunterVerifierProvider } from "./providers/hunter";
import { overpassProvider } from "./providers/overpass";
import { rentcastProvider } from "./providers/rentcast";
import { resendProvider } from "./providers/resend";
import { secEdgarProvider } from "./providers/sec-edgar";
import { smtpProvider } from "./providers/smtp";
import { yelpProvider } from "./providers/yelp";
import { vapiProvider } from "./providers/vapi";
import type { ProviderAdapter, ProviderCategory } from "./types";

/**
 * The provider registry.
 *
 * The Connections page renders entirely from this file. Adding a provider means
 * adding an entry here plus an adapter — no UI changes, no new route, no new
 * form. That is the mechanism that keeps §7 of the brief true as the provider
 * list grows.
 *
 * `secretField` is the one value that gets encrypted. Everything in `configFields`
 * is non-secret and stored in plaintext `credentials.config`, because the user
 * needs to be able to see and edit it.
 */

export type FieldType = "text" | "password" | "number" | "email" | "select" | "boolean";

export interface ConfigField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  /** Shown under the input. Say what the value is for, not what a field is. */
  help?: string;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  category: ProviderCategory;
  /** One line, shown on the card. What it does for the user, not what it is. */
  summary: string;
  docsUrl: string;
  /**
   * The encrypted field. Every metered or authenticated provider has exactly
   * one. Absent only when `requiresCredential` is `false` — a free, keyless
   * public API has nothing to encrypt, and forcing a fake secret through the
   * vault for one would be lying to the vault about what it is protecting.
   */
  secretField?: { label: string; placeholder: string; help?: string };
  /** Default true. Set false for a provider that needs no key at all (e.g. OpenStreetMap). */
  requiresCredential?: boolean;
  configFields: ConfigField[];
  /** Zod schema for `config`, validated before the credential is written. */
  configSchema: z.ZodType<Record<string, unknown>>;
  adapter: ProviderAdapter;
  /**
   * True when this provider's `testConnection` has been run against a live
   * account from this codebase. Surfaced in the UI so nobody mistakes an
   * unverified adapter for a proven one.
   */
  verified: boolean;
}

/**
 * Categories the Sources screen configures (which data feeds discovery), as
 * opposed to Connections (which credentials are on file). A provider can, and
 * usually does, appear in both places — Connections manages its key, Sources
 * decides whether and how heavily discovery uses it.
 */
export const SOURCE_CATEGORIES: ProviderCategory[] = [
  "lead_source",
  "enrichment",
  "verification",
  "search",
  "crm",
];

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  email_send: "Email sending",
  email_receive: "Email receiving",
  voice: "Voice",
  lead_source: "Lead data",
  enrichment: "Enrichment",
  verification: "Email verification",
  search: "Search",
  crm: "CRM",
  llm: "Models",
  scheduling: "Scheduling",
};

/** Category display order on the Connections page — setup order, roughly. */
export const CATEGORY_ORDER: ProviderCategory[] = [
  "llm",
  "email_send",
  "email_receive",
  "voice",
  "lead_source",
  "enrichment",
  "verification",
  "search",
  "scheduling",
  "crm",
];

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    category: "llm",
    summary: "Powers every agent: source strategy, research, scoring, and message writing.",
    docsUrl: "https://console.anthropic.com/settings/keys",
    secretField: {
      label: "API key",
      placeholder: "sk-ant-api03-…",
      help: "From console.anthropic.com → Settings → API keys.",
    },
    configFields: [
      {
        name: "defaultModel",
        label: "Default model",
        type: "select",
        required: false,
        default: "claude-opus-5",
        options: SUPPORTED_MODELS.map((m) => ({ value: m, label: m })),
        help: "Per-agent overrides live in Settings. This is the fallback.",
      },
    ],
    configSchema: z.object({
      defaultModel: z.enum(SUPPORTED_MODELS as [string, ...string[]]).optional(),
    }),
    adapter: anthropicProvider,
    verified: true,
  },

  {
    id: "vapi",
    name: "Vapi",
    category: "voice",
    summary: "Places the outbound calls and returns transcripts and recordings.",
    docsUrl: "https://dashboard.vapi.ai/",
    secretField: {
      label: "Private API key",
      placeholder: "…",
      help: "Vapi dashboard → Settings → API Keys. Use the private key, not the public one.",
    },
    configFields: [
      {
        name: "phoneNumberId",
        label: "Phone number ID",
        type: "text",
        required: true,
        help: "Provision a number in Vapi first. Without it no call can be placed.",
      },
      {
        name: "assistantId",
        label: "Base assistant ID",
        type: "text",
        required: true,
        help: "Per-prospect context is layered on top of this assistant at call time.",
      },
      {
        name: "webhookSecret",
        label: "Webhook secret",
        type: "password",
        required: true,
        help: "Set the same value in Vapi's server settings. Payloads that do not match it are discarded.",
      },
      {
        name: "publicKey",
        label: "Public key",
        type: "text",
        required: false,
        help: "Only needed for in-browser test calls.",
      },
    ],
    configSchema: z.object({
      phoneNumberId: z.string().min(1, "Provision a phone number in Vapi and paste its ID."),
      assistantId: z.string().min(1, "An assistant ID is required."),
      webhookSecret: z.string().min(16, "Use at least 16 characters — this is what authenticates inbound call results."),
      publicKey: z.string().optional(),
    }),
    adapter: vapiProvider,
    verified: true,
  },

  {
    id: "smtp",
    name: "SMTP",
    category: "email_send",
    summary: "Sends through any mailbox you already own — Gmail, Outlook, or your own server.",
    docsUrl: "https://nodemailer.com/smtp/",
    secretField: {
      label: "Password",
      placeholder: "…",
      help: "With 2FA on Gmail or Outlook this must be an app password, not your account password.",
    },
    configFields: [
      { name: "host", label: "Host", type: "text", required: true, placeholder: "smtp.gmail.com" },
      {
        name: "port",
        label: "Port",
        type: "number",
        required: true,
        default: 587,
        help: "587 for STARTTLS, 465 for implicit TLS.",
      },
      { name: "user", label: "Username", type: "text", required: true, placeholder: "you@company.com" },
      {
        name: "fromEmail",
        label: "From address",
        type: "email",
        required: true,
        help: "Most servers require this to match the authenticated account.",
      },
      { name: "fromName", label: "From name", type: "text", required: false, placeholder: "Jane Doe" },
      {
        name: "secure",
        label: "Implicit TLS",
        type: "boolean",
        required: false,
        help: "Leave off for port 587. Turn on for port 465.",
      },
    ],
    configSchema: z.object({
      host: z.string().min(1, "An SMTP host is required."),
      port: z.coerce.number().int().min(1).max(65535),
      user: z.string().min(1, "A username is required."),
      fromEmail: z.string().email("Enter a valid From address."),
      fromName: z.string().optional(),
      secure: z.coerce.boolean().optional(),
    }),
    adapter: smtpProvider,
    verified: true,
  },

  {
    id: "resend",
    name: "Resend",
    category: "email_send",
    summary: "Transactional sending with domain authentication and delivery webhooks.",
    docsUrl: "https://resend.com/docs/api-reference/introduction",
    secretField: { label: "API key", placeholder: "re_…", help: "From resend.com → API Keys." },
    configFields: [
      {
        name: "fromEmail",
        label: "From address",
        type: "email",
        required: true,
        help: "Must be on a domain you have verified in Resend.",
      },
      { name: "fromName", label: "From name", type: "text", required: false },
    ],
    configSchema: z.object({
      fromEmail: z.string().email("Enter a valid From address."),
      fromName: z.string().optional(),
    }),
    adapter: resendProvider,
    // Written from the public API docs; not yet exercised against a live account.
    verified: false,
  },

  {
    id: "overpass",
    name: "OpenStreetMap (Overpass)",
    category: "lead_source",
    summary: "Finds real, physically-located businesses by category and place — free, no account needed.",
    docsUrl: "https://wiki.openstreetmap.org/wiki/Overpass_API",
    // The public Overpass instance takes no credential at all. Fair-use is a
    // request-rate courtesy (User-Agent header, headroom under the daily
    // quota), enforced in the adapter, not an API key.
    requiresCredential: false,
    configFields: [
      {
        name: "endpoint",
        label: "Overpass endpoint",
        type: "text",
        required: false,
        default: "https://overpass-api.de/api/interpreter",
        help: "Change this only to point at a self-hosted or regional mirror.",
      },
    ],
    configSchema: z.object({ endpoint: z.string().url().optional() }),
    adapter: overpassProvider,
    verified: true,
  },

  {
    id: "hunter_domain_search",
    name: "Hunter — Domain Search",
    category: "lead_source",
    summary: "Finds named people and their work emails at a target company domain.",
    docsUrl: "https://hunter.io/api-documentation/v2#domain-search",
    secretField: {
      label: "API key",
      placeholder: "…",
      help: "From hunter.io → API → your key.",
    },
    configFields: [
      {
        name: "seniority",
        label: "Seniority filter",
        type: "select",
        required: false,
        options: [
          { value: "", label: "Any" },
          { value: "junior", label: "Junior" },
          { value: "senior", label: "Senior" },
          { value: "executive", label: "Executive" },
        ],
        help: "Narrows every search made through this connection. Leave on Any to filter per-run instead.",
      },
    ],
    configSchema: z.object({ seniority: z.enum(["", "junior", "senior", "executive"]).optional() }),
    adapter: hunterDomainSearchProvider,
    verified: true,
  },

  {
    id: "hunter_verifier",
    name: "Hunter — Email Verifier",
    category: "verification",
    summary: "Checks deliverability of a discovered address before it is allowed to enter a sequence.",
    docsUrl: "https://hunter.io/api-documentation/v2#email-verifier",
    secretField: {
      label: "API key",
      placeholder: "…",
      help: "The same key as Domain Search works here — Hunter meters both from one account.",
    },
    configFields: [],
    configSchema: z.object({}),
    adapter: hunterVerifierProvider,
    verified: true,
  },

  {
    id: "apollo",
    name: "Apollo",
    category: "lead_source",
    summary: "Searches Apollo's contact database by title, industry and company size.",
    docsUrl: "https://docs.apollo.io/reference/people-search",
    secretField: {
      label: "API key",
      placeholder: "…",
      help: "From Apollo → Settings → Integrations → API.",
    },
    configFields: [],
    configSchema: z.object({}),
    adapter: apolloProvider,
    // Written from Apollo's public API reference; no paid account has been
    // available in this codebase to run it against. See providers/apollo.ts.
    verified: false,
  },

  {
    id: "google_places",
    name: "Google Places",
    category: "lead_source",
    summary: "Real businesses by category and place, anywhere Google Maps has coverage — including the UAE.",
    docsUrl: "https://developers.google.com/maps/documentation/places/web-service/text-search",
    secretField: {
      label: "API key",
      placeholder: "AIza…",
      help: "Google Cloud Console → APIs & Services → Credentials. The Places API (New) must be enabled for this key's project.",
    },
    configFields: [],
    configSchema: z.object({}),
    adapter: googlePlacesProvider,
    verified: true,
  },

  {
    id: "yelp",
    name: "Yelp Fusion",
    category: "lead_source",
    summary: "Local businesses by category and city — strongest for the US; UAE coverage is thin.",
    docsUrl: "https://docs.developer.yelp.com/reference/v3_business_search",
    secretField: {
      label: "API key",
      placeholder: "…",
      help: "yelp.com/developers → Manage App. The free tier needs no card.",
    },
    configFields: [],
    configSchema: z.object({}),
    adapter: yelpProvider,
    verified: true,
  },

  {
    id: "sec_edgar",
    name: "SEC EDGAR",
    category: "lead_source",
    summary: "US public companies and their filed subsidiaries — free, no account, narrow but real coverage.",
    docsUrl: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    requiresCredential: false,
    configFields: [],
    configSchema: z.object({}),
    adapter: secEdgarProvider,
    verified: true,
  },

  {
    id: "rentcast",
    name: "RentCast",
    category: "lead_source",
    summary: "US property ownership records — who actually owns a building, for ICPs that sell to owners or landlords.",
    docsUrl: "https://developers.rentcast.io/reference/property-records",
    secretField: {
      label: "API key",
      placeholder: "…",
      help: "app.rentcast.io/app/api. The free tier includes 50 requests/month.",
    },
    configFields: [],
    configSchema: z.object({}),
    adapter: rentcastProvider,
    verified: true,
  },

  {
    id: "dubai_pulse",
    name: "Dubai Land Department (Dubai Pulse)",
    category: "lead_source",
    summary: "Official Dubai government property transaction records — real, government-sourced, not scraped.",
    docsUrl: "https://www.dubaipulse.gov.ae/data/dld-transactions/dld_transactions-open-api",
    secretField: {
      label: "API Secret",
      placeholder: "…",
      help: "Request dataset access on dubaipulse.gov.ae — they email an API Key and API Secret.",
    },
    configFields: [
      { name: "clientId", label: "API Key", type: "text", required: true, help: "The API Key from the same grant email as the Secret." },
    ],
    configSchema: z.object({ clientId: z.string().min(1, "The API Key is required.") }),
    adapter: dubaiPulseProvider,
    // OAuth flow and endpoint confirmed from Dubai Pulse's published developer
    // instructions; the exact transaction record field names were not — no
    // grant was available to test against. See providers/dubai-pulse.ts.
    verified: false,
  },

  {
    id: "bayut",
    name: "Bayut",
    category: "lead_source",
    summary: "UAE property listings. Unofficial by default (see warning below) — official Enterprise mode available if you have partner access.",
    docsUrl: "https://bayutapi.com/documentation.html",
    secretField: {
      label: "RapidAPI key",
      placeholder: "…",
      help: "From your RapidAPI account, subscribed to the \"uae-real-estate2\" (Bayut) product.",
    },
    configFields: [
      {
        name: "mode",
        label: "Mode",
        type: "select",
        required: true,
        default: "rapidapi",
        options: [
          { value: "rapidapi", label: "Unofficial (RapidAPI) — not authorized by Bayut, real ToS/legal risk" },
          { value: "enterprise", label: "Official Enterprise API (requires Bayut partner access — not yet implemented here)" },
        ],
        help: "The unofficial mode republishes Bayut's data without Bayut's authorization. Use at your own legal risk.",
      },
    ],
    configSchema: z.object({ mode: z.enum(["rapidapi", "enterprise"]) }),
    adapter: bayutProvider,
    verified: false,
  },

  {
    id: "propertyfinder",
    name: "Property Finder",
    category: "lead_source",
    summary: "UAE property listings. Unofficial by default (see warning below) — official Enterprise mode available if you have partner access.",
    docsUrl: "https://propertyfinderapi.com/",
    secretField: {
      label: "RapidAPI key",
      placeholder: "…",
      help: "From your RapidAPI account, subscribed to whichever Property Finder data product you chose.",
    },
    configFields: [
      {
        name: "mode",
        label: "Mode",
        type: "select",
        required: true,
        default: "rapidapi",
        options: [
          { value: "rapidapi", label: "Unofficial (RapidAPI) — not authorized by Property Finder, real ToS/legal risk" },
          { value: "enterprise", label: "Official Enterprise API (requires partner access — not yet implemented here)" },
        ],
        help: "The unofficial mode republishes Property Finder's data without its authorization. Use at your own legal risk.",
      },
      {
        name: "rapidApiHost",
        label: "RapidAPI host",
        type: "text",
        required: false,
        placeholder: "e.g. property-finder-uae.p.rapidapi.com",
        help: "Copy this from the Endpoints tab of whichever Property Finder product you subscribed to on RapidAPI — there are several, and this was not verified against a live one.",
      },
    ],
    configSchema: z.object({ mode: z.enum(["rapidapi", "enterprise"]), rapidApiHost: z.string().optional() }),
    adapter: propertyFinderProvider,
    verified: false,
  },

  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    summary: "Pushes qualified prospects into HubSpot, and imports existing contacts so customers are never cold-emailed.",
    docsUrl: "https://developers.hubspot.com/docs/api/crm/contacts",
    secretField: {
      label: "Private App access token",
      placeholder: "pat-na1-…",
      help: "HubSpot → Settings → Integrations → Private Apps → your app → Auth. Needs the crm.objects.contacts.read and .write scopes.",
    },
    configFields: [
      {
        name: "suppressLifecycleStages",
        label: "Treat these stages as do-not-contact",
        type: "text",
        required: false,
        default: "customer",
        placeholder: "customer,opportunity",
        help: "Comma-separated HubSpot lifecycle stages. Contacts imported at one of these stages are added to suppressions, so outreach never lands on an existing customer or an open deal.",
      },
    ],
    configSchema: z.object({ suppressLifecycleStages: z.string().optional() }),
    adapter: hubspotProvider,
    // Written from HubSpot's public CRM v3 reference; no portal was available to
    // call. `npm run providers:verify` flips this once testConnection passes
    // against a real token.
    verified: false,
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function getProvider(id: string): ProviderDefinition | undefined {
  return BY_ID.get(id);
}

export function requireProvider(id: string): ProviderDefinition {
  const provider = BY_ID.get(id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

/**
 * Groups providers by category in display order. Pass a subset (e.g. only the
 * credential-bearing ones, or only the source-configuring ones) to scope which
 * screen is asking — Connections and Sources render the same registry but do
 * not want the same rows.
 */
export function providersByCategory(
  providers: ProviderDefinition[] = PROVIDERS,
): { category: ProviderCategory; label: string; providers: ProviderDefinition[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    providers: providers.filter((p) => p.category === category),
  })).filter((group) => group.providers.length > 0);
}

/**
 * The registry as the client sees it: no adapters, no functions, no secrets.
 * This is what the Connections page is rendered from.
 */
export type PublicProviderDefinition = Omit<ProviderDefinition, "adapter" | "configSchema">;

export function publicRegistry(): PublicProviderDefinition[] {
  return PROVIDERS.map(({ adapter: _adapter, configSchema: _schema, ...rest }) => rest);
}
