# DC Coms Clean Install Test

Use a disposable fresh Rocky Linux 9-family VM. Do not run this test on production.

## Preflight

```bash
cat /etc/os-release
getenforce
test ! -e /data/dccoms && echo CLEAN
test ! -e /etc/dccoms && echo CLEAN
```

## Verify and Extract

```bash
sha256sum -c dc-coms-community-v1.0.0-rc3.tar.gz.sha256
tar -xzf dc-coms-community-v1.0.0-rc3.tar.gz
cd dc-coms-community-v1.0.0-rc3
./deploy/scripts/release-audit.sh
```

Expected: `DC Coms Community release audit: PASS`.

## Configure and Install

```bash
cp deploy/install.env.example deploy/install.env
vi deploy/install.env
./deploy/scripts/install.sh --check
./deploy/scripts/install.sh --apply
```

Set the real test FQDN, timezone, TLS certificate path, and TLS key path.

## Validate Services

```bash
systemctl is-active dccoms-postgres.service
systemctl is-active dccoms-synapse.service
systemctl is-active dccoms-admin-api.service
systemctl is-active dccoms-reset-api.service
systemctl is-active nginx
systemctl is-active dccoms-reminder-bot.service
systemctl is-active dccoms-ops-collector.service
systemctl is-active dccoms-ops-bot.service
curl -f http://127.0.0.1:8008/_matrix/client/versions
nginx -t
```

## Browser Regression

Validate administrator login/password change, user creation, setup/reset code, second-user login, DMs, channels, messaging, replies, edits, deletion, reactions, emoji, attachments, search, pins, mentions, drafts, typing indicators, notifications, room rename/topic, password reset, sessions, room deletion, Reminder Bot, DC Ops, logout, desktop layout, and narrow layout.

## Security Regression

Confirm no service unexpectedly listens publicly on 8008, 8010, 8011, or 8012.

```bash
getsebool httpd_can_network_connect
ausearch -m AVC -ts recent
```

Promote to final `1.0.0` only after the clean-host test passes.
