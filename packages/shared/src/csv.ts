/**
 * Dependency-free RFC-4180-ish CSV parser plus a fuzzy header mapper.
 *
 * Ported from the legacy MVP's `lib/csv.js`. It handles the cases that matter in
 * a customer upload — quoted fields, escaped quotes, commas and newlines inside
 * quotes, a BOM — and the alias table was built from real column names people
 * actually use. Extended here with the fields the new prospect model needs.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  // \uFEFF rather than the literal byte-order mark: Excel writes one at the
  // start of every CSV it exports, and an invisible character in the source is
  // one an editor or a copy-paste can silently drop.
  const s = String(text).replace(/^\uFEFF/, "");
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignored; the \n branch closes the row
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface ParsedCsv {
  headers: string[];
  records: Record<string, string>[];
}

export function parseCsvToObjects(text: string): ParsedCsv {
  const raw = parseCsv(text).filter((r) => r.length > 0 && r.some((c) => c.trim() !== ""));
  const header = raw[0];
  if (!header) return { headers: [], records: [] };

  const headers = header.map((h) => h.trim());
  const records = raw.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });

  return { headers, records };
}

/** Canonical prospect fields a CSV import can populate. */
export type ProspectCsvField =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "title"
  | "companyName"
  | "companyDomain"
  | "linkedinUrl"
  | "country"
  | "city"
  | "timezone"
  | "notes";

const COLUMN_ALIASES: Record<ProspectCsvField, string[]> = {
  firstName: ["first name", "firstname", "first", "given name", "forename"],
  lastName: ["last name", "lastname", "last", "surname", "family name"],
  fullName: ["name", "full name", "fullname", "contact", "contact name", "lead", "lead name", "person"],
  email: ["email", "e-mail", "email address", "mail", "work email", "business email"],
  phone: [
    "phone", "phone number", "phonenumber", "number", "mobile", "cell", "cellphone",
    "telephone", "tel", "contact number", "msisdn", "direct dial", "direct phone",
  ],
  title: ["title", "job title", "jobtitle", "position", "role", "designation"],
  companyName: ["company", "company name", "organization", "organisation", "org", "business", "account", "employer"],
  companyDomain: ["domain", "website", "company domain", "company website", "url", "site", "web"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedin profile", "li url", "profile url"],
  country: ["country", "country name", "nation"],
  city: ["city", "town", "locality"],
  timezone: ["timezone", "time zone", "tz"],
  notes: ["notes", "note", "comment", "comments", "context", "remarks", "description"],
};

/** Loose fallbacks, applied only when the exact-alias pass found nothing. */
const FUZZY_FALLBACKS: Partial<Record<ProspectCsvField, RegExp>> = {
  email: /e-?mail/,
  phone: /phone|mobile|cell|tel|number/,
  companyDomain: /domain|website|url/,
  linkedinUrl: /linked ?in/,
  companyName: /company|organi[sz]ation|employer/,
  title: /title|position|role/,
};

export type ColumnMapping = Partial<Record<ProspectCsvField, string>>;

/**
 * Map CSV headers onto canonical fields. Exact alias match first, then a fuzzy
 * pass for anything still unmapped. Returns the *original* header strings so the
 * caller can index records directly — and so the UI can show the user what was
 * detected and let them correct it.
 */
export function mapProspectColumns(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const mapping: ColumnMapping = {};
  const claimed = new Set<number>();

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [ProspectCsvField, string[]][]) {
    const idx = lower.findIndex((h, i) => !claimed.has(i) && aliases.includes(h));
    if (idx !== -1) {
      mapping[field] = headers[idx];
      claimed.add(idx);
    }
  }

  for (const [field, pattern] of Object.entries(FUZZY_FALLBACKS) as [ProspectCsvField, RegExp][]) {
    if (mapping[field]) continue;
    const idx = lower.findIndex((h, i) => !claimed.has(i) && pattern.test(h));
    if (idx !== -1) {
      mapping[field] = headers[idx];
      claimed.add(idx);
    }
  }

  return mapping;
}

/** Apply a mapping to one raw record, dropping empty values. */
export function applyMapping(
  record: Record<string, string>,
  mapping: ColumnMapping,
): Partial<Record<ProspectCsvField, string>> {
  const out: Partial<Record<ProspectCsvField, string>> = {};
  for (const [field, header] of Object.entries(mapping) as [ProspectCsvField, string][]) {
    const value = record[header]?.trim();
    if (value) out[field] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serializing out
// ---------------------------------------------------------------------------

/**
 * Quote a single field.
 *
 * Quoting is not merely cosmetic here. A leading `=`, `+`, `-` or `@` makes
 * Excel and Sheets treat the cell as a formula, so a prospect whose notes begin
 * `=cmd|...` becomes a live formula in whoever opens the export — the CSV
 * injection problem. Prefixing a tab defuses it while still displaying the
 * original text, and the tab is inside quotes so it survives a round trip.
 */
function encodeField(value: unknown): string {
  if (value === null || value === undefined) return "";

  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);

  if (s === "") return "";

  const risky = /^[=+\-@\t\r]/.test(s);
  const body = risky ? `\t${s}` : s;

  // Always quote when quoting could matter, rather than testing for each
  // separator: a quoted field is valid CSV regardless, and the cost is bytes.
  if (risky || /[",\r\n]/.test(body)) {
    return `"${body.replace(/"/g, '""')}"`;
  }
  return body;
}

export interface CsvColumn<T> {
  /** Header text written to row one. */
  header: string;
  /** Pulls the cell value out of a row. Returning null or undefined writes an empty cell. */
  value: (row: T) => unknown;
}

/**
 * Serialize rows to RFC-4180 CSV with CRLF endings, which is what Excel expects
 * and what `parseCsv` above reads back.
 *
 * Columns are explicit rather than inferred from object keys: an export is a
 * published interface, and inferring it would silently change shape — and could
 * silently start leaking a new column — the moment someone adds a database
 * field.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines: string[] = [columns.map((c) => encodeField(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => encodeField(c.value(row))).join(","));
  }
  // Trailing CRLF: the last record ends with a line break in RFC 4180, and some
  // importers drop a final line that lacks one.
  return `${lines.join("\r\n")}\r\n`;
}
