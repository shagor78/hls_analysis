FROM node:22-slim

WORKDIR /app

# Install system dependencies for optional Python & SQLite CLI utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    sqlite3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY . .

# Create persistent directories for data, backups, exports, and logs
RUN mkdir -p /app/data /app/backups /app/exports /app/logs

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]
