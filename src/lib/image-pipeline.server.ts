/**
 * Server adapter for the image pipeline (t60): binds the pure logic in
 * image-pipeline.ts to the Cloudflare IMAGES binding.
 *
 * Why the IMAGES binding (verified in Cloudflare docs, 2026-10-18):
 *  - It is the documented way to transform images from a Worker:
 *    `env.IMAGES.input(stream).transform({...}).output({ format:
 *    "image/webp", quality }).response()`, accepts raw bytes/streams
 *    up to 20 MB, and preserves animation (anim option) and alpha.
 *  - Workers run in V8 isolates with a 128 MB memory limit; native
 *    decoders such as Sharp are not a documented/supported Worker
 *    runtime dependency, so decoding in-isolate was rejected.
 *  - Free plan includes 5,000 unique transformations/month; over the
 *    limit NEW transformations fail with error 9422 while existing
 *    (stored) media keep serving. We transform once at upload and
 *    serve stored R2 variants, so quota is only spent on uploads and
 *    backfill. Quota exhaustion is explicit: the upload fails with a
 *    quota-specific error unless the original already meets the hero
 *    contract (see fallbackProcessedImage — recorded, never silent).
 */
import { workerEnv } from "./cf-env.server.ts";
import {
  ImagePipelineError,
  fallbackProcessedImage,
  isQuotaError,
  processImageBytes,
  type ImageTransformer,
  type ProcessedImage,
} from "./image-pipeline.ts";

const QUOTA_MESSAGE =
  "The Cloudflare Images free quota (5,000 unique transformations this month) is exhausted, so this image could not be optimized. Try again next month, enable a paid Images plan, or upload an already-optimized WebP no larger than 1280x720 and 200 KB.";

type ImagesBinding = {
  input(stream: ReadableStream): {
    transform(options: Record<string, unknown>): {
      output(options: Record<string, unknown>): Promise<{ response(): Response }>;
    };
  };
};

function imagesBinding(env: { IMAGES?: unknown }): ImagesBinding | null {
  const candidate = env.IMAGES as ImagesBinding | undefined;
  return candidate && typeof candidate.input === "function" ? candidate : null;
}

/**
 * Production transformer backed by the IMAGES binding. t147: one retry on a
 * transient transform failure (never on quota or invalid input) before the
 * upload fails loudly — nothing is ever stored unoptimized by accident.
 */
export const cloudflareImageTransformer: ImageTransformer = async (args) => {
  try {
    return await transformOnce(args);
  } catch (error) {
    if (!(error instanceof ImagePipelineError) || error.code !== "transform-failed") throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return transformOnce(args);
  }
};

const transformOnce: ImageTransformer = async ({ bytes, spec, quality, anim, planned }) => {
  const env = await workerEnv();
  const images = imagesBinding(env);
  if (!images) {
    throw new ImagePipelineError(
      "binding-missing",
      "The IMAGES binding is not configured for this Worker, so images cannot be optimized. Add the images binding in wrangler.jsonc and redeploy.",
    );
  }
  try {
    const stream = new Blob([bytes as BlobPart]).stream();
    const result = await images
      .input(stream)
      .transform({ width: planned.width, height: planned.height, fit: "scale-down" })
      .output({ format: "image/webp", quality, anim });
    const response = result.response();
    if (!response.ok) {
      throw new ImagePipelineError("transform-failed", `Image transform failed with HTTP ${response.status} for the ${spec.name} variant.`);
    }
    const transformed = new Uint8Array(await response.arrayBuffer());
    return { bytes: transformed, contentType: response.headers.get("content-type") ?? "" };
  } catch (error) {
    if (error instanceof ImagePipelineError) throw error;
    if (isQuotaError(error)) {
      throw new ImagePipelineError("quota-exceeded", QUOTA_MESSAGE);
    }
    throw new ImagePipelineError(
      "transform-failed",
      `Image transform failed for the ${spec.name} variant: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export type UploadProcessing = ProcessedImage & { processing: "images-binding" | "original-within-target" };

/**
 * The single entry point every upload path uses. Throws
 * ImagePipelineError (stable `code`) on failure — callers store
 * nothing in that case, so no partial R2/D1 state can remain.
 */
export async function processUploadImage(bytes: Uint8Array, transform: ImageTransformer = cloudflareImageTransformer): Promise<UploadProcessing> {
  try {
    const processed = await processImageBytes(bytes, transform);
    return { ...processed, processing: "images-binding" };
  } catch (error) {
    const pipelineError =
      error instanceof ImagePipelineError
        ? error
        : isQuotaError(error)
          ? new ImagePipelineError("quota-exceeded", QUOTA_MESSAGE)
          : new ImagePipelineError("transform-failed", error instanceof Error ? error.message : String(error));
    if (pipelineError.code === "invalid-image" || pipelineError.code === "too-large") throw pipelineError;
    const fallback = fallbackProcessedImage(bytes, pipelineError);
    if (fallback) return { ...fallback, processing: "original-within-target" };
    throw pipelineError;
  }
}
