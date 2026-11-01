/**
 * t147: dominant colour of an image from a 1x1 PNG (the IMAGES binding
 * scales the cover down to one pixel). Returns "#rrggbb", or null when the
 * pixel is transparent-ish (a placeholder would show through) or the PNG
 * cannot be read. Pure (DecompressionStream only), so tests run in Node.
 */
export async function colorFromOnePixelPng(png: Uint8Array): Promise<string | null> {
  try {
    if (png.length < 33 || png[0] !== 0x89 || png[1] !== 0x50) return null;
    let offset = 8;
    let colorType = -1;
    let bitDepth = 0;
    let palette: Uint8Array | null = null;
    let alphaTable: Uint8Array | null = null;
    const idat: Uint8Array[] = [];
    while (offset + 8 <= png.length) {
      const length = ((png[offset] << 24) | (png[offset + 1] << 16) | (png[offset + 2] << 8) | png[offset + 3]) >>> 0;
      const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
      const data = png.subarray(offset + 8, offset + 8 + length);
      if (type === "IHDR") {
        bitDepth = data[8];
        colorType = data[9];
      } else if (type === "PLTE") palette = data;
      else if (type === "tRNS") alphaTable = data;
      else if (type === "IDAT") idat.push(data);
      else if (type === "IEND") break;
      offset += 12 + length;
    }
    if (bitDepth !== 8 || idat.length === 0) return null;
    const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const chunk of idat) {
      joined.set(chunk, at);
      at += chunk.length;
    }
    const raw = new Uint8Array(await new Response(new Blob([joined]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    // raw[0] is the scanline filter byte; for a single pixel every filter
    // except Paeth/Up/Avg on row 0 reduces to the stored value (no prior row).
    const px = raw.subarray(1);
    let r: number, g: number, b: number, a = 255;
    if (colorType === 2) [r, g, b] = [px[0], px[1], px[2]];
    else if (colorType === 6) [r, g, b, a] = [px[0], px[1], px[2], px[3]];
    else if (colorType === 0) [r, g, b] = [px[0], px[0], px[0]];
    else if (colorType === 4) [r, g, b, a] = [px[0], px[0], px[0], px[1]];
    else if (colorType === 3 && palette) {
      const i = px[0];
      [r, g, b] = [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]];
      if (alphaTable && i < alphaTable.length) a = alphaTable[i];
    } else return null;
    if ([r, g, b].some((v) => v === undefined || Number.isNaN(v))) return null;
    if (a < 250) return null;
    return hex(r, g, b);
  } catch {
    return null;
  }
}

export function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Accepts only a plain #rrggbb (safe to put in an inline style). */
export function safeColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}
