#!/bin/sh
set -eu
key=$(printf '%s' "${GOOGLE_MAPS_API_KEY:-}" | tr -d '"\\')
printf '{"mapsKey":"%s"}\n' "$key" > /usr/share/nginx/html/config.json
exec /docker-entrypoint.sh nginx -g 'daemon off;'
