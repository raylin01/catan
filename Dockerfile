FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY client/package*.json ./client/
RUN npm ci --ignore-scripts --prefix client
COPY client ./client
RUN npm run build --prefix client

FROM node:22-bookworm-slim
WORKDIR /app
COPY server/package*.json ./server/
RUN npm ci --ignore-scripts --omit=dev --prefix server
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
ENV HOST=0.0.0.0 PORT=3001 CATAN_DATA_DIR=/app/data
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
