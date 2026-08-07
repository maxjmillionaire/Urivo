import { z } from "zod";
import {
  ATTACHMENT_LIMITS,
  IMAGE_MEDIA_TYPES,
  validateAttachments,
  type Attachment,
} from "./attachments";

/*
 * Wire validation for attachments.
 *
 * Kept out of lib/ai/attachments.ts so that file stays free of Zod — the
 * browser imports it for the limits and would otherwise carry the whole schema
 * library for two constants.
 *
 * The browser validates before uploading, and the server validates again here.
 * That is not redundancy: the first is courtesy (fail in a tenth of a second
 * rather than after a slow upload), the second is the actual boundary. A
 * request that skips the UI entirely still cannot hand the model a 200 MB file
 * or a media type the API will reject.
 */

const base64 = z
  .string()
  .min(1)
  // The API rejects a data: prefix and embedded newlines, and both are easy to
  // produce with FileReader — catch them here rather than as a 400 from Anthropic.
  .regex(/^[A-Za-z0-9+/=]+$/, "not clean base64")
  .max(Math.ceil((ATTACHMENT_LIMITS.maxBytesPerFile * 4) / 3) + 16);

export const AttachmentSchema = z.object({
  kind: z.enum(["image", "pdf"]),
  mediaType: z.enum([...IMAGE_MEDIA_TYPES, "application/pdf"] as [string, ...string[]]),
  data: base64,
  name: z.string().trim().min(1).max(200),
  fromVideo: z.boolean().optional(),
});

export const AttachmentsSchema = z.array(AttachmentSchema).max(ATTACHMENT_LIMITS.maxFiles).optional();

/**
 * Parse and enforce the byte limits in one step.
 *
 * Anything over the limits is DROPPED rather than failing the request: a
 * merchant who attaches six screenshots and one enormous one should get their
 * answer about the six. The caller can report what was left out.
 */
export function acceptAttachments(
  raw: unknown,
): { attachments: Attachment[]; dropped: string[] } {
  const parsed = AttachmentsSchema.safeParse(raw);
  if (!parsed.success || !parsed.data) return { attachments: [], dropped: [] };
  const { accepted, rejected } = validateAttachments(parsed.data as Attachment[]);
  return { attachments: accepted, dropped: rejected.map((r) => r.name) };
}
