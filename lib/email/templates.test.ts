import { describe, it, expect } from "vitest";
import { orderConfirmationEmail, welcomeEmail } from "./templates";

/*
 * The shopper's order confirmation is the merchant's email to their own
 * customer — so it has to read as the STORE's receipt, not Urivo's. These tests
 * pin the two things that make that true: the store's brand leads, and the
 * itemised summary survives into the plain-text part (a receipt with no items
 * in the text/plain alternative is broken for every client that prefers text).
 */

const base = {
  storeName: "Nordljus",
  customerName: "Ada",
  amountTotal: "€48",
  lines: [
    { title: "Merino Beanie", quantity: 2, lineTotal: "€40" },
    { title: "Wool Socks", quantity: 1, lineTotal: "€8" },
  ],
};

describe("orderConfirmationEmail — the shopper's receipt", () => {
  it("confirms the order and greets the customer by name", () => {
    const email = orderConfirmationEmail(base);
    expect(email.subject).toBe("Your Nordljus order is confirmed");
    expect(email.html).toContain("Thank you, Ada.");
    expect(email.text).toContain("Thank you, Ada.");
  });

  it("falls back to a nameless thank-you when no customer name is present", () => {
    const email = orderConfirmationEmail({ ...base, customerName: null });
    expect(email.html).toContain("Thank you for your order.");
  });

  it("itemises every line and the total in BOTH the HTML and the text part", () => {
    const email = orderConfirmationEmail(base);
    for (const body of [email.html, email.text]) {
      expect(body).toContain("2 × Merino Beanie");
      expect(body).toContain("1 × Wool Socks");
      expect(body).toContain("€40");
      expect(body).toContain("€8");
      // The total row, labelled, is what makes it a receipt rather than a list.
      expect(body).toContain("Total");
      expect(body).toContain("€48");
    }
  });

  it("leads with the store's brand and relegates Urivo to 'powered by'", () => {
    const email = orderConfirmationEmail(base);
    // The store's name is the wordmark; Urivo is the rails underneath.
    expect(email.html).toContain("Nordljus");
    expect(email.html).toContain("Powered by");
    expect(email.text).toContain("Nordljus — powered by Urivo");
    // The Urivo logo tile must NOT appear on a shopper's email.
    expect(email.html).not.toContain('alt="Urivo"');
  });

  it("strips markup from a merchant-supplied store name and product title", () => {
    const email = orderConfirmationEmail({
      ...base,
      storeName: "<script>x</script>Shop",
      lines: [{ title: "<b>Hat</b>", quantity: 1, lineTotal: "€10" }],
    });
    // Angle brackets are removed, not entity-encoded, so HTML and text agree.
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>Hat</b>");
    expect(email.html).toContain("scriptx/scriptShop");
    expect(email.text).not.toContain("<script>");
  });

  it("never divides an odd cent count into a broken total (caller formats money)", () => {
    // Amounts arrive pre-formatted; the template must render them verbatim.
    const email = orderConfirmationEmail({ ...base, amountTotal: "€48.50" });
    expect(email.html).toContain("€48.50");
  });
});

describe("brandless templates are untouched by the shopper-brand path", () => {
  it("keeps Urivo's own logo and wordmark on a platform email", () => {
    const email = welcomeEmail("Ada");
    expect(email.html).toContain('alt="Urivo"');
    expect(email.text.trimEnd().endsWith("— Urivo")).toBe(true);
  });
});
