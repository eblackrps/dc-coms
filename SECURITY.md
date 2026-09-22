# DC Coms Security

Community V1 is designed as a private communication service behind nginx HTTPS.

SELinux is expected to remain `Enforcing`. The installer configures only the nginx permissions required by DC Coms.

The installer adds HTTPS to firewalld and does not intentionally expose ports 8008, 8010, 8011, or 8012.

Public Matrix registration and guest access are disabled.

Fresh secrets are generated locally during installation. Generated configuration and common secret/runtime file types are excluded by `.gitignore`.

Initial administrator credentials are temporarily written to `/root/dccoms-initial-admin.txt`. Delete this file after successfully changing the password.

The password-reset identity is a Synapse administrator because it performs controlled administrative password operations. Reminder Bot and DC Ops are ordinary Matrix users.

Support APIs are bound to localhost. Do not change them to `0.0.0.0` without an explicit security review.

Community V1 expects an administrator-supplied TLS certificate and private key.

Backups may contain messages, account information, encrypted application state, server identity, bot state, and service credentials. Treat them as sensitive.

Never commit generated install configuration, secret-bearing `.env` files, Matrix signing keys, TLS private keys, Matrix access tokens, database dumps, SQLite runtime databases, or production configuration containing credentials.

Before release:

```bash
./deploy/scripts/release-audit.sh
```

Do not publish credentials, sensitive production logs, or exploit details in a public issue. Prefer private maintainer contact or GitHub private vulnerability reporting.
