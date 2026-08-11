import { describe, expect, it } from "vitest";
import { applyMapping, mapProspectColumns, parseCsv, parseCsvToObjects } from "./csv";

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
