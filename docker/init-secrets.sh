#!/bin/sh
# Writes throwaway local secrets for docker/compose.yaml. Never use these values anywhere real.
set -eu
dir="$(dirname "$0")/secrets"
mkdir -p "$dir"
[ -f "$dir/db_password.txt" ] || head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$dir/db_password.txt"
pw="$(cat "$dir/db_password.txt")"
printf 'postgresql://toadsbank:%s@db:5432/toadsbank' "$pw" > "$dir/database_url.txt"
[ -f "$dir/service_token.txt" ] || head -c 32 /dev/urandom | base64 | tr -d '/+=' > "$dir/service_token.txt"
echo "secrets written to $dir"
