/*
 * Crawlers, and why this file exists at all.
 *
 * Spec 10 §13. Analytics must reflect human behaviour, so bot traffic is
 * excluded from BOTH sides of every ratio — counting it in the denominator
 * would depress conversion just as counting it in the numerator would inflate
 * clicks.
 *
 * The one that actually costs money is the link unfurler. Meta fetches every
 * URL pasted into an ad account to build its preview, before a single human
 * sees the ad; Slack and WhatsApp do the same when a link is shared. A tracked
 * ad link is pasted into Meta exactly once per ad, so without this every new ad
 * would open with a phantom click on day zero — and for a store with 80
 * visitors that moves the conversion rate visibly.
 *
 * Measured, not assumed: today's storefront records visits from a client-side
 * beacon, and unfurlers do not execute JavaScript, so they are already absent
 * from the data. That immunity is accidental, and it is exactly what the move
 * to a server-held attribution window would have destroyed. This makes it
 * deliberate and keeps it true for the paths that do run on the server —
 * Googlebot renders JavaScript on a second pass, so the beacon alone was never
 * complete cover.
 *
 * Kept deliberately conservative. A missed bot is a small distortion; a human
 * misread as a bot is a sale that vanishes from the merchant's reporting with
 * no way for them to discover why.
 */

/**
 * Substrings that appear in the user agent of automated clients.
 *
 * Lowercase; matched as substrings against a lowercased UA. Ordered by how
 * often they show up against a storefront rather than alphabetically.
 */
const BOT_SIGNATURES = [
  // Link unfurlers — the ones that hit tracked ad links directly.
  "facebookexternalhit",
  "facebookcatalog",
  "meta-externalagent",
  "slackbot",
  "slack-imgproxy",
  "whatsapp",
  "twitterbot",
  "telegrambot",
  "discordbot",
  "linkedinbot",
  /*
   * Pinterest's crawler only. A bare "pinterest" would also match its in-app
   * browser ("Pinterest for iOS/11.36"), discarding real people who clicked a
   * Pinterest ad — which Ad Studio generates.
   */
  "pinterestbot",
  "pinterest/0.",
  "redditbot",
  "skypeuripreview",
  "vkshare",
  "embedly",
  "quora link preview",
  "outbrain",
  "nuzzel",
  "bitlybot",
  "iframely",

  // Search and AI crawlers.
  "googlebot",
  "google-inspectiontool",
  "storebot-google",
  "bingbot",
  "adidxbot",
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "applebot",
  "petalbot",
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  "claudebot",
  "claude-web",
  "anthropic-ai",
  "perplexitybot",
  "ccbot",
  "bytespider",
  "amazonbot",

  // Monitoring, tooling and generic automation.
  "uptimerobot",
  "pingdom",
  "statuscake",
  "site24x7",
  "datadog",
  "newrelicpinger",
  "lighthouse",
  "chrome-lighthouse",
  "pagespeed",
  "gtmetrix",
  "headlesschrome",
  "phantomjs",
  "puppeteer",
  "playwright",
  "selenium",
  "python-requests",
  "scrapy",
  "curl/",
  "wget/",
  "go-http-client",
  "axios/",
  "node-fetch",
  "okhttp",
  "java/",
  "libwww-perl",
  "apache-httpclient",

  // Generic markers. Last, because they are the broadest.
  "bot/",
  "bot;",
  "+bot",
  "spider",
  "crawler",
  "crawling",
  "preview",
  "monitor",
  "scraper",
  "fetcher",
  "archiver",
];

/**
 * Is this request automated?
 *
 * A missing or empty user agent counts as a bot: every real browser sends one,
 * and a blank UA is the signature of a script that did not bother.
 */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  if (ua.length < 8) return true; // Too short to be any real browser.
  return BOT_SIGNATURES.some((sig) => ua.includes(sig));
}

/**
 * Why a request was classified as automated — for the admin view and for
 * debugging a merchant's "where did my visitor go" question.
 *
 * Returns null for human traffic.
 */
export function botReason(userAgent: string | null | undefined): string | null {
  if (!userAgent) return "no user agent";
  const ua = userAgent.toLowerCase();
  if (ua.length < 8) return "user agent too short to be a browser";
  return BOT_SIGNATURES.find((sig) => ua.includes(sig)) ?? null;
}
