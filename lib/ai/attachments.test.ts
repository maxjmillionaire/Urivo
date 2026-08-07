import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTACHMENT_LIMITS,
  base64Bytes,
  buildUserContent,
  describeAttachments,
  validateAttachments,
  type Attachment,
} from "./attachments";

/*
 * Attachments, tested where the failure would be silent.
 *
 * Every case here is a way the feature can appear to work while doing
 * something else: a file that quietly never reaches the model, an image
 * re-sent and re-billed on every turn of a conversation, or — the one that
 * matters most — the product implying Claude watched a video it cannot watch.
 */

const b64 = (bytes: number) => "A".repeat(Math.ceil((bytes * 4) / 3));
const image = (over: Partial<Attachment> = {}): Attachment => ({
  kind: "image",
  mediaType: "image/png",
  data: b64(1000),
  name: "shot.png",
  ...over,
});

describe("limits are enforced, and enforced by dropping not by refusing", () => {
  it("keeps the good files and names only the bad one", () => {
    const { accepted, rejected } = validateAttachments([
      image({ name: "a.png" }),
      image({ name: "huge.png", data: b64(ATTACHMENT_LIMITS.maxBytesPerFile + 1) }),
      image({ name: "b.png" }),
    ]);
    // Refusing the whole batch over one oversized screenshot makes the
    // merchant do the sorting; this is the behaviour worth pinning.
    expect(accepted.map((a) => a.name)).toEqual(["a.png", "b.png"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].name).toBe("huge.png");
  });

  it("stops at the file count", () => {
    const many = Array.from({ length: ATTACHMENT_LIMITS.maxFiles + 3 }, (_, i) => image({ name: `${i}.png` }));
    const { accepted, rejected } = validateAttachments(many);
    expect(accepted).toHaveLength(ATTACHMENT_LIMITS.maxFiles);
    expect(rejected).toHaveLength(3);
  });

  it("stops at the total, not just per file", () => {
    // Each file individually fits; three of them do not. Without the running
    // total, a merchant could send 8 files of 7.5 MB and blow past the API's
    // request ceiling with every single file "valid".
    const each = Math.floor(ATTACHMENT_LIMITS.maxBytesPerFile * 0.9);
    expect(each * 3).toBeGreaterThan(ATTACHMENT_LIMITS.maxBytesTotal);
    const { accepted, rejected } = validateAttachments([
      image({ name: "1", data: b64(each) }),
      image({ name: "2", data: b64(each) }),
      image({ name: "3", data: b64(each) }),
    ]);
    expect(accepted).toHaveLength(2);
    expect(rejected[0].name).toBe("3");
  });

  it("rejects a data: prefix and embedded newlines, which the API rejects too", () => {
    const withPrefix = image({ name: "p.png", data: "data:image/png;base64,AAAA" });
    const withNewlines = image({ name: "n.png", data: "AAAA\nBBBB" });
    const { accepted, rejected } = validateAttachments([withPrefix, withNewlines]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(2);
  });

  it("rejects a media type the API does not accept", () => {
    const { accepted } = validateAttachments([image({ mediaType: "image/svg+xml" })]);
    expect(accepted).toHaveLength(0);
  });

  it("measures base64 as bytes, not characters", () => {
    // A 4-character base64 group is 3 bytes; counting characters would let a
    // file a third larger than the limit straight through.
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AAA=")).toBe(2);
    expect(base64Bytes("AA==")).toBe(1);
  });
});

describe("content blocks are shaped the way the API expects", () => {
  it("returns a plain string when nothing is attached", () => {
    // Every existing call site keeps its wire shape — and its prompt cache.
    expect(buildUserContent("hello")).toBe("hello");
    expect(buildUserContent("hello", [])).toBe("hello");
  });

  it("puts attachments before the text", () => {
    const blocks = buildUserContent("what is wrong with this?", [image()]);
    expect(Array.isArray(blocks)).toBe(true);
    const arr = blocks as Exclude<typeof blocks, string>;
    expect(arr[0].type).toBe("image");
    expect(arr[arr.length - 1].type).toBe("text");
  });

  it("uses a document block for a PDF and an image block for an image", () => {
    const blocks = buildUserContent("read these", [
      image(),
      { kind: "pdf", mediaType: "application/pdf", data: b64(500), name: "spec.pdf" },
    ]) as Exclude<ReturnType<typeof buildUserContent>, string>;
    expect(blocks.map((b) => b.type)).toEqual(["image", "document", "text"]);
  });
});

/*
 * The honesty requirement, and the reason this feature needed care at all.
 *
 * Claude has no video content block. Video is sent as extracted frames, and
 * every part of the product that touches it has to say so — otherwise a
 * merchant reads a critique of their UGC ad and reasonably believes the
 * voiceover was judged.
 */
describe("video is never presented as something the model watched", () => {
  it("tells the model the frames are a sequence, and that audio is missing", () => {
    const blocks = buildUserContent("critique this ad", [
      image({ fromVideo: true, name: "ad.mp4 · 0:02" }),
      image({ fromVideo: true, name: "ad.mp4 · 0:06" }),
    ]) as Exclude<ReturnType<typeof buildUserContent>, string>;
    const text = blocks[blocks.length - 1];
    expect(text.type).toBe("text");
    const body = (text as { text: string }).text;
    expect(body).toMatch(/frames from a video/i);
    expect(body).toMatch(/cannot hear the audio/i);
  });

  it("says nothing about video when no frames are attached", () => {
    const blocks = buildUserContent("look at this", [image()]) as Exclude<
      ReturnType<typeof buildUserContent>,
      string
    >;
    expect((blocks[blocks.length - 1] as { text: string }).text).not.toMatch(/video/i);
  });

  it("counts frames and files separately when describing a batch", () => {
    const described = describeAttachments([
      image(),
      image({ fromVideo: true }),
      image({ fromVideo: true }),
      { kind: "pdf", mediaType: "application/pdf", data: b64(100), name: "a.pdf" },
    ]);
    expect(described).toBe("1 image, 2 video frames, 1 PDF");
  });

  it("the upload control tells the merchant what video does and does not capture", () => {
    const ui = readFileSync(
      join(__dirname, "..", "..", "app", "(platform)", "dashboard", "_shell", "attach.tsx"),
      "utf8",
    );
    // A merchant who believes their audio was analysed has been misled by the
    // product, not by the model.
    expect(ui).toMatch(/the audio does not/i);
  });
});

describe("a conversation does not re-send its attachments", () => {
  it("puts files on the current turn only", () => {
    const assistant = readFileSync(join(__dirname, "assistant.ts"), "utf8");
    /*
     * Re-attaching on every turn would multiply the cost of a conversation by
     * its length and leave the model looking at a screenshot the founder moved
     * on from ten messages ago.
     */
    expect(assistant).toMatch(/isCurrentTurn/);
    expect(assistant).toMatch(/i === lastIndex && m\.role === "user"/);
  });

  it("clears the composer when a message is sent", () => {
    const rail = readFileSync(
      join(__dirname, "..", "..", "app", "(platform)", "dashboard", "_shell", "ask-urivo.tsx"),
      "utf8",
    );
    expect(rail).toMatch(/const sending = attachments;\s*\n\s*setAttachments\(\[\]\);/);
  });
});

describe("every AI surface that accepts uploads validates them server-side", () => {
  const ROOT = join(__dirname, "..", "..");
  const routes = [
    "app/api/ask/route.ts",
    "app/api/research/route.ts",
    "app/api/generate-store/route.ts",
    "app/api/stores/[id]/ads/route.ts",
  ];

  it.each(routes)("%s re-checks the bytes rather than trusting the browser", (route) => {
    const src = readFileSync(join(ROOT, route), "utf8");
    // The browser check is courtesy; this is the boundary. A request that
    // never went near the UI must not be able to hand the model a 200 MB file.
    expect(src).toMatch(/acceptAttachments\(/);
  });
});
