FROM node:20-bookworm-slim
# build tools so better-sqlite3 compiles if no prebuilt binary is available
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV DB_PATH=/data/furlongbets.db
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "src/server.js"]
