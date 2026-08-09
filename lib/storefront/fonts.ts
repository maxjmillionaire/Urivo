import {
  Playfair_Display,
  Cormorant_Garamond,
  Fraunces,
  Spectral,
  Libre_Baskerville,
  Inter,
  Manrope,
  DM_Sans,
  Space_Grotesk,
  Sora,
  Jost,
  Epilogue,
  Archivo,
  Syne,
  Bebas_Neue,
  IBM_Plex_Mono,
} from "next/font/google";

/*
 * Storefront webfonts — self-hosted, not fetched from Google at runtime.
 *
 * The generator picks a heading/body pair per store, so the typography IS part
 * of the brand it invents. Until this module existed the renderer emitted a
 * <link> to fonts.googleapis.com, and the app's own CSP (`style-src 'self'`,
 * `font-src 'self' data:`) refused it — in production as well as in dev. The
 * failure was silent in the worst way: the family name was still declared, so
 * the browser fell back to system-ui and every generated store shipped with a
 * typeface nobody chose. Measured on a real store: `document.fonts` contained
 * zero loaded faces.
 *
 * next/font downloads each family at BUILD time and serves it from our own
 * origin, which fixes three things at once:
 *   1. the CSP passes, because the font really is 'self';
 *   2. no visitor request reaches Google, so a German merchant's storefront
 *      does not embed a third-party font call (LG München I, 3 O 17493/20 —
 *      the liability would land on every merchant we generate a store for);
 *   3. no extra DNS + TLS handshake on the critical path.
 *
 * All sixteen families are declared here and every variable is bound on the
 * storefront root. That costs a few KB of @font-face rules, not sixteen
 * downloads: a browser fetches a face only when rendered text actually uses it,
 * so a store still pulls exactly the two faces it was designed with. `preload`
 * is off for the same reason — preloading is per-family and we cannot know at
 * build time which two a given store will need.
 */

/*
 * Every option is written out literally on purpose. next/font is compiled by an
 * SWC plugin that reads these call arguments statically at build time — it
 * cannot follow a spread or a shared constant, and rejects one outright
 * ("Unexpected spread"). Repetition here is the price of build-time fonts.
 *
 * Variable fonts carry their whole weight range in one file, so no `weight` is
 * given. The five static families MUST list the weights they actually ship;
 * asking for one that does not exist fails the build.
 */
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--f-playfair" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--f-cormorant" });
const fraunces = Fraunces({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--f-fraunces" });
const spectral = Spectral({ subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "600"], style: ["normal", "italic"], variable: "--f-spectral" });
const libre = Libre_Baskerville({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], style: ["normal", "italic"], variable: "--f-libre" });
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-inter" });
const manrope = Manrope({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-manrope" });
const dmsans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-dmsans" });
const spacegrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-spacegrotesk" });
const sora = Sora({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-sora" });
const jost = Jost({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-jost" });
const epilogue = Epilogue({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-epilogue" });
const archivo = Archivo({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-archivo" });
const syne = Syne({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-syne" });
const bebas = Bebas_Neue({ subsets: ["latin"], display: "swap", preload: false, weight: ["400"], variable: "--f-bebas" });
const ibmmono = IBM_Plex_Mono({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600"], variable: "--f-ibmmono" });

/**
 * Every font variable, to be applied on the element that wraps a storefront.
 * `fontStack()` in design-system.ts resolves a key to `var(--f-<key>)`, so the
 * variables must be in scope wherever storefront markup renders.
 */
export const STOREFRONT_FONT_VARS = [
  playfair, cormorant, fraunces, spectral, libre, inter, manrope, dmsans,
  spacegrotesk, sora, jost, epilogue, archivo, syne, bebas, ibmmono,
]
  .map((f) => f.variable)
  .join(" ");
