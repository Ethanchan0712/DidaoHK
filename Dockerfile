# 基礎 Node image
FROM node:20-alpine

WORKDIR /app

# 限制 node 記憶體，預防 512MB OOM
ENV NODE_OPTIONS=--max-old-space-size=400

COPY package.json package-lock.json ./

# ✅ v2.0.84 重點：改用 npm install，唔再用 npm ci
RUN npm install --omit-dev

COPY . .

# 啟動後端
CMD ["node", "server.js"]
