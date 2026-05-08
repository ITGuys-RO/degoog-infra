FROM node:26-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:26-slim AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production \
    DEGOOG_URL=http://degoog.local:4444 \
    DEGOOG_DEFAULT_LANGUAGE=ro \
    DEGOOG_TIMEOUT_MS=15000
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
COPY --from=build /app/dist ./dist
EXPOSE 8765
CMD ["node", "dist/index.js", "--transport", "http", "--host", "0.0.0.0", "--port", "8765"]
