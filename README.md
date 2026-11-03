# Hayate

Bulk email (and soon WhatsApp) for small businesses: campaigns, date-based
automations, contacts, and deliverability safety built in. Multi-tenant from day one.
(“Hayate” is the working name; the brand lives in `web/src/lib/brand.ts`.)

## Structure

```
b2b/
├── docker-compose.yml      Postgres + Redis for local development
├── web/                    Dashboard (React 19, Vite, Tailwind v4, Radix)
│   └── src/
│       ├── components/     UI kit (ui/), email preview + visual editor, contacts, campaigns
│       ├── pages/          Overview, Campaigns, Composer, Report, Automations, Contacts, Templates, Settings
│       └── lib/            API client, session, formatting, types
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
| Email | Amazon SES (ap-south-1), or the company’s own Gmail | Cheapest reliable sending, scales to SaaS |
| Dashboard | React 19 + Vite + Tailwind v4 + Radix | Accessible primitives, small and fast |

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

Then the dashboard, in a third terminal:

```bash
cd web
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :4000)
```

Want realistic data to click around or show a client? `cd server && npm run seed:demo`
creates a demo company (sign in as `demo@hayate.test` / `demo-password-123`).
Add `-- --reset` to recreate it. It refuses to run in production.

Check it is alive: `curl http://localhost:4000/health`

```json
{ "status": "ok", "database": "up", "redis": "up" }
```

## Production

The API server also serves the built dashboard, so the whole product is one
origin (simple cookies, strict CSP, no CORS):

```bash
cd web && npm ci && npm run build          # → web/dist
cd ../server && npm ci && npm run build
npm run db:migrate
npm start                                   # API + dashboard on PORT
npm run start:worker                        # sending, scheduling, automations
```

The server looks for the dashboard in `../web/dist`; set `WEB_DIST` to point
elsewhere. Restart the server after each dashboard build (asset names change).

## Plans, free trial and WhatsApp

Every new company starts on a **free trial**: 5 days, 200 emails, and up to 100 WhatsApp
messages a day (`TRIAL_DAYS`, `TRIAL_EMAILS`, `TRIAL_WHATSAPP_PER_DAY`). A WhatsApp campaign
bigger than a day's allowance continues the next day; one that couldn't finish before the
trial ends is refused up front. When it ends, sending
stops on its own: WhatsApp is unlinked and its keys deleted, scheduled campaigns are
cancelled, automations paused, and the company sees "Your free trial has ended".
Their data stays. A reminder goes out the day before.

Until online payments exist, the operator changes plans from the server:

```bash
cd server
npm run plan -- <company slug or owner email>                 # show
npm run plan -- <company slug or owner email> paid [emails]   # upgrade (default 5,000 emails a month)
npm run plan -- <company slug or owner email> trial <days>    # extend or restart a trial
```

**WhatsApp during the trial** links the company's own number the way WhatsApp Web does
(Settings → WhatsApp → Link WhatsApp, then scan the QR code from the phone). **This is
unofficial**: WhatsApp can block numbers that send in bulk this way. It is available only
during an active trial, each number can be used for one trial, and sending is paced
(one message every 10 seconds by default). Only contacts who agreed to WhatsApp get
messages; replying STOP unsubscribes them. The **worker** holds the connection, so it
must be running. Paid companies will use the official WhatsApp Business route
(planned: Meta Cloud API through a Solution Partner such as Gupshup).

For testing, `npm run feature -- whatsapp-web <company> on` turns WhatsApp Web on for a
company outside a trial.

## API

All `/api` routes use a session cookie set at sign-in. Writes must be JSON.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/signup` | Create a company account and its owner |
| POST | `/api/auth/login` · `/api/auth/logout` | Sign in / out (rate limited) |
| GET | `/api/auth/me` | Current user and company |
| GET · POST | `/api/domains` | List / connect a sending domain (returns DNS records to add) |
| POST | `/api/domains/:id/check` | Re-check DNS and SES status now |
| DELETE | `/api/domains/:id` | Disconnect a domain |
| GET · POST | `/api/senders` | List / create "from" addresses on a verified domain |
| PATCH · DELETE | `/api/senders/:id` | Edit / remove a sender |
| GET | `/api/integrations/gmail/connect` | Start "Connect Gmail" (redirects to Google) |
| GET | `/api/integrations/gmail/callback` | Google returns here; creates the Gmail sender |
| GET · DELETE | `/api/mailboxes` · `/api/mailboxes/:id` | Connected mailboxes / disconnect (revokes at Google) |
| GET · POST · PATCH · DELETE | `/api/contacts` · `/api/contacts/:id` | Contacts (search, status, list filters, pages) |
| GET | `/api/contacts/stats` | Counts for the status tabs |
| GET · POST · DELETE | `/api/fields` | Custom fields (text, number, date, yes/no) |
| GET · POST · PATCH · DELETE | `/api/lists` · `/api/lists/:id/members` | Lists and membership |
| POST | `/api/imports/preview` · `/api/imports` | CSV import: preview mapping, then import |
| GET · POST · PATCH · DELETE | `/api/campaigns` · `/api/campaigns/:id` | Campaign drafts |
| POST | `/api/campaigns/:id/preview` · `/test` · `/schedule` · `/send` · `/cancel` | Preview + checks, test email, schedule, send, cancel |
| GET | `/api/campaigns/:id/report` | Rates, top links, bounces |
| POST | `/api/audience/count` | Live "N contacts match" |
| GET · POST · PATCH · DELETE | `/api/templates` · `/api/templates/starters` | Templates and ready-made designs |
| GET · POST · PATCH · DELETE | `/api/automations` · `/activate` · `/pause` · `/upcoming` | Date-based automations |
| GET | `/api/overview` | Everything the dashboard home shows |
| GET · POST | `/api/notifications` · `/api/notifications/read` | Alerts for the company |
| GET · POST | `/u/:token` | Unsubscribe page and Gmail one-click unsubscribe |
| POST | `/webhooks/ses` | SES events via SNS (signature-verified) |

### How a company connects its own domain

1. `POST /api/domains { "domain": "abcholidays.com" }` → returns 7 DNS records.
2. The company adds them at its DNS provider: an ownership TXT (proves *this* account owns the
   domain), 3 DKIM CNAMEs, MX + SPF for `mail.abcholidays.com`, and an optional DMARC TXT.
3. The worker re-checks every 5 minutes for 7 days (or the user clicks "Check now").
4. Once verified, the company creates a sender like `offers@abcholidays.com`. Its customers
   only ever see the company's own name and address.

### Two ways to send

| | Own domain (SES) | Connected Gmail |
|---|---|---|
| Sender shown | `offers@company.com` | the company's Gmail address |
| Setup | add DNS records once | "Sign in with Google" |
| Volume | thousands, scales | ~400/day (Gmail) · ~1,500/day (Workspace) |
| Bounce / open tracking | yes (SES events) | no — Gmail doesn't report them |

Gmail access is **send-only** (`gmail.send`) — the app can never read anyone's inbox.
Tokens are encrypted at rest (AES-256-GCM). When a mailbox hits its daily limit, the
remaining emails wait in the queue and go out as the 24-hour window frees up.

## Tests

```bash
cd server && npm test     # needs Postgres + Redis (docker compose up -d)
```
