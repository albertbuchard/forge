FROM node:22-bookworm-slim

ENV HOST=0.0.0.0 \
    PORT=4400 \
    FORGE_DEMO_ROOT=/var/lib/forge-demo

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build \
    && mkdir -p /var/lib/forge-demo \
    && chown -R node:node /app /var/lib/forge-demo

USER node
ENV NODE_ENV=production
EXPOSE 4400

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4400/api/v1/demo/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "run", "demo:public"]
