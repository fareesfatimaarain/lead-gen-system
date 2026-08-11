import { describe, expect, it } from "vitest";
import {
  isSameLocalDay,
  isWeekend,
  isWithinHours,
  jitteredDelaySeconds,
  localDateKey,
  localHour,
  localParts,
} from "./time";

// 2026-08-07T12:00:00Z is a Friday.
const FRI_NOON_UTC = new Date("2026-08-07T12:00:00Z");

describe("localParts", () => {
  it("decomposes an instant in the target zone", () => {
    const p = localParts(FRI_NOON_UTC, "Asia/Karachi"); // UTC+5
    expect(p).toMatchObject({ year: 2026, month: 8, day: 7, hour: 17, weekday: 5 });
  });

  it("crosses the date line correctly", () => {
    // 2026-08-07T20:00Z is already Saturday in Karachi (+5 -> 01:00).
    const p = localParts(new Date("2026-08-07T20:00:00Z"), "Asia/Karachi");
    expect(p).toMatchObject({ day: 8, hour: 1, weekday: 6 });
  });

  it("falls back to UTC on an unknown zone instead of throwing", () => {
    // An enrichment provider returning garbage must not crash the orchestrator.
    const p = localParts(FRI_NOON_UTC, "Not/AZone");
    expect(p.hour).toBe(12);
  });

  it("renders midnight as hour 0, not 24", () => {
    expect(localHour(new Date("2026-08-07T00:00:00Z"), "UTC")).toBe(0);
  });
});

describe("isWithinHours", () => {
  it("treats the window as [start, end)", () => {
    const at = (h: number) => new Date(`2026-08-07T${String(h).padStart(2, "0")}:00:00Z`);
    expect(isWithinHours(at(9), "UTC", 9, 18)).toBe(true); // start is inclusive
    expect(isWithinHours(at(17), "UTC", 9, 18)).toBe(true);
    expect(isWithinHours(at(18), "UTC", 9, 18)).toBe(false); // end is exclusive
    expect(isWithinHours(at(8), "UTC", 9, 18)).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    const at = (h: number) => new Date(`2026-08-07T${String(h).padStart(2, "0")}:00:00Z`);
    expect(isWithinHours(at(22), "UTC", 20, 6)).toBe(true);
    expect(isWithinHours(at(3), "UTC", 20, 6)).toBe(true);
    expect(isWithinHours(at(12), "UTC", 20, 6)).toBe(false);
  });

  it("treats start === end as always allowed", () => {
    expect(isWithinHours(FRI_NOON_UTC, "UTC", 0, 0)).toBe(true);
  });

  it("evaluates in the prospect's zone, not the server's", () => {
    // 03:00 UTC is 08:00 in Karachi — outside a 9-18 window either way,
    // but 05:00 UTC is 10:00 Karachi, which is inside. This is the whole point:
    // the same instant is sendable for one prospect and not for another.
    const at5 = new Date("2026-08-07T05:00:00Z");
    expect(isWithinHours(at5, "UTC", 9, 18)).toBe(false);
    expect(isWithinHours(at5, "Asia/Karachi", 9, 18)).toBe(true);
  });
});

describe("DST transitions", () => {
  // US DST ends 2026-11-01: 02:00 EDT -> 01:00 EST. The 06:00Z instant is 02:00 EDT,
  // and the 07:00Z instant is 02:00 EST — the same wall clock twice.
  it("keeps wall-clock hours stable across a fall-back boundary", () => {
    expect(localHour(new Date("2026-11-01T05:00:00Z"), "America/New_York")).toBe(1); // 01:00 EDT
    expect(localHour(new Date("2026-11-01T06:00:00Z"), "America/New_York")).toBe(1); // 01:00 EST
  });

  // US DST starts 2026-03-08: 02:00 EST -> 03:00 EDT. 02:xx local never happens.
  it("skips the non-existent hour on a spring-forward boundary", () => {
    expect(localHour(new Date("2026-03-08T06:59:00Z"), "America/New_York")).toBe(1);
    expect(localHour(new Date("2026-03-08T07:00:00Z"), "America/New_York")).toBe(3);
  });

  it("still gates a 9-18 window correctly on a DST day", () => {
    // 13:00Z on the spring-forward day is 09:00 EDT — the first sendable hour.
    expect(isWithinHours(new Date("2026-03-08T13:00:00Z"), "America/New_York", 9, 18)).toBe(true);
    expect(isWithinHours(new Date("2026-03-08T12:59:00Z"), "America/New_York", 9, 18)).toBe(false);
  });
});

describe("isWeekend", () => {
  it("identifies Saturday and Sunday in the prospect's zone", () => {
    expect(isWeekend(FRI_NOON_UTC, "UTC")).toBe(false);
    expect(isWeekend(new Date("2026-08-08T12:00:00Z"), "UTC")).toBe(true); // Sat
    expect(isWeekend(new Date("2026-08-09T12:00:00Z"), "UTC")).toBe(true); // Sun
  });

  it("can disagree with UTC near a zone boundary", () => {
    // Friday 20:00 UTC is already Saturday 01:00 in Karachi.
    const instant = new Date("2026-08-07T20:00:00Z");
    expect(isWeekend(instant, "UTC")).toBe(false);
    expect(isWeekend(instant, "Asia/Karachi")).toBe(true);
  });
});

describe("localDateKey / isSameLocalDay", () => {
  it("formats a stable per-day cap key", () => {
    expect(localDateKey(FRI_NOON_UTC, "UTC")).toBe("2026-08-07");
  });

  it("detects same-day in the prospect's zone", () => {
    const morning = new Date("2026-08-07T06:00:00Z");
    const evening = new Date("2026-08-07T18:00:00Z");
    expect(isSameLocalDay(morning, evening, "UTC")).toBe(true);
    // In Karachi the evening instant is 23:00 the same day; still same day.
    expect(isSameLocalDay(morning, evening, "Asia/Karachi")).toBe(true);
    // But 20:00Z rolls over in Karachi.
    expect(isSameLocalDay(morning, new Date("2026-08-07T20:00:00Z"), "Asia/Karachi")).toBe(false);
  });
});

describe("jitteredDelaySeconds", () => {
  it("stays within bounds", () => {
    expect(jitteredDelaySeconds(240, 1800, () => 0)).toBe(240);
    expect(jitteredDelaySeconds(240, 1800, () => 1)).toBe(1800);
    expect(jitteredDelaySeconds(240, 1800, () => 0.5)).toBe(1020);
  });

  it("collapses to the minimum when the range is inverted or zero-width", () => {
    expect(jitteredDelaySeconds(600, 600, () => 0.5)).toBe(600);
    expect(jitteredDelaySeconds(600, 100, () => 0.5)).toBe(600);
  });

  it("never returns a negative delay", () => {
    expect(jitteredDelaySeconds(-10, -5, () => 0.5)).toBe(0);
  });

  it("produces a spread rather than a fixed cadence", () => {
    // A fixed send interval is one of the clearest automation signals a mailbox
    // provider can read, so the spread itself is the property under test.
    const values = new Set(
      Array.from({ length: 50 }, () => jitteredDelaySeconds(240, 1800)),
    );
    expect(values.size).toBeGreaterThan(20);
  });
});
