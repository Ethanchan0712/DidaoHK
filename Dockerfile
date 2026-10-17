# 「的道」後端部署用 Dockerfile（Render 免費版）
# Node 22（同開發機一致）
# v2.0.83：better-sqlite3 ^13 有官方 prebuilt binary（Linux x86_64），
# npm ci 會自動下載，唔使喺 Render 512MB 細機入面用 C++ 編譯
# （之前 --build-from-source 喺 512MB 爆 OOM → build Failed；而家慳 RAM 又快）

FROM node:22-slim AS runtime
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 前端靜態檔（Vite build 產出）——冇咗佢網頁版會 404
COPY dist ./dist

COPY server ./server

ENV PORT=10000
EXPOSE 10000
CMD ["node", "server/index.cjs"]
