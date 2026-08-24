/*
 * Campaign field bounds — isomorphic on purpose.
 *
 * The composer (a client component) and the send route (server) must agree on
 * the same limits, and campaign.ts is server-only (it reaches the AI SDK and
 * the service-role client). Keeping the plain numbers here lets both sides
 * import them without dragging a server module into the browser bundle.
 */
export const CAMPAIGN_LIMITS = {
  subjectMin: 3,
  subjectMax: 120,
  bodyMin: 20,
  bodyMax: 5000,
} as const;
