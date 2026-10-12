# Deployment

One image (`Dockerfile`) runs the Next.js app and the WhatsApp bot side by side
(`scripts/start.mjs`). It needs a Postgres database and a volume for `/data`, where the bot
keeps its WhatsApp login. On Coolify that is an application built from this repository's
Dockerfile plus a Postgres resource; any other Docker host works the same way.

## First start

1. Create a Postgres database and put its URL into `DATABASE_URL`.
2. Set the variables from `.env.example`. On an empty database:
   - `ADMIN_NAME` and `ADMIN_PHONE` create you as admin and default host, and the app prints
     a login link to its log.
   - `DEFAULT_RESTAURANT_NAME` and `DEFAULT_RESTAURANT_URL` add the usual restaurant and make
     it the default host's. Its fees and menu are entered afterwards on its page.
3. Mount a volume at `/data`.
4. Deploy. The app migrates the database on start; `GET /api/health` answers once it is up.
5. Open the login link from the log, or log in with your phone number once the bot is linked.

## Port

The app listens on `PORT` (default 3000); set it in the environment or at build time
(`--build-arg PORT=3500`) when 3000 is taken. The bot's own port (`BOT_PORT`, default 3001)
is only used inside the container and does not need to be published.

## Domain

`arns.dev` uses Cloudflare as DNS. Point `freitach.arns.dev` at the server and let Coolify
(or your reverse proxy) route it to the app's port. Set `APP_URL=https://freitach.arns.dev`:
login links, the iCal feed and the WhatsApp messages are built from it, and session cookies
are only marked secure when it starts with https.

## Linking WhatsApp

The bot is a linked device on a WhatsApp account, ideally a separate prepaid number. This is
not Meta's official API: it is free and works in groups, but WhatsApp can block numbers it
considers automated, so keep the volume to what the group needs.

Open the people page (Leute) as admin: it shows whether the bot is connected and, if not, a
QR code to scan in WhatsApp → Linked devices. With `PAIRING_PHONE` set to the bot's number
(digits with country code) it shows a pairing code instead, for WhatsApp → Linked devices →
Link with phone number. The same card lists the bot's groups; put a group's id into
`WHATSAPP_GROUP` for announcements there.

`WHATSAPP=off` runs the app without the bot; every message is then only written to the log.

## Lieferando menus

Lieferando blocks server-side requests, so menus come in through the browser: the bookmarklet
on a restaurant's page reads the open Lieferando menu and hands it to the import preview, and
plain copy and paste works too. Members can add a missing dish with its price on any Friday.

## Backups

Everything worth keeping is in Postgres, e.g. `pg_dump` from the Coolify database resource.
The WhatsApp login in `/data` can be recreated by linking again.
