FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

FROM base AS development-dependencies-env
COPY package.json pnpm-lock.yaml /app/
WORKDIR /app
RUN pnpm install --frozen-lockfile

FROM base AS production-dependencies-env
COPY package.json pnpm-lock.yaml /app/
WORKDIR /app
RUN pnpm install --frozen-lockfile --prod

FROM base AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN pnpm build

FROM base
COPY package.json pnpm-lock.yaml /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
COPY --from=build-env /app/instrument.server.mjs /app/instrument.server.mjs
WORKDIR /app
EXPOSE 3000
ENV NODE_ENV=production
CMD ["pnpm", "start"]
