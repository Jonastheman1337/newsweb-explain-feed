FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/prompt-kit/package.json packages/prompt-kit/package.json

RUN npm install

COPY . .

RUN npm run prisma:generate \
  && npm run build -w packages/shared \
  && npm run build -w packages/prompt-kit \
  && npm run build -w apps/worker

CMD ["npm", "run", "start", "-w", "apps/worker"]

