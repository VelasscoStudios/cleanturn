#!/usr/bin/env bash
#
# Server hardening for the CleanTurn droplet. Idempotent — safe to re-run.
# Run as root ON the droplet:  ssh cleanturn-droplet 'bash -s' < deploy/harden.sh
#
# Goal: no remote path in except a valid SSH key. Everything else — password
# login, brute force, unpatched CVEs, stray open ports, network tricks — is shut.
# The DigitalOcean web Console remains as a break-glass recovery path (we do NOT
# lock the root password, so you can always get back in through DO if needed).
#
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "must run as root"; exit 1; }

echo "==> 0/8 Swap (a 512MB droplet has no headroom for upgrades/builds — add it)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
  echo "    2G swap enabled"
else
  echo "    swap already present"
fi

echo "==> 1/8 SSH hardening (validated before it takes effect)"
# key-only root, fewer tries, shorter grace, no forwarding, drop idle sessions,
# and only root may log in at all.
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers root
EOF
# Never reload a config that would not parse — that is how people lock themselves out.
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl restart ssh
echo "    sshd config valid and reloaded (open sessions keep working)"

echo "==> 2/8 fail2ban (ban SSH brute-force sources)"
DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban >/dev/null
cat > /etc/fail2ban/jail.d/cleanturn.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
EOF
systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban

echo "==> 3/8 Firewall: only SSH + HTTP + HTTPS inbound"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp   >/dev/null 2>&1 || true
ufw allow 443/tcp  >/dev/null 2>&1 || true   # ready for TLS
ufw --force enable >/dev/null 2>&1 || true

echo "==> 4/8 Kernel / network hardening (sysctl)"
cat > /etc/sysctl.d/99-cleanturn-hardening.conf <<'EOF'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.log_martians = 1
kernel.randomize_va_space = 2
# Prefer RAM; only lean on swap under real pressure (small droplet).
vm.swappiness = 10
EOF
sysctl --system >/dev/null

echo "==> 5/8 Automatic security updates (+ off-hours auto-reboot for kernel CVEs)"
DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades >/dev/null
cat > /etc/apt/apt.conf.d/20-cleanturn-auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
U=/etc/apt/apt.conf.d/50unattended-upgrades
if [ -f "$U" ]; then
  sed -i 's#^//\s*Unattended-Upgrade::Automatic-Reboot "false";#Unattended-Upgrade::Automatic-Reboot "true";#' "$U" || true
  sed -i 's#^//\s*Unattended-Upgrade::Automatic-Reboot-Time "02:00";#Unattended-Upgrade::Automatic-Reboot-Time "04:30";#' "$U" || true
fi
systemctl enable unattended-upgrades >/dev/null 2>&1 || true

echo "==> 6/8 Apply currently-pending security updates now"
apt-get update -y >/dev/null
DEBIAN_FRONTEND=noninteractive unattended-upgrade -v || true

echo "==> 7/8 nginx: hide version banner"
if [ -f /etc/nginx/nginx.conf ]; then
  grep -q 'server_tokens off;' /etc/nginx/nginx.conf \
    || sed -i 's/# server_tokens off;/server_tokens off;/' /etc/nginx/nginx.conf
  grep -q 'server_tokens off;' /etc/nginx/nginx.conf \
    || sed -i '0,/http {/s//http {\n\tserver_tokens off;/' /etc/nginx/nginx.conf
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
fi

echo
echo "==> Hardening complete."
echo "    Reminder (human-error surface): remove any stale/leaked key from"
echo "    /root/.ssh/authorized_keys and keep only the keys you trust."
