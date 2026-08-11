/**
 * E.164 normalization.
 *
 * Ported from the legacy MVP's `lib/phone.js`. The logic is unchanged — it
 * handles the formats that actually turn up in customer CSVs: +country, 00country,
 * national-with-leading-zero, and bare digits.
 *
 * TODO(verify): this is not libphonenumber. It cannot tell a valid national
 * number from an invalid one, only a plausibly-shaped one. Before Phase 5 dials
 * anything, swap the validation half for `libphonenumber-js` — a wrong number is
 * a real person answering a call meant for someone else, which is exactly the
 * prospect experience this product exists to avoid. Normalization can stay.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(raw: string | null | undefined, defaultCountryCode: string): string | null {
  if (raw === null || raw === undefined) return null;

  const country = defaultCountryCode.replace(/\D/g, "");
  let s = String(raw).trim();
  if (!s) return null;

  const hadPlus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  if (!s) return null;

  if (hadPlus) return `+${s}`;
  if (s.startsWith("00")) return `+${s.slice(2)}`;
  if (!country) return null;
  if (s.startsWith("0")) return `+${country}${s.slice(1)}`;
  if (s.startsWith(country)) return `+${s}`;
  return `+${country}${s}`;
}

export function isValidE164(phone: string | null | undefined): boolean {
  return E164.test(phone ?? "");
}

/** `+923001234567` -> `+92 300 ••• ••67`. For UI where the full number isn't needed. */
export function maskPhone(phone: string): string {
  if (!isValidE164(phone)) return phone;
  const digits = phone.slice(1);
  const tail = digits.slice(-2);
  return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ••• ••${tail}`;
}
