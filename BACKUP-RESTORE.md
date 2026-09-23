# DC Coms Backup and Restore

## Protect

At minimum preserve:

```text
/data/dccoms/backups
/data/dccoms/synapse
/data/dccoms/reminder-bot
/data/dccoms/ops-bot
/etc/dccoms
```

Also preserve or be able to reissue the TLS certificate and key.

Community V1 installs `dccoms-db-backup.service` and `dccoms-db-backup.timer`.

```bash
systemctl status dccoms-db-backup.timer
systemctl list-timers dccoms-db-backup.timer
systemctl start dccoms-db-backup.service
systemctl status dccoms-db-backup.service
```

Database backups are stored under `/data/dccoms/backups`.

Current main excludes data from Synapse's `e2e_one_time_keys_json` table when creating PostgreSQL dumps. Synapse documents that used one-time-key data should not be restored from an older database backup because previously used keys can be re-issued and cause later message-decryption failures.

The Synapse signing key under `/data/dccoms/synapse` is durable server identity material. Do not regenerate it during a normal restore of the same homeserver.

Database recovery alone does not restore uploaded Synapse media.

Reminder Bot and DC Ops directories may contain persistent state and encrypted Matrix session/store material.

Files under `/etc/dccoms` contain generated credentials and must be treated as secrets.

Restore the same server identity, database, Synapse state, bot state, and protected credentials together.

## Important: v1.0.1 and older full database dumps

The DC Coms v1.0.1 release created full PostgreSQL dumps that include `e2e_one_time_keys_json` data.

If restoring one of those dumps:

1. Restore the database into a clean database. Do not restore over an existing populated Synapse database.
2. Keep Synapse stopped after the database restore.
3. Before Synapse starts, truncate the restored one-time-key table:

```bash
podman exec dccoms-postgres \
  sh -lc \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "TRUNCATE e2e_one_time_keys_json;"'
```

4. Restore the remaining DC Coms server state described above.
5. Start Synapse and complete the recovery validation below.

This legacy-dump step follows the Synapse backup guidance for dumps that did not exclude `e2e_one_time_keys_json` at backup time.

## Recovery validation

A recovery is not proven by service startup alone. Validate it on disposable infrastructure before relying on the procedure for production recovery.

At minimum verify:

- Synapse and PostgreSQL start cleanly from the restored state
- the original homeserver/server identity is preserved
- Matrix media and attachments expected in the recovery set are available
- Reminder Bot and DC Ops state is usable
- existing users can authenticate
- two test users can exchange new end-to-end encrypted messages after recovery
- trusted-device, secret-storage, recovery-key, and encrypted-session-backup behavior is checked separately from server-state recovery
- an intentionally recovered user can decrypt expected historical encrypted messages when that user's client-side recovery material is available

A restored server cannot recreate a user's missing end-to-end encryption keys. Server recovery and user encrypted-history recovery remain separate requirements.
