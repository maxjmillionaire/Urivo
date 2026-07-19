import type { MetadataRoute } from "next";

/*
 * Web app manifest — installability + a polished "Add to Home Screen" on mobile.
 * Midnight theme so the splash and chrome match the product.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Urivo — AI Commerce Operating System",
    short_name: "Urivo",
    description: "Research markets, build a premium brand, and launch a complete online store — with AI.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0B1220",
    theme_color: "#0B1220",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
