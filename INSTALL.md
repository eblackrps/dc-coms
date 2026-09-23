# DC Coms Community Installation

This procedure installs DC Coms Community on a fresh supported host.

Read and complete [PREREQUISITES.md](PREREQUISITES.md) before starting.

## Installation boundaries

Community V1 supports clean installation on Rocky Linux 9, AlmaLinux 9, RHEL 9, and CentOS Stream 9. Other RHEL-compatible distributions are not currently validated by the installer.

The installer:

- installs required host packages
- creates the DC Coms filesystem layout
- generates fresh installation secrets
- renders Synapse, nginx, Quadlet, frontend, and service configuration
- pulls PostgreSQL and Synapse container images
- builds the frontend and bot containers
- configures nginx
- keeps SELinux Enforcing and applies the required web-content context
- enables firewalld and adds HTTPS
- creates the initial administrator and service accounts
- starts application services and timers
- creates an initial PostgreSQL backup
- runs local health checks

The installer does not:

- create DNS records
- request or renew TLS certificates
- migrate an existing Matrix deployment
- upgrade an existing DC Coms installation
- provide HA or clustering
- configure off-host backup storage

## 1. Obtain the release artifact

Use the release archive, checksum, and manifest from the GitHub Releases page for the version you intend to deploy.

For v1.0.1 the files are:

```text
dc-coms-community-v1.0.1.tar.gz
dc-coms-community-v1.0.1.tar.gz.sha256
dc-coms-community-v1.0.1.manifest.txt
```

Keep the archive and its `.sha256` file in the same directory.

## 2. Verify the release archive

Run:

```bash
sha256sum -c dc-coms-community-v1.0.1.tar.gz.sha256
```

Expected:

```text
dc-coms-community-v1.0.1.tar.gz: OK
```

Do not continue if checksum verification fails.

## 3. Extract the release

```bash
tar -xzf dc-coms-community-v1.0.1.tar.gz
cd dc-coms-community-v1.0.1
```

Run the package audit before changing anything:

```bash
./deploy/scripts/release-audit.sh
```

Expected final line:

```text
DC Coms Community release audit: PASS
```

Do not continue if the audit fails.

## 4. Create the installation configuration

Copy the example:

```bash
cp deploy/install.env.example deploy/install.env
vi deploy/install.env
```

Set these site-specific values:

| Variable | Example | Notes |
| --- | --- | --- |
| `DC_COMS_FQDN` | `chat.example.com` | permanent Matrix/DC Coms server name |
| `DC_COMS_TIMEZONE` | `America/New_York` | timezone used by the application and Reminder Bot |
| `DC_COMS_TLS_CERT` | `/etc/pki/tls/certs/dccoms.crt` | certificate valid for the FQDN |
| `DC_COMS_TLS_KEY` | `/etc/pki/tls/private/dccoms.key` | matching private key |
| `DC_COMS_ADMIN_LOCALPART` | `admin` | initial administrator username without `@` |

The PostgreSQL defaults can normally remain unchanged:

```text
DC_COMS_POSTGRES_DB=synapse
DC_COMS_POSTGRES_USER=synapse
```

Community V1 requires Reminder Bot and DC Ops:

```text
DC_COMS_ENABLE_REMINDER_BOT=true
DC_COMS_ENABLE_OPS_BOT=true
```

Leave these canonical paths unchanged:

```text
DC_COMS_ROOT=/data/dccoms
DC_COMS_WEB_ROOT=/data/dccoms/preview
DC_COMS_CONFIG_ROOT=/etc/dccoms
```

Do not put passwords or manually generated application secrets into `deploy/install.env`. The installer generates installation secrets locally.

## 5. Run configuration preflight

```bash
./deploy/scripts/install.sh --check
```

Expected:

```text
Configuration preflight: PASS

No changes were made.
```

The preflight validates required configuration values, supported OS family/version, canonical paths, FQDN shape, and required Community feature flags.

It intentionally does not perform the installation. TLS-file readability and additional runtime checks occur during `--apply`.

## 6. Install

Run:

```bash
./deploy/scripts/install.sh --apply
```

Watch the output. A successful run ends with:

```text
DC COMS INSTALLATION COMPLETE
```

The completion output also shows:

- the HTTPS URL
- the path to the initial administrator credential file
- reminders about SELinux and firewall exposure

Do not interrupt the installer during package installation, container image pulls, account bootstrap, or service startup unless it is clearly stalled because of an external failure.

## 7. Retrieve the initial administrator credentials

After a successful install:

```bash
cat /root/dccoms-initial-admin.txt
```

The file is root-readable only and contains the generated initial administrator password.

Do not copy this file into source control, tickets, chat, or ordinary logs.

## 8. Verify server-side health

Run:

```bash
systemctl is-active dccoms-postgres.service
systemctl is-active dccoms-synapse.service
systemctl is-active dccoms-admin-api.service
systemctl is-active dccoms-reset-api.service
systemctl is-active dccoms-reminder-bot.service
systemctl is-active dccoms-ops-collector.service
systemctl is-active dccoms-ops-bot.service
systemctl is-active nginx
```

Each should report:

```text
active
```

Check Matrix and nginx:

```bash
curl -fsS   http://127.0.0.1:8008/_matrix/client/versions   >/dev/null   && echo "Synapse: PASS"

nginx -t
```

Check SELinux:

```bash
getenforce
getsebool httpd_can_network_connect
```

Expected:

```text
Enforcing
httpd_can_network_connect --> on
```

Check the firewall:

```bash
firewall-cmd --list-services
firewall-cmd --list-ports
```

HTTPS should be allowed. DC Coms internal ports should not be opened as public firewall ports.

Check listeners:

```bash
ss -lntp   | grep -E ':(443|8008|8010|8011|8012)[[:space:]]'
```

Expected design:

- 443 is externally reachable through nginx
- 8008 is bound to localhost
- 8010 is bound to localhost
- 8011 is bound to localhost
- 8012 is bound to localhost

Check the initial backup:

```bash
ls -lh /data/dccoms/backups/
systemctl status dccoms-db-backup.timer
```

At least one non-empty `synapse-*.dump` file should exist after a successful Community V1 installation.

## 9. Perform the first browser login

From a client that can resolve and reach the FQDN, open:

```text
https://<DC_COMS_FQDN>
```

Sign in with the initial administrator credentials.

Immediately:

1. change the administrator password
2. verify the new password works
3. remove the temporary credential file

```bash
rm -f /root/dccoms-initial-admin.txt
```

Then create a normal test user and verify messaging before onboarding additional users.

## 10. Confirm timers

```bash
systemctl list-timers 'dccoms-*'
```

Community V1 installs:

- nightly PostgreSQL backup timer
- hourly storage-capacity check timer

## If installation fails

Do not disable SELinux, open internal ports, or delete application directories as a first response.

Start with [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

A failed install may leave:

```text
/etc/dccoms/.community-install-in-progress
deploy/generated/
```

Those are intentional recovery state. Generated files can contain secrets and must not be published.

Collect the failure output and relevant service logs before changing the host.

For release testing, rebuilding the disposable VM from a clean snapshot is preferable to repeatedly repairing an unknown partial state.

## After installation

Continue with:

- [ADMIN-GUIDE.md](ADMIN-GUIDE.md)
- [BACKUP-RESTORE.md](BACKUP-RESTORE.md)
- [SECURITY.md](SECURITY.md)
- [USER-GUIDE.md](USER-GUIDE.md)
