"use client";

import { useRef, useState, useCallback } from "react";
import {
  ACCEPTED_UPLOAD_TYPES,
  ATTACHMENT_LIMITS,
  validateAttachments,
  type Attachment,
} from "@/lib/ai/attachments";

/*
 * The one attachment control, used by every AI surface in Urivo.
 *
 * Three jobs, all of them in the browser so nothing lands on a server that
 * doesn't need it:
 *
 * 1. DOWNSCALE IMAGES to the API's high-resolution tier. A 12-megapixel phone
 *    photo and a 2576px one produce the same answer; only one of them costs a
 *    slow upload and four thousand extra tokens.
 *
 * 2. TURN VIDEO INTO FRAMES. Claude cannot watch a video — there is no video
 *    content block in the API. Rather than refuse "analyse this UGC ad", the
 *    browser seeks to evenly-spaced timestamps and captures each one, so the
 *    model reasons about the hook, the pacing, the framing and the on-screen
 *    text. The control says plainly that audio is not included, because a
 *    merchant who thinks their voiceover was judged has been misled.
 *
 * 3. VALIDATE BEFORE SENDING, against the same limits the server enforces, so
 *    an oversized file fails in a tenth of a second instead of after a
 *    thirty-second upload.
 */

interface Props {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  /** Shown under the control — what uploads are for on this particular screen. */
  hint?: string;
  disabled?: boolean;
  compact?: boolean;
}

export function AttachButton({ attachments, onChange, hint, disabled, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setBusy(true);
      setProblems([]);
      const found: Attachment[] = [];
      const failed: string[] = [];

      for (const file of Array.from(files)) {
        try {
          if (file.type.startsWith("video/")) {
            const frames = await extractFrames(file);
            if (frames.length === 0) {
              failed.push(`${file.name} — the browser could not decode that video (try MP4/H.264).`);
            }
            found.push(...frames);
          } else if (file.type === "application/pdf") {
            found.push({ kind: "pdf", mediaType: "application/pdf", data: await toBase64(file), name: file.name });
          } else if (file.type.startsWith("image/")) {
            found.push(await downscaleImage(file));
          } else {
            failed.push(`${file.name} — not an image, PDF or video.`);
          }
        } catch {
          failed.push(`${file.name} — could not be read.`);
        }
      }

      const { accepted, rejected } = validateAttachments([...attachments, ...found]);
      onChange(accepted);
      setProblems([...failed, ...rejected.map((r) => `${r.name} — ${r.reason}`)]);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    },
    [attachments, onChange],
  );

  const remove = (index: number) => onChange(attachments.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_UPLOAD_TYPES}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          className={`inline-flex items-center gap-1.5 rounded-full border border-hair text-ivory/70 transition-colors hover:text-ivory disabled:opacity-40 ${
            compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-xs"
          }`}
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 6.5 8 12a2 2 0 0 0 2.8 2.8l5.7-5.6a3.5 3.5 0 0 0-5-5L5 10.2a5 5 0 0 0 7 7l4.5-4.4" />
          </svg>
          {busy ? "Reading…" : "Attach"}
        </button>

        {attachments.map((a, i) => (
          <span
            key={`${a.name}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-night/50 py-1 pl-2.5 pr-1.5 text-[11px] text-ivory/70"
          >
            <span className="max-w-[10rem] truncate">{a.name}</span>
            {a.fromVideo && <span className="text-gold/70">frame</span>}
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${a.name}`}
              className="rounded-full px-1 text-ivory/40 transition-colors hover:text-ivory"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {hint && attachments.length === 0 && problems.length === 0 && (
        <p className="text-[11px] leading-tight text-ivory/35">{hint}</p>
      )}

      {attachments.some((a) => a.fromVideo) && (
        <p className="text-[11px] leading-tight text-ivory/45">
          Video is read as {ATTACHMENT_LIMITS.videoFrames} still frames — the hook, pacing and
          on-screen text come through, the audio does not.
        </p>
      )}

      {problems.map((p) => (
        <p key={p} className="text-[11px] leading-tight text-red-300/90">
          {p}
        </p>
      ))}
    </div>
  );
}

/* ── Browser-side file work ────────────────────────────────────────────── */

function stripPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripPrefix(String(reader.result)));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale to the API's high-resolution long edge.
 *
 * PNG is preserved when the source is PNG — logos and screenshots with
 * transparency are exactly what merchants attach, and re-encoding them to JPEG
 * would put a black box behind every transparent pixel.
 */
async function downscaleImage(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // GIFs and anything the decoder refuses go through untouched; the size
    // check still applies, so this cannot smuggle a 50 MB file past the limits.
    return { kind: "image", mediaType: file.type, data: await toBase64(file), name: file.name };
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > ATTACHMENT_LIMITS.maxImageEdge ? ATTACHMENT_LIMITS.maxImageEdge / longest : 1;
  if (scale === 1 && file.size <= ATTACHMENT_LIMITS.maxBytesPerFile) {
    bitmap.close();
    return { kind: "image", mediaType: file.type, data: await toBase64(file), name: file.name };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { kind: "image", mediaType: file.type, data: await toBase64(file), name: file.name };
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const keepAlpha = file.type === "image/png";
  const mediaType = keepAlpha ? "image/png" : "image/jpeg";
  return {
    kind: "image",
    mediaType,
    data: stripPrefix(canvas.toDataURL(mediaType, keepAlpha ? undefined : 0.85)),
    name: file.name,
  };
}

/**
 * Pull evenly-spaced frames out of a video, in the browser.
 *
 * Frames are taken across the middle of the clip rather than from 0 to the
 * end: the first frame of an ad is often black or a title card, and the last
 * is often a logo — neither says anything about the thing being judged.
 */
async function extractFrames(file: File): Promise<Attachment[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    const duration = await new Promise<number>((resolve, reject) => {
      // A codec Chromium cannot decode (HEVC in a .mov, most often) fires
      // `error` rather than resolving — surface it instead of hanging.
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new Error("decode failed"));
      setTimeout(() => reject(new Error("timeout")), 15_000);
    });
    if (!Number.isFinite(duration) || duration <= 0) return [];

    const canvas = document.createElement("canvas");
    const count = ATTACHMENT_LIMITS.videoFrames;
    const frames: Attachment[] = [];

    for (let i = 0; i < count; i++) {
      const t = (duration * (i + 0.5)) / count;
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("seek failed"));
        video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      });

      const longest = Math.max(video.videoWidth, video.videoHeight);
      if (longest === 0) return frames;
      const scale = longest > ATTACHMENT_LIMITS.maxImageEdge ? ATTACHMENT_LIMITS.maxImageEdge / longest : 1;
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return frames;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      frames.push({
        kind: "image",
        mediaType: "image/jpeg",
        data: stripPrefix(canvas.toDataURL("image/jpeg", 0.8)),
        name: `${file.name} · ${formatTime(t)}`,
        fromVideo: true,
      });
    }
    return frames;
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
