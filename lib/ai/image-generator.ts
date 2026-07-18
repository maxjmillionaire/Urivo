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
 * The provider is pluggable. The default is Google Gemini (Imagen / "Nano
 * Banana"), which has a genuine free tier and a plain HTTPS API the app can call
 * server-side at no cost to us. Swapping to another provider (Higgsfield, etc.)
 * means implementing ImageProvider — nothing else changes.
 *
 * Every step is best-effort: if the key is unset, the provider errors, a request
 * times out, or storage is unavailable, the product simply has no image and the
 * renderer falls back to its palette plane. Store generation never fails because
 * of imagery.
 */

const STORAGE_BUCKET = "product-images";
const PER_IMAGE_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT = 3;
const GEMINI_IMAGE_MODEL = process.env.GOOGLE_AI_IMAGE_MODEL || "gemini-2.5-flash-image";

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
    const timer = setTimeout(() => controller.abort(), PER_IMAGE_TIMEOUT_MS);
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

/** Resolve the configured provider, or null when imagery is not configured. */
export function imageProvider(): ImageProvider | null {
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

async function withConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

  try {
    return await withConcurrency(products, MAX_CONCURRENT, async (product, i) => {
      const img = await provider.generate(productPrompt(designSystem, product.title, product.description));
      if (!img) return null;
      return uploadImage(subdomain, i, img);
    });
  } catch {
    return products.map(() => null);
  }
}
