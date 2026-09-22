# DC Coms Administrator Guide

## Accounts

The initial human administrator is created from `DC_COMS_ADMIN_LOCALPART` and is a Synapse administrator.

`@dcreset:<server>` is a protected Synapse-admin service account used only for controlled password-reset operations. Do not use it interactively.

`@reminderbot:<server>` and `@dcops:<server>` are ordinary Matrix users and are not Synapse administrators.

## Administration

DC Coms supports listing users, creating users, issuing setup/reset codes, locking users, revoking sessions when locking, deactivating users, protecting administrator accounts from ordinary UI management, and administrative room deletion.

Administrator actions use the logged-in administrator's Matrix session.

The room-delete API listens on `127.0.0.1:8010` and forwards the human administrator's authorization to Synapse; it does not maintain its own Matrix identity.

## Status and Logs

```bash
systemctl status   dccoms-postgres.service   dccoms-synapse.service   dccoms-admin-api.service   dccoms-reset-api.service   nginx

systemctl status dccoms-reminder-bot.service
systemctl status dccoms-ops-collector.service dccoms-ops-bot.service
systemctl list-timers 'dccoms-*'
```

Examples:

```bash
journalctl -fu dccoms-synapse.service
journalctl -u dccoms-reset-api.service
journalctl -u dccoms-reminder-bot.service
journalctl -u dccoms-ops-bot.service
```

Protected configuration is under `/etc/dccoms`. Synapse data is under `/data/dccoms/synapse`. The signing key is durable server identity material and must be preserved. The deployed frontend is `/data/dccoms/preview`.

Do not expose ports 8008, 8010, 8011, or 8012 externally.
