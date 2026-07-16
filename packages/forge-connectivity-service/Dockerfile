ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG SERVICE_VERSION=0.1.9
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ARG NODE_IMAGE
ARG SERVICE_VERSION
ARG VCS_REF
ARG BUILD_DATE
LABEL org.opencontainers.image.title="Forge Connectivity Service" \
      org.opencontainers.image.description="Content-blind self-hosted mailbox for Forge peers" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${SERVICE_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/albertbuchard/forge" \
      org.opencontainers.image.url="https://github.com/albertbuchard/forge/tree/main/packages/forge-connectivity-service" \
      org.opencontainers.image.documentation="https://github.com/albertbuchard/forge/tree/main/packages/forge-connectivity-service/docs" \
      org.opencontainers.image.base.name="${NODE_IMAGE}"
ENV NODE_ENV=production \
    FORGE_CONNECTIVITY_HOST=0.0.0.0 \
    FORGE_CONNECTIVITY_PORT=8787 \
    FORGE_CONNECTIVITY_DATABASE_PATH=/data/connectivity.sqlite
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs
RUN mkdir -p /data && chown node:node /data && chmod 0700 /data
USER node
EXPOSE 8787
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "dist/main.js"]
