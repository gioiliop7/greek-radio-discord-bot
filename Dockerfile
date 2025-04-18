FROM node:18-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Optional: install curl/wget for debugging
RUN apt-get update && apt-get install -y curl

# Copy app code
COPY . .

# Expose nothing - it’s a bot
CMD ["node", "index.js"]