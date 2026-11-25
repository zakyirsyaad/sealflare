FROM node:24-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json ./shared/package.json
COPY packages/sandbox-worker/package.json ./packages/sandbox-worker/package.json
RUN npm install --global pnpm@12.10.1 \
    && pnpm --filter @sealflare/sandbox-worker... install --prod --frozen-lockfile --ignore-scripts

FROM node:24-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS runtime
ENV NODE_ENV=production RUN_DIR=/var/lib/sealflare/runs PORT=8787
WORKDIR /app
COPY --from=dependencies /app /app
COPY shared/rules ./shared/rules
COPY shared/schemas ./shared/schemas
COPY shared/abi ./shared/abi
COPY packages/sandbox-worker/tsconfig.json ./packages/sandbox-worker/tsconfig.json
COPY packages/sandbox-worker/src ./packages/sandbox-worker/src
RUN mkdir -p /var/lib/sealflare/runs && chown node:node /var/lib/sealflare/runs
USER node
WORKDIR /app/packages/sandbox-worker
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
