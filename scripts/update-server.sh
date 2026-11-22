#!/usr/bin/env bash
set -euo pipefail

cd /opt/terraquest
[[ -f .env ]] || { echo 'Missing /opt/terraquest/.env' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'The server image requires x86-64' >&2; exit 1; }

state=/var/lib/terra-updater
install -d -m 0700 "$state"
exec 9>"$state/lock"
flock -n 9 || exit 0

repository=applememestm-pixel/terraquest
asset=terra-server-linux-amd64.tar.gz
release=$(curl -fsS --max-time 20 "https://api.github.com/repos/$repository/releases/tags/server-latest")
digest=$(python3 -c '
import json, re, sys
assets = json.load(sys.stdin)["assets"]
for asset in assets:
    digest = asset.get("digest") or ""
    if asset["name"] == sys.argv[1] and asset["state"] == "uploaded" and re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        print(digest.removeprefix("sha256:"))
        break
else:
    sys.exit("No published server image with a SHA-256 digest")
' "$asset" <<< "$release")

image=terraquest:local
rollback=terraquest:auto-rollback
running=$(docker compose ps -q terra)
old=''
if [[ -n $running ]]; then
    old=$(docker inspect --format '{{.Image}}' "$running")
fi
if [[ -f $state/applied && $(<"$state/applied") == "$digest $old" ]]; then
    exit 0
fi
if [[ -f $state/rejected && $(<"$state/rejected") == "$digest $old" ]]; then
    exit 0
fi

work=$(mktemp -d "$state/download.XXXXXXXX")
trap 'rm -f -- "$work/$asset"; rmdir -- "$work"' EXIT
curl -fsSL --max-time 120 --max-filesize 60000000 -o "$work/$asset" \
    "https://github.com/$repository/releases/download/server-latest/$asset"
printf '%s  %s\n' "$digest" "$work/$asset" | sha256sum -c -

if [[ -n $old ]]; then
    docker image tag "$old" "$rollback"
fi
if docker image load -i "$work/$asset" && docker compose up -d --no-build --pull never --wait --wait-timeout 60; then
    applied=$(docker image inspect --format '{{.Id}}' "$image")
    printf '%s %s\n' "$digest" "$applied" > "$state/applied.new"
    mv -f -- "$state/applied.new" "$state/applied"
    if [[ -n $old ]]; then
        docker image rm "$rollback" || true
    fi
    echo "Terra updated to $applied"
else
    if [[ -n $old ]]; then
        docker image tag "$rollback" "$image"
        docker compose up -d --no-build --pull never --wait --wait-timeout 60
        printf '%s %s\n' "$digest" "$old" > "$state/rejected"
        docker image rm "$rollback" || true
    fi
    exit 1
fi
