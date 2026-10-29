FROM node:24-alpine
WORKDIR /app

COPY editor/package.json editor/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY editor/ ./
RUN chmod -R a+rX /app
ENV NODE_ENV=production
EXPOSE 8090
CMD ["node", "server.mjs"]
