# Gebruik Node.js 18 als basis
FROM node:18-alpine

# Installeer basis dependencies
RUN apk add --no-cache tini

# Stel werkdirectory in
WORKDIR /app

# Kopieer package files
COPY package*.json ./

# Installeer dependencies
RUN npm ci --only=production

# Kopieer TypeScript configuratie en source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript naar JavaScript
RUN npm install typescript@5.3.0 --no-save && \
    npx tsc && \
    npm uninstall typescript

# Verwijder source code (niet meer nodig na build)
RUN rm -rf src tsconfig.json

# Stel environment variables in
ENV NODE_ENV=production
ENV MCP_TRANSPORT=sse
ENV PORT=3000

# Expose poort voor SSE
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Gebruik tini als init systeem (voor proper signal handling)
ENTRYPOINT ["/sbin/tini", "--"]

# Start de MCP server in SSE mode
CMD ["node", "build/index.js"]