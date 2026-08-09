# Urivo production image (spec 6.4 §36): multi-stage, small, non-root,
# healthcheck, env-only secrets.

# --- deps -------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build ------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public env vars are inlined at build time; provide safe placeholders so the
# build succeeds. Real values are injected at runtime on Railway.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime ----------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind to every interface, not loopback.
#
# Next's standalone server reads HOSTNAME and falls back to localhost. Inside a
# container that means it listens only on 127.0.0.1: the platform's proxy and
# the healthcheck below both fail to reach it, the container is marked unhealthy
# and killed — after a build that succeeded and a process that started cleanly.
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# No `public/` copy: Urivo does not have one, and does not need one.
#
# The icons live in the App Router — app/icon.png and app/apple-icon.png — and
# app/manifest.ts points at the URLs Next generates from them. Nothing is served
# from a static root directory, so `public/` was never created; git tracks no
# empty directories, and the build stage therefore had no /app/public to copy.
# The COPY failed its checksum and stopped the image build.
#
# An empty public/ with a .gitkeep would have turned the build green while
# leaving a directory that exists only to satisfy a line that should not be
# there. If real static assets are ever added, restore this COPY along with them.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
