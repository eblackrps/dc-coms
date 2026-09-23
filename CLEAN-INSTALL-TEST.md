# DC Coms Clean Install Test

This is the release-candidate validation procedure.

Use a disposable fresh Rocky Linux 9-family VM. Do not run this test on the private production DC Coms server.

The purpose of this test is to prove that a published Community release can be installed from its release artifact on a host that has no DC Coms history.

## Record the test environment

Before changing the VM, record:

```bash
date
cat /etc/os-release
uname -r
getenforce
nproc
free -h
df -hT
timedatectl
```

Keep the CPU, memory, and storage values with the test results. Community V1 does not yet publish a validated minimum resource baseline.

## Gate 1 - host prerequisites

Complete [PREREQUISITES.md](PREREQUISITES.md).

Confirm the VM is clean:

```bash
test ! -e /data/dccoms && echo "/data/dccoms: CLEAN"
test ! -e /etc/dccoms && echo "/etc/dccoms: CLEAN"
```

Expected: both lines report `CLEAN`.

## Gate 2 - artifact integrity

Use the actual release archive and checksum intended for publication.

For the current v1.0.1 release:

```bash
sha256sum -c dc-coms-community-v1.0.1.tar.gz.sha256

tar -xzf dc-coms-community-v1.0.1.tar.gz
cd dc-coms-community-v1.0.1

./deploy/scripts/release-audit.sh
```

Required results:

- SHA256 verification reports `OK`
- release audit reports `DC Coms Community release audit: PASS`

A failure here blocks the release.

## Gate 3 - configuration preflight

```bash
cp deploy/install.env.example deploy/install.env
vi deploy/install.env
```

Set the real test values for:

- FQDN
- timezone
- TLS certificate path
- TLS key path
- initial administrator localpart

Then run:

```bash
./deploy/scripts/install.sh --check
```

Required result:

```text
Configuration preflight: PASS
```

Confirm that `--check` did not create `/data/dccoms` or `/etc/dccoms`.

## Gate 4 - clean installation

Run:

```bash
./deploy/scripts/install.sh --apply
```

Required final banner:

```text
DC COMS INSTALLATION COMPLETE
```

Capture the complete console output for the validation record, but do not publish generated passwords or secret files.

## Gate 5 - service health

Every required service must be active:

```bash
for service in   dccoms-postgres.service   dccoms-synapse.service   dccoms-admin-api.service   dccoms-reset-api.service   dccoms-reminder-bot.service   dccoms-ops-collector.service   dccoms-ops-bot.service   nginx
do
  printf '%-36s' "$service"
  systemctl is-active "$service"
done
```

Check timers:

```bash
systemctl list-timers 'dccoms-*'
```

Check Matrix:

```bash
curl -fsS   http://127.0.0.1:8008/_matrix/client/versions   >/dev/null   && echo "Synapse API: PASS"
```

Check nginx:

```bash
nginx -t
```

Any required service that is not active blocks the release.

## Gate 6 - security boundaries

SELinux:

```bash
getenforce
getsebool httpd_can_network_connect
```

Required:

```text
Enforcing
httpd_can_network_connect --> on
```

Firewall:

```bash
firewall-cmd --get-active-zones
firewall-cmd --list-services
firewall-cmd --list-ports
```

Listener check:

```bash
ss -lntp   | grep -E ':(443|8008|8010|8011|8012)[[:space:]]'
```

Required design:

- 443: HTTPS entry point
- 8008: localhost only
- 8010: localhost only
- 8011: localhost only
- 8012: localhost only

Check recent SELinux denials:

```bash
ausearch -m AVC -ts recent
```

Investigate unexpected DC Coms-related AVC denials. Do not disable SELinux to make the test pass.

## Gate 7 - backup validation

A successful install should create an initial PostgreSQL backup.

```bash
ls -lh /data/dccoms/backups/
test -n "$(find /data/dccoms/backups -type f -name 'synapse-*.dump' -size +0c -print -quit)"   && echo "Initial database backup: PASS"
```

Run another backup manually:

```bash
systemctl start dccoms-db-backup.service
systemctl status dccoms-db-backup.service
ls -lh /data/dccoms/backups/
```

The backup service must complete successfully.

Full end-to-end recovery validation remains a separate final-release gate; see [BACKUP-RESTORE.md](BACKUP-RESTORE.md).

## Gate 8 - external HTTPS

From an intended client, verify:

- the FQDN resolves to the test server
- HTTPS opens without a certificate warning
- the DC Coms login page loads

Also verify that the internal service ports are not reachable as public application endpoints.

## Gate 9 - browser regression

Use at least two Matrix users and validate:

### Account and security

- administrator login
- administrator password change
- user creation
- setup/reset code
- second-user login
- session/device view
- session removal
- forgotten-password reset
- logout

### Messaging

- direct message
- private channel
- send/receive
- reply
- edit
- delete/redact
- standard reactions
- emoji
- encrypted attachment
- pasted image/file
- clickable URL
- message deep link
- search
- pin/unpin
- @mention
- draft persistence
- typing indicator
- unread state
- room rename
- room topic

### Notifications and layout

- browser notification permission and delivery
- unread favicon state
- mention favicon state
- desktop layout
- narrow/mobile-width layout

### Services

- Reminder Bot
- DC Ops
- administrative room deletion

Any material regression blocks final release.

## Gate 10 - release decision

The release candidate passes the clean-install gate only when:

- [ ] host prerequisites pass
- [ ] artifact checksum passes
- [ ] release audit passes
- [ ] configuration preflight passes
- [ ] clean install completes without manual code changes
- [ ] all required services are active
- [ ] security boundaries are correct
- [ ] initial and manual database backups succeed
- [ ] external HTTPS works correctly
- [ ] browser regression passes
- [ ] no unresolved release-blocking defects remain

Do not publish a GA release until the separate recovery-validation requirement has also been satisfied.
