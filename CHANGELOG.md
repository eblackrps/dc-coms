# Changelog

## Unreleased

### Fixed

- exclude Synapse `e2e_one_time_keys_json` table data from scheduled PostgreSQL backups so restored dumps do not reintroduce stale one-time-key state
- document safe handling for v1.0.1 and older full database dumps by truncating `e2e_one_time_keys_json` before Synapse starts after restore
- expand recovery validation to include post-restore encrypted messaging and separate user encrypted-history recovery checks

## 1.0.1 - 2026-09-23

Packaging and documentation hotfix release.

### Fixed

- generate portable SHA256 files that reference the release archive by filename instead of the build server's absolute path
- verify the generated checksum during release packaging
- require `frontend-src/pnpm-lock.yaml` in the release audit because frontend installation uses `pnpm install --frozen-lockfile`
- remove stale RC3 wording from the installation guide
- align documented supported operating systems with the installer: Rocky Linux 9, AlmaLinux 9, RHEL 9, and CentOS Stream 9

### Validation scope

- no application runtime code changed from v1.0.0
- v1.0.1 requires release audit, portable checksum verification, archive extraction, packaged release audit, and installer preflight smoke validation

## 1.0.0 - 2026-09-23

General-availability release of DC Coms Community V1.

### Validation

- clean installation completed successfully on a fresh supported host
- browser and service regression checks passed
- backup and restore validation passed
- release audit passed
- no functional application changes were introduced after the tested RC4 candidate; this promotion updates release metadata and documentation for GA

### Included

- self-hosted Matrix/Synapse deployment on Rocky Linux 9-family systems
- encrypted browser chat, direct messages, private channels, replies, edits, deletion, reactions, attachments, search, pins, notifications, drafts, typing indicators, deep links, and mentions
- account and administrative lifecycle tooling
- Reminder Bot and DC Ops
- nightly PostgreSQL backups and recovery documentation
- SELinux Enforcing deployment with localhost-bound support services

## 1.0.0-rc4 - 2026-09-23

Release candidate after successful clean-host installation validation.

### Fixed

- enable Matrix timeline support for Reminder Source context loading
- preserve the improved deployment prerequisite and installation documentation

### Validation

- clean installation completed successfully on a fresh supported host
- RC4 remains subject to exact-artifact clean-install regression, browser regression, backup validation, and recovery validation before final 1.0.0

## 1.0.0-rc3 - 2026-09-22

Clean-install hardening release candidate.

### Fixed

- install `rsync`, which is required by frontend deployment
- install frontend dependencies with the pinned lockfile before building
- PostgreSQL backups now use the running container's configured database and user
- create an initial database backup during installation before DC Ops starts
- add PostgreSQL service dependency to the backup unit
- simplify and harden Synapse shared-secret registration HMAC generation
- require Reminder Bot and DC Ops in Community V1 so the packaged UI and health model remain internally consistent

## 1.0.0-rc2 - 2026-09-22

Community packaging release candidate.

### Added

- reusable Rocky Linux 9-family installer
- generated per-install secrets
- sanitized Synapse template
- Podman Quadlet templates
- nginx template
- initial administrator and service-account bootstrap
- SELinux and firewalld configuration
- release audit and reproducible source archive builder
- installation, admin, user, security, backup/recovery, troubleshooting, clean-install, and GitHub release documentation

### Changed

- frontend runtime configuration is installation-neutral
- Matrix server identity is runtime configurable
- service environment files use `/etc/dccoms`
- Community V1 uses canonical `/data/dccoms`
- Community reactions use standard Unicode only

### Removed

- production hostnames and private network references
- historical deployment previews/checkpoint metadata/backups
- private/custom character emoji packs
- development dependency trees
- generated runtime state
- production secrets and credentials

### Validation

Source release audit, packaged-artifact audit, private-reference scan, secret/runtime scan, placeholder scan, shell syntax, and Python syntax have passed.

Fresh-host installation validation remains pending.

## 1.0.0-rc1 - 2026-09-22

Initial sanitized portable source artifact.
