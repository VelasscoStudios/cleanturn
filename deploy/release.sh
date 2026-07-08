#!/usr/bin/env bash
#
# Activate a shipped release. Invoked over SSH by the deploy workflow with REL
# set to /opt/cleanturn/releases/<sha>. Runs as the SSH deploy user (root):
# migrates the DB, atomically swaps the `current` symlink, restarts the
# service, health-checks it, and rolls back if the new release is unhealthy.
#
set -euo pipefail

APP=/opt/cleanturn
REL="${REL:?REL not set}"
SERVICE=cleanturn
RUN_USER=cleanturn
HEALTH_URL="http://127.0.0.1:3100/api/health"
KEEP=5

echo "==> Activating $REL"

# Runtime .env and the persistent SQLite DB live in shared/, symlinked in so
# they survive across releases.
ln -sfn "$APP/shared/.env" "$REL/.env"

# App files are owned by the unprivileged runtime user.
chown -R "$RUN_USER":"$RUN_USER" "$REL"

# Keep the systemd unit in sync with the repo copy.
if ! cmp -s "$REL/deploy/cleanturn.service" /etc/systemd/system/cleanturn.service 2>/dev/null; then
  cp "$REL/deploy/cleanturn.service" /etc/systemd/system/cleanturn.service
  systemctl daemon-reload
  echo "    systemd unit updated"
fi

# Migrate + idempotent seed, as the runtime user so the DB file is owned by it.
# (The seed self-skips if an admin already exists.)
runuser -u "$RUN_USER" -- bash -eu -c '
  set -a; . "'"$APP"'/shared/.env"; set +a
  cd "'"$REL"'"
  ./node_modules/.bin/prisma migrate deploy
  ./node_modules/.bin/tsx prisma/seed.ts
'

# Atomic swap, remembering the previous target for rollback.
PREV=""
[ -L "$APP/current" ] && PREV="$(readlink -f "$APP/current" || true)"
ln -sfn "$REL" "$APP/current"

systemctl restart "$SERVICE"

# Health-check (the endpoint returns 200 only when the DB is reachable).
ok=0
for _ in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done

if [ "$ok" -ne 1 ]; then
  echo "!! Health check failed — rolling back"
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$APP/current"
    systemctl restart "$SERVICE"
  fi
  exit 1
fi

echo "==> Deploy OK: $(basename "$REL")"

# Retain only the most recent $KEEP releases.
ls -1dt "$APP"/releases/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
