FROM node:20

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .

# Ensure data directory exists for SQLite
RUN mkdir -p /app/data

CMD ["npm", "start"]