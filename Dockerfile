# Node 22 LTS - required for the built-in node:sqlite module this app uses.
FROM node:22-slim

WORKDIR /app

# Install dependencies first (better layer caching - only reinstalls when
# package.json/package-lock.json actually change).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the app.
COPY . .

# The SQLite database and session store live here - this is where the Fly
# volume gets mounted (see fly.toml), so data survives deploys/restarts.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
