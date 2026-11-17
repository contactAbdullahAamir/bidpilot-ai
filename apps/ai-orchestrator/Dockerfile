FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/ai-orchestrator/package.json apps/ai-orchestrator/package.json
RUN npm ci --workspace @bidpilot/ai-orchestrator --workspace @bidpilot/contracts --include-workspace-root
COPY packages/contracts packages/contracts
COPY apps/ai-orchestrator apps/ai-orchestrator
RUN npm run build --workspace @bidpilot/contracts && npm run build --workspace @bidpilot/ai-orchestrator

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8000
CMD ["node", "apps/ai-orchestrator/dist/src/main.js"]
