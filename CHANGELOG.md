# Changelog

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
