FROM node:20

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .

RUN mkdir -p /app/data

CMD ["npm", "start"]