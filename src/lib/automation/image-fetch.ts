/**
 * Featured-image intake for automation: base64 bytes or a safe https fetch.
 *
 * SSRF rules for URL fetches: https only, port 443, no IP-literal hosts, no
 * localhost / *.local / *.internal / single-label hosts, no credentials in the
 * URL, redirects followed manually (max 3) and re-checked each hop, 1.5 MB cap
 * enforced while streaming, 10 s timeout, and the bytes must be JPEG, PNG or
 * WebP by magic number regardless of the declared Content-Type. (Workers
 * cannot reach private networks; the host rules are defence in depth.)
 */
export const MAX_IMAGE_BYTES = 1_500_000;
export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export function unsafeUrlReason(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Not a valid URL.";
  }
  if (url.protocol !== "https:") return "Only https URLs are allowed.";
  if (url.username || url.password) return "Credentials in URLs are not allowed.";
  if (url.port && url.port !== "443") return "Only the default https port is allowed.";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return "Single-label hosts are not allowed.";
  if (/^\[.*\]$/.test(host) || host.includes(":")) return "IP-literal hosts are not allowed.";
  if (/^\d+(\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return "IP-literal hosts are not allowed.";
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|intranet|corp)$/.test(host)) return "Private host names are not allowed.";
  return null;
}

export class ImageIntakeError extends Error {}

/** Smallest cover we accept: anything smaller is a placeholder, icon or tracking pixel. */
export const MIN_IMAGE_WIDTH = 400;
export const MIN_IMAGE_HEIGHT = 200;

/** Pixel size read from the file header (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X). */
export function imageSize(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u16le = (i: number) => bytes[i] | (bytes[i + 1] << 8);
  const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  const u32be = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  if (mime === "image/png") {
    if (bytes.length < 24) return null;
    return { width: u32be(16), height: u32be(20) };
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16be(i + 5), width: u16be(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
  if (chunk === "VP8L") {
    const b = bytes.subarray(21, 25);
    return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
  }
  if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
  return null;
}

/** Rejects placeholder-sized or unreadable images (e.g. the 75-byte "cover" an AI produced). */
export function assertUsableCover(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } {
  const size = imageSize(bytes, mime);
  if (!size) throw new ImageIntakeError("Could not read the image size.");
  if (size.width < MIN_IMAGE_WIDTH || size.height < MIN_IMAGE_HEIGHT) {
    throw new ImageIntakeError(
      `Image is ${size.width}x${size.height}px; a cover must be at least ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT}px. Send a real photo or illustration.`,
    );
  }
  return size;
}

export function decodeBase64Image(data: string): { bytes: Uint8Array; mime: ImageMime } {
  const cleaned = data.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) throw new ImageIntakeError("Image data is not valid base64.");
  if (cleaned.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) throw new ImageIntakeError("Image must be under 1.5 MB.");
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new ImageIntakeError("Image must be under 1.5 MB.");
  const mime = sniffImage(bytes);
  if (!mime) throw new ImageIntakeError("Only real JPEG, PNG or WebP images are accepted.");
  return { bytes, mime };
}

export async function fetchImage(
  raw: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<{ bytes: Uint8Array; mime: ImageMime; finalUrl: string }> {
  let current = raw;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= 3; hop += 1) {
      const reason = unsafeUrlReason(current);
      if (reason) throw new ImageIntakeError(reason);
      const response = await fetcher(current, {
        redirect: "manual",
        signal: controller.signal,
        // A descriptive UA: Wikimedia and many CDNs refuse requests without one (403).
        headers: { accept: "image/jpeg,image/png,image/webp", "user-agent": "DYPOL-Blog-ImageFetcher/1.0 (+https://dypolblog.rstmcsoch.workers.dev)" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new ImageIntakeError("Redirect without a location.");
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok || !response.body) throw new ImageIntakeError(`Image fetch failed (${response.status}).`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_IMAGE_BYTES) throw new ImageIntakeError("Image must be under 1.5 MB.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new ImageIntakeError("Image must be under 1.5 MB.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const mime = sniffImage(bytes);
      if (!mime) throw new ImageIntakeError("The URL did not return a JPEG, PNG or WebP image.");
      return { bytes, mime, finalUrl: current };
    }
    throw new ImageIntakeError("Too many redirects.");
  } catch (error) {
    if (error instanceof ImageIntakeError) throw error;
    throw new ImageIntakeError(controller.signal.aborted ? "Image fetch timed out." : "Image fetch failed.");
  } finally {
    clearTimeout(timer);
  }
}
