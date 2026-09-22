#!/usr/bin/env bash

umask 077

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" &&
  pwd
)"

GENERATED_DIR="$SCRIPT_DIR/../generated"
SECRET_FILE="$GENERATED_DIR/secrets.env"

mkdir -p "$GENERATED_DIR"
chmod 700 "$GENERATED_DIR"

if [ -e "$SECRET_FILE" ]; then
  echo "Secret file already exists:"
  echo "$SECRET_FILE"
  echo
  echo "Refusing to overwrite existing installation secrets."
  exit 1
fi

random_hex() {
  openssl rand -hex "$1"
}

POSTGRES_PASSWORD="$(random_hex 32)"
REGISTRATION_SECRET="$(random_hex 32)"
ADMIN_PASSWORD="$(random_hex 24)"
RESET_SERVICE_PASSWORD="$(random_hex 24)"
REMINDER_PASSWORD="$(random_hex 24)"
OPS_PASSWORD="$(random_hex 24)"
OPS_COLLECTOR_TOKEN="$(random_hex 32)"

cat > "$SECRET_FILE" <<SECRETS
DC_COMS_POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DC_COMS_REGISTRATION_SHARED_SECRET=$REGISTRATION_SECRET
DC_COMS_ADMIN_PASSWORD=$ADMIN_PASSWORD
DC_COMS_RESET_SERVICE_PASSWORD=$RESET_SERVICE_PASSWORD
DC_COMS_REMINDER_PASSWORD=$REMINDER_PASSWORD
DC_COMS_OPS_PASSWORD=$OPS_PASSWORD
DC_COMS_OPS_COLLECTOR_TOKEN=$OPS_COLLECTOR_TOKEN
SECRETS

chmod 600 "$SECRET_FILE"

unset \
  POSTGRES_PASSWORD \
  REGISTRATION_SECRET \
  ADMIN_PASSWORD \
  RESET_SERVICE_PASSWORD \
  REMINDER_PASSWORD \
  OPS_PASSWORD \
  OPS_COLLECTOR_TOKEN

echo "Fresh installation secrets generated."
echo "Location:"
echo "$SECRET_FILE"
echo
echo "The secret values were not printed."
