#!/bin/sh
set -e

# A bind-mounted /data/whatsapp arrives owned by root; the app and the bot run as node.
mkdir -p "${AUTH_DIR:-/data/whatsapp}"
chown -R node:node "${AUTH_DIR:-/data/whatsapp}" 2>/dev/null || true

exec su-exec node "$@"
