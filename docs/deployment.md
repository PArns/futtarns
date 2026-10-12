# Deployment

The stack is three services (`docker-compose.yml`): `app`, `bot` and `db` (Postgres 17).
GitHub Actions builds `ghcr.io/parns/futtarns` and `ghcr.io/parns/futtarns-bot` for amd64
and arm64 on every push to `main` (`.github/workflows/docker.yml`).

## First start

1. Copy `.env.example` to `.env` next to `docker-compose.yml` and fill it in. Set
   `ADMIN_NAME` and `ADMIN_PHONE`: on an empty database the app creates you as admin and
   default host and prints a login link to its log.
2. Start it: `docker stack deploy -c docker-compose.yml freitach` (Swarm) or
   `docker compose up -d`. The app migrates the database on start.
3. Open the login link from `docker logs` of the app (Swarm: `docker service logs freitach_app`).

## Domain

`arns.dev` uses Cloudflare as DNS. Point `freitach.arns.dev` at the server (A/AAAA record,
proxied or not) and route it to the app's port 3000 through your reverse proxy. Set
`APP_URL=https://freitach.arns.dev`: login links, the iCal feed and the WhatsApp messages
are built from it, and session cookies are only marked secure when it starts with https.

## Pairing the WhatsApp bot

The bot is a linked device on a WhatsApp account, ideally a separate prepaid number. This is
not Meta's official API: it is free and works in groups, but WhatsApp can block numbers it
considers automated, so keep the volume to what the group needs.

- **QR code**: open `http://<bot>:3001/qr?token=<BOT_TOKEN>` (from inside the network, or
  publish the port temporarily) and scan it in WhatsApp → Linked devices.
- **Pairing code**: set `PAIRING_PHONE` to the bot's number (digits only, with country code);
  the code appears in the bot's log. Enter it in WhatsApp → Linked devices → Link with phone
  number.

The login is stored in the `bot-auth` volume. `GET /health` shows whether it is connected.
For announcements in a group chat, add the bot's number to the group, list groups with
`GET /groups?token=<BOT_TOKEN>` and set `WHATSAPP_GROUP` to the group's id.

## Backups

Everything worth keeping is in the `db-data` volume, e.g.
`docker exec <db> pg_dump -U freitach freitach > freitach.sql`.
