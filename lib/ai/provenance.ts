/*
 * Machine-readable AI provenance on generated imagery (EU AI Act Art. 50(2)).
 *
 * From 2 August 2026, a provider of a generative AI system must mark its output
 * so that it is detectable as artificially generated — in a MACHINE-readable
 * form. The visible line under a product grid (lib/storefront/ai-disclosure.ts)
 * satisfies the human half and does nothing for this one: a crawler, a
 * marketplace or a regulator's detection tool cannot read rendered text on a
 * page it never visits.
 *
 * The grace period to 2 December 2026 covers systems placed on the market
 * before 2 August. Urivo launches after, so it does not apply to us.
 *
 * WHAT THIS IS, PRECISELY
 *
 * This embeds an XMP packet carrying IPTC's `digitalSourceType` with the value
 * `trainedAlgorithmicMedia` — the standard vocabulary term for "made by a
 * generative model", the same one Adobe, Google and the major agencies write.
 * It is the metadata layer of the Commission's Code of Practice, which asks for
 * a layered approach: metadata, an imperceptible watermark, and logging.
 *
 * What it is NOT: a signed C2PA manifest, and not robust. Metadata survives
 * copying and most CDNs; it does not survive a screenshot or a re-encode by a
 * tool that drops unknown chunks. Claiming otherwise would be worse than
 * shipping nothing, because it would stop anyone from adding the layers that
 * cover what this misses. C2PA proper requires a signing certificate and an
 * identity to sign as, which is a business decision rather than a code change.
 *
 * Urivo's third layer already exists: products.image_source records provenance
 * per image in the database (migration 0032), which is the record that survives
 * everything because it never travels with the file.
 *
 * Dependency-free on purpose. PNG chunk and JPEG segment insertion are a few
 * dozen lines each, and a native image library in the upload path is a build
 * liability and an attack surface for something this small.
 */

/** IPTC NewsCodes term for media produced by a generative model. */
export const TRAINED_ALGORITHMIC_MEDIA =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

const XMP_NS = "http://ns.adobe.com/xap/1.0/";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const XMP_KEYWORD = "XML:com.adobe.xmp";

export interface ProvenanceOptions {
  /** Model or system that produced the image, recorded as the creator tool. */
  generator?: string;
}

/** The XMP packet. Deliberately minimal — every field here is one we can stand behind. */
export function xmpPacket(opts: ProvenanceOptions = {}): string {
  const generator = escapeXml(opts.generator ?? "Urivo");
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <Iptc4xmpExt:DigitalSourceType>${TRAINED_ALGORITHMIC_MEDIA}</Iptc4xmpExt:DigitalSourceType>
   <xmp:CreatorTool>${generator}</xmp:CreatorTool>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------ PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * Insert the XMP packet as an iTXt chunk immediately before IEND.
 *
 * Walks the chunk list rather than searching for the IEND bytes: the sequence
 * can occur inside compressed image data, and truncating a file there would
 * corrupt it.
 */
function markPng(bytes: Buffer, xmp: string): Buffer {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IEND") {
      const data = Buffer.concat([
        Buffer.from(XMP_KEYWORD, "latin1"),
        Buffer.from([0x00, 0x00, 0x00]), // null, compression flag 0, method 0
        Buffer.from([0x00, 0x00]), // empty language tag, empty translated keyword
        Buffer.from(xmp, "utf8"),
      ]);
      return Buffer.concat([
        bytes.subarray(0, offset),
        pngChunk("iTXt", data),
        bytes.subarray(offset),
      ]);
    }
    const next = offset + 12 + length;
    if (next <= offset) return bytes; // malformed length; leave the file alone
    offset = next;
  }
  return bytes;
}

/** True when the PNG already carries an XMP packet, so marking stays idempotent. */
function pngHasXmp(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from(XMP_KEYWORD, "latin1"));
}

/* ------------------------------ JPEG --------------------------------- */

export function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** Insert an APP1 XMP segment directly after SOI, where readers expect it. */
function markJpeg(bytes: Buffer, xmp: string): Buffer {
  const payload = Buffer.concat([
    Buffer.from(XMP_NS, "latin1"),
    Buffer.from([0x00]),
    Buffer.from(xmp, "utf8"),
  ]);
  // Segment length counts itself but not the marker, and the field is 16-bit.
  const segmentLength = payload.length + 2;
  if (segmentLength > 0xffff) return bytes;
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(segmentLength, 2);
  return Buffer.concat([bytes.subarray(0, 2), header, payload, bytes.subarray(2)]);
}

function jpegHasXmp(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from(XMP_NS, "latin1"));
}

/* ------------------------------ public ------------------------------- */

/**
 * Mark an image as AI-generated, machine-readably.
 *
 * Returns the input untouched for a format it does not understand or a buffer
 * it would have to guess about. A missing mark is a compliance gap; a corrupted
 * product photograph is a broken storefront, and the second is worse — the
 * merchant loses the sale AND the mark.
 */
export function markAiGenerated(
  bytes: Buffer,
  mimeType: string,
  opts: ProvenanceOptions = {},
): Buffer {
  try {
    const xmp = xmpPacket(opts);
    if (isPng(bytes)) return pngHasXmp(bytes) ? bytes : markPng(bytes, xmp);
    if (isJpeg(bytes)) return jpegHasXmp(bytes) ? bytes : markJpeg(bytes, xmp);
    return bytes;
  } catch {
    // Never let provenance marking be the reason a store has no imagery.
    return bytes;
  }
}

/** True when the buffer carries our AI-generated marking. Used by the tests and detectors. */
export function hasAiProvenance(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from(TRAINED_ALGORITHMIC_MEDIA, "utf8"));
}
