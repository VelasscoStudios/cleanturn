#!/usr/bin/env bash
#
# ONE-TIME droplet setup for CleanTurn. Run as root ON THE DROPLET, once,
# before the first deploy:
#
#   scp deploy/bootstrap.sh root@<droplet>:/tmp/ && ssh root@<droplet> 'bash /tmp/bootstrap.sh'
#
# Idempotent: safe to re-run. Installs Node, nginx, the runtime user, the
# directory layout, the systemd unit, the reverse proxy, the firewall, and a
# generated shared/.env (with a random admin password printed once).
#
set -euo pipefail

APP=/opt/cleanturn
RUN_USER=cleanturn
NODE_MAJOR=20
IP="$(curl -fsS ifconfig.me 2>/dev/null || echo YOUR_SERVER_IP)"

echo "==> Packages: Node.js ${NODE_MAJOR}, nginx, rsync"
apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v${NODE_MAJOR}\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx

echo "==> Runtime user + directory layout"
id -u "$RUN_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$RUN_USER"
install -d -o "$RUN_USER" -g "$RUN_USER" "$APP" "$APP/releases" "$APP/shared" "$APP/shared/data"

echo "==> shared/.env (generated once; never overwritten)"
if [ ! -f "$APP/shared/.env" ]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  CRON_SECRET="$(openssl rand -hex 32)"
  ADMIN_PW="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
  cat > "$APP/shared/.env" <<EOF
NODE_ENV=production
DATABASE_URL=file:$APP/shared/data/prod.db
SESSION_SECRET=$SESSION_SECRET
CRON_SECRET=$CRON_SECRET
APP_URL=http://$IP
APP_TIMEZONE=America/Edmonton
ADMIN_EMAIL=admin@cleanturn.local
ADMIN_INITIAL_PASSWORD=$ADMIN_PW
NOTIFICATIONS_ENABLED=false
EOF
  chown "$RUN_USER":"$RUN_USER" "$APP/shared/.env"
  chmod 600 "$APP/shared/.env"
  echo "    ****************************************************************"
  echo "    INITIAL ADMIN LOGIN (save now — shown only once):"
  echo "      email:    admin@cleanturn.local"
  echo "      password: $ADMIN_PW"
  echo "    ****************************************************************"
else
  echo "    exists — leaving it (and your data) untouched"
fi

echo "==> systemd unit"
cat > /etc/systemd/system/cleanturn.service <<'EOF'
[Unit]
Description=CleanTurn (Next.js) production server
After=network.target
[Service]
Type=simple
User=cleanturn
Group=cleanturn
WorkingDirectory=/opt/cleanturn/current
EnvironmentFile=/opt/cleanturn/shared/.env
ExecStart=/opt/cleanturn/current/node_modules/.bin/next start -p 3100 -H 127.0.0.1
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/cleanturn/shared/data
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cleanturn

echo "==> nginx reverse proxy (:80 -> :3100)"
cat > /etc/nginx/sites-available/cleanturn <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
ln -sfn /etc/nginx/sites-available/cleanturn /etc/nginx/sites-enabled/cleanturn
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall (SSH + HTTP)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp   >/dev/null 2>&1 || true
  yes | ufw enable    >/dev/null 2>&1 || true
fi

echo
echo "==> Bootstrap complete."
echo "    NEXT: authorize the CI deploy key so GitHub Actions can log in — put"
echo "    your github-actions-deploy PUBLIC key in /root/.ssh/authorized_keys:"
echo "      echo 'ssh-ed25519 AAAA...github-actions-deploy' >> /root/.ssh/authorized_keys"
echo "    Then push to main (or run the Deploy workflow) to ship the first release."
