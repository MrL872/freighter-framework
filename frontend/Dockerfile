FROM node:22-alpine3.23

ENV DIR=/app
WORKDIR $DIR
ENV NODE_ENV=production

RUN apk update && apk add --no-cache dumb-init=1.2.5-r3

COPY package*.json .
RUN npm ci --omit=dev

COPY server.js server.js
COPY public public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["dumb-init", "node", "server.js"]
