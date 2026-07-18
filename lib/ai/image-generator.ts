import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { StoreDesignSystem } from "@/lib/storefront/design-system";

/*
 * Product imagery generation (spec 6.9: providers isolated behind a clean
 * service). Storefronts deserve real, on-brand product photography — not
 * placeholders. Generation runs ONCE at store-creation time; images are stored
 * in object storage and the URLs persisted with each product.
 *
 * The provider is pluggable. The default is Higgsfield (its "Soul" text-to-image
 * model — the same engine behind our reference shots), with Google Gemini as an
 * automatic fallback. Swapping or adding a provider means implementing
 * ImageProvider — nothing else changes.
 *
 * Every step is best-effort: if credentials are unset, a provider errors, a
 * request times out, or storage is unavailable, the product simply has no image
 * and the renderer falls back to its palette plane. Store generation never fails
 * because of imagery, and a total wall-clock budget keeps it inside the request
 * limit — whatever images finished in time are used.
 */

const STORAGE_BUCKET = "product-images";
const MAX_CONCURRENT = 3;
// Whole-imagery budget: comfortably under the route's maxDuration so a slow
// provider can never fail store creation. Images done by the deadline are used.
const TOTAL_BUDGET_MS = 210_000;

// Gemini (fallback)
const GEMINI_IMAGE_MODEL = process.env.GOOGLE_AI_IMAGE_MODEL || "gemini-2.5-flash-image";
const GEMINI_TIMEOUT_MS = 45_000;

// Higgsfield (primary)
const HIGGSFIELD_ENDPOINT = "/v1/text2image/soul";
const HIGGSFIELD_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

export interface ImageProvider {
  readonly name: string;
  /** Return generated image bytes, or null on any failure. */
  generate(prompt: string): Promise<GeneratedImage | null>;
}

/* ------------------------------ Gemini provider ---------------------------- */

class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini";
  constructor(private readonly apiKey: string) {}

  async generate(prompt: string): Promise<GeneratedImage | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as GeminiResponse;
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) return null;
      return { bytes: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || "image/png" };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
  }[];
}

/* ---------------------------- Higgsfield provider -------------------------- */

class HiggsfieldImageProvider implements ImageProvider {
  readonly name = "higgsfield";
  constructor(
    private readonly credentials: string,
    private readonly size: string,
    private readonly quality: "720p" | "1080p",
  ) {}

  async generate(prompt: string): Promise<GeneratedImage | null> {
    try {
      // Dynamic import so the SDK loads only when Higgsfield is configured.
      const { createHiggsfieldClient } = await import("@higgsfield/client/v2");
      const client = createHiggsfieldClient({ credentials: this.credentials });
      const res = await withTimeout(
        client.subscribe(HIGGSFIELD_ENDPOINT, {
          input: {
            prompt,
            width_and_height: this.size,
            quality: this.quality,
            batch_size: 1,
            enhance_prompt: true,
            seed: Math.floor(Math.random() * 1_000_000_000),
          },
          withPolling: true,
        }),
        HIGGSFIELD_TIMEOUT_MS,
      );
      if (!res || res.status !== "completed") return null;
      const imageUrl = res.images?.[0]?.url;
      if (!imageUrl) return null;
      const dl = await fetch(imageUrl);
      if (!dl.ok) return null;
      const bytes = Buffer.from(await dl.arrayBuffer());
      return { bytes, mimeType: dl.headers.get("content-type") || "image/png" };
    } catch {
      return null;
    }
  }
}

/**
 * Resolve the configured provider, or null when imagery is not configured.
 * Higgsfield is primary (best product photography); Gemini is the fallback.
 */
export function imageProvider(): ImageProvider | null {
  const hfKey = process.env.HIGGSFIELD_API_KEY;
  const hfSecret = process.env.HIGGSFIELD_API_SECRET;
  if (hfKey && hfSecret) {
    const size = process.env.HIGGSFIELD_IMAGE_SIZE || "1536x2048"; // 3:4 portrait
    const quality = process.env.HIGGSFIELD_IMAGE_QUALITY === "720p" ? "720p" : "1080p";
    return new HiggsfieldImageProvider(`${hfKey}:${hfSecret}`, size, quality);
  }
  const gemini = process.env.GOOGLE_AI_API_KEY;
  if (gemini) return new GeminiImageProvider(gemini);
  return null;
}

/* --------------------------------- prompts --------------------------------- */

function artDirection(ds: StoreDesignSystem): string {
  // Translate the brand's design system into a consistent photographic brief so
  // every product in a store shares one art direction.
  const dark = ds.palette.background.toLowerCase() < "#888888";
  const surface = dark
    ? "a deep, moody seamless background"
    : "a soft, bright seamless background";
  const mood =
    ds.layout.motion === "lively" ? "energetic, editorial, contemporary" : "calm, refined, timeless";
  return `Style: ${ds.personality}. ${mood} commercial product photography. ${surface} in tones near ${ds.palette.background}, with a subtle ${ds.palette.accent} accent in the lighting. Studio softbox lighting, shallow depth of field, high detail, photorealistic, centered single subject, generous negative space. No text, no logos, no watermark, no people.`;
}

function productPrompt(ds: StoreDesignSystem, title: string, description: string | null): string {
  const subject = description ? `${title} — ${description}` : title;
  return `A premium e-commerce hero product photograph of: ${subject}. ${artDirection(ds)}`;
}

/* ------------------------------- orchestration ----------------------------- */

/** Run fn over items with bounded concurrency, writing into `out` as each
 *  completes so partial progress survives an outer deadline. */
async function runInto<T>(out: (string | null)[], items: T[], limit: number, fn: (item: T, i: number) => Promise<string | null>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function uploadImage(subdomain: string, index: number, img: GeneratedImage): Promise<string | null> {
  try {
    const admin = supabaseAdmin();
    const ext = img.mimeType.includes("jpeg") || img.mimeType.includes("jpg") ? "jpg" : "png";
    const path = `${subdomain}/${index}-${randomUUID()}.${ext}`;
    const { error } = await admin.storage.from(STORAGE_BUCKET).upload(path, img.bytes, {
      contentType: img.mimeType,
      upsert: false,
    });
    if (error) return null;
    return admin.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

export interface ImageableProduct {
  title: string;
  description: string | null;
  priceEUR: number;
}

/** True when at least one image provider is configured. */
export function isImageGenerationConfigured(): boolean {
  return imageProvider() !== null;
}

/**
 * Generate + store a single product image (used by the store manager's re-roll).
 * Returns the new public URL, or null on any failure.
 */
export async function generateSingleProductImage(
  subdomain: string,
  designSystem: StoreDesignSystem,
  product: ImageableProduct,
): Promise<string | null> {
  const provider = imageProvider();
  if (!provider) return null;
  const img = await provider.generate(productPrompt(designSystem, product.title, product.description));
  if (!img) return null;
  return uploadImage(subdomain, Date.now(), img);
}

/**
 * Generate + store one photograph per product. Returns an array of image URLs
 * (or null per product) aligned to the input order. Never throws — imagery is an
 * enhancement, never a dependency of store creation.
 */
export async function generateStoreImagery(
  subdomain: string,
  designSystem: StoreDesignSystem,
  products: ImageableProduct[],
): Promise<(string | null)[]> {
  const provider = imageProvider();
  if (!provider) return products.map(() => null);

  const results: (string | null)[] = new Array(products.length).fill(null);
  const core = runInto(results, products, MAX_CONCURRENT, async (product, i) => {
    const img = await provider.generate(productPrompt(designSystem, product.title, product.description));
    return img ? await uploadImage(subdomain, i, img) : null;
  }).catch(() => {});

  // Whichever finishes first: all images, or the wall-clock budget. On the
  // deadline we return whatever completed — never blocking store creation.
  await Promise.race([core, new Promise<void>((r) => setTimeout(r, TOTAL_BUDGET_MS))]);
  return results;
}
