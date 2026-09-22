# Synapse configuration

DC Coms does not ship production Matrix secrets.

The installer will create the Synapse configuration on the
target host and generate installation-specific secrets there.

The public repository must never contain:

- signing keys
- registration shared secrets
- database passwords
- access tokens
- recovery keys
- TLS private keys
- production homeserver.yaml files containing secrets
