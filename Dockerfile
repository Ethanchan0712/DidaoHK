# 「的道」後端部署用 Dockerfile（Render 免費版）
# Node 22（同開發機一致）
# v2.0.86：better-sqlite3 v13 tarball 內置 prebuilds/linux-x64.node，
# npm ci 加 --ignore-scripts 直接跳過 node-gyp 編譯
# （node:22-slim 冇 Python，npm 見 binding.gyp 硬行 node-gyp rebuild 會失敗；
#  之前 --build-from-source 喺 512MB 亦會爆 OOM）

FROM node:22-slim AS runtime
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# 前端靜態檔（Vite build 產出）——冇咗佢網頁版會 404
COPY dist ./dist

COPY server ./server

ENV PORT=10000
EXPOSE 10000
CMD ["node", "server/index.cjs"]
