# Newsweb Aksjelive News Service

News service that turns company notices from Newsweb into short news stories
designed for publication in E24s Aksjelive service.

## Hva denne tjenesten gjor
- Poller `newsreader/list` hvert 20. sekund.
- Henter detaljer for nye selskapsmeldinger via `newsreader/message`.
- Lagrer radata i PostgreSQL.
- Genererer korte Bokmal-nyhetssaker tilpasset E24s Aksjelive-format.
- Validerer output:
  - Gyldig schema
  - Ingen nye tall som ikke finnes i kilden
  - Krav om source limitation ved vedlegg eller tynn kildetekst
  - `lead + paragraphs` maks 5 setninger
  - `company_sentence` noyaktig 1 setning
- Auto-publiserer kun ved gyldig rewrite.
- Retry opptil 3 forsok. Ingen fallback-publisering ved vedvarende feil.

## Monorepo
```text
apps/
  api/      Fastify API (auth, feed, notice, meta, admin, health)
  worker/   BullMQ-pipeline (poll, ingest, rewrite, publish)
  web/      Next.js frontend
packages/
  shared/   typer, schema, DB-klient, queue/cache-konstanter
  prompt-kit/ promptpolicy og tallvalidering
prisma/
  schema.prisma
infra/
  docker-compose.yml
  nginx.conf
```

## Krav
- Node 22+
- npm 11+
- PostgreSQL 16+
- Redis 7+

## Miljo
Kopier `.env.example` til `.env` og fyll inn:
- `MODEL_PROVIDER` (`openai` eller `anthropic`)
- provider-key:
  - `OPENAI_API_KEY` hvis `MODEL_PROVIDER=openai`
  - `ANTHROPIC_API_KEY` hvis `MODEL_PROVIDER=anthropic`
- `SESSION_SECRET`
- `ADMIN_API_KEY`
- SMTP-verdier for faktisk e-postutsending (ellers logges magic-link i API-logg)

Hvis valgt provider-key mangler, stopper worker ved oppstart med tydelig feil
(`OPENAI_KEY_MISSING` eller `ANTHROPIC_KEY_MISSING`).

## Lokal oppstart (uten Docker)
1. Installer avhengigheter:
```bash
npm install
```
2. Start Postgres/Redis lokalt.
3. Generer Prisma-klient og migrer:
```bash
npm run prisma:generate
npm run prisma:migrate:dev
```
4. Legg til invitert bruker:
```bash
npm run invite:add -w apps/api -- user@example.com
```
5. Start alle tjenester:
```bash
npm run dev
```
6. Aapne `http://localhost:3000/feed`.

## Docker oppstart
Fra `infra/`:
```bash
docker compose up --build
```

Frontend tilgjengelig via `http://localhost:8080`.

## Render deploy
Repoet har en Render Blueprint i `render.yaml` som oppretter:
- `newsweb-explain-web` (Next.js frontend)
- `newsweb-explain-api` (Fastify API)
- `newsweb-explain-worker` (polling/rewrite worker)
- `newsweb-explain-db` (Postgres)
- `newsweb-explain-redis` (Render Key Value / Redis-kompatibel ko)

Oppsett:
1. Push repoet til GitHub.
2. I Render: New -> Blueprint, velg repoet og bruk `render.yaml`.
3. Fyll inn hemmelige variabler Render ber om:
```text
ANTHROPIC_API_KEY
MAGIC_LINK_BASE_URL=https://<web-service-url>/login
SMTP_HOST / SMTP_USER / SMTP_PASS hvis magic links skal sendes som e-post
```
4. API-tjenesten kjører `prisma migrate deploy` som pre-deploy command.

Etter forste deploy kan inviterte brukere legges til fra API-service shell:
```bash
npm run invite:add -w apps/api -- user@example.com
```

## API-endepunkter
- `POST /auth/request-magic-link`
- `POST /auth/verify-magic-link`
- `GET /feed`
- `GET /notice/:messageId`
- `GET /meta/filters`
- `POST /admin/reprocess/:messageId` (krever `x-admin-key`)
- `GET /health`

## Promptpolicy (v2.0.0)
- E24-lignende korte nyhetsbulletiner pa Bokmal.
- Kun eksplisitte kildefakta fra full originaltekst + metadata.
- Ingen spekulasjon.
- Manglende data = `ikke oppgitt`.
- Fast strukturert JSON-output.
- Klart skille mellom `negative_or_surprising` og `excluded_hype`.

## Rewrite runbook
For a verifisere at en publisert notis er ekte AI-omskriving:
1. Sjekk raden i `rewrites` for meldingen.
2. Bekreft `status = published`.
3. Bekreft i `validation_json`:
   - `valid = true`
   - `sourceBodyChars > 0`
   - `promptChars > 0`
