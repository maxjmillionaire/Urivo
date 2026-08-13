import { z } from "zod";

/*
 * Shared request schemas (spec 6.1 §3: validate every endpoint with Zod).
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/*
 * GPSR Art. 19 fields (migration 0050). Every one is optional and may be
 * cleared: a merchant who typed a manufacturer address into the wrong product
 * must be able to empty it again, and an empty field is an honest "not supplied
 * yet" that the dashboard reports. Ceilings mirror the database constraint.
 *
 * Declared before the schemas that spread it — a `const` referenced above its
 * declaration throws at module load, not at call time, which would take down
 * every route importing this file.
 */
const GpsrShape = {
  manufacturerName: z.string().trim().max(200).optional(),
  manufacturerAddress: z.string().trim().max(500).optional(),
  manufacturerEmail: z.string().trim().max(320).optional(),
  euResponsibleName: z.string().trim().max(200).optional(),
  euResponsibleAddress: z.string().trim().max(500).optional(),
  euResponsibleEmail: z.string().trim().max(320).optional(),
  productIdentifier: z.string().trim().max(140).optional(),
  safetyWarnings: z.string().trim().max(2000).optional(),
};

export const ProductCreateSchema = z.object({
  title: z.string().trim().min(1, "Give the product a title.").max(140),
  description: z.string().trim().max(400).default(""),
  priceEUR: z.number().positive("Price must be above zero.").max(1_000_000),
  inventoryCount: z.number().int().min(0).max(1_000_000).default(100),
  // Optional on create: safety details are usually filled in after the product
  // exists, and blocking the first save on them would stop a founder mid-flow.
  ...GpsrShape,
});

export const ProductUpdateSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(400).optional(),
  priceEUR: z.number().positive().max(1_000_000).optional(),
  inventoryCount: z.number().int().min(0).max(1_000_000).optional(),
  showLogo: z.boolean().optional(),
  ...GpsrShape,
});

export const StoreUpdateSchema = z.object({
  storeName: z.string().trim().min(2, "Name is too short.").max(80).optional(),
  tagline: z.string().trim().max(120).optional(),
  background: z.string().regex(HEX, "Use a hex colour like #1F293B.").optional(),
  structure: z.string().regex(HEX, "Use a hex colour like #1F293B.").optional(),
  accent: z.string().regex(HEX, "Use a hex colour like #1F293B.").optional(),
  isActive: z.boolean().optional(),
});
