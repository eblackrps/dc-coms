# DC Coms GitHub Release Procedure

This document is for maintainers preparing Community release candidates and final releases.

The public repository must contain only the sanitized Community source and its clean public history. Never import the private production repository or checkpoint history.

## Release principles

- publish from the sanitized Community tree only
- run the release audit before every release build
- never publish generated secrets, runtime state, TLS keys, Matrix signing keys, database files, or private production configuration
- treat a published Git tag as immutable
- if a published release candidate needs changes, create the next RC rather than moving the old tag
- test the actual packaged release artifact, not an uncommitted working tree
- promote final `v1.0.0` only after all validation gates pass

## Before committing release changes

Run:

```bash
./deploy/scripts/release-audit.sh
git diff --check
git status --short
```

Inspect every staged file before committing.

## Build a release candidate

Set `VERSION` to the new release candidate, for example:

```text
1.0.0-rc4
```

Update release-facing documentation and `CHANGELOG.md`, then run:

```bash
./deploy/scripts/release-audit.sh
./deploy/scripts/build-release.sh
```

The release builder creates:

```text
dc-coms-community-v<VERSION>.tar.gz
dc-coms-community-v<VERSION>.tar.gz.sha256
dc-coms-community-v<VERSION>.manifest.txt
```

Release artifacts are stored outside the source tree.

## Verify the packaged artifact

From the release-output directory:

```bash
sha256sum -c dc-coms-community-v<VERSION>.tar.gz.sha256
```

Extract the archive into a temporary directory and run the included release audit against the extracted copy.

Do not continue if either verification fails.

## Commit and push

The public repository uses the sanitized `main` branch.

Before pushing:

```bash
git diff --cached --check
git status --short
```

Confirm no generated or private files are staged.

Push only after the source audit passes.

## Tag the exact candidate

After the release commit is on `main`:

```bash
git tag -a   v<VERSION>   -m "DC Coms Community v<VERSION>"

git push origin v<VERSION>
```

Do not retag an already published candidate. Create the next RC if the source, documentation, installer, or packaged artifact changes materially.

## GitHub prerelease

Create a GitHub prerelease for RC builds and attach:

- `.tar.gz`
- `.tar.gz.sha256`
- `.manifest.txt`

The release notes should state that the candidate is not final until clean-host and recovery validation pass.

## Clean-host validation

Validate the exact downloaded release artifacts using [CLEAN-INSTALL-TEST.md](CLEAN-INSTALL-TEST.md).

Required gates include:

- source/package audit
- checksum verification
- fresh supported host
- clean installer preflight
- successful `--apply`
- service health
- security boundary validation
- initial/manual backup validation
- external HTTPS
- browser regression
- recovery validation before final GA

Record defects against the tested release version.

If code, installer behavior, required configuration, or release documentation changes after testing begins, cut another RC and retest the affected gates.

## Final v1.0.0

Final `v1.0.0` requires:

- clean-host installation passed
- browser regression passed
- service regression passed
- security regression passed
- backup verification passed
- recovery validation passed
- release audit passed
- packaged-artifact audit passed
- no unresolved release-blocking defects

Then:

1. set `VERSION=1.0.0`
2. update `CHANGELOG.md` and release-status text
3. rebuild and verify the final artifact
4. commit and push
5. tag `v1.0.0`
6. publish the final GitHub release
7. archive the validation evidence

Recommended GitHub repository protections include protected `main`, review before merging where practical, dependency alerts, secret scanning when available, private vulnerability reporting, and no force pushes to `main`.
