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

The Synapse signing key under `/data/dccoms/synapse` is durable server identity material. Do not regenerate it during a normal restore of the same homeserver.

Database recovery alone does not restore uploaded Synapse media.

Reminder Bot and DC Ops directories may contain persistent state and encrypted Matrix session/store material.

Files under `/etc/dccoms` contain generated credentials and must be treated as secrets.

Restore the same server identity, database, Synapse state, bot state, and protected credentials together.

End-to-end recovery must be validated on disposable infrastructure before final Community `1.0.0`.
