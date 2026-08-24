import { describe, it, expect } from "vitest";
import {
  validateCampaign,
  sanitizeSenderName,
  campaignFrom,
  unsubscribeUrl,
  renderCampaignEmail,
  CAMPAIGN_LIMITS,
} from "./campaign";
import { subscribersCsv, type Subscriber } from "./audience";

/*
 * The campaign pipeline sends real email to real people, so its pure parts are
 * pinned here: what counts as a valid campaign, how a store name is made safe
 * for a From header, and — the two that carry legal and security weight — that
 * every rendered email has a working unsubscribe link and that nothing a
 * merchant or a subscriber typed can inject markup into the message.
 */

describe("validateCampaign", () => {
  it("rejects an empty or too-short subject", () => {
    expect(validateCampaign({ subject: "", body: "x".repeat(50) }).ok).toBe(false);
    expect(validateCampaign({ subject: "hi", body: "x".repeat(50) }).ok).toBe(false);
  });

  it("rejects a body below the minimum", () => {
    expect(validateCampaign({ subject: "A real subject", body: "too short" }).ok).toBe(false);
  });

  it("rejects over-long fields", () => {
    expect(validateCampaign({ subject: "s".repeat(CAMPAIGN_LIMITS.subjectMax + 1), body: "x".repeat(50) }).ok).toBe(false);
    expect(validateCampaign({ subject: "Fine", body: "x".repeat(CAMPAIGN_LIMITS.bodyMax + 1) }).ok).toBe(false);
  });

  it("accepts and trims a valid campaign", () => {
    const r = validateCampaign({ subject: "  Launch day  ", body: "  We are finally live and shipping.  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subject).toBe("Launch day");
      expect(r.value.body).toBe("We are finally live and shipping.");
    }
  });

  it("treats non-string input as missing rather than throwing", () => {
    expect(validateCampaign({ subject: 42, body: null }).ok).toBe(false);
  });
});

describe("sanitizeSenderName", () => {
  it("strips characters that could break or spoof a From header", () => {
    expect(sanitizeSenderName('Evil <a@b.com>, "x"')).toBe("Evil ab.com x");
  });

  it("caps the length and falls back when empty", () => {
    expect(sanitizeSenderName("x".repeat(80)).length).toBe(40);
    expect(sanitizeSenderName("   ")).toBe("Your store");
    expect(sanitizeSenderName("@<>")).toBe("Your store");
  });
});

describe("campaignFrom", () => {
  it("sends under the store name on Urivo's verified domain", () => {
    const from = campaignFrom("Nordljus");
    expect(from).toMatch(/^Nordljus via Urivo <.+@.+>$/);
  });

  it("never lets the store name smuggle a second address in", () => {
    const from = campaignFrom("A <evil@x.com>");
    // Exactly one angle-bracket pair — the real sender address.
    expect(from.match(/</g)?.length).toBe(1);
  });
});

describe("unsubscribeUrl", () => {
  it("builds a token link and normalises the origin", () => {
    expect(unsubscribeUrl("https://urivo.ai/", "tok-123")).toBe("https://urivo.ai/api/unsubscribe?t=tok-123");
  });
  it("encodes the token", () => {
    expect(unsubscribeUrl("https://urivo.ai", "a/b?c")).toContain("t=a%2Fb%3Fc");
  });
});

describe("renderCampaignEmail", () => {
  const url = "https://urivo.ai/api/unsubscribe?t=abc";
  const email = renderCampaignEmail({
    storeName: "Nordljus",
    subject: "Launch day",
    body: "First paragraph.\n\nSecond paragraph.",
    unsubscribeUrl: url,
  });

  it("carries a working unsubscribe link in both HTML and text", () => {
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html.toLowerCase()).toContain("unsubscribe");
    expect(email.text).toContain(url);
  });

  it("names the store the shopper subscribed to", () => {
    expect(email.html).toContain("Nordljus");
    expect(email.text).toContain("Nordljus");
  });

  it("renders blank-line-separated paragraphs", () => {
    expect(email.html).toContain("First paragraph.");
    expect(email.html).toContain("Second paragraph.");
  });

  it("escapes HTML from the subject, body and store name — no injection", () => {
    const evil = renderCampaignEmail({
      storeName: "Acme <x>",
      subject: "Sale & <b>deal</b>",
      body: "<script>alert(1)</script>",
      unsubscribeUrl: url,
    });
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&lt;script&gt;");
    expect(evil.html).toContain("Sale &amp; &lt;b&gt;deal&lt;/b&gt;");
    expect(evil.html).toContain("Acme &lt;x&gt;");
  });
});

describe("subscribersCsv", () => {
  const rows: Subscriber[] = [
    { id: "1", email: "a@b.com", source: "storefront", subscribed: true, createdAt: "2026-08-01T00:00:00Z" },
    { id: "2", email: 'weird","x@y.com', source: "storefront", subscribed: false, createdAt: "2026-08-02T00:00:00Z" },
  ];
  const csv = subscribersCsv(rows);

  it("starts with a BOM and a header row", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("email,status,source,subscribed_at");
  });

  it("quotes every cell and doubles inner quotes so a crafted address can't add a column", () => {
    // The malicious value stays inside one quoted cell.
    expect(csv).toContain('"weird"",""x@y.com"');
    expect(csv).toContain('"subscribed"');
    expect(csv).toContain('"unsubscribed"');
  });

  it("uses CRLF line endings", () => {
    expect(csv).toContain("\r\n");
  });
});
