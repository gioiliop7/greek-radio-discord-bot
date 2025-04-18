FROM node:22

WORKDIR /app


RUN apt-get update && apt-get install -y ffmpeg --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

# Copy app code
COPY . .

# Expose nothing - it’s a bot
CMD ["node", "index.js"]
