# DC Coms Troubleshooting

Start with:

```bash
systemctl --no-pager --full status   dccoms-postgres.service   dccoms-synapse.service   dccoms-admin-api.service   dccoms-reset-api.service   nginx
```

Check Matrix:

```bash
curl -f http://127.0.0.1:8008/_matrix/client/versions
```

Check nginx:

```bash
nginx -t
systemctl status nginx
journalctl -u nginx
```

Check containers:

```bash
podman ps -a
```

SELinux should remain Enforcing:

```bash
getenforce
ausearch -m AVC -ts recent
getsebool httpd_can_network_connect
```

Expected:

```text
httpd_can_network_connect --> on
```

Do not disable SELinux as a workaround.

Firewall checks:

```bash
firewall-cmd --get-active-zones
firewall-cmd --list-services
firewall-cmd --list-ports
```

HTTPS should be allowed. Ports 8008, 8010, 8011, and 8012 should not require external exposure.

Password reset:

```bash
systemctl status dccoms-reset-api.service
journalctl -u dccoms-reset-api.service
```

Reminder Bot:

```bash
systemctl status dccoms-reminder-bot.service
journalctl -u dccoms-reminder-bot.service
```

DC Ops:

```bash
systemctl status dccoms-ops-collector.service dccoms-ops-bot.service
journalctl -u dccoms-ops-collector.service
journalctl -u dccoms-ops-bot.service
```

Frontend files live at `/data/dccoms/preview`; runtime browser config is `/data/dccoms/preview/config.js`.

Listener check:

```bash
ss -lntp | grep -E ':(443|8008|8010|8011|8012)[[:space:]]'
```
