FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
RUN npx playwright install --with-deps chromium
ENV NODE_ENV=production HOST=0.0.0.0 APP_ORIGIN=http://127.0.0.1:3001
EXPOSE 3001
CMD ["npm", "run", "api"]
