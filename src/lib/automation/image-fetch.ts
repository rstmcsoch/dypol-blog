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
        headers: { accept: "image/jpeg,image/png,image/webp" },
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
