# Boron: one image with the server, the web UI and Tesseract's Bangla and English models. Everything else lives in /data.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod
# Fetch Tesseract's Bangla and English models once, at build time.
RUN mkdir -p tessdata && node --input-type=module -e "import { createWorker } from 'tesseract.js'; const w = await createWorker(['ben', 'eng'], 1, { cachePath: '/app/tessdata' }); await w.terminate();"

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production BORON_DATA_DIR=/data BORON_TESSDATA=/app/tessdata PORT=3000
# Where mounted login folders are looked for; a folder that is not mounted is simply not detected.
ENV BORON_PI_AUTH=/logins/pi/auth.json BORON_CLAUDE_CREDENTIALS=/logins/claude/.credentials.json BORON_CODEX_AUTH=/logins/codex/auth.json
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
COPY --from=build /app/tessdata ./tessdata
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/main.ts"]
