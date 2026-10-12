#!/bin/sh
set -e

# A bind-mounted /data/whatsapp arrives owned by root; the app and the bot run as node.
# The WhatsApp login in it is as good as the phone, so nobody else on the host may read it.
mkdir -p "${AUTH_DIR:-/data/whatsapp}"
chown -R node:node "${AUTH_DIR:-/data/whatsapp}" 2>/dev/null || true
chmod -R go-rwx "${AUTH_DIR:-/data/whatsapp}" 2>/dev/null || true
umask 077

exec su-exec node "$@"
