FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production

COPY . .

ENV APP_VERSION=1.2.1
ENV FOUNDER_ADMIN_EMAIL=aram_grigoryan96@bk.ru
ENV FOUNDER_ADMIN_FULL_NAME=Арам Григорян

EXPOSE 3000

CMD ["node", "server.js"]
