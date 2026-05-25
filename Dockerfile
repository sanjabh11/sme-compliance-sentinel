FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/README.md ./README.md
COPY --from=builder /app/WINNING_STRATEGY.md ./WINNING_STRATEGY.md
COPY --from=builder /app/XPRIZE_CHECKLIST.md ./XPRIZE_CHECKLIST.md
COPY --from=builder /app/.env.example ./.env.example
COPY --from=builder /app/.gitignore ./.gitignore
COPY --from=builder /app/cloudrun.service.yaml ./cloudrun.service.yaml
COPY --from=builder /app/app ./app
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tests ./tests
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "run", "start"]
