import { test } from "node:test";
import assert from "node:assert/strict";
import { csvEscape } from "./analytics-csv.ts";

test("csv: plain text is unchanged", () => {
  assert.equal(csvEscape("Anthropic IPO"), "Anthropic IPO");
  assert.equal(csvEscape(42), "42");
  assert.equal(csvEscape(null), "");
});

test("csv: RFC 4180 quoting for quotes, commas and newlines", () => {
  assert.equal(csvEscape('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape("line1\nline2"), '"line1\nline2"');
});

test("csv: formula lead-ins are neutralised (CWE-1236)", () => {
  // Each of these would execute in Excel / LibreOffice / Sheets without the guard.
  for (const payload of [
    '=HYPERLINK("http://evil.example","click")',
    "=cmd|'/c calc'!A1",
    "+1+1",
    "-2+3",
    "@SUM(A1:A9)",
    "\t=1+1",
    "\r=1+1",
  ]) {
    const out = csvEscape(payload);
    // The dangerous character must never be the first character the spreadsheet sees.
    const firstSeen = out.startsWith('"') ? out[1] : out[0];
    assert.equal(firstSeen, "'", `payload ${JSON.stringify(payload)} kept a formula lead (got ${JSON.stringify(out)})`);
  }
});

test("csv: neutralised cells that also need quoting still quote correctly", () => {
  assert.equal(csvEscape('=A1,"x"'), '"\'=A1,""x"""');
});

test("csv: ordinary negative numbers in text columns stay readable", () => {
  // Prefixing is intentional here: a text column that begins with "-" is ambiguous
  // to a spreadsheet, and the apostrophe is the documented disambiguation.
  assert.equal(csvEscape("-12%"), "'-12%");
});
