# Public demo image (DEMO_MODE=1). No runtime dependencies: only the app files
# are copied, nothing is installed, and the server runs as the unprivileged
# "node" user on a read-only app folder. Data lives in memory only.
FROM node:22-alpine
ENV NODE_ENV=production DEMO_MODE=1 HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --chown=root:root package.json server.mjs ./
COPY --chown=root:root server ./server
COPY --chown=root:root public ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "server.mjs"]
