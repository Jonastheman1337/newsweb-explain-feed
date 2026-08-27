# Autoweb UpCloud production runbook

This package moves the existing Autoweb application to one Autoweb-only
UpCloud server without changing public routes, the Prisma schema, or application
behavior. The first release is built from the exact Render production commit.

## Fixed production topology

- UpCloud Starter, Stavanger (`NO-SVG1`), 2 vCPU, 16 GB RAM, encrypted 50 GB
  block storage, Ubuntu 24.04 LTS, and public IPv4/IPv6 assigned.
- UpCloud Week-plan backups run daily at 03:30 UTC and retain seven copies; no
  extra Block Storage, Object Storage, Managed Database, or Load Balancer.
- Only Caddy publishes host ports. Caddy sends all application traffic to the
  Next.js web container; API, worker, PostgreSQL, and Redis stay private.
- PostgreSQL 16 uses one `newsweb_explain` database. Do not set
  `GENERATION_LOG_DATABASE_URL`.
- Redis uses AOF and `noeviction`. Redis is fresh at migration; Render queue
  state is drained rather than copied.

## 1. Account and server prerequisites

1. Enable UpCloud account 2FA before production traffic.
2. The server is `autoweb-prod`, UUID
   `00cb3adf-c88a-4e0c-b5f7-48a1e5f71914`, IPv4 `81.27.105.83`, with the
   `trav-training-laptop` SSH key. Do not publish its IPv6 address at cutover.
3. Enable the UpCloud server firewall: TCP 80/443 and UDP 443 from all IPv4/IPv6,
   TCP 22 only from approved admin IPs, and ICMP. Allow all outbound traffic.
4. Enable the registrar lock for `autoweb24.no`. Do not change nameservers.

Run the bootstrap as root, verify a second SSH session as `autoweb`, and only
then disable root/password SSH:

```bash
bash /tmp/bootstrap-host.sh
ssh autoweb@SERVER_IP
sudo bash /tmp/bootstrap-host.sh --harden-ssh
```

## 2. Release and secrets

From the clean migration worktree, commit the infrastructure package and create
the exact application archive:

```powershell
powershell -File infra/upcloud/scripts/prepare-release.ps1 `
  -AppSha c2c173636dad50364ef1a246f384c8c417296d8e
```

Copy the infrastructure directory to `/srv/autoweb/current/infra/upcloud`, and
copy the application tar to `/srv/autoweb/releases/incoming/`. The tar checksum
must be transferred separately and compared before building.

Export the complete Render Dashboard Environment table and the Render `.env`
secret file without printing values. The public API alone is insufficient: it
omits Blueprint-managed values, including the production-generated
`SESSION_SECRET`. Merge the secret file first and the Dashboard environment on
top, remove the infrastructure-owned keys listed in `app.env.example`, and place
the result at `/srv/autoweb/secrets/app.env`. Copy `host.env.example` to
`/srv/autoweb/secrets/host.env`, generate a 64-hex PostgreSQL password, and set
the real preview CIDR, ACME email, and alert email. Both files must be mode 600.

```powershell
node infra/upcloud/scripts/merge-render-env.mjs `
  --variables dist/upcloud/render-dashboard.env `
  --secret-file dist/upcloud/render-secret.env `
  --out dist/upcloud/app.env
```

If only the public API export is available, it also omits the login variables.
The optional `--login-source VERIFIED_LOGIN_ENV` imports only
`LOGIN_USERNAME`/`LOGIN_PASSWORD`; use it only after those credentials pass a
live `/api/auth/login` check.

Production currently has no SMTP host, user, or password configured and uses a
placeholder sender. Preserve that runtime state for rehearsal, but do not install
the watchdog timers or claim alert acceptance until a real SMTP account and
recipient have been configured and a test alert has been delivered.

Build and deploy with polling disabled:

```bash
infra/upcloud/scripts/build-release.sh APP_SHA SOURCE_TAR EXPECTED_SHA256
infra/upcloud/scripts/deploy.sh APP_SHA
```

## 3. Rehearsal

1. Create a manual DNS-zone backup in Domene Shop.
2. Add `upcloud-preview.autoweb24.no A 81.27.105.83` with TTL 300.
3. Keep `NEWSWEB_POLLING_ENABLED=false` and disable outbound mail for the
   rehearsal copy.
4. Download a current Render logical export, transfer it to the server, and run:

```bash
infra/upcloud/scripts/restore-render-export.sh /srv/autoweb/tmp/EXPORT.dir.tar.gz
infra/upcloud/scripts/deploy.sh APP_SHA
```

5. Compare the generated database manifest with a source manifest, then test
   login, feed, notice pages, SSE, attachments, admin signals, and health.
6. Run 25 concurrent read requests and three representative generation jobs on
   the cloned database. Do not proceed after any OOM/restart or host memory at
   or above 80 percent. The rehearsed export-to-verified-restore path must finish
   within 35 minutes.
7. Create one logical backup and run a restore drill before production cutover.

## 4. Cutover

1. At least 60 minutes before the window, create another DNS backup and reduce
   only the apex A and `www` CNAME TTLs from 1800 to 300.
2. Freeze editorial writes, disable Render polling at the same deployed commit,
   drain all active/waiting BullMQ work, and suspend the Render web service.
3. Create the final Render export. Restore it on UpCloud, run migrations, and
   compare row-count manifests.
4. Start UpCloud with polling disabled and repeat read-only preview checks.
5. Change only the apex A to the UpCloud IPv4 and `www` CNAME to
   `autoweb24.no`. Do not add AAAA during initial cutover.
6. Verify public DNS, TLS, the `www` 308 redirect, login/session continuity,
   feed, attachments, admin signals, and `/api/health`.
7. If checks fail by minute 45, restore apex `216.24.57.1` and `www`
   `autoweb-f4dw.onrender.com`, then resume Render.
8. After read-only acceptance, set `NEWSWEB_POLLING_ENABLED=true`, redeploy the
   same images, verify one worker heartbeat and one controlled generation, then
   reopen writes.

## 5. Backups, monitoring, and rollback hold

Install the timers only after public TLS and SMTP alert delivery have both been
tested:

```bash
sudo infra/upcloud/scripts/install-systemd.sh
infra/upcloud/scripts/backup.sh
infra/upcloud/scripts/restore-drill.sh
infra/upcloud/scripts/watchdog.sh
```

Keep Render service, database, Key Value, environment, and custom domains
intact but suspended for seven days; disable Render automatic deploys. Before
any UpCloud write, rollback is Render resume plus the two original DNS values.
After writes, freeze UpCloud and reverse-migrate its database into a fresh
Render PostgreSQL and fresh Redis before resuming Render.

After seven stable days, verify another restore drill and take a final logical
dump. Deleting or cancelling Render requires a separate explicit approval.
