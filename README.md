# Invoicing App

A self-hosted invoicing system for small businesses. Manage clients, products/services,
invoices (with line items, statuses, and payments), expenses, and see revenue/expense
reports — all from one small Node.js app with no external database server required.

## Features

- **Multi-user** with two roles: admin (full access + settings/team management) and staff
- **Clients** — contact info, tax ID, notes, full invoice history per client
- **Products & Services** — reusable catalog with default price/tax rate
- **Invoices** — line items, statuses (draft/sent/paid/overdue/cancelled), partial or full
  payment tracking, printable/PDF-able view (use your browser's Print → Save as PDF)
- **Expenses** — categorized expense tracking
- **Reports** — monthly revenue vs. expenses, outstanding balances, expenses by category,
  net profit
- **Billing** — recurring payment, cancel subscription, upgrade subscription plan
- **Company settings** — business name/address shown on invoices, invoice number prefix,
  default tax rate, currency symbol

## Tech stack

- Node.js + Express
- SQLite (via Node's built-in `node:sqlite` module) — a single file database, no
  separate DB server and no native modules to compile on install
- Server-rendered pages (EJS) — no separate frontend build step
- Session-based login (`express-session` with a small custom `node:sqlite`-backed
  store in `db/session-store.js`)

This keeps the whole app to one process and one data file, which is easy to back up
(just copy the `data/` folder) and easy to deploy on a small VPS.

## Requirements

- Node.js 22.5 or newer (needed for the built-in `node:sqlite` module; no separate
  database install, and no C++ build tools needed since there's nothing to compile)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the example environment file and edit it
cp .env.example .env
# Open .env and set SESSION_SECRET to a long random string, e.g.:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Create your first admin user (interactive prompt)
npm run seed

# 4. Start the app
npm start
```

The app will be available at `http://localhost:3000` (or whatever `PORT` you set in `.env`).

The database file is created automatically at `data/invoicing.db` the first time you run
the app or the seed script.

## Adding team members

Log in as an admin and go to **Settings** → **Add a team member**. You can create both
`staff` and `admin` accounts from there — you don't need to run the seed script again
except for the very first user.

## Deploying on your own server

A simple, solid approach for a small business:

1. Copy this project to your server (e.g. via `git clone` or `scp`).
2. `npm install --omit=dev` (or plain `npm install`)
3. Set up `.env` with a real `SESSION_SECRET`.
4. Run the app with a process manager so it restarts automatically, for example
   [pm2](https://pm2.keymetrics.io/):
   ```bash
   npm install -g pm2
   pm2 start server.js --name invoicing
   pm2 save
   pm2 startup   # follow the printed instructions to start pm2 on boot
   ```
5. Put a reverse proxy (nginx or Caddy) in front of it for HTTPS. If you do this, set
   `TRUST_PROXY=true` in `.env` so secure cookies work correctly.

   Example Caddy config (automatic HTTPS):
   ```
   invoices.yourcompany.com {
     reverse_proxy localhost:3000
   }
   ```

## Backing up your data

Everything is in the `data/` folder:
- `data/invoicing.db` — all your business data
- `data/sessions.db` — active login sessions (safe to lose; people just log in again)

Back up `data/invoicing.db` regularly (a nightly `cp` to another disk or cloud storage
is enough for most small businesses). Because it's a single SQLite file, restoring is as
simple as copying it back.

## Project structure

```
server.js            App entry point
db/
  schema.sql          Database schema
  index.js            Opens the DB connection, runs the schema
  seed.js             Interactive script to create the first admin user
middleware/
  auth.js             Login/role-based access control
routes/               One file per feature area (clients, products, invoices, expenses,
                       reports, dashboard/settings, auth)
views/                EJS templates (server-rendered HTML)
public/css/           Stylesheet
data/                 SQLite database files (created at runtime, not in version control)
```

## Notes & limitations

- This is intentionally simple: no email sending built in (you can print/save invoices
  as PDF and send them yourself, or extend the app with a mail library like `nodemailer`
  if you want automated sending later).
- Single currency at a time (set in Settings). Multi-currency isn't supported.
- Designed for a small team (a handful of users) rather than large-scale multi-tenant use.
