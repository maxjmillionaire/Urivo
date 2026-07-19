"use client";

import { useEffect } from "react";

/*
 * Clears the store's cart once the order is confirmed. The cart lives in
 * localStorage keyed by subdomain (see store-cart.tsx); a completed purchase
 * should leave the shopper with an empty cart.
 */
export function ClearCart({ subdomain }: { subdomain: string }) {
  useEffect(() => {
    try {
      localStorage.removeItem(`uv-cart:${subdomain}`);
    } catch {
      /* ignore */
    }
  }, [subdomain]);
  return null;
}
