/**
 * Minimal QR Code encoder (t80) — byte mode, error-correction level M,
 * versions 1–10 (up to 213 bytes, plenty for an otpauth:// URI). Pure TS,
 * no dependencies; renders an SVG string server-side so the admin Security
 * page can show a scannable TOTP enrolment code without any external
 * service (the secret never leaves this server). The module matrix is
 * fixture-tested against a reference encoder in qr.test.ts.
 */

/* GF(256) tables for Reed–Solomon (primitive polynomial 0x11D). */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const gfMul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly; // coefficients, highest degree first, leading 1
}
function rsRemainder(data: Uint8Array, gen: Uint8Array): Uint8Array {
  const result = new Uint8Array(gen.length - 1);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1); result[result.length - 1] = 0;
    // gen is highest-degree-first with a trailing 1; the divisor coefficients
    // for the synthetic-division loop run the other way (verified against
    // Nayuki's qrcodegen in qr.test.ts).
    for (let i = 0; i < result.length; i += 1) result[i] ^= gfMul(gen[gen.length - 2 - i], factor);
  }
  return result;
}

/* Level-M block table: [ec codewords per block, [[blocks, data cw each], ...]] */
const M_BLOCKS: [number, [number, number][]][] = [
  [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
  [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]],
];
const TOTAL_CW = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 2];
const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number) { for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1); }
}

function encodeDataBlocks(text: string, version: number): { blocks: Uint8Array[]; ecBlocks: Uint8Array[]; allData: Uint8Array } {
  const bytes = new TextEncoder().encode(text);
  const [ecLen, groups] = M_BLOCKS[version - 1];
  const dataCapacityCw = groups.reduce((sum, [n, cw]) => sum + n * cw, 0);
  const countBits = version <= 9 ? 8 : 16;
  const buf = new BitBuffer();
  buf.push(0x4, 4); // byte mode
  buf.push(bytes.length, countBits);
  for (const b of bytes) buf.push(b, 8);
  const capacityBits = dataCapacityCw * 8;
  if (buf.bits.length > capacityBits) throw new Error("QR payload too large");
  buf.push(0, Math.min(4, capacityBits - buf.bits.length));
  while (buf.bits.length % 8 !== 0) buf.push(0, 1);
  for (let pad = 0xec; buf.bits.length < capacityBits; pad ^= 0xec ^ 0x11) buf.push(pad, 8);
  const allData = new Uint8Array(dataCapacityCw);
  for (let i = 0; i < allData.length; i += 1) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | buf.bits[i * 8 + j];
    allData[i] = b;
  }
  const gen = rsGenerator(ecLen);
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [count, cwEach] of groups) {
    for (let i = 0; i < count; i += 1) {
      const block = allData.slice(offset, offset + cwEach);
      offset += cwEach;
      blocks.push(block);
      ecBlocks.push(rsRemainder(block, gen));
    }
  }
  return { blocks, ecBlocks, allData };
}

type Matrix = { size: number; modules: boolean[][]; isFunction: boolean[][] };

function baseMatrix(version: number): Matrix {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, v: boolean) => { modules[y][x] = v; isFunction[y][x] = true; };
  // timing
  for (let i = 0; i < size; i += 1) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // alignment
  const centers = ALIGNMENT[version - 1];
  for (const cy of centers) for (const cx of centers) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // reserve format areas + dark module
  for (let i = 0; i < 9; i += 1) { isFunction[8][i] = true; isFunction[i][8] = true; }
  for (let i = 0; i < 8; i += 1) { isFunction[8][size - 1 - i] = true; isFunction[size - 1 - i][8] = true; }
  modules[size - 8][8] = true;
  // version info
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >>> i) & 1) === 1;
      set(size - 11 + (i % 3), Math.floor(i / 3), bit);
      set(Math.floor(i / 3), size - 11 + (i % 3), bit);
    }
  }
  return { size, modules, isFunction };
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function formatBitsValue(mask: number): number {
  const data = mask; // EC level M = 0b00 in the high bits
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function drawFormat(m: Matrix, mask: number) {
  const bits = formatBitsValue(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const { size, modules } = m;
  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(i);
  modules[7][8] = bit(6); modules[8][8] = bit(7); modules[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i][8] = bit(i);
  modules[size - 8][8] = true; // dark module
}

function penalty(m: Matrix): number {
  const { size, modules } = m;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < size; y += 1) lines.push(modules[y]);
  for (let x = 0; x < size; x += 1) lines.push(modules.map((row) => row[x]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= line.length; i += 1) {
      if (i < line.length && line[i] === line[i - 1]) run += 1;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    // finder-like pattern penalty (rule 3, simplified standard form)
    const s = line.map((b) => (b ? "1" : "0")).join("");
    for (let i = 0; i + 7 <= s.length; i += 1) {
      if (s.slice(i, i + 7) === "1011101") {
        const before = i >= 4 && s.slice(i - 4, i) === "0000";
        const after = i + 11 <= s.length && s.slice(i + 7, i + 11) === "0000";
        if (before || after) score += 40;
      }
    }
  }
  for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
    if (modules[y][x] === modules[y][x + 1] && modules[y][x] === modules[y + 1][x] && modules[y][x] === modules[y + 1][x + 1]) score += 3;
  }
  let dark = 0;
  for (const row of modules) for (const b of row) if (b) dark += 1;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

/** Full boolean module matrix (no quiet zone). `forcedMask` is for tests. */
export function qrMatrix(text: string, forcedMask?: number): { size: number; modules: boolean[][]; version: number } {
  const byteLength = new TextEncoder().encode(text).length;
  let version = 0;
  for (let v = 1; v <= 10; v += 1) {
    const [, groups] = [M_BLOCKS[v - 1][0], M_BLOCKS[v - 1][1]];
    const dataCw = groups.reduce((sum, [n, cw]) => sum + n * cw, 0);
    const capacity = Math.floor((dataCw * 8 - 4 - (v <= 9 ? 8 : 16)) / 8);
    if (byteLength <= capacity) { version = v; break; }
  }
  if (!version) throw new Error("QR payload too large");
  const { blocks, ecBlocks } = encodeDataBlocks(text, version);
  const ecLen = M_BLOCKS[version - 1][0];
  // interleave
  const codewords: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) for (const b of blocks) if (i < b.length) codewords.push(b[i]);
  for (let i = 0; i < ecLen; i += 1) for (const b of ecBlocks) codewords.push(b[i]);
  const bits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i -= 1) bits.push((cw >>> i) & 1);
  for (let i = 0; i < REMAINDER_BITS[version - 1]; i += 1) bits.push(0);

  const place = (mask: number): Matrix => {
    const m = baseMatrix(version);
    let idx = 0;
    for (let right = m.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < m.size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? m.size - 1 - vert : vert;
          if (!m.isFunction[y][x]) {
            let v = idx < bits.length ? bits[idx] === 1 : false;
            idx += 1;
            if (MASKS[mask](x, y)) v = !v;
            m.modules[y][x] = v;
          }
        }
      }
    }
    drawFormat(m, mask);
    return m;
  };

  if (forcedMask !== undefined) {
    const m = place(forcedMask);
    return { size: m.size, modules: m.modules, version };
  }
  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = place(mask);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return { size: best!.size, modules: best!.modules, version };
}

/** Standalone SVG (white background, 4-module quiet zone) sized in px via width attr at call site. */
export function qrSvg(text: string): string {
  const { size, modules } = qrMatrix(text);
  const quiet = 4;
  const total = size + quiet * 2;
  let d = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="Authenticator QR code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
