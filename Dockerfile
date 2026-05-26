FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/uploads /app/uploads/documents

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
