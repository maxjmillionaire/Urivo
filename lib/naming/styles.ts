/*
 * Naming styles — a tiny, client-safe vocabulary shared by the Name Studio
 * (server) and the Brand Name Studio UI (client). No server-only imports here,
 * so a client component can render the style chips without pulling in the SDK.
 */
export const NAME_STYLES = ["premium", "luxury", "minimal", "modern"] as const;
export type NameStyle = (typeof NAME_STYLES)[number];
