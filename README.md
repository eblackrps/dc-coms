# DC Coms

DC Coms is a private, browser-based Matrix communication client for small teams. Community V1 packages the web client, Matrix Synapse, PostgreSQL, nginx, operational services, password-reset tooling, Reminder Bot, and DC Ops into a reproducible Rocky Linux 9-family deployment.

## Community V1

Features include encrypted Matrix chat, direct messages, private channels, replies, edits, deletion, standard Unicode reactions and emoji, encrypted attachments, search, pins, browser notifications, unread state, drafts, typing indicators, message deep links, clickable URLs, clipboard paste, @mentions, room rename/topic management, account/session management, password change/reset, user lifecycle controls, administrative room deletion, Reminder Bot, DC Ops, nightly PostgreSQL backups, storage monitoring, and responsive browser layouts.

Private/custom character emoji packs are not included.

## Supported Platform

- Rocky Linux 9
- AlmaLinux 9
- RHEL 9-compatible systems
- Podman
- systemd
- nginx
- SELinux Enforcing

Canonical paths:

```text
/data/dccoms
/etc/dccoms
```

## Architecture

```text
Browser
  |
HTTPS
  |
nginx
  +-- DC Coms frontend
  +-- Synapse :8008
  +-- Admin API :8010
  +-- Reset API :8011

PostgreSQL <-- Synapse
Reminder Bot --> Matrix
DC Ops Bot --> local collector :8012
```

Ports 8008, 8010, 8011, and 8012 remain local to the server. Only HTTPS is opened through the host firewall by the installer.

## Security Defaults

- HTTPS
- SELinux Enforcing
- public Matrix registration disabled
- guest access disabled
- support APIs bound to localhost
- fresh per-install secrets
- protected environment files
- dedicated password-reset service identity
- non-admin Reminder Bot and DC Ops users

See [SECURITY.md](SECURITY.md).

## Installation

See [INSTALL.md](INSTALL.md).

```bash
cp deploy/install.env.example deploy/install.env
vi deploy/install.env
./deploy/scripts/install.sh --check
./deploy/scripts/install.sh --apply
```

Do not run `--apply` against an existing DC Coms deployment.

## Documentation

- INSTALL.md
- ADMIN-GUIDE.md
- USER-GUIDE.md
- BACKUP-RESTORE.md
- TROUBLESHOOTING.md
- SECURITY.md
- CLEAN-INSTALL-TEST.md
- GITHUB-RELEASE.md
- CHANGELOG.md

## Release Status

`1.0.0-rc3` is a release candidate. Source and packaged-artifact sanitization audits have passed. A clean-host install/regression test remains required before final `1.0.0`.
