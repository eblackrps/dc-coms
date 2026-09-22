#!/usr/bin/env bash

umask 077

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" &&
  pwd
)"

REPO_ROOT="$(
  cd "$SCRIPT_DIR/../.." &&
  pwd
)"

CONFIG_FILE="$REPO_ROOT/deploy/install.env"
GENERATED="$REPO_ROOT/deploy/generated"
SECRETS="$GENERATED/secrets.env"
RENDERED="$GENERATED/rendered"

ACTION="check"

fail() {
  echo
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo
  echo "== $* =="
}

run() {
  "$@" ||
    fail "Command failed: $*"
}

case "${1:-}" in
  "")
    ACTION="check"
    ;;

  --check)
    ACTION="check"
    ;;

  --apply)
    ACTION="apply"
    ;;

  *)
    fail "Usage: $0 [--check|--apply]"
    ;;
esac

[ "$(id -u)" -eq 0 ] ||
  fail "Run the installer as root."

[ -f "$CONFIG_FILE" ] ||
  fail "Missing $CONFIG_FILE"

# shellcheck disable=SC1090
. "$CONFIG_FILE"

required="
DC_COMS_FQDN
DC_COMS_TIMEZONE
DC_COMS_ROOT
DC_COMS_WEB_ROOT
DC_COMS_CONFIG_ROOT
DC_COMS_TLS_CERT
DC_COMS_TLS_KEY
DC_COMS_POSTGRES_DB
DC_COMS_POSTGRES_USER
DC_COMS_ADMIN_LOCALPART
DC_COMS_ENABLE_REMINDER_BOT
DC_COMS_ENABLE_OPS_BOT
DC_COMS_SYNAPSE_IMAGE
DC_COMS_POSTGRES_IMAGE
"

for name in $required
do
  eval "value=\${$name:-}"

  [ -n "$value" ] ||
    fail "Missing configuration value: $name"
done

[ "$DC_COMS_ROOT" = "/data/dccoms" ] ||
  fail "Community V1 requires DC_COMS_ROOT=/data/dccoms"

[ "$DC_COMS_WEB_ROOT" = "/data/dccoms/preview" ] ||
  fail "Community V1 requires DC_COMS_WEB_ROOT=/data/dccoms/preview"

[ "$DC_COMS_CONFIG_ROOT" = "/etc/dccoms" ] ||
  fail "Community V1 requires DC_COMS_CONFIG_ROOT=/etc/dccoms"

case "$DC_COMS_ENABLE_REMINDER_BOT" in
  true|false) ;;
  *) fail "DC_COMS_ENABLE_REMINDER_BOT must be true or false" ;;
esac

case "$DC_COMS_ENABLE_OPS_BOT" in
  true|false) ;;
  *) fail "DC_COMS_ENABLE_OPS_BOT must be true or false" ;;
esac

case "$DC_COMS_FQDN" in
  *.*) ;;
  *) fail "DC_COMS_FQDN must be a fully-qualified domain name" ;;
esac

[ -r /etc/os-release ] ||
  fail "Unable to identify the operating system."

# shellcheck disable=SC1091
. /etc/os-release

OS_MAJOR="${VERSION_ID%%.*}"

case "$ID" in
  rocky|almalinux|rhel|centos) ;;
  *)
    fail \
      "Community V1 supports Rocky/Alma/RHEL-compatible Linux."
    ;;
esac

[ "$OS_MAJOR" = "9" ] ||
  fail "Community V1 currently supports major version 9."

echo
echo "========================================"
echo " DC COMS COMMUNITY V1"
echo "========================================"
echo
echo "Operating system: $PRETTY_NAME"
echo "FQDN:             $DC_COMS_FQDN"
echo "Timezone:         $DC_COMS_TIMEZONE"
echo "Install root:     $DC_COMS_ROOT"
echo "Web root:         $DC_COMS_WEB_ROOT"
echo "TLS certificate:  $DC_COMS_TLS_CERT"
echo "TLS private key:  $DC_COMS_TLS_KEY"
echo "Reminder Bot:     $DC_COMS_ENABLE_REMINDER_BOT"
echo "DC Ops:           $DC_COMS_ENABLE_OPS_BOT"
echo

if [ "$ACTION" = "check" ]; then
  echo "Configuration preflight: PASS"
  echo
  echo "No changes were made."
  exit 0
fi

case "$DC_COMS_FQDN" in
  *.invalid|example.com|*.example.com)
    fail \
      "Replace the example FQDN before using --apply."
    ;;
esac

[ -r "$DC_COMS_TLS_CERT" ] ||
  fail "TLS certificate is not readable: $DC_COMS_TLS_CERT"

[ -r "$DC_COMS_TLS_KEY" ] ||
  fail "TLS private key is not readable: $DC_COMS_TLS_KEY"

[ -d "$REPO_ROOT/frontend-src" ] ||
  fail "Missing frontend-src"

[ -d "$REPO_ROOT/bots/reminder-bot" ] ||
  fail "Missing Reminder Bot source"

[ -d "$REPO_ROOT/bots/ops-bot" ] ||
  fail "Missing DC Ops source"

if [ -e /etc/dccoms/.community-installed ]; then
  fail \
    "DC Coms Community is already installed. This installer is not an upgrade tool."
fi

if \
  [ -d /data/dccoms ] &&
  [ -n "$(
    find /data/dccoms \
      -mindepth 1 \
      -maxdepth 1 \
      -print \
      -quit \
      2>/dev/null
  )" ] &&
  [ ! -e /etc/dccoms/.community-install-in-progress ]
then
  fail \
    "Existing /data/dccoms content detected. Refusing to modify an existing installation."
fi

info "Install host packages"

run dnf install -y \
  podman \
  nginx \
  python3 \
  openssl \
  curl \
  firewalld \
  policycoreutils-python-utils

for command in \
  podman \
  nginx \
  python3 \
  openssl \
  curl \
  firewall-cmd \
  semanage \
  restorecon \
  setsebool
do
  command -v "$command" >/dev/null 2>&1 ||
    fail "Required command is unavailable: $command"
done

info "Create installation marker"

run install \
  -d \
  -m 0700 \
  /etc/dccoms

run touch \
  /etc/dccoms/.community-install-in-progress

info "Generate installation secrets"

if [ ! -f "$SECRETS" ]; then
  run \
    "$REPO_ROOT/deploy/scripts/generate-secrets.sh"
fi

grep -q \
  '^DC_COMS_ADMIN_PASSWORD=' \
  "$SECRETS" ||
  fail \
    "Generated secrets are from an older installer. Remove deploy/generated and rerun."

info "Render installation configuration"

run \
  "$REPO_ROOT/deploy/scripts/render-install.sh"

info "Create service account"

if ! getent passwd dccomsreset >/dev/null 2>&1; then
  run useradd \
    --system \
    --home-dir /var/lib/dccoms-reset \
    --shell /sbin/nologin \
    dccomsreset
fi

info "Create filesystem layout"

run install \
  -d \
  -m 0700 \
  -o 999 \
  -g 999 \
  /data/dccoms/postgres

run install \
  -d \
  -m 0750 \
  -o 991 \
  -g 991 \
  /data/dccoms/synapse

run install \
  -d \
  -m 0700 \
  /data/dccoms/backups

run install \
  -d \
  -m 0700 \
  /data/dccoms/reminder-bot

run install \
  -d \
  -m 0700 \
  /data/dccoms/reminder-bot/store

run install \
  -d \
  -m 0700 \
  /data/dccoms/ops-bot

run install \
  -d \
  -m 0700 \
  /data/dccoms/ops-bot/store

run install \
  -d \
  -m 0755 \
  /data/dccoms/preview

run install \
  -d \
  -m 0755 \
  /data/dccoms/web-src

run install \
  -d \
  -m 0700 \
  -o dccomsreset \
  -g dccomsreset \
  /var/lib/dccoms-reset

info "Install Synapse configuration"

run install \
  -m 0600 \
  "$RENDERED/data/dccoms/synapse/homeserver.yaml" \
  /data/dccoms/synapse/homeserver.yaml

run chown \
  991:991 \
  /data/dccoms/synapse/homeserver.yaml

info "Install protected environment files"

for file in \
  postgres.env \
  dccoms-reset.env \
  dccoms-reminder.env \
  dccoms-ops.env \
  dccoms-ops-collector.env
do
  run install \
    -m 0600 \
    "$RENDERED/etc/dccoms/$file" \
    "/etc/dccoms/$file"
done

info "Install Podman Quadlets"

run install \
  -d \
  -m 0755 \
  /etc/containers/systemd

for file in \
  dccoms.network \
  dccoms-postgres.container \
  dccoms-synapse.container
do
  run install \
    -m 0644 \
    "$RENDERED/etc/containers/systemd/$file" \
    "/etc/containers/systemd/$file"
done

info "Install nginx configuration"

run install \
  -m 0644 \
  "$RENDERED/etc/nginx/conf.d/dccoms.conf" \
  /etc/nginx/conf.d/dccoms.conf

info "Install support programs"

run install \
  -d \
  -m 0755 \
  /usr/local/libexec

run install \
  -d \
  -m 0755 \
  /usr/local/sbin

for file in \
  dccoms-admin-api.py \
  dccoms-reset-api.py \
  dccoms-ops-collector.py
do
  run install \
    -m 0755 \
    "$REPO_ROOT/deploy/scripts/$file" \
    "/usr/local/libexec/$file"
done

for file in \
  dccoms-db-backup.sh \
  dccoms-storage-check.sh \
  dccoms-storage-status \
  dccoms-build-deploy-frontend
do
  run install \
    -m 0755 \
    "$REPO_ROOT/deploy/scripts/$file" \
    "/usr/local/sbin/$file"
done

info "Install systemd units"

for unit in \
  "$REPO_ROOT"/deploy/systemd/*.service \
  "$REPO_ROOT"/deploy/systemd/*.timer
do
  run install \
    -m 0644 \
    "$unit" \
    "/etc/systemd/system/$(basename "$unit")"
done

info "Install frontend source"

run rm -rf \
  /data/dccoms/web-src

run /usr/bin/cp -af \
  "$REPO_ROOT/frontend-src" \
  /data/dccoms/web-src

info "Pull core container images"

run podman pull \
  "$DC_COMS_POSTGRES_IMAGE"

run podman pull \
  "$DC_COMS_SYNAPSE_IMAGE"

info "Build DC Coms frontend"

run \
  /usr/local/sbin/dccoms-build-deploy-frontend

run install \
  -m 0644 \
  "$RENDERED/data/dccoms/preview/config.js" \
  /data/dccoms/preview/config.js

info "Build service containers"

if [ "$DC_COMS_ENABLE_REMINDER_BOT" = "true" ]; then
  run podman build \
    -t localhost/dccoms-reminder-bot:0.1 \
    "$REPO_ROOT/bots/reminder-bot"
fi

if [ "$DC_COMS_ENABLE_OPS_BOT" = "true" ]; then
  run podman build \
    -t localhost/dccoms-ops-bot:0.1 \
    "$REPO_ROOT/bots/ops-bot"
fi

info "Configure SELinux"

run setsebool \
  -P \
  httpd_can_network_connect \
  on

semanage fcontext \
  -a \
  -t httpd_sys_content_t \
  '/data/dccoms/preview(/.*)?' \
  >/dev/null 2>&1 ||
semanage fcontext \
  -m \
  -t httpd_sys_content_t \
  '/data/dccoms/preview(/.*)?' \
  >/dev/null 2>&1 ||
fail "Unable to configure DC Coms SELinux file context."

run restorecon \
  -RF \
  /data/dccoms/preview

info "Configure firewall"

run systemctl \
  enable \
  --now \
  firewalld

run firewall-cmd \
  --permanent \
  --add-service=https

run firewall-cmd \
  --reload

info "Reload systemd"

run systemctl \
  daemon-reload

info "Start PostgreSQL"

run systemctl \
  enable \
  --now \
  dccoms-postgres.service

POSTGRES_READY=false

for _ in $(seq 1 60)
do
  if podman exec \
    dccoms-postgres \
    pg_isready \
    -U "$DC_COMS_POSTGRES_USER" \
    -d "$DC_COMS_POSTGRES_DB" \
    >/dev/null 2>&1
  then
    POSTGRES_READY=true
    break
  fi

  sleep 1
done

[ "$POSTGRES_READY" = "true" ] ||
  fail "PostgreSQL did not become ready."

info "Start Synapse"

run systemctl \
  enable \
  --now \
  dccoms-synapse.service

SYNAPSE_READY=false

for _ in $(seq 1 90)
do
  if curl \
    --fail \
    --silent \
    http://127.0.0.1:8008/_matrix/client/versions \
    >/dev/null 2>&1
  then
    SYNAPSE_READY=true
    break
  fi

  sleep 1
done

[ "$SYNAPSE_READY" = "true" ] ||
  fail "Synapse did not become ready."

info "Bootstrap Matrix accounts"

if [ ! -e /etc/dccoms/.accounts-bootstrapped ]; then
  run \
    "$REPO_ROOT/deploy/scripts/bootstrap-accounts.sh"

  run touch \
    /etc/dccoms/.accounts-bootstrapped
fi

info "Preserve initial administrator credential"

# shellcheck disable=SC1090
. "$SECRETS"

ADMIN_CREDENTIAL_FILE="/root/dccoms-initial-admin.txt"

{
  echo "DC Coms initial administrator"
  echo
  echo "Username: @$DC_COMS_ADMIN_LOCALPART:$DC_COMS_FQDN"
  echo "Password: $DC_COMS_ADMIN_PASSWORD"
  echo
  echo "Change this password after the first successful login."
  echo "Then securely delete this file."
} > "$ADMIN_CREDENTIAL_FILE"

run chmod \
  0600 \
  "$ADMIN_CREDENTIAL_FILE"

unset DC_COMS_ADMIN_PASSWORD

info "Validate nginx"

run nginx -t

info "Start DC Coms application services"

run systemctl \
  enable \
  --now \
  dccoms-admin-api.service

run systemctl \
  enable \
  --now \
  dccoms-reset-api.service

run systemctl \
  enable \
  --now \
  nginx

if [ "$DC_COMS_ENABLE_REMINDER_BOT" = "true" ]; then
  run systemctl \
    enable \
    --now \
    dccoms-reminder-bot.service
fi

if [ "$DC_COMS_ENABLE_OPS_BOT" = "true" ]; then
  run systemctl \
    enable \
    --now \
    dccoms-ops-collector.service

  run systemctl \
    enable \
    --now \
    dccoms-ops-bot.service
fi

run systemctl \
  enable \
  --now \
  dccoms-db-backup.timer

run systemctl \
  enable \
  --now \
  dccoms-storage-check.timer

info "Final local health checks"

for service in \
  dccoms-postgres.service \
  dccoms-synapse.service \
  dccoms-admin-api.service \
  dccoms-reset-api.service \
  nginx
do
  systemctl is-active \
    --quiet \
    "$service" ||
    fail "Service is not active: $service"
done

if [ "$DC_COMS_ENABLE_REMINDER_BOT" = "true" ]; then
  systemctl is-active \
    --quiet \
    dccoms-reminder-bot.service ||
    fail "Reminder Bot is not active."
fi

if [ "$DC_COMS_ENABLE_OPS_BOT" = "true" ]; then
  systemctl is-active \
    --quiet \
    dccoms-ops-collector.service ||
    fail "DC Ops collector is not active."

  systemctl is-active \
    --quiet \
    dccoms-ops-bot.service ||
    fail "DC Ops bot is not active."
fi

run curl \
  --fail \
  --silent \
  http://127.0.0.1:8008/_matrix/client/versions \
  >/dev/null

info "Finalize installation"

run rm -f \
  /etc/dccoms/.community-install-in-progress

run touch \
  /etc/dccoms/.community-installed

run rm -rf \
  "$GENERATED"

echo
echo "========================================"
echo " DC COMS INSTALLATION COMPLETE"
echo "========================================"
echo
echo "URL:"
echo "  https://$DC_COMS_FQDN"
echo
echo "Initial administrator credentials:"
echo "  $ADMIN_CREDENTIAL_FILE"
echo
echo "After first login:"
echo "  1. Change the administrator password."
echo "  2. Securely delete the credential file."
echo
echo "SELinux remains enforcing."
echo "Only HTTPS was added to the firewall."
echo "Matrix and support APIs remain localhost-only."
echo
