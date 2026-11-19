# TrustElect API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t trustelect-api .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @trustelect/api --workspace @trustelect/shared --include-workspace-root=false --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @trustelect/shared && npm run build -w @trustelect/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @trustelect/api --workspace @trustelect/shared --include-workspace-root=false --ignore-scripts \
  && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
RUN mkdir -p /data/evidence apps/api/data && chown -R node:node /data apps/api/data
USER node
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["sh", "-c", "node dist/cli/migrate.js && exec node dist/main.js"]
