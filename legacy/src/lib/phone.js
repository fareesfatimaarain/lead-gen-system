// Pragmatic E.164 normalization. Not a full libphonenumber, but handles the
// common CSV formats: +country, 00country, national with leading 0, or bare
// digits, defaulting to DEFAULT_COUNTRY_CODE (digits only, e.g. "92" for PK).

function defaultCountry() {
  return String(process.env.DEFAULT_COUNTRY_CODE || "92").replace(/[^\d]/g, "");
}

function normalizePhone(raw, country = defaultCountry()) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  const hadPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;

  if (hadPlus) return `+${s}`;
  if (s.startsWith("00")) return `+${s.slice(2)}`;
  if (s.startsWith("0")) return `+${country}${s.slice(1)}`;
  if (s.startsWith(country)) return `+${s}`;
  return `+${country}${s}`;
}

function isValidE164(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone || "");
}

module.exports = { normalizePhone, isValidE164 };
