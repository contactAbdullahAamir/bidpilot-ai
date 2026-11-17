FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace @bidpilot/api --workspace @bidpilot/contracts --include-workspace-root
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN npm run build --workspace @bidpilot/contracts && npm run build --workspace @bidpilot/api

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
CMD ["node", "apps/api/dist/src/main.js"]
