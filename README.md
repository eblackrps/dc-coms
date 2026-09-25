# DC Coms

[![Latest Release](https://img.shields.io/github/v/release/eblackrps/dc-coms)](https://github.com/eblackrps/dc-coms/releases/latest)
[![License](https://img.shields.io/github/license/eblackrps/dc-coms)](LICENSE)

DC Coms is a private, browser-based Matrix communication client for small teams. Community V1 packages the web client, Matrix Synapse, PostgreSQL, nginx, operational services, password-reset tooling, Reminder Bot, and DC Ops into a reproducible Rocky Linux 9-family deployment.

## Release status

**1.0.1 is the current general-availability release.**

Community V1 passed source sanitization, packaged-artifact auditing, clean-host installation validation, browser and service regression checks, backup verification, and recovery validation.

## Start here

For a new deployment, follow the documentation in this order:

1. [PREREQUISITES.md](PREREQUISITES.md) - prepare the host, DNS, TLS, network, and storage
2. [INSTALL.md](INSTALL.md) - install and perform first login
3. [ADMIN-GUIDE.md](ADMIN-GUIDE.md) - operate the service
4. [BACKUP-RESTORE.md](BACKUP-RESTORE.md) - protect server identity and application state
5. [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - diagnose failed installs or services

If you are validating a release candidate rather than deploying for normal use, use [CLEAN-INSTALL-TEST.md](CLEAN-INSTALL-TEST.md).

## Supported deployment target

Community V1 supports clean installation on:

- Rocky Linux 9
- AlmaLinux 9
- RHEL 9
- CentOS Stream 9
- Podman
- systemd
- nginx
- SELinux Enforcing

The deployment uses fixed application paths:

```text
/data/dccoms
/etc/dccoms
```

The installer is for a fresh dedicated host. It is not an upgrade, migration, repair, or overwrite tool.

## What you need before installation

At minimum, prepare:

- root access to a supported fresh host
- outbound internet access for packages and container images
- a permanent fully qualified DNS name that already resolves to the host
- a TLS certificate valid for that name
- the matching TLS private key
- inbound TCP 443 from intended clients
- adequate storage for database data, Matrix media, containers, and backups

You do not need to preinstall Podman, nginx, Node.js, pnpm, PostgreSQL, or Synapse.

See [PREREQUISITES.md](PREREQUISITES.md) for the full checklist.

## Deployment flow

After prerequisites are complete:

```bash
sha256sum -c dc-coms-community-v1.0.1.tar.gz.sha256
tar -xzf dc-coms-community-v1.0.1.tar.gz
cd dc-coms-community-v1.0.1

./deploy/scripts/release-audit.sh

cp deploy/install.env.example deploy/install.env
vi deploy/install.env

./deploy/scripts/install.sh --check
./deploy/scripts/install.sh --apply
```

Do not run `--apply` against an existing DC Coms deployment.

See [INSTALL.md](INSTALL.md) for the complete procedure and expected results.

## Architecture

```text
Browser
  |
HTTPS :443
  |
nginx
  +-- DC Coms frontend
  +-- Synapse ---------------- :8008 localhost
  +-- Admin API -------------- :8010 localhost
  +-- Password Reset API ----- :8011 localhost

PostgreSQL <---- Synapse
Reminder Bot --> Matrix
DC Ops Bot ----> Collector --- :8012 localhost
```

Only HTTPS is intended to be externally reachable for DC Coms. Ports 8008, 8010, 8011, and 8012 remain local to the server.

## Community V1 features

DC Coms includes encrypted Matrix chat, direct messages, private channels, replies, edits, deletion, standard Unicode reactions and emoji, encrypted attachments, search, pins, browser notifications, unread state, drafts, typing indicators, message deep links, clickable URLs, clipboard paste, @mentions, room rename/topic management, account/session management, password change/reset, user lifecycle controls, administrative room deletion, Reminder Bot, DC Ops, nightly PostgreSQL backups, storage monitoring, and responsive browser layouts.

Private/custom character emoji packs are not included in Community V1.

## Security defaults

Community V1 is designed to keep the application private by default:

- HTTPS entry point
- SELinux remains Enforcing
- public Matrix registration disabled
- guest access disabled
- support APIs bound to localhost
- fresh per-install secrets
- protected environment files
- dedicated password-reset service identity
- non-admin Reminder Bot and DC Ops users

See [SECURITY.md](SECURITY.md).

## Documentation map

| Document | Use it for |
| --- | --- |
| [PREREQUISITES.md](PREREQUISITES.md) | host, DNS, TLS, network, storage, and readiness checks |
| [INSTALL.md](INSTALL.md) | download, configure, install, first login, and verification |
| [ADMIN-GUIDE.md](ADMIN-GUIDE.md) | accounts, services, logs, and administration |
| [USER-GUIDE.md](USER-GUIDE.md) | normal end-user operation |
| [BACKUP-RESTORE.md](BACKUP-RESTORE.md) | backup scope and recovery requirements |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | installation and runtime diagnosis |
| [SECURITY.md](SECURITY.md) | security model and sensitive-data handling |
| [CLEAN-INSTALL-TEST.md](CLEAN-INSTALL-TEST.md) | release-candidate validation on a disposable host |
| [GITHUB-RELEASE.md](GITHUB-RELEASE.md) | maintainer release process |
| [CHANGELOG.md](CHANGELOG.md) | release history |
