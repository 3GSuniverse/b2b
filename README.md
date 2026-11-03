# Sandesh

Bulk email (and soon WhatsApp) for small businesses — campaigns, date-based
automations, contacts, and deliverability safety built in. Multi-tenant from day one.

## Structure

```
b2b/
├── docker-compose.yml      Postgres + Redis for local development
└── server/                 API + background worker (Node, TypeScript)
    ├── drizzle/            Generated SQL migrations (committed, readable SQL)
    ├── drizzle.config.ts   Drizzle Kit config — reads DATABASE_URL from .env
    └── src/
        ├── config/env.ts   All settings, validated at startup
        ├── db/schema.ts    Database schema (tenants, contacts, campaigns, automations…)
        ├── lib/            Shared clients: database (Drizzle), Redis
        ├── queues/         BullMQ queue definitions
        ├── modules/        One folder per feature (routes + logic)
        ├── app.ts          Builds the Fastify app
        ├── server.ts       API entry point
        └── worker.ts       Sending worker entry point (separate process)
```

## Stack

| Part | Choice | Why |
|---|---|---|
| API | Fastify 5 + TypeScript | Fast, typed, low overhead |
| Database | PostgreSQL 16 + Drizzle ORM | Typed queries, plain-SQL migrations, no native binaries |
| Queue | Redis + BullMQ | Retries, rate limiting, scheduled jobs |
| Email | Amazon SES (ap-south-1) | Cheapest reliable sending, scales to SaaS |

The **API** and the **worker** are separate processes, so a large send never
slows the dashboard down.

## Run locally

Requirements: Node 22+, Docker.

```bash
# 1. Start Postgres and Redis
docker compose up -d

# 2. Install and configure
cd server
npm install
cp .env.example .env          # then fill in the AWS keys

# 3. Create the database tables
npm run db:migrate

# 4. Run the API and the worker (two terminals)
npm run dev
npm run dev:worker
```

Check it is alive: `curl http://localhost:4000/health`

```json
{ "status": "ok", "database": "up", "redis": "up" }
```
