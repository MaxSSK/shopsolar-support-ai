# Auto-Ingest Setup Guide

When a ticket is closed in Zoho Desk, a webhook fires to `/api/ingest`, which embeds the ticket and upserts it into the Supabase `tickets` table automatically.

---

## Step 1 — Run the Supabase migration

Open the Supabase SQL editor for this project:
https://supabase.com/dashboard/project/xjuztkkrmigyyzojyttw/sql

Paste and run the contents of `supabase/add-queue-column.sql`:

```sql
alter table tickets
  add column if not exists queue text;
```

This adds the nullable `queue` column. It is safe to run multiple times.

---

## Step 2 — Generate and set INGEST_SECRET

Generate a secure random secret:

```bash
openssl rand -hex 32
```

Copy the output. Then add it to Vercel:

1. Go to your Vercel project → **Settings → Environment Variables**
2. Add a new variable:
   - **Name:** `INGEST_SECRET`
   - **Value:** the string you generated
   - **Environment:** Production (and Preview if you want to test there)
3. Redeploy the app so the new variable takes effect.

Keep this value — you'll need it when configuring the Zoho webhook in the next step.

---

## Step 3 — Configure the Zoho Desk webhook

1. In Zoho Desk, go to **Settings → Developer Space → Webhooks**
2. Click **New Webhook**
3. Fill in:
   - **Webhook Name:** `Auto-ingest closed tickets`
   - **Trigger:** Ticket → Status changes to **Closed**
   - **URL:** `https://shopsolar-support-ai.vercel.app/api/ingest`
   - **Method:** POST
4. Under **Custom Headers**, add:
   - **Header name:** `x-ingest-secret`
   - **Value:** the secret you generated in Step 2
5. Save the webhook.

Zoho will POST the ticket payload to the endpoint every time a ticket is closed.

---

## Step 4 (optional) — Update match_tickets to return queue

Once you want to filter similar-ticket lookups by queue, run `supabase/match-tickets-update.sql` in the Supabase SQL editor. This replaces the existing `match_tickets` function with one that also returns the `queue` column.

---

## Verifying it works

1. Close a test ticket in Zoho Desk.
2. Open the Vercel dashboard → **Logs** for your project.
3. Look for log lines starting with `[ingest]`. You should see:
   - `Received webhook for ticket ID: <id>`
   - `Generating embedding for ticket: <id>`
   - `Successfully ingested ticket: <id> | queue: <queue>`
4. Confirm the row appears in the Supabase `tickets` table.

If the webhook fires but the endpoint returns 401, double-check that the `x-ingest-secret` header value in Zoho exactly matches `INGEST_SECRET` in Vercel — no extra spaces or quotes.

If the endpoint returns 500, check the Vercel log for the specific error message.
