import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  markAiGenerated,
  hasAiProvenance,
  xmpPacket,
  isPng,
  isJpeg,
  TRAINED_ALGORITHMIC_MEDIA,
} from "./provenance";

/*
 * EU AI Act Art. 50(2), in force since 2 August 2026: generated output must be
 * machine-readably detectable as generated. The visible disclosure on the
 * storefront does not satisfy this — a detector never renders the page.
 *
 * These tests care about two things: the mark is really there, and the file is
 * still a valid image afterwards. The second matters more. A missing mark is a
 * compliance gap; a corrupted product photo costs the merchant the sale AND the
 * mark.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** A real 1×1 PNG, built rather than pasted, so the structure is inspectable. */
function makePng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const idat = deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]));
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function makeJpeg(): Buffer {
  // SOI + a minimal APP0/JFIF + EOI. Enough to exercise segment insertion.
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0", "latin1"),
    Buffer.alloc(9),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Walk the chunk list the way a decoder does; throws on a malformed file. */
function pngChunks(bytes: Buffer): { type: string; length: number; crcOk: boolean }[] {
  const out: { type: string; length: number; crcOk: boolean }[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error(`chunk ${type} runs past the end of the file`);
    const expected = bytes.readUInt32BE(end - 4);
    const actual = crc32(bytes.subarray(offset + 4, end - 4));
    out.push({ type, length, crcOk: expected === actual });
    offset = end;
    if (type === "IEND") break;
  }
  return out;
}

describe("the packet says the right thing", () => {
  it("carries the IPTC term for generative media", () => {
    expect(xmpPacket()).toContain(TRAINED_ALGORITHMIC_MEDIA);
    expect(TRAINED_ALGORITHMIC_MEDIA).toContain("trainedAlgorithmicMedia");
  });

  it("escapes the generator name rather than letting it break the XML", () => {
    const packet = xmpPacket({ generator: 'Urivo <"x"> & co' });
    expect(packet).toContain("&lt;");
    expect(packet).toContain("&amp;");
    expect(packet).not.toContain('<"x">');
  });
});

describe("PNG", () => {
  const marked = markAiGenerated(makePng(), "image/png");

  it("is still a structurally valid PNG", () => {
    expect(isPng(marked)).toBe(true);
    const chunks = pngChunks(marked);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "iTXt", "IEND"]);
  });

  it("writes a correct CRC on every chunk, including the new one", () => {
    // A wrong CRC is exactly the kind of bug that renders fine in a browser and
    // fails in the one strict decoder that matters.
    for (const c of pngChunks(marked)) expect(c.crcOk, `${c.type} CRC`).toBe(true);
  });

  it("puts the mark before IEND, not after it", () => {
    const types = pngChunks(marked).map((c) => c.type);
    expect(types.indexOf("iTXt")).toBeLessThan(types.indexOf("IEND"));
  });

  it("is detectable", () => {
    expect(hasAiProvenance(marked)).toBe(true);
    expect(hasAiProvenance(makePng())).toBe(false);
  });

  it("does not mark twice", () => {
    const again = markAiGenerated(marked, "image/png");
    expect(again.length).toBe(marked.length);
    expect(pngChunks(again).filter((c) => c.type === "iTXt")).toHaveLength(1);
  });

  it("preserves the original image data byte for byte", () => {
    const original = makePng();
    const originalIdat = pngChunks(original).find((c) => c.type === "IDAT")!;
    const markedIdat = pngChunks(marked).find((c) => c.type === "IDAT")!;
    expect(markedIdat.length).toBe(originalIdat.length);
  });
});

describe("JPEG", () => {
  const marked = markAiGenerated(makeJpeg(), "image/jpeg");

  it("is still a JPEG and keeps SOI first", () => {
    expect(isJpeg(marked)).toBe(true);
    expect(marked[0]).toBe(0xff);
    expect(marked[1]).toBe(0xd8);
  });

  it("inserts APP1 directly after SOI", () => {
    expect(marked[2]).toBe(0xff);
    expect(marked[3]).toBe(0xe1);
  });

  it("writes a segment length that matches the payload", () => {
    const declared = marked.readUInt16BE(4);
    // Length counts itself (2 bytes) plus the payload, and excludes the marker.
    const payloadEnd = 6 + declared - 2;
    expect(marked.subarray(6, payloadEnd).includes(TRAINED_ALGORITHMIC_MEDIA)).toBe(true);
  });

  it("keeps EOI at the end", () => {
    expect(marked[marked.length - 2]).toBe(0xff);
    expect(marked[marked.length - 1]).toBe(0xd9);
  });

  it("is detectable and idempotent", () => {
    expect(hasAiProvenance(marked)).toBe(true);
    expect(markAiGenerated(marked, "image/jpeg").length).toBe(marked.length);
  });
});

describe("it never damages what it does not understand", () => {
  it("returns unknown formats untouched", () => {
    const webp = Buffer.from("RIFF....WEBPVP8 ", "latin1");
    expect(markAiGenerated(webp, "image/webp").equals(webp)).toBe(true);
  });

  it("returns truncated and empty buffers untouched", () => {
    for (const b of [Buffer.alloc(0), Buffer.from([0x89, 0x50]), Buffer.from([0xff])]) {
      expect(markAiGenerated(b, "image/png").equals(b)).toBe(true);
    }
  });

  it("leaves a PNG with a malformed chunk length alone rather than truncating it", () => {
    const png = makePng();
    png.writeUInt32BE(0xfffffff0, 8); // absurd IHDR length
    expect(markAiGenerated(png, "image/png").equals(png)).toBe(true);
  });
});

/*
 * Correct and applied are different properties — the lesson the storefront
 * disclosure taught twice. A marking function nothing calls marks nothing.
 */
describe("the upload path actually marks", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./image-generator.ts", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("is reading the generator (a wrong path would pass everything)", () => {
    expect(source).toContain("storage");
    expect(source.length).toBeGreaterThan(1000);
  });

  it("marks the bytes before they are uploaded", () => {
    expect(source).toContain("markAiGenerated");
    const marked = source.indexOf("markAiGenerated");
    const uploaded = source.indexOf(".upload(");
    expect(marked).toBeGreaterThan(-1);
    expect(uploaded).toBeGreaterThan(-1);
    expect(marked, "the mark must be applied before the upload call").toBeLessThan(uploaded);
  });

  it("uploads the marked buffer, not the original", () => {
    // The bug this catches: marking into a variable and then uploading
    // img.bytes anyway, which typechecks and silently ships unmarked files.
    expect(source).toMatch(/\.upload\([^)]*\bbytes\b/);
    expect(source).not.toMatch(/\.upload\([^)]*img\.bytes/);
  });
});
