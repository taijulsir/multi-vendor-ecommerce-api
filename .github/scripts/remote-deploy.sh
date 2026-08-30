#!/usr/bin/env bash
# Runs ON THE VPS, via `ssh ... bash -s < this-file` from
# .github/workflows/cd.yml's "Deploy over SSH" step. Kept as its own
# file (not an inline heredoc in the workflow YAML) specifically so it's
# a real, shellcheck-able, independently-testable script rather than a
# heredoc whose closing delimiter fights YAML's block-scalar indentation
# rules -- see this script's own git history for why that was a real
# problem, not a style preference.
#
# Expects IMAGE_TAG already exported in this shell's environment (the
# workflow does that via `ssh ... "IMAGE_TAG='$IMAGE_TAG' bash -s"`).
set -euo pipefail

cd /srv/multi-vendor-ecommerce-api

if [ -z "${IMAGE_TAG:-}" ]; then
  echo "::error::IMAGE_TAG not set in the remote shell environment"
  exit 1
fi

# The exact, already-verified (manually run, exit 0) backup unit --
# root-managed, systemd oneshot, pairs with the existing daily timer.
# `systemctl start` on a oneshot unit blocks until the script exits, so
# `set -euo pipefail` above genuinely waits for (and aborts on failure
# of) the backup before anything below touches the database.
echo "==> 1/6 Backing up the database (pre-migration, pre-rollout)"
sudo systemctl start multi-vendor-ecommerce-db-backup.service

echo "==> 2/6 Pulling $IMAGE_TAG"
docker compose --env-file .env.production -f docker-compose.prod.yml pull app

echo "==> 3/6 Applying database migrations (prisma migrate deploy)"
# `docker compose run` deliberately does not publish the service's
# normal ports unless --service-ports is passed, so this throwaway
# container never conflicts with the still-running previous `app`
# container's bind on 127.0.0.1:3010.
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app \
  npx prisma migrate deploy

echo "==> 4/6 Rolling out the new app container"
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait app

echo "==> 5/6 Container-level health check (direct, bypassing Nginx/DNS/TLS)"
for i in $(seq 1 15); do
  if wget --spider -q http://127.0.0.1:3010/api/health; then
    echo "Container healthy."
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "::error::Container never became healthy"
    exit 1
  fi
  sleep 2
done

echo "==> 6/6 Deployed image:"
docker compose --env-file .env.production -f docker-compose.prod.yml images app
