# Base images are pinned by digest so a rebuild of the same commit gets the
# same base. Bump the tag and digest together.
# Build stage: full dependencies and the TypeScript compiler.
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Runtime stage: production dependencies and compiled output only, so the
# image carries no compiler, test runner or type packages.
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
# Opaque id of this build, reported by /api/health/ready. CI passes a hash
# of the ref and commit; local builds report "dev". The commit and version
# are shown only on the admin metrics route.
ARG BUILD_ID=dev
ARG GIT_SHA=
ARG APP_VERSION=
ENV NODE_ENV=production BUILD_ID=$BUILD_ID GIT_SHA=$GIT_SHA APP_VERSION=$APP_VERSION
WORKDIR /app
COPY package*.json ./
# The lockfile records no libc for sharp's prebuilt packages, so npm installs
# the glibc ones next to the musl ones Alpine loads. Dropping them saves ~18 MB.
RUN npm ci --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/@img/sharp-*linux-* \
 && npm cache clean --force
# Maintenance scripts ship in dist/scripts, run as "node dist/scripts/<name>.js".
COPY --from=build /app/dist ./dist
# Applied by "node dist/migrate.js" before a release starts serving.
COPY migrations ./migrations
# Files stay root-owned and read-only to the app, which runs unprivileged.
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
