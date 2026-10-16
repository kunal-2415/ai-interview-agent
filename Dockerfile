FROM node:20-alpine

WORKDIR /app

# Install dependencies first for Docker caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Ensure data directory exists
RUN mkdir -p data/recordings

EXPOSE 8787

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

CMD ["npm", "start"]
