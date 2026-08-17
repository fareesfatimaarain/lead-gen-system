import { describe, expect, it } from "vitest";
import { applyMapping, mapProspectColumns, parseCsv, parseCsvToObjects, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a plain grid", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsv('name,note\n"Doe, Jane",hello')).toEqual([
      ["name", "note"],
      ["Doe, Jane", "hello"],
    ]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('q\n"she said ""hi"""')).toEqual([["q"], ['she said "hi"']]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([["note"], ["line one\nline two"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a UTF-8 BOM", () => {
    // Excel writes one on every export, and it silently corrupts the first header.
    expect(parseCsv("﻿email\njane@co.com")).toEqual([["email"], ["jane@co.com"]]);
  });
});

describe("parseCsvToObjects", () => {
  it("keys records by trimmed header", () => {
    const { headers, records } = parseCsvToObjects(" Email , Company \njane@co.com , Acme ");
    expect(headers).toEqual(["Email", "Company"]);
    expect(records).toEqual([{ Email: "jane@co.com", Company: "Acme" }]);
  });

  it("returns empty results for empty input", () => {
    expect(parseCsvToObjects("")).toEqual({ headers: [], records: [] });
    expect(parseCsvToObjects("\n\n")).toEqual({ headers: [], records: [] });
  });

  it("pads short rows rather than dropping them", () => {
    const { records } = parseCsvToObjects("a,b,c\n1,2");
    expect(records).toEqual([{ a: "1", b: "2", c: "" }]);
  });
});

describe("mapProspectColumns", () => {
  it("maps obvious headers", () => {
    const m = mapProspectColumns(["First Name", "Last Name", "Email", "Company", "Job Title"]);
    expect(m).toMatchObject({
      firstName: "First Name",
      lastName: "Last Name",
      email: "Email",
      companyName: "Company",
      title: "Job Title",
    });
  });

  it("is case- and spacing-insensitive", () => {
    expect(mapProspectColumns(["  E-MAIL  "]).email).toBe("  E-MAIL  ");
  });

  it("falls back to a fuzzy match when no alias hits", () => {
    const m = mapProspectColumns(["Primary Work E-Mail", "Direct Phone Line"]);
    expect(m.email).toBe("Primary Work E-Mail");
    expect(m.phone).toBe("Direct Phone Line");
  });

  it("never assigns one column to two fields", () => {
    // "Name" is an alias of fullName and would also fuzzy-match nothing else;
    // the claimed-set guard is what keeps a single column from being reused.
    const m = mapProspectColumns(["Name", "Company Name"]);
    expect(m.fullName).toBe("Name");
    expect(m.companyName).toBe("Company Name");
  });

  it("prefers the exact alias over a fuzzy candidate", () => {
    const m = mapProspectColumns(["Contact Number", "Email"]);
    expect(m.phone).toBe("Contact Number");
    expect(m.email).toBe("Email");
  });

  it("returns an empty mapping when nothing is recognizable", () => {
    expect(mapProspectColumns(["col1", "col2"])).toEqual({});
  });
});

describe("applyMapping", () => {
  it("extracts and trims mapped values", () => {
    const m = mapProspectColumns(["Email", "Company"]);
    expect(applyMapping({ Email: " jane@co.com ", Company: "Acme" }, m)).toEqual({
      email: "jane@co.com",
      companyName: "Acme",
    });
  });

  it("drops empty values instead of writing blank fields", () => {
    const m = mapProspectColumns(["Email", "Company"]);
    expect(applyMapping({ Email: "jane@co.com", Company: "   " }, m)).toEqual({
      email: "jane@co.com",
    });
  });
});

describe("toCsv", () => {
  const cols = [
    { header: "Email", value: (r: { email?: string; notes?: string }) => r.email },
    { header: "Notes", value: (r: { email?: string; notes?: string }) => r.notes },
  ];

  it("writes a header row and CRLF line endings", () => {
    expect(toCsv([{ email: "jane@co.com", notes: "hi" }], cols)).toBe(
      "Email,Notes\r\njane@co.com,hi\r\n",
    );
  });

  it("writes only the header when there are no rows", () => {
    expect(toCsv([], cols)).toBe("Email,Notes\r\n");
  });

  it("quotes fields containing commas, quotes or newlines", () => {
    const out = toCsv([{ email: "a@b.com", notes: 'x, y "z"\nnext' }], cols);
    expect(out).toBe('Email,Notes\r\na@b.com,"x, y ""z""\nnext"\r\n');
  });

  it("writes empty cells for null and undefined", () => {
    expect(toCsv([{ email: undefined, notes: "n" }], cols)).toBe("Email,Notes\r\n,n\r\n");
  });

  it("round-trips through parseCsvToObjects", () => {
    const rows = [
      { email: "jane@co.com", notes: 'has "quotes", a comma' },
      { email: "bob@co.com", notes: "plain" },
    ];
    const parsed = parseCsvToObjects(toCsv(rows, cols));
    expect(parsed.headers).toEqual(["Email", "Notes"]);
    expect(parsed.records).toEqual([
      { Email: "jane@co.com", Notes: 'has "quotes", a comma' },
      { Email: "bob@co.com", Notes: "plain" },
    ]);
  });

  // CSV injection: Excel and Sheets execute a cell that opens with = + - or @.
  it("defuses formula-leading values so a spreadsheet will not execute them", () => {
    const out = toCsv([{ email: "=cmd|'/c calc'!A1", notes: "@SUM(1)" }], cols);
    expect(out).toBe('Email,Notes\r\n"\t=cmd|\'/c calc\'!A1","\t@SUM(1)"\r\n');
    // The original text is preserved once the guard tab is stripped.
    const back = parseCsvToObjects(out).records[0]?.Email ?? "";
    expect(back.replace(/^\t/, "")).toBe("=cmd|'/c calc'!A1");
  });

  it("serializes dates as ISO and objects as JSON", () => {
    const out = toCsv([{ at: new Date("2026-01-02T03:04:05Z"), meta: { a: 1 } }], [
      { header: "At", value: (r: { at: Date; meta: object }) => r.at },
      { header: "Meta", value: (r: { at: Date; meta: object }) => r.meta },
    ]);
    expect(out).toBe('At,Meta\r\n2026-01-02T03:04:05.000Z,"{""a"":1}"\r\n');
  });
});
