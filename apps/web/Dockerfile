FROM node:20-alpine AS build
WORKDIR /app
ARG API_URL=http://api:3001
ENV API_URL=$API_URL
COPY package*.json tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @bidpilot/web --workspace @bidpilot/contracts --include-workspace-root
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build --workspace @bidpilot/contracts && npm run build --workspace @bidpilot/web

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@bidpilot/web"]
