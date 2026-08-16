import { describe, it, expect } from "vitest";
import { isBot, botReason } from "./bots";

/*
 * Spec 10 §13. The asymmetry of the two failure modes drives every case here:
 * a missed bot slightly distorts a rate, while a human misread as a bot is a
 * sale that disappears from the merchant's reporting with no way to find out
 * why. So the real browsers get the exhaustive list.
 */

describe("link unfurlers never count as visitors", () => {
  /*
   * The expensive one. Meta fetches every URL pasted into an ad account to
   * build its preview — before any human sees the ad. Since a tracked link is
   * pasted exactly once per ad, each new ad would otherwise open with a
   * phantom click, and every ad would look like it had reach it never had.
   */
  it.each([
    ["Meta", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    ["Meta catalog", "facebookcatalog/1.0"],
    ["Meta agent", "meta-externalagent/1.1"],
    ["Slack", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
    ["WhatsApp", "WhatsApp/2.23.20.0 A"],
    ["Twitter", "Twitterbot/1.0"],
    ["Telegram", "TelegramBot (like TwitterBot)"],
    ["Discord", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
    ["LinkedIn", "LinkedInBot/1.0 (compatible; Mozilla/5.0)"],
  ])("%s", (_name, ua) => {
    expect(isBot(ua)).toBe(true);
  });
});

describe("search and AI crawlers never count as visitors", () => {
  it.each([
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["Google Store", "Mozilla/5.0 (compatible; Storebot-Google/1.0)"],
    ["Bing", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
    ["DuckDuckGo", "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)"],
    ["Apple", "Mozilla/5.0 (Macintosh) AppleWebKit/605 (KHTML, like Gecko) Applebot/0.1"],
    ["GPTBot", "Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"],
    ["PerplexityBot", "Mozilla/5.0 (compatible; PerplexityBot/1.0)"],
    ["ClaudeBot", "Mozilla/5.0 (compatible; ClaudeBot/1.0)"],
  ])("%s", (_name, ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it("catches Googlebot, which renders JavaScript and would fire the beacon", () => {
    // The client-side beacon is not cover on its own: Googlebot runs a second
    // pass with JS enabled and would otherwise register as a real session.
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
  });
});

describe("automation and monitoring never count as visitors", () => {
  it.each([
    ["curl", "curl/8.4.0"],
    ["wget", "Wget/1.21.3"],
    ["python", "python-requests/2.31.0"],
    ["Go", "Go-http-client/2.0"],
    ["node-fetch", "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)"],
    ["headless Chrome", "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36"],
    ["Playwright", "Mozilla/5.0 Playwright/1.40"],
    ["Lighthouse", "Mozilla/5.0 Chrome-Lighthouse"],
    ["UptimeRobot", "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"],
  ])("%s", (_name, ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it("treats a missing user agent as automated", () => {
    // Every real browser sends one. A blank UA is a script that did not bother.
    expect(isBot(null)).toBe(true);
    expect(isBot(undefined)).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot("x")).toBe(true);
  });
});

describe("real people are never dropped", () => {
  /*
   * The costly direction. A shopper misclassified here vanishes from the
   * merchant's numbers silently — no error, no log, just a sale that never
   * appears next to the ad that earned it.
   */
  it.each([
    ["Chrome / Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"],
    ["Chrome / macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"],
    ["Safari / iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1"],
    ["Safari / iPad", "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"],
    ["Safari / macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15"],
    ["Firefox / Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0"],
    ["Firefox / Android", "Mozilla/5.0 (Android 14; Mobile; rv:122.0) Gecko/122.0 Firefox/122.0"],
    ["Chrome / Android", "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"],
    ["Edge", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"],
    ["Samsung Internet", "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36"],
    ["Opera", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0"],
    ["Meta in-app browser", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/449.0.0]"],
    ["Instagram in-app", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 316.0.0.36.109"],
    ["TikTok in-app", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_33.5.0"],
  ])("%s", (_name, ua) => {
    expect(isBot(ua)).toBe(false);
  });

  it.each([
    ["Pinterest iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Pinterest for iOS/11.36"],
    ["Pinterest Android", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Pinterest/11.4.0"],
  ])("%s in-app browser is a real person, not the Pinterest crawler", (_name, ua) => {
    /*
     * Ad Studio generates Pinterest ads, and Pinterest's in-app browser carries
     * "Pinterest" in its UA exactly as its crawler does. Matching the bare word
     * would silently discard the very traffic those ads produce.
     */
    expect(isBot(ua)).toBe(false);
  });

  it("still catches the Pinterest crawler itself", () => {
    expect(isBot("Pinterest/0.2 (+https://www.pinterest.com/bot.html)")).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; Pinterestbot/1.0; +https://www.pinterest.com/bot.html)")).toBe(true);
  });

  it("keeps the in-app browsers our own ads send people into", () => {
    /*
     * The single most damaging false positive available. A Meta ad opens in
     * Facebook's in-app browser, whose UA contains "FBAN/FBIOS" — and the
     * unfurler is "facebookexternalhit". Matching Facebook too loosely would
     * discard precisely the traffic Ad Studio exists to measure.
     */
    const inApp = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/449.0.0;FBBV/553402314]";
    expect(isBot(inApp)).toBe(false);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
  });
});

describe("a dropped visit can always be explained", () => {
  it("names the signature that matched", () => {
    expect(botReason("facebookexternalhit/1.1")).toBe("facebookexternalhit");
    expect(botReason("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("googlebot");
  });

  it("says so plainly when there was no user agent", () => {
    expect(botReason(null)).toBe("no user agent");
  });

  it("returns nothing for a real browser", () => {
    expect(botReason("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36")).toBeNull();
  });
});
