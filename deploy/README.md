# Deploying CleanTurn

CI/CD: **build on GitHub's runner, swap on the droplet.** The Actions runner
(`ubuntu-latest`, x64) is the same platform as the droplet (Ubuntu 24.04 x64),
so the compiled Next.js output and the native Prisma engine built in CI run
as-is on the box — no building on the droplet.

## Flow

1. Push to `main` (or run the **Deploy** workflow manually).
2. Runner: `npm ci` → `prisma generate` → `npm test` → `npm run build`.
3. `rsync` the release to `/opt/cleanturn/releases/<sha>/` (hardlinked against
   the live release, so only changed files transfer after the first deploy).
4. On the droplet, [`release.sh`](./release.sh): run `prisma migrate deploy`,
   atomically repoint `current -> releases/<sha>`, restart the service,
   health-check `/api/health`, and **roll back** if it's unhealthy.

Persistent state lives in `/opt/cleanturn/shared/` (the SQLite DB and `.env`)
and is symlinked into each release, so deploys never touch your data.

```
/opt/cleanturn/
  shared/.env              # runtime secrets (generated once by bootstrap)
  shared/data/prod.db      # SQLite database (persists across deploys)
  releases/<sha>/          # one dir per deploy (last 5 kept)
  current -> releases/<sha>
```

## One-time setup

### 1. Bootstrap the droplet (once)

```sh
scp deploy/bootstrap.sh root@138.197.174.226:/tmp/
ssh root@138.197.174.226 'bash /tmp/bootstrap.sh'
```

Installs Node 20, nginx (`:80 -> :3100`), a `cleanturn` runtime user, the
systemd unit, the firewall, and a generated `shared/.env`. **It prints the
initial admin password once — save it.**

### 2. Authorize the CI deploy key on the droplet

GitHub Actions logs in with the `github-actions-deploy` key. Add its public
half to the droplet:

```sh
ssh root@138.197.174.226 \
  "echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIOSVIKI9XT9c9LalRdMo4e3X7lGIGLJ9pMbkQ4as0at github-actions-deploy' >> /root/.ssh/authorized_keys"
```

### 3. Add GitHub repository secrets

In `VelasscoStudios/cleanturn` → Settings → Secrets and variables → Actions,
or with the CLI (authenticated as VelasscoStudios):

```sh
gh secret set DEPLOY_HOST      -b "138.197.174.226"
gh secret set DEPLOY_USER      -b "root"
gh secret set DEPLOY_SSH_KEY   < ~/.ssh/digitalocean_deploy        # private key
# Optional but recommended (strict host-key checking):
ssh-keyscan -t ed25519 138.197.174.226 | gh secret set DEPLOY_KNOWN_HOSTS
```

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | droplet IP (`138.197.174.226`) |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | **private** half of the `github-actions-deploy` key |
| `DEPLOY_KNOWN_HOSTS` | *(optional)* output of `ssh-keyscan` for the host |

Without `DEPLOY_KNOWN_HOSTS`, the workflow falls back to
`StrictHostKeyChecking=accept-new`.

### 4. Deploy

Push to `main`. Watch it under the repo's **Actions** tab.

## Operating the droplet

```sh
systemctl status cleanturn        # service state
journalctl -u cleanturn -f        # live logs
systemctl restart cleanturn       # manual restart
ls -1dt /opt/cleanturn/releases   # release history (newest first)
```

### Automatic iCal sync

A systemd timer syncs every property's feed every 10 minutes —
`cleanturn-sync.timer` fires the oneshot `cleanturn-sync.service`, which curls
`POST 127.0.0.1:3100/api/cron/sync` with the Bearer token read from
`shared/cron-auth.header` (regenerated from `CRON_SECRET` by `release.sh` on
every deploy, which also installs/enables both units). The open `/admin` page
re-reads the DB every minute, so bookings appear with no interaction.

```sh
systemctl list-timers cleanturn-sync.timer   # next/last tick
journalctl -u cleanturn-sync.service -n 20   # tick history (curl output)
journalctl -u cleanturn | grep '\[sync\]'    # authoritative per-run counts
```

`GET /api/health` reports `syncFresh: false` when the newest successful sync
is older than 35 minutes — point any uptime pinger at it to catch a dead
timer, since in-app alerts can only fire while syncs are running.

**Manual rollback** to the previous release:

```sh
ln -sfn "$(ls -1dt /opt/cleanturn/releases/*/ | sed -n 2p)" /opt/cleanturn/current
systemctl restart cleanturn
```

## Follow-ups (not required for a working deploy)

- **TLS**: point a domain at the droplet and run `certbot --nginx` for HTTPS,
  then set `APP_URL=https://your-domain` in `shared/.env`.
- **Backups**: the whole DB is one file — `cp /opt/cleanturn/shared/data/prod.db`
  on a schedule (SQLite `.backup` for a consistent copy under load).
