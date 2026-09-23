# DC Coms Deployment Prerequisites

Complete this checklist before running the DC Coms installer.

Community V1 is a fresh-install deployment. It is not an upgrade, migration, repair, or overwrite workflow.

## 1. Supported host

Use a dedicated server or VM running one of the following:

- Rocky Linux 9
- AlmaLinux 9
- RHEL 9
- CentOS Stream 9

Other RHEL-compatible distributions are not currently validated by the Community V1 installer.

The host must use systemd and must support SELinux.

Run:

```bash
cat /etc/os-release
getenforce
```

Expected:

- operating-system major version: `9`
- SELinux: `Enforcing`

Do not disable SELinux for DC Coms.

## 2. Administrative access

The installer must run as `root`.

```bash
id -u
```

Expected:

```text
0
```

## 3. Fresh-host requirement

The Community installer is intentionally conservative. It refuses to overwrite an existing DC Coms installation.

Before installation, these paths must not contain an existing deployment:

```text
/data/dccoms
/etc/dccoms
```

Check:

```bash
test ! -e /data/dccoms && echo "/data/dccoms: clear"
test ! -e /etc/dccoms && echo "/etc/dccoms: clear"
```

If either path already contains DC Coms data, stop. Do not delete an existing deployment just to satisfy the installer.

## 4. DNS name

Choose the permanent fully qualified domain name before installation.

Example:

```text
chat.example.com
```

The name must resolve to the DC Coms server from the client networks that will use the service.

Check from the server:

```bash
FQDN=chat.example.com
getent hosts "$FQDN"
```

Also verify resolution from at least one intended client.

Changing the Matrix server identity later is not a normal hostname change. Choose the name carefully.

## 5. TLS certificate and private key

Community V1 does not request or manage TLS certificates.

Before installation, provide:

- a TLS certificate valid for the chosen FQDN
- the matching private key
- file paths that root can read

Typical example paths:

```text
/etc/pki/tls/certs/dccoms.crt
/etc/pki/tls/private/dccoms.key
```

Check:

```bash
TLS_CERT=/etc/pki/tls/certs/dccoms.crt
TLS_KEY=/etc/pki/tls/private/dccoms.key

test -r "$TLS_CERT" && echo "certificate readable"
test -r "$TLS_KEY" && echo "private key readable"
```

If OpenSSL is already installed, you can also inspect the certificate:

```bash
openssl x509   -in "$TLS_CERT"   -noout   -subject   -issuer   -dates   -ext subjectAltName
```

The certificate must include the DC Coms FQDN.

## 6. Network access

Required inbound access:

- TCP 443 from intended DC Coms clients
- SSH only if you use SSH to administer the host

Do not expose these DC Coms internal ports externally:

- 8008 - Synapse
- 8010 - narrow room-administration API
- 8011 - password-reset API
- 8012 - DC Ops collector

The installer configures nginx as the HTTPS entry point and adds the `https` service to firewalld.

Required outbound access includes:

- operating-system package repositories
- `docker.io`
- `ghcr.io`
- GitHub if the release archive is downloaded directly on the server

The host also needs working DNS resolution.

## 7. Time synchronization

Correct system time matters for TLS, Matrix sessions, logs, and scheduled jobs.

Check:

```bash
timedatectl
```

Confirm the clock is correct and time synchronization is active.

## 8. Storage

DC Coms uses these canonical locations:

```text
/data/dccoms
/etc/dccoms
```

Runtime data under `/data/dccoms` includes PostgreSQL data, Synapse data and media, bot state, frontend files, and local database backups.

Community V1 does not yet publish a validated minimum CPU, memory, or disk size. The clean-host release test records the VM resources used so a tested baseline can be published after validation.

Before deploying, ensure the filesystem backing `/data` has enough free space for:

- PostgreSQL
- Matrix media and attachments
- container images and frontend build output
- retained database backups
- expected growth

Check:

```bash
df -hT /
df -hT /data 2>/dev/null || true
```

If `/data` is not a separate filesystem, it will consume space from the filesystem that contains it.

## 9. What you do not need to preinstall

On a supported fresh host, the installer installs its host dependencies, including:

- Podman
- nginx
- rsync
- Python 3
- OpenSSL
- curl
- firewalld
- SELinux management utilities

The frontend build runs in a container and installs its pinned Node/pnpm dependencies from the included lockfile.

Do not manually install PostgreSQL, Synapse, Node.js, or pnpm on the host for a normal Community deployment.

## 10. Information to have ready

Before opening `deploy/install.env`, have these values ready:

| Setting | Meaning |
| --- | --- |
| `DC_COMS_FQDN` | permanent DC Coms hostname |
| `DC_COMS_TIMEZONE` | host/application timezone, for example `America/New_York` |
| `DC_COMS_TLS_CERT` | TLS certificate path |
| `DC_COMS_TLS_KEY` | matching private-key path |
| `DC_COMS_ADMIN_LOCALPART` | initial administrator username, without `@` or server name |

Community V1 uses these fixed paths:

```text
DC_COMS_ROOT=/data/dccoms
DC_COMS_WEB_ROOT=/data/dccoms/preview
DC_COMS_CONFIG_ROOT=/etc/dccoms
```

Reminder Bot and DC Ops are required in Community V1.

## 11. Final pre-install checklist

Do not continue until all applicable items are true:

- [ ] supported Rocky Linux 9, AlmaLinux 9, RHEL 9, or CentOS Stream 9 host
- [ ] root access
- [ ] SELinux is Enforcing
- [ ] system clock is correct
- [ ] no existing DC Coms deployment
- [ ] permanent FQDN selected
- [ ] FQDN resolves correctly
- [ ] valid TLS certificate available
- [ ] matching TLS private key available
- [ ] TCP 443 reachable by intended clients
- [ ] ports 8008, 8010, 8011, and 8012 are not intentionally exposed
- [ ] outbound package/container-registry access works
- [ ] adequate storage is available
- [ ] current release archive and checksum are available

When this checklist is complete, continue with [INSTALL.md](INSTALL.md).
