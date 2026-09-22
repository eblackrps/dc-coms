# DC Coms Troubleshooting

Use this guide when installation fails or a deployed Community instance is unhealthy.

Do not begin by disabling SELinux, opening internal ports, deleting `/data/dccoms`, deleting `/etc/dccoms`, or exposing secret-bearing environment files.

## Start here

Run these first:

```bash
systemctl --failed

systemctl --no-pager --full status   dccoms-postgres.service   dccoms-synapse.service   dccoms-admin-api.service   dccoms-reset-api.service   dccoms-reminder-bot.service   dccoms-ops-collector.service   dccoms-ops-bot.service   nginx

podman ps -a

getenforce

ss -lntp   | grep -E ':(443|8008|8010|8011|8012)[[:space:]]'
```

Then diagnose the failing layer rather than changing unrelated parts of the system.

## Installer preflight fails

Run:

```bash
./deploy/scripts/install.sh --check
```

Common causes:

- unsupported OS or major version
- missing value in `deploy/install.env`
- non-FQDN server name
- changed canonical path
- Reminder Bot disabled
- DC Ops disabled

Community V1 requires:

```text
DC_COMS_ROOT=/data/dccoms
DC_COMS_WEB_ROOT=/data/dccoms/preview
DC_COMS_CONFIG_ROOT=/etc/dccoms
DC_COMS_ENABLE_REMINDER_BOT=true
DC_COMS_ENABLE_OPS_BOT=true
```

## Installer refuses an existing host

The installer intentionally refuses a normal `--apply` when an existing DC Coms tree is detected.

Do not delete an existing deployment to bypass this guard.

Check:

```bash
ls -la /data/dccoms 2>/dev/null
ls -la /etc/dccoms 2>/dev/null
```

A partially failed Community install may contain:

```text
/etc/dccoms/.community-install-in-progress
```

Preserve logs and failure output before deciding whether to retry or rebuild the host.

For release testing, restoring the disposable VM to a clean snapshot is preferred.

## TLS or nginx failure

Check that the configured files exist and are readable:

```bash
grep -E '^DC_COMS_(FQDN|TLS_CERT|TLS_KEY)=' deploy/install.env

nginx -t
journalctl -u nginx --no-pager -n 100
```

Do not paste the private key into an issue or chat.

If OpenSSL is available:

```bash
openssl x509   -in /path/to/certificate.crt   -noout   -subject   -issuer   -dates   -ext subjectAltName
```

Confirm the configured FQDN appears in the certificate.

## Container image pull failure

Check network and DNS first:

```bash
getent hosts docker.io
getent hosts ghcr.io

podman pull docker.io/library/postgres:17
podman pull ghcr.io/element-hq/synapse:v1.161.0
```

If pulls fail, fix outbound DNS, proxy, routing, or registry access rather than modifying the application configuration.

## Frontend build failure

The frontend build runs inside the pinned Node container and installs dependencies from `pnpm-lock.yaml`.

Check:

```bash
journalctl --no-pager -n 100

podman images   --format '{{.Repository}}:{{.Tag}}'   | grep 'node'
```

The build source is:

```text
/data/dccoms/web-src
```

The deployed frontend is:

```text
/data/dccoms/preview
```

Do not add a host Node.js installation as a workaround unless you are deliberately developing the frontend.

## PostgreSQL failure

Check:

```bash
systemctl status dccoms-postgres.service
journalctl -u dccoms-postgres.service --no-pager -n 100
podman ps -a
podman logs dccoms-postgres
```

PostgreSQL data lives under:

```text
/data/dccoms/postgres
```

Do not delete the data directory to resolve a startup failure.

## Synapse failure

Check:

```bash
systemctl status dccoms-synapse.service
journalctl -u dccoms-synapse.service --no-pager -n 150
podman logs dccoms-synapse

curl -v   http://127.0.0.1:8008/_matrix/client/versions
```

Synapse configuration and identity data are under:

```text
/data/dccoms/synapse
```

The signing key in that directory is durable server identity material. Do not delete or regenerate it as a generic troubleshooting step.

## Password-reset API failure

```bash
systemctl status dccoms-reset-api.service
journalctl -u dccoms-reset-api.service --no-pager -n 100
```

The API should listen only on localhost port 8011.

## Administrative room-delete API failure

```bash
systemctl status dccoms-admin-api.service
journalctl -u dccoms-admin-api.service --no-pager -n 100
```

The API should listen only on localhost port 8010.

## Reminder Bot failure

```bash
systemctl status dccoms-reminder-bot.service
journalctl -u dccoms-reminder-bot.service --no-pager -n 150
podman logs dccoms-reminder-bot
```

Persistent Reminder Bot state is under:

```text
/data/dccoms/reminder-bot
```

## DC Ops failure

Collector:

```bash
systemctl status dccoms-ops-collector.service
journalctl -u dccoms-ops-collector.service --no-pager -n 150
```

Bot:

```bash
systemctl status dccoms-ops-bot.service
journalctl -u dccoms-ops-bot.service --no-pager -n 150
podman logs dccoms-ops-bot
```

The collector should listen only on localhost port 8012.

## Backup failure

Check the timer and last service run:

```bash
systemctl status dccoms-db-backup.timer
systemctl status dccoms-db-backup.service
journalctl -u dccoms-db-backup.service --no-pager -n 100
ls -lh /data/dccoms/backups/
```

Run a backup manually:

```bash
systemctl start dccoms-db-backup.service
systemctl status dccoms-db-backup.service
```

Do not assume a timer being active means backups are valid. Confirm non-empty `synapse-*.dump` files exist.

## Storage warning or DC Ops health warning

```bash
/usr/local/sbin/dccoms-storage-status

df -hT /data

du -sh /data/dccoms/* 2>/dev/null   | sort -h
```

Do not delete PostgreSQL, Synapse, signing-key, or bot-state files to reclaim space without understanding their role.

## SELinux denial

SELinux should remain Enforcing.

```bash
getenforce
getsebool httpd_can_network_connect
ausearch -m AVC -ts recent
```

Expected boolean:

```text
httpd_can_network_connect --> on
```

If an AVC is related to DC Coms, identify the exact denied operation. Do not use `setenforce 0` as the fix.

## Firewall or listener problem

```bash
firewall-cmd --get-active-zones
firewall-cmd --list-services
firewall-cmd --list-ports

ss -lntp   | grep -E ':(443|8008|8010|8011|8012)[[:space:]]'
```

Expected design:

- 443 externally reachable
- 8008 localhost only
- 8010 localhost only
- 8011 localhost only
- 8012 localhost only

## Files that contain secrets

Do not publish the contents of:

```text
/etc/dccoms/*.env
/root/dccoms-initial-admin.txt
deploy/generated/
/data/dccoms/synapse/*.signing.key
TLS private keys
Matrix access-token or crypto-state files
```

When requesting support, provide service status, sanitized logs, OS/version information, and the release version without exposing credentials.

## Useful version information

```bash
cat /etc/os-release
podman --version
nginx -v
cat VERSION 2>/dev/null || true
```

For release-candidate problems, also state whether the issue occurred during `--check`, `--apply`, first login, browser regression, backup validation, or normal runtime.
