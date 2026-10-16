# Deployment

One image (`Dockerfile`) runs the Next.js app and the WhatsApp bot side by side
(`scripts/start.mjs`) on port 3500. `docker-compose.yml` adds Postgres. As in park.fan's
API, the data lives on the host, not in Docker volumes:

| Host path                 | Holds                                 |
| ------------------------- | ------------------------------------- |
| `/data/freitach/postgres` | the database                          |
| `/data/freitach/whatsapp` | the bot's WhatsApp login (`AUTH_DIR`) |

Both survive redeploys and deleting the resource in Coolify. The container starts as root
only to hand `/data/whatsapp` to the `node` user (`docker-entrypoint.sh`), then drops to it.

## Coolify

1. New Resource → this repository → build pack **Docker Compose** (`docker-compose.yml`).
2. Environment Variables (all three are required, Coolify blocks the deploy without them):
   - `ADMIN_NAME`, `ADMIN_PHONE`: on an empty database they create you as admin and default
     host; the login link appears in the app's log.
   - `DB_PASSWORD`: the database password, letters and digits only (it goes into a URL). Set
     it once: Postgres keeps the password it was initialised with, so changing it later
     locks the app out.

   `APP_URL` defaults to `https://freitach.arns.dev`, the default restaurant to Pizzeria
   Rustica.

3. Domains: enter `https://freitach.arns.dev:3500` for the `app` service. The `:3500` only
   tells Coolify's proxy which container port to use; the site is served on 443. The app is
   also published on the server's port 3500, and the way in from Cloudflare uses it, so it
   must not be bound to `127.0.0.1` only (that answers every request with a 502).
4. Deploy. The app migrates the database on start; `GET /api/health` answers once it is up.
5. Open the login link from the log, press "Anmelden", then link WhatsApp on the people page
   (Leute). Until an admin has logged in, every start prints a fresh link, so a restart
   brings back a lost one. Logging in with a phone number works once the bot is linked.

## Without Compose

The `Dockerfile` also runs on its own: give it `DATABASE_URL` (Postgres), `APP_URL`, a mount
at `/data/whatsapp` and the variables from `.env.example`. It listens on `PORT` (default
3500). The bot's own port (`BOT_PORT`, default 3001) is only used inside the container.

## Login

Members log in with their phone number and a six-digit code the bot sends. A code works once,
for ten minutes and five guesses; each number gets at most five codes an hour and the whole
group 30, since every code is a WhatsApp message and a flood of them gets the bot's number
blocked. A number that is not registered gets the same answer as a registered one, and no
message goes out.

A personal login link (from Leute, or from the log on first start) works once: it opens a
page with an "Anmelden" button, and only pressing it uses the link up, so a chat app's link
preview cannot spend it.

## Domain

`arns.dev` uses Cloudflare as DNS. Point `freitach.arns.dev` at the server (A/AAAA record)
and let Coolify route it to the app. `APP_URL` must match it: login links, the iCal feed and
the WhatsApp messages are built from it, and session cookies are only marked secure when it
starts with https.

## Linking WhatsApp

The bot is a linked device on a WhatsApp account, ideally a separate prepaid number. This is
not Meta's official API: it is free and works in groups, but WhatsApp can block numbers it
considers automated, so keep the volume to what the group needs.

Open the people page (Leute) as admin: it shows whether the bot is connected and, if not, a
QR code to scan in WhatsApp → Linked devices. With `PAIRING_PHONE` set to the bot's number
(`491701234567`; a German `0170 1234567` works too) it shows a pairing code instead, for
WhatsApp → Linked devices → Link with phone number, entered on the phone with that number.
WhatsApp Business works the same way. WhatsApp drops an unlinked connection after about two
and a half minutes, and its code with it; while the page is open it fetches a fresh one by
itself, and the bot does not ask for one while nobody is looking. Once connected, the bot
writes the groups it is in, with their ids, to the container log (not to the page, so other
admins don't see them); put one id into `WHATSAPP_GROUP` for announcements there.

To move the bot to another number, use "Andere Nummer verknüpfen" on the same card: it logs
the current phone out, deletes the stored login and shows a new QR code, or a pairing code
if you enter the new number. The login in `/data/whatsapp` is replaced, nothing else changes.

The bot can run on someone's own number. It only answers registered members, and only their
commands (`1`, `2`, `3`, `wie immer`, `gleiches`, `später`, `pünktlich`, `andere`, `bezahlt`,
`status`, `code`, `hilfe`); every other chat on the number is left alone, and messages from
unknown numbers are ignored.

`WHATSAPP=off` runs the app without the bot; every message is then only written to the log.

## Lieferando menus

Lieferando blocks server-side requests, so menus come in through the browser: the bookmarklet
on a restaurant's page reads the open Lieferando menu and hands it to the import preview, and
plain copy and paste works too. Members can add a missing dish with its price on any Friday.

## Backups

Everything worth keeping is in Postgres, e.g.
`docker exec <db container> pg_dump -U freitach freitach > freitach.sql`, or a copy of
`/data/freitach/postgres` while the stack is stopped. The WhatsApp login in
`/data/freitach/whatsapp` can be recreated by linking again.
