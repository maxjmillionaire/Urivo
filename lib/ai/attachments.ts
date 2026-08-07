/*
 * Attachments — what a merchant can hand the AI, and what happens to it.
 *
 * ── What Claude can actually read ───────────────────────────────────────────
 *
 * IMAGES and PDFs are native: they become `image` and `document` content blocks
 * on the same message as the text, and the model sees them directly.
 *
 * VIDEO IS NOT. The Claude API has no video content block — there is no way to
 * hand it an MP4 and have it watch. Rather than refuse the merchant ("analyse
 * this UGC ad" is a real request with a real answer), the browser extracts
 * evenly-spaced frames and sends those as images. The model then genuinely
 * reasons about the hook, the pacing, the framing and the on-screen text —
 * everything an ad critique actually turns on. What it cannot hear is audio,
 * and what it cannot see is motion between frames, so the UI says so rather
 * than letting someone believe their voiceover was judged.
 *
 * ZIP archives are not supported and are not faked. Unpacking arbitrary
 * archives server-side to feed a model is a zip-bomb and path-traversal
 * surface for no user-visible gain over dropping the files in directly.
 *
 * ── What happens to a file ──────────────────────────────────────────────────
 *
 * Nothing is stored. Attachments travel inside the request that uses them and
 * are gone when it returns — no bucket, no rows, no retention question, and
 * nothing to leak later. It also means an attachment applies to the message it
 * was sent with and is not silently reused on the next one.
 *
 * Isomorphic: the browser validates against these same limits before spending
 * a merchant's upload on a request the server would reject.
 */

export type AttachmentKind = "image" | "pdf";

export interface Attachment {
  kind: AttachmentKind;
  /** MIME type, already narrowed to something the API accepts. */
  mediaType: string;
  /** Base64 WITHOUT the data: prefix and without newlines — the API rejects both. */
  data: string;
  /** Original filename, shown back to the merchant so they can tell files apart. */
  name: string;
  /** Set when this image is a frame the browser pulled out of a video. */
  fromVideo?: boolean;
}

/** Exactly what the Claude API accepts as an image block. */
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/**
 * What the file picker offers. MP4/MOV are accepted and converted to frames in
 * the browser; the API never sees a video.
 */
export const ACCEPTED_UPLOAD_TYPES =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,video/mp4,video/quicktime";

export const ATTACHMENT_LIMITS = {
  /** Per file, after the browser has downscaled images. */
  maxBytesPerFile: 8 * 1024 * 1024,
  /*
   * Total across one request. The API's own ceiling is 32 MB; staying well
   * under it leaves room for the system prompt, the business context and the
   * conversation, none of which are free.
   */
  maxBytesTotal: 20 * 1024 * 1024,
  maxFiles: 8,
  /**
   * Long edge in pixels. 2576 is the high-resolution tier — anything larger is
   * downscaled by the API anyway, so sending it only burns upload time.
   */
  maxImageEdge: 2576,
  /** Frames pulled from a video. Enough to read a hook and a pacing arc. */
  videoFrames: 6,
} as const;

/** Base64 length → decoded byte count, without allocating the buffer. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, (data.length * 3) / 4 - padding);
}

export interface AttachmentRejection {
  name: string;
  reason: string;
}

/**
 * Check a set of attachments against the limits.
 *
 * Returns rejections rather than throwing, because the useful behaviour is to
 * send the eight files that are fine and say which two were not — refusing the
 * whole batch over one oversized screenshot makes the merchant do the sorting.
 */
export function validateAttachments(items: Attachment[]): {
  accepted: Attachment[];
  rejected: AttachmentRejection[];
} {
  const accepted: Attachment[] = [];
  const rejected: AttachmentRejection[] = [];
  let total = 0;

  for (const item of items) {
    if (accepted.length >= ATTACHMENT_LIMITS.maxFiles) {
      rejected.push({ name: item.name, reason: `Only ${ATTACHMENT_LIMITS.maxFiles} files at a time.` });
      continue;
    }
    if (item.kind === "image" && !IMAGE_MEDIA_TYPES.includes(item.mediaType as (typeof IMAGE_MEDIA_TYPES)[number])) {
      rejected.push({ name: item.name, reason: "That image format is not supported." });
      continue;
    }
    if (item.kind === "pdf" && item.mediaType !== "application/pdf") {
      rejected.push({ name: item.name, reason: "That file is not a PDF." });
      continue;
    }
    // A data: prefix or embedded newlines are both rejected by the API, and
    // both are easy to introduce with FileReader — normalise rather than fail.
    if (/[^A-Za-z0-9+/=]/.test(item.data)) {
      rejected.push({ name: item.name, reason: "The file could not be read." });
      continue;
    }

    const bytes = base64Bytes(item.data);
    if (bytes > ATTACHMENT_LIMITS.maxBytesPerFile) {
      rejected.push({ name: item.name, reason: `Too large — keep files under ${mb(ATTACHMENT_LIMITS.maxBytesPerFile)}.` });
      continue;
    }
    if (total + bytes > ATTACHMENT_LIMITS.maxBytesTotal) {
      rejected.push({ name: item.name, reason: `That would exceed the ${mb(ATTACHMENT_LIMITS.maxBytesTotal)} total.` });
      continue;
    }

    total += bytes;
    accepted.push(item);
  }

  return { accepted, rejected };
}

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/*
 * Anthropic content blocks. Typed structurally rather than against the SDK's
 * param types so this file stays isomorphic — the browser imports the limits
 * from here too, and pulling the SDK into a client bundle for two shapes would
 * be a large cost for no benefit.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

/**
 * Build the user message content for a prompt plus its attachments.
 *
 * Attachments come FIRST and the text last. That ordering is what the API
 * documents for documents, and it is also how the request reads: here is the
 * material, now here is what I am asking about it.
 *
 * Returns a plain string when there is nothing attached, so every existing
 * call site keeps its current wire shape and its prompt cache.
 */
export function buildUserContent(text: string, attachments?: Attachment[]): string | ContentBlock[] {
  if (!attachments || attachments.length === 0) return text;

  const blocks: ContentBlock[] = attachments.map((a) =>
    a.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }
      : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } },
  );

  /*
   * Tell the model which images are video frames. Without it, six stills of the
   * same scene read as six near-duplicate photographs, and the critique comes
   * back as "your images are repetitive" rather than as a read of the edit.
   */
  const frames = attachments.filter((a) => a.fromVideo).length;
  const note = frames > 0
    ? `\n\n(${frames} of the attached images are evenly-spaced frames from a video, in order. Judge them as a sequence — pacing, hook, on-screen text — not as separate photographs. You cannot hear the audio.)`
    : "";

  blocks.push({ type: "text", text: text + note });
  return blocks;
}

/** Short, human description for logs and the credit ledger. */
export function describeAttachments(attachments?: Attachment[]): string {
  if (!attachments || attachments.length === 0) return "";
  const images = attachments.filter((a) => a.kind === "image" && !a.fromVideo).length;
  const frames = attachments.filter((a) => a.fromVideo).length;
  const pdfs = attachments.filter((a) => a.kind === "pdf").length;
  const parts: string[] = [];
  if (images) parts.push(`${images} image${images === 1 ? "" : "s"}`);
  if (frames) parts.push(`${frames} video frame${frames === 1 ? "" : "s"}`);
  if (pdfs) parts.push(`${pdfs} PDF${pdfs === 1 ? "" : "s"}`);
  return parts.join(", ");
}
