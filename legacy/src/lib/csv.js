// Minimal, dependency-free RFC-4180-ish CSV parser. Handles quoted fields,
// escaped quotes (""), commas and newlines inside quotes, and BOM.

function parseCsv(text) {
  const rows = [];
  const s = String(text).replace(/^﻿/, "");
  let field = "";
  let row = [];
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
      // ignore; handled by \n
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

function parseCsvToObjects(text) {
  const raw = parseCsv(text).filter((r) => r.length && r.some((c) => String(c).trim() !== ""));
  if (!raw.length) return { headers: [], records: [] };
  const headers = raw[0].map((h) => String(h).trim());
  const records = raw.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, records };
}

// Fuzzy-map common column names to our canonical lead fields.
const COLUMN_ALIASES = {
  name: ["name", "full name", "fullname", "contact", "contact name", "lead", "lead name", "first name"],
  phone: ["phone", "phone number", "phonenumber", "number", "mobile", "cell", "cellphone", "telephone", "tel", "contact number", "msisdn"],
  email: ["email", "e-mail", "email address", "mail"],
  company: ["company", "company name", "organization", "organisation", "org", "business", "account"],
  timezone: ["timezone", "time zone", "tz"],
  notes: ["notes", "note", "comment", "comments", "context", "remarks"]
};

function mapLeadColumns(headers) {
  const lower = headers.map((h) => String(h).trim().toLowerCase());
  const mapping = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = lower.findIndex((h) => aliases.includes(h));
    if (idx !== -1) mapping[field] = headers[idx];
  }
  // Fallback: any header containing "phone"/"mobile"/"number" for phone.
  if (!mapping.phone) {
    const idx = lower.findIndex((h) => /phone|mobile|number|cell|tel/.test(h));
    if (idx !== -1) mapping.phone = headers[idx];
  }
  if (!mapping.name) {
    const idx = lower.findIndex((h) => /name/.test(h));
    if (idx !== -1) mapping.name = headers[idx];
  }
  return mapping;
}

module.exports = { parseCsv, parseCsvToObjects, mapLeadColumns };
