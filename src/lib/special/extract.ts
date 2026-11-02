/**
 * t173: bounded text extraction for research files (cloud files, uploads).
 * Supports TXT, MD, CSV, DOCX, XLSX, PPTX (zip + XML) and simple text PDFs.
 * Pure Web APIs only (DecompressionStream), so it runs in Workers and Node.
 *
 * Limits: input <= MAX_EXTRACT_BYTES, each inflated zip entry <= 20 MB,
 * output text <= maxChars. Extracted text is untrusted content: callers wrap
 * it before handing it to an AI (see research.ts untrusted()).
 */

export const MAX_EXTRACT_BYTES = 15_000_000;
const MAX_ENTRY_BYTES = 20_000_000;

export type ExtractKind = "txt" | "md" | "csv" | "docx" | "xlsx" | "pptx" | "pdf";
export class ExtractError extends Error {}

export function kindOf(name: string, mime = ""): ExtractKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["txt", "md", "csv", "docx", "xlsx", "pptx", "pdf"].includes(ext)) return ext as ExtractKind;
  if (ext === "markdown") return "md";
  if (mime === "text/plain") return "txt";
  if (mime === "text/markdown") return "md";
  if (mime === "text/csv") return "csv";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml")) return "docx";
  if (mime.includes("spreadsheetml")) return "xlsx";
  if (mime.includes("presentationml")) return "pptx";
  return null;
}

async function inflateRaw(data: Uint8Array, limit = MAX_ENTRY_BYTES): Promise<Uint8Array> {
  return streamThrough(data, new DecompressionStream("deflate-raw"), limit);
}
async function inflateZlib(data: Uint8Array, limit = MAX_ENTRY_BYTES): Promise<Uint8Array> {
  return streamThrough(data, new DecompressionStream("deflate"), limit);
}
async function streamThrough(data: Uint8Array, ds: DecompressionStream, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let r: ReadableStreamReadResult<Uint8Array>;
    try {
      r = await reader.read();
    } catch {
      break; // truncated / corrupt stream: keep what was inflated
    }
    if (r.done) break;
    size += r.value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ExtractError("A compressed part of the file is too large to read.");
    }
    chunks.push(r.value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** Minimal zip reader (central directory, stored + deflate). Returns name -> lazy reader. */
export function zipEntries(bytes: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66_000); i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ExtractError("Not a valid Office file (zip directory missing).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, () => Promise<Uint8Array>>();
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= bytes.length; n += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    out.set(name, async () => {
      if (local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) throw new ExtractError("Corrupt zip entry.");
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new ExtractError("Unsupported compression in file.");
    });
  }
  return out;
}

export function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const z = zipEntries(bytes);
  const doc = z.get("word/document.xml");
  if (!doc) throw new ExtractError("DOCX without word/document.xml.");
  const xml = new TextDecoder().decode(await doc());
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<(?!\/?w:t[\s>])[^>]+>/g, "")
    .replace(/<\/?w:t[^>]*>/g, "")
    .split("\n").map((l) => decodeXmlText(l).trim()).filter(Boolean).join("\n");
}

async function pptxText(bytes: Uint8Array): Promise<string> {
  const z = zipEntries(bytes);
  const slides = [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/g)?.pop()) - Number(b.match(/\d+/g)?.pop()));
  const out: string[] = [];
  for (const [i, k] of slides.slice(0, 300).entries()) {
    const xml = new TextDecoder().decode(await (z.get(k) as () => Promise<Uint8Array>)());
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXmlText(m[1]));
    out.push(`[Slide ${i + 1}] ${texts.join(" ").replace(/\s+/g, " ").trim()}`);
  }
  return out.join("\n");
}

/** XLSX -> rows of the first sheets (shared strings resolved). */
export async function xlsxRows(bytes: Uint8Array, maxRows = 5000): Promise<{ sheet: string; rows: string[][] }[]> {
  const z = zipEntries(bytes);
  const dec = new TextDecoder();
  const shared: string[] = [];
  const ss = z.get("xl/sharedStrings.xml");
  if (ss) {
    const xml = dec.decode(await ss());
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(decodeXmlText([...si[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join("")));
  }
  const sheets = [...z.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  const out: { sheet: string; rows: string[][] }[] = [];
  for (const k of sheets.slice(0, 5)) {
    const xml = dec.decode(await (z.get(k) as () => Promise<Uint8Array>)());
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= maxRows) break;
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? "";
        const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
        const v = /<v>([^<]*)<\/v>/.exec(c[2] ?? "")?.[1] ?? /<t[^>]*>([^<]*)<\/t>/.exec(c[2] ?? "")?.[1] ?? "";
        const value = /t="s"/.test(attrs) ? (shared[Number(v)] ?? "") : decodeXmlText(v);
        while (cells.length < col) cells.push("");
        cells[col] = value;
      }
      rows.push(cells);
    }
    out.push({ sheet: k.replace(/^.*\//, "").replace(/\.xml$/, ""), rows });
  }
  return out;
}

/** RFC 4180 CSV (quotes, escaped quotes, CRLF). Also accepts ; or tab when the header has no commas. */
export function parseCsv(textValue: string, maxRows = 20_000): string[][] {
  const first = textValue.split(/\r?\n/, 1)[0] ?? "";
  const sep = first.includes(",") ? "," : first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < textValue.length; i += 1) {
    const ch = textValue[i];
    if (quoted) {
      if (ch === '"' && textValue[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && textValue[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

/** Text from simple PDFs: FlateDecode content streams, Tj / TJ / ' operators. Scanned PDFs yield nothing. */
async function pdfText(bytes: Uint8Array, maxChars: number): Promise<string> {
  const raw = latin1(bytes);
  const out: string[] = [];
  let total = 0;
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && total < maxChars) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const dict = m[1];
    let data = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try { data = await inflateZlib(data, 5_000_000); } catch { continue; }
    } else if (/\/Filter/.test(dict)) continue;
    const content = latin1(data);
    if (!/(Tj|TJ)\b/.test(content)) continue;
    const texts: string[] = [];
    for (const t of content.matchAll(/\[((?:\([^)]*\)|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|')|(T\*|Td|TD|ET)\b/g)) {
      if (t[3]) { texts.push("\n"); continue; }
      const piece = t[1] !== undefined ? [...t[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => x[1]).join("") : (t[2] ?? "");
      texts.push(piece.replace(/\\([nrtbf()\\]|\d{1,3})/g, (_, e: string) => (/^\d/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: "\n", r: "", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[e] ?? e)));
    }
    const chunk = texts.join("").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    if (chunk) { out.push(chunk); total += chunk.length; }
  }
  return out.join("\n");
}

export type Extracted = { kind: ExtractKind; text: string; truncated: boolean; chars: number };

export async function extractText(bytes: Uint8Array, name: string, mime = "", maxChars = 200_000): Promise<Extracted> {
  if (bytes.byteLength > MAX_EXTRACT_BYTES) throw new ExtractError(`File is larger than ${Math.round(MAX_EXTRACT_BYTES / 1e6)} MB; pick a smaller file.`);
  const kind = kindOf(name, mime);
  if (!kind) throw new ExtractError("Unsupported file type. Readable: PDF, DOCX, TXT, MD, XLSX, CSV, PPTX.");
  let textValue: string;
  if (kind === "txt" || kind === "md" || kind === "csv") textValue = new TextDecoder().decode(bytes);
  else if (kind === "docx") textValue = await docxText(bytes);
  else if (kind === "pptx") textValue = await pptxText(bytes);
  else if (kind === "xlsx") textValue = (await xlsxRows(bytes, 2000)).map((s) => `[${s.sheet}]\n${s.rows.map((r) => r.join("\t")).join("\n")}`).join("\n\n");
  else textValue = await pdfText(bytes, maxChars);
  // eslint-disable-next-line no-control-regex
  textValue = textValue.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const truncated = textValue.length > maxChars;
  return { kind, text: truncated ? textValue.slice(0, maxChars) : textValue, truncated, chars: Math.min(textValue.length, maxChars) };
}

/** Splits text into ~size-char chunks on paragraph boundaries and returns the ones that best match the query. */
export function relevantChunks(textValue: string, query: string, opts: { size?: number; max?: number } = {}): { index: number; text: string; score: number }[] {
  const size = opts.size ?? 1200;
  const max = opts.max ?? 6;
  const paras = textValue.split(/\n{1,}/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n" + p).length > size && cur) { chunks.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${p}` : p;
    while (cur.length > size * 1.5) { chunks.push(cur.slice(0, size)); cur = cur.slice(size); }
  }
  if (cur.trim()) chunks.push(cur);
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2);
  const scored = chunks.map((c, index) => {
    const low = c.toLowerCase();
    const score = terms.length ? terms.reduce((s, t) => s + (low.split(t).length - 1), 0) : chunks.length - index;
    return { index, text: c, score };
  });
  return scored.filter((c) => !terms.length || c.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, max).sort((a, b) => a.index - b.index);
}
