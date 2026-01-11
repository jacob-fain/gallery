FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Remove dev dependencies
RUN npm prune --production

EXPOSE 3001
CMD ["node", "dist/index.js"]
