import { z } from "zod";

/*
 * Shared request schemas (spec 6.1 §3: validate every endpoint with Zod).
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

export const ProductCreateSchema = z.object({
  title: z.string().trim().min(1, "Give the product a title.").max(140),
  description: z.string().trim().max(400).default(""),
  priceEUR: z.number().positive("Price must be above zero.").max(1_000_000),
  inventoryCount: z.number().int().min(0).max(1_000_000).default(100),
});

export const ProductUpdateSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(400).optional(),
  priceEUR: z.number().positive().max(1_000_000).optional(),
  inventoryCount: z.number().int().min(0).max(1_000_000).optional(),
  showLogo: z.boolean().optional(),
});

export const StoreUpdateSchema = z.object({
  storeName: z.string().trim().min(2, "Name is too short.").max(80).optional(),
  tagline: z.string().trim().max(120).optional(),
  background: z.string().regex(HEX, "Use a hex colour like #1F293B.").optional(),
  structure: z.string().regex(HEX, "Use a hex colour like #1F293B.").optional(),
  accent: z.string().regex(HEX, "Use a hex colour like #1F293B.").optional(),
  isActive: z.boolean().optional(),
});
