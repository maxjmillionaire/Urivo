import "server-only";
import { SupplierError, type SupplierProvider, type SupplierProviderId } from "./types";
import { autodsProvider } from "./providers/autods";

/*
 * Provider registry — the ONLY place in the codebase that knows which concrete
 * suppliers exist. Everything else resolves a provider through
 * getSupplierProvider() and talks to the interface, never to a vendor.
 *
 * ── Adding a provider (CJ, Zendrop, DSers, Spocket, Printful, Printify) ──
 *   1. Create lib/suppliers/providers/<name>.ts implementing SupplierProvider
 *      (normalise the vendor's API into the canonical types — copy autods.ts).
 *   2. Add one line to REGISTRY below.
 * That's the entire integration. No other file changes.
 */
const REGISTRY: Partial<Record<SupplierProviderId, SupplierProvider>> = {
  autods: autodsProvider,
  // Planned — each is one file + one line here:
  // cj: cjProvider,
  // zendrop: zendropProvider,
  // dsers: dsersProvider,
  // spocket: spocketProvider,
  // printful: printfulProvider,
  // printify: printifyProvider,
};

/** Every provider Urivo intends to support (for the connect UI, incl. planned). */
export const ALL_PROVIDER_IDS: SupplierProviderId[] = [
  "autods", "cj", "zendrop", "dsers", "spocket", "printful", "printify",
];

const DISPLAY_NAME: Record<SupplierProviderId, string> = {
  autods: "AutoDS", cj: "CJ Dropshipping", zendrop: "Zendrop", dsers: "DSers",
  spocket: "Spocket", printful: "Printful", printify: "Printify",
};

/** Resolve a provider. Throws UNSUPPORTED if it isn't wired up yet. */
export function getSupplierProvider(id: SupplierProviderId): SupplierProvider {
  const provider = REGISTRY[id];
  if (!provider) throw new SupplierError("UNSUPPORTED", `Supplier "${id}" is not available yet.`);
  return provider;
}

export function isProviderAvailable(id: SupplierProviderId): boolean {
  return Boolean(REGISTRY[id]);
}

/** For the connect screen: every intended provider + whether it's live. */
export function listSupplierProviders(): { id: SupplierProviderId; name: string; available: boolean }[] {
  return ALL_PROVIDER_IDS.map((id) => ({ id, name: DISPLAY_NAME[id], available: isProviderAvailable(id) }));
}
