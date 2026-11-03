# syntax=docker/dockerfile:1
# Hosted (Streamable HTTP) build of nextbillion-mcp. The runtime image holds only the
# bundled single-file server; no npm install at runtime (the documentation index is built
# in-process from the docs repository at start-up).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/server ./packages/server
RUN npm run build --workspace packages/server

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build /app/packages/server/dist ./dist
USER node
EXPOSE 8080
# NBAI_PUBLIC_URL (default https://mcp.nextbillion.io) must match the URL users enter.
CMD ["node", "dist/index.js"]
