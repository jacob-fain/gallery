# Build stage: full dependencies and the TypeScript compiler.
FROM node:24.22.3-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Runtime stage: production dependencies and compiled output only, so the
# image carries no compiler, test runner or type packages.
FROM node:24.22.3-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
# Files stay root-owned and read-only to the app, which runs unprivileged.
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
