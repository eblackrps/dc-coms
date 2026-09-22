# DC Coms Community Installation

## Supported Systems

Community V1 supports clean installation on Rocky Linux 9, AlmaLinux 9, and compatible RHEL 9 systems.

Install on a dedicated server or VM. Do not run the installer over an existing DC Coms deployment.

## Requirements

You need root access, internet access, a fully qualified DNS name already resolving to the server, a TLS certificate and matching private key, and TCP 443 reachable by intended users.

Community V1 does not automatically request or manage TLS certificates.

## Verify and Extract

```bash
sha256sum -c dc-coms-community-v1.0.0-rc2.tar.gz.sha256
tar -xzf dc-coms-community-v1.0.0-rc2.tar.gz
cd dc-coms-community-v1.0.0-rc2
```

## Configure

```bash
cp deploy/install.env.example deploy/install.env
vi deploy/install.env
```

Set at least:

```text
DC_COMS_FQDN
DC_COMS_TIMEZONE
DC_COMS_TLS_CERT
DC_COMS_TLS_KEY
DC_COMS_ADMIN_LOCALPART
```

Leave these canonical paths unchanged:

```text
DC_COMS_ROOT=/data/dccoms
DC_COMS_WEB_ROOT=/data/dccoms/preview
DC_COMS_CONFIG_ROOT=/etc/dccoms
```

Reminder Bot and DC Ops are enabled by default.

## Preflight

```bash
./deploy/scripts/install.sh --check
```

No host changes are made by `--check`.

## Install

```bash
./deploy/scripts/install.sh --apply
```

The installer installs dependencies, creates protected runtime directories, generates fresh secrets, renders configuration, installs PostgreSQL and Synapse Quadlets, builds the frontend and bot containers, configures nginx and SELinux, opens HTTPS through firewalld, bootstraps Matrix accounts, starts services, enables timers, and performs local health checks.

## Initial Administrator

Credentials are written to:

```text
/root/dccoms-initial-admin.txt
```

After the first successful login, change the administrator password, verify it, then delete the file:

```bash
rm -f /root/dccoms-initial-admin.txt
```

## Verify

```bash
systemctl --no-pager --full status   dccoms-postgres.service   dccoms-synapse.service   dccoms-admin-api.service   dccoms-reset-api.service   nginx

curl -f http://127.0.0.1:8008/_matrix/client/versions
nginx -t
getenforce
firewall-cmd --list-services
```

If enabled:

```bash
systemctl status dccoms-reminder-bot.service
systemctl status dccoms-ops-collector.service dccoms-ops-bot.service
```

SELinux should remain `Enforcing`. Only HTTPS should be exposed externally.

This installer is for fresh installs, not upgrades, migrations, repairs, or overwrites.
