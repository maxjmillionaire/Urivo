import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCart } from "./checkout";

/*
 * Storefront cart validation — the boundary between what a shopper's browser
 * claims and what the merchant actually charges.
 *
 * Everything a shopper sends is a suggestion. The request body carries product
 * ids and quantities and nothing else; the price on the Stripe line item has to
 * come from the catalogue row, or the oldest trick in e-commerce works: edit the
 * price in the payload and buy a €200 coat for one cent.
 *
 * The catalogue read is also scoped to the store being checked out, so a product
 * id belonging to a DIFFERENT merchant cannot be smuggled into this basket.
 */

/** A products table, queried the way validateCart queries it. */
function fakeAdmin(catalogue: Array<Record<string, unknown>>) {
  const seen: { storeId?: string; ids?: string[] } = {};
  const client = {
    from() {
      return {
        select() {
          return {
            eq(_col: string, storeId: string) {
              seen.storeId = storeId;
              return {
                in(_c: string, ids: string[]) {
                  seen.ids = ids;
                  // The real query filters by store_id server-side.
                  const data = catalogue.filter(
                    (p) => p.store_id === storeId && ids.includes(p.id as string),
                  );
                  return Promise.resolve({ data, error: null });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, seen };
}

const STORE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const catalogue = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", store_id: STORE, title: "Coat", price_eur: 200, image_url: null, inventory_count: 5 },
  { id: "aaaaaaaa-0000-0000-0000-000000000002", store_id: STORE, title: "Scarf", price_eur: 39.5, image_url: null, inventory_count: 1 },
  { id: "bbbbbbbb-0000-0000-0000-000000000003", store_id: OTHER, title: "Rival item", price_eur: 999, image_url: null, inventory_count: 9 },
];

describe("validateCart — the shopper proposes, the catalogue decides", () => {
  it("prices every line from the catalogue, in cents", async () => {
    const { client } = fakeAdmin(catalogue);
    const cart = await validateCart(client, STORE, [
      { productId: "aaaaaaaa-0000-0000-0000-000000000001", quantity: 2 },
    ], "eur");
    expect(cart.lines[0].unitAmount).toBe(20_000);
    expect(cart.lines[0].lineTotal).toBe(40_000);
    expect(cart.subtotal).toBe(40_000);
  });

  it("ignores a price sent by the client", async () => {
    const { client } = fakeAdmin(catalogue);
    // The oldest attack: post your own price alongside the id.
    const hostile = [
      { productId: "aaaaaaaa-0000-0000-0000-000000000001", quantity: 1, price_eur: 0.01, unitAmount: 1, lineTotal: 1 },
    ] as never;
    const cart = await validateCart(client, STORE, hostile, "eur");
    expect(cart.lines[0].unitAmount).toBe(20_000);
    expect(cart.subtotal).toBe(20_000);
  });

  it("refuses a product belonging to another merchant's store", async () => {
    const { client } = fakeAdmin(catalogue);
    const cart = await validateCart(client, STORE, [
      { productId: "bbbbbbbb-0000-0000-0000-000000000003", quantity: 1 },
    ], "eur");
    expect(cart.lines).toEqual([]);
    expect(cart.subtotal).toBe(0);
  });

  it("scopes the catalogue read to the store being checked out", async () => {
    const { client, seen } = fakeAdmin(catalogue);
    await validateCart(client, STORE, [
      { productId: "aaaaaaaa-0000-0000-0000-000000000001", quantity: 1 },
    ], "eur");
    expect(seen.storeId).toBe(STORE);
  });

  it("clamps quantity to stock rather than overselling", async () => {
    const { client } = fakeAdmin(catalogue);
    const cart = await validateCart(client, STORE, [
      { productId: "aaaaaaaa-0000-0000-0000-000000000002", quantity: 20 },
    ], "eur");
    expect(cart.lines[0].quantity).toBe(1); // inventory_count = 1
    expect(cart.subtotal).toBe(3_950);
  });

  it("collapses a repeated product instead of billing it twice at a stale price", async () => {
    const { client } = fakeAdmin(catalogue);
    const cart = await validateCart(client, STORE, [
      { productId: "aaaaaaaa-0000-0000-0000-000000000001", quantity: 1 },
      { productId: "aaaaaaaa-0000-0000-0000-000000000001", quantity: 2 },
    ], "eur");
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(3);
  });

  it("refuses negative and fractional quantities", async () => {
    const { client } = fakeAdmin(catalogue);
    const cart = await validateCart(client, STORE, [
      { productId: "aaaaaaaa-0000-0000-0000-000000000001", quantity: -5 },
      { productId: "aaaaaaaa-0000-0000-0000-000000000002", quantity: 1.9 },
    ], "eur");
    // A negative quantity can never reduce the bill.
    expect(cart.subtotal).toBeGreaterThan(0);
    for (const line of cart.lines) {
      expect(line.quantity).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(line.quantity)).toBe(true);
      expect(line.lineTotal).toBeGreaterThan(0);
    }
  });

  it("returns an empty cart for an unknown product rather than a free order", async () => {
    const { client } = fakeAdmin(catalogue);
    const cart = await validateCart(client, STORE, [
      { productId: "99999999-0000-0000-0000-000000000009", quantity: 1 },
    ], "eur");
    expect(cart.lines).toEqual([]);
  });
});
