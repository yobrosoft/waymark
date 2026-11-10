#!/bin/sh
set -eu
key=$(printf '%s' "${GOOGLE_MAPS_API_KEY:-}" | tr -d '"\\')
gid=$(printf '%s' "${GOOGLE_CLIENT_ID:-}" | tr -d '"\\')
printf '{"mapsKey":"%s","googleClientId":"%s"}\n' "$key" "$gid" > /usr/share/nginx/html/config.json
exec /docker-entrypoint.sh nginx -g 'daemon off;'
