/*
 * What each platform will actually accept.
 *
 * The generated schema cannot express these. Structured outputs strip string
 * length constraints before the request is sent (the SDK re-checks them
 * client-side), and even if they survived, a single `headline` field cannot
 * carry one limit for Google and another for Pinterest. So the limits lived
 * only in the prompt — which meant the model usually complied and nothing
 * caught it when it did not.
 *
 * That gap is not cosmetic. A Google RSA headline over 30 characters is
 * rejected at upload. The merchant does not get a slightly-too-long ad; they
 * get an ad they cannot run, discovered after they have already opened Google
 * Ads and pasted it in.
 *
 * These are upload/display limits, not style preferences. Keep them accurate;
 * a wrong number here silently mangles good copy.
 */

export const AD_PLATFORMS = ["Meta", "Google", "TikTok", "Pinterest"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export interface PlatformLimits {
  headline: number;
  /** Where the platform truncates the body, or refuses it outright. */
  primaryText: number;
  /** Why the limit exists, shown to the merchant when copy had to be adjusted. */
  note: string;
}

export const PLATFORM_LIMITS: Record<AdPlatform, PlatformLimits> = {
  // Responsive Search Ads: headline 30, description 90. Hard upload limits.
  Google: { headline: 30, primaryText: 90, note: "Google rejects RSA headlines over 30 characters and descriptions over 90." },
  // Feed: headline truncates around 40, primary text collapses behind
  // "See more" at roughly 125 — not a rejection, but everything past it is
  // invisible to a scrolling reader, which for an ad is the same thing.
  Meta: { headline: 40, primaryText: 125, note: "Meta hides primary text past ~125 characters behind “See more”." },
  TikTok: { headline: 100, primaryText: 100, note: "TikTok caps ad text at 100 characters." },
  Pinterest: { headline: 100, primaryText: 500, note: "Pinterest caps the title at 100 characters." },
};

export interface Creative {
  platform: string;
  format: string;
  angle: string;
  headline: string;
  primaryText: string;
  cta: string;
}

export interface Violation {
  index: number;
  platform: string;
  field: "headline" | "primaryText";
  length: number;
  limit: number;
}

/** Every creative that exceeds what its platform will take. */
export function findViolations(creatives: Creative[]): Violation[] {
  const out: Violation[] = [];
  creatives.forEach((c, index) => {
    const limits = PLATFORM_LIMITS[c.platform as AdPlatform];
    if (!limits) return;
    if (c.headline.length > limits.headline) {
      out.push({ index, platform: c.platform, field: "headline", length: c.headline.length, limit: limits.headline });
    }
    if (c.primaryText.length > limits.primaryText) {
      out.push({ index, platform: c.platform, field: "primaryText", length: c.primaryText.length, limit: limits.primaryText });
    }
  });
  return out;
}

/**
 * Cut to a word boundary, never mid-word.
 *
 * The last resort after a repair pass has already failed. A headline cut to
 * "The last marking gau" is worse than the original problem; cut to "The last
 * marking" it is at least still an ad. No ellipsis — Google counts it toward
 * the limit, and it reads as a mistake rather than a choice.
 */
export function trimToWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  // A single word longer than the whole limit has no boundary to find.
  const trimmed = space > limit * 0.5 ? cut.slice(0, space) : cut;
  return trimmed.replace(/[\s,;:–—-]+$/, "");
}

export interface EnforcementResult {
  creatives: Creative[];
  /** Human-readable record of anything that had to be cut, for the merchant. */
  adjusted: string[];
}

/**
 * Bring every creative inside its platform's limits.
 *
 * Reported rather than silent: a merchant whose headline was shortened should
 * know, because the cut version is what they will paste into Google and the
 * original was the one they read in the UI.
 */
export function enforceLimits(creatives: Creative[]): EnforcementResult {
  const adjusted: string[] = [];
  const out = creatives.map((c) => {
    const limits = PLATFORM_LIMITS[c.platform as AdPlatform];
    if (!limits) return c;
    let { headline, primaryText } = c;
    if (headline.length > limits.headline) {
      adjusted.push(`${c.platform} headline shortened to ${limits.headline} characters.`);
      headline = trimToWord(headline, limits.headline);
    }
    if (primaryText.length > limits.primaryText) {
      adjusted.push(`${c.platform} body shortened to ${limits.primaryText} characters.`);
      primaryText = trimToWord(primaryText, limits.primaryText);
    }
    return { ...c, headline, primaryText };
  });
  return { creatives: out, adjusted };
}

/** The limits, written for the model rather than for a developer. */
export function renderPlatformLimits(): string {
  return [
    "HARD LIMITS — copy that exceeds these cannot be uploaded or will not be seen. Count characters as you write; do not go over.",
    ...AD_PLATFORMS.map(
      (p) =>
        `  ${p}: headline ≤ ${PLATFORM_LIMITS[p].headline} characters, body ≤ ${PLATFORM_LIMITS[p].primaryText} characters. ${PLATFORM_LIMITS[p].note}`,
    ),
  ].join("\n");
}
