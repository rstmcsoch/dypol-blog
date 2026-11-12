/**
 * CSV cell encoding for the analytics exports (pure; shared by the server and
 * node tests).
 *
 * Two problems have to be solved at once:
 *
 *  1. RFC 4180 structure — a cell containing a quote, comma or line break must
 *     be double-quoted, and embedded quotes doubled.
 *  2. Spreadsheet formula execution (CWE-1236). Excel, LibreOffice Calc and
 *     Google Sheets treat a cell whose first character is `=`, `+`, `-`, `@`,
 *     TAB or CR as a formula *even when the cell is quoted*, so a title such
 *     as `=HYPERLINK("http://evil","click")` (or the older `=cmd|'/c calc'!A1`)
 *     runs when the owner opens the export. Article titles are written by the
 *     automation pipeline from external news sources, so this is reachable
 *     without the owner typing anything hostile.
 *
 * The standard mitigation is to prefix the cell with an apostrophe, which every
 * spreadsheet reads as "this is literal text" and hides in the cell view.
 * Escaping happens before quoting so the apostrophe is inside the quotes.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvEscape(value: unknown): string {
  let text = String(value ?? "");
  if (FORMULA_LEAD.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"` + text.replace(/"/g, '""') + `"`;
  return text;
}
