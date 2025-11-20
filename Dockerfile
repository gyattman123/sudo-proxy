FROM node:18-slim

RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    fonts-noto fonts-noto-color-emoji fonts-noto-cjk \
    libx11-xcb1 libxcomposite1 libxrandr2 libxdamage1 libxfixes3 \
    libxext6 libnss3 libxss1 libgtk-3-0 libasound2 libatk1.0-0 \
    libdrm2 libgbm1 libgbm-dev \
    --no-install-recommends

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
