import {
  useCallback,
  useEffect,
  useState,
} from 'react'

import type {
  MatrixClient,
} from 'matrix-js-sdk'

import {
  clearRecoveryKeyCache,
  hasCachedRecoveryKey,
  validateAndCacheRecoveryKey,
} from './RecoveryKeyCache'
import ChangeMyPassword from './ChangeMyPassword'
import AdminUserCreate from './AdminUserCreate'
import AdminUserManagement from './AdminUserManagement'
import AdminPasswordReset from './AdminPasswordReset'
import DeviceSessions from './DeviceSessions'

type SecuritySnapshot = {
  cryptoVersion: string

  deviceVerified: boolean | null
  deviceSignedByOwner: boolean | null
  deviceCrossSigned: boolean | null
  deviceLocallyVerified: boolean | null

  identityVerified: boolean

  crossSigningReady: boolean
  crossPublicKeys: boolean
  crossPrivateInSecretStorage: boolean
  crossPrivateCached: boolean

  secretStorageReady: boolean
  secretStorageKeyId: string | null
  storedSecretsReady: number
  storedSecretsTotal: number

  backupVersion: string | null
  backupKeyPresent: boolean
}

type Props = {
  client: MatrixClient
  userId: string
  deviceId: string
  onClose: () => void
}

type Tone =
  | 'good'
  | 'warn'
  | 'bad'
  | 'neutral'

function StatusRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: Tone
}) {
  return (
    <div className="security-status-row">
      <span className="security-status-label">
        {label}
      </span>

      <span
        className={
          `security-status-value ${tone}`
        }
      >
        <span
          className={
            `security-status-dot ${tone}`
          }
        />

        {value}
      </span>
    </div>
  )
}

function yesNo(
  value: boolean,
  yes = 'Ready',
  no = 'Not ready',
) {
  return value ? yes : no
}

export default function SecurityRecovery({
  client,
  userId,
  deviceId,
  onClose,
}: Props) {
  const [snapshot, setSnapshot] =
    useState<SecuritySnapshot | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState('')

  const [copyState, setCopyState] =
    useState('Copy Device ID')

  const [recoveryKey, setRecoveryKey] =
    useState('')

  const [
    recoveryUnlocked,
    setRecoveryUnlocked,
  ] = useState(
    hasCachedRecoveryKey(),
  )

  const [recoveryBusy, setRecoveryBusy] =
    useState(false)

  const [
    recoveryMessage,
    setRecoveryMessage,
  ] = useState('')

  const [backupBusy, setBackupBusy] =
    useState(false)

  const [
    backupMessage,
    setBackupMessage,
  ] = useState('')

  const refresh = useCallback(
    async () => {
      setLoading(true)
      setError('')

      try {
        const crypto =
          client.getCrypto()

        if (!crypto) {
          throw new Error(
            'Rust Crypto is not initialized.',
          )
        }

        try {
          await crypto.getUserDeviceInfo(
            [userId],
            true,
          )
        } catch (err) {
          console.debug(
            'Device info refresh skipped:',
            err,
          )
        }

        const cryptoVersion =
          crypto.getVersion()

        const deviceStatus =
          await crypto
            .getDeviceVerificationStatus(
              userId,
              deviceId,
            )

        const identityStatus =
          await crypto
            .getUserVerificationStatus(
              userId,
            )

        const crossSigningReady =
          await crypto
            .isCrossSigningReady()

        const crossStatus =
          await crypto
            .getCrossSigningStatus()

        const secretStatus =
          await crypto
            .getSecretStorageStatus()

        const backupVersion =
          await crypto
            .getActiveSessionBackupVersion()

        const backupKey =
          await crypto
            .getSessionBackupPrivateKey()

        const cached =
          crossStatus
            .privateKeysCachedLocally

        const validityEntries =
          Object.values(
            secretStatus
              .secretStorageKeyValidityMap,
          )

        setSnapshot({
          cryptoVersion,

          deviceVerified:
            deviceStatus
              ? deviceStatus.isVerified()
              : null,

          deviceSignedByOwner:
            deviceStatus
              ? deviceStatus.signedByOwner
              : null,

          deviceCrossSigned:
            deviceStatus
              ? deviceStatus
                  .crossSigningVerified
              : null,

          deviceLocallyVerified:
            deviceStatus
              ? deviceStatus.localVerified
              : null,

          identityVerified:
            identityStatus.isVerified(),

          crossSigningReady,

          crossPublicKeys:
            crossStatus.publicKeysOnDevice,

          crossPrivateInSecretStorage:
            crossStatus
              .privateKeysInSecretStorage,

          crossPrivateCached:
            Boolean(cached.masterKey) &&
            Boolean(
              cached.selfSigningKey,
            ) &&
            Boolean(
              cached.userSigningKey,
            ),

          secretStorageReady:
            secretStatus.ready,

          secretStorageKeyId:
            secretStatus.defaultKeyId,

          storedSecretsReady:
            validityEntries
              .filter(Boolean)
              .length,

          storedSecretsTotal:
            validityEntries.length,

          backupVersion,

          backupKeyPresent:
            backupKey !== null,
        })
      } catch (err) {
        console.error(
          'Security status refresh failed:',
          err,
        )

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to read security status.',
        )
      } finally {
        setLoading(false)
      }
    },
    [
      client,
      userId,
      deviceId,
    ],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const handleKey =
      (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          onClose()
        }
      }

    window.addEventListener(
      'keydown',
      handleKey,
    )

    return () => {
      window.removeEventListener(
        'keydown',
        handleKey,
      )
    }
  }, [onClose])

  async function copyDeviceId() {
    try {
      await navigator.clipboard
        .writeText(deviceId)

      setCopyState('Copied')

      window.setTimeout(
        () => {
          setCopyState(
            'Copy Device ID',
          )
        },
        1500,
      )
    } catch (err) {
      console.warn(
        'Clipboard copy failed:',
        err,
      )

      setCopyState('Copy failed')
    }
  }

  async function unlockRecoveryStorage(
    event: React.FormEvent,
  ) {
    event.preventDefault()

    if (!recoveryKey.trim()) {
      setRecoveryMessage(
        'Enter your recovery key.',
      )
      return
    }

    setRecoveryBusy(true)
    setRecoveryMessage('')
    setBackupMessage('')

    try {
      await validateAndCacheRecoveryKey(
        client,
        recoveryKey,
      )

      const crypto =
        client.getCrypto()

      if (!crypto) {
        throw new Error(
          'Rust Crypto is not initialized.',
        )
      }

      /*
       * IMPORTANT:
       * setupNewCrossSigning is explicitly false.
       * We are restoring the existing identity,
       * not generating a new one.
       */
      await crypto.bootstrapCrossSigning({
        setupNewCrossSigning: false,
      })

      /*
       * bootstrapCrossSigning normally
       * signs this device. If the current
       * device still lacks the owner
       * signature, sign it explicitly
       * with the restored self-signing key.
       */
      const deviceStatus =
        await crypto
          .getDeviceVerificationStatus(
            userId,
            deviceId,
          )

      if (
        deviceStatus &&
        !deviceStatus.signedByOwner
      ) {
        await crypto.crossSignDevice(
          deviceId,
        )
      }

      setRecoveryKey('')
      setRecoveryUnlocked(true)

      setRecoveryMessage(
        'Recovery storage unlocked. Existing cross-signing keys were loaded into this device.',
      )

      await refresh()
    } catch (err) {
      console.error(
        'Recovery unlock failed:',
        err,
      )

      clearRecoveryKeyCache()
      setRecoveryUnlocked(false)

      setRecoveryMessage(
        err instanceof Error
          ? err.message
          : 'Unable to unlock recovery storage.',
      )
    } finally {
      setRecoveryBusy(false)
    }
  }

  async function enableKeyBackup() {
    if (!hasCachedRecoveryKey()) {
      setBackupMessage(
        'Unlock recovery storage first.',
      )
      return
    }

    setBackupBusy(true)
    setBackupMessage('')

    try {
      const crypto =
        client.getCrypto()

      if (!crypto) {
        throw new Error(
          'Rust Crypto is not initialized.',
        )
      }

      const existing =
        await crypto
          .checkKeyBackupAndEnable()

      if (existing === null) {
        /*
         * No server-side backup exists.
         * Create one. Because secret
         * storage is configured and the
         * recovery key is cached, the
         * backup decryption key will also
         * be saved into secret storage.
         */
        await crypto.resetKeyBackup()

        setBackupMessage(
          'Encrypted session backup created and enabled.',
        )
      } else {
        /*
         * Never replace an existing
         * backup automatically. Load its
         * decryption key from secret
         * storage and enable it.
         */
        await crypto
          .loadSessionBackupPrivateKeyFromSecretStorage()

        await crypto
          .checkKeyBackupAndEnable()

        setBackupMessage(
          'Existing encrypted session backup loaded and enabled.',
        )
      }

      await refresh()
    } catch (err) {
      console.error(
        'Backup setup failed:',
        err,
      )

      setBackupMessage(
        err instanceof Error
          ? err.message
          : 'Unable to enable encrypted session backup.',
      )
    } finally {
      setBackupBusy(false)
    }
  }

  function forgetRecoveryKey() {
    clearRecoveryKeyCache()

    setRecoveryKey('')
    setRecoveryUnlocked(false)

    setRecoveryMessage(
      'Recovery key removed from this browser tab memory.',
    )
  }

  const recoveryReady =
    Boolean(snapshot) &&
    snapshot!.deviceVerified === true &&
    snapshot!.identityVerified &&
    snapshot!.crossSigningReady &&
    snapshot!.secretStorageReady &&
    Boolean(snapshot!.backupVersion) &&
    snapshot!.backupKeyPresent

  const warnings: string[] = []

  if (snapshot) {
    if (
      snapshot.deviceVerified !== true
    ) {
      warnings.push(
        'This browser device is not currently verified.',
      )
    }

    if (
      !snapshot.crossSigningReady
    ) {
      warnings.push(
        'Cross-signing is not fully ready on this device.',
      )
    }

    if (
      !snapshot.secretStorageReady
    ) {
      warnings.push(
        'Secret storage is incomplete or unavailable.',
      )
    }

    if (
      !snapshot.backupVersion
    ) {
      warnings.push(
        'No trusted automatic encrypted-session backup is active.',
      )
    } else if (
      !snapshot.backupKeyPresent
    ) {
      warnings.push(
        'Encrypted-session backup is active, but this browser does not currently cache its decryption key.',
      )
    }
  }

  return (
    <div
      className="security-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose()
        }
      }}
    >
      <section
        className="security-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Security and Recovery"
      >
        <header
          className="security-panel-header"
        >
          <div>
            <div
              className="security-eyebrow"
            >
              DC COMS
            </div>

            <h2>
              Security & Recovery
            </h2>

            <p>
              Live status from this
              Matrix device and its
              Rust Crypto store.
            </p>
          </div>

          <button
            type="button"
            className="security-close"
            onClick={onClose}
            aria-label="Close Security and Recovery"
          >
            ×
          </button>
        </header>

        <div
          className={
            recoveryReady
              ? 'security-summary ready'
              : 'security-summary attention'
          }
        >
          <div
            className="security-summary-icon"
          >
            {recoveryReady
              ? '✓'
              : '!'}
          </div>

          <div>
            <strong>
              {recoveryReady
                ? 'Recovery posture looks good'
                : 'Recovery attention required'}
            </strong>

            <span>
              {recoveryReady
                ? 'This device has the crypto state required for encrypted messaging and session-backup recovery.'
                : 'Finish the recovery steps below before relying on this browser for encrypted-history recovery.'}
            </span>
          </div>
        </div>

        <div
          className="security-actions"
        >
          <button
            type="button"
            onClick={() => {
              void refresh()
            }}
            disabled={loading}
          >
            {loading
              ? 'Refreshing...'
              : 'Refresh Security Status'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => {
              void copyDeviceId()
            }}
          >
            {copyState}
          </button>
        </div>

        {error && (
          <div
            className="security-error"
          >
            {error}
          </div>
        )}

        <div
          className="security-identity-card"
        >
          <div
            className="security-card-heading"
          >
            Current session
          </div>

          <div
            className="security-identity-grid"
          >
            <div>
              <span>User</span>
              <strong>{userId}</strong>
            </div>

            <div>
              <span>Device ID</span>
              <strong>{deviceId}</strong>
            </div>

            <div>
              <span>Crypto engine</span>
              <strong>
                {snapshot
                  ? snapshot.cryptoVersion
                  : loading
                    ? 'Loading...'
                    : 'Unavailable'}
              </strong>
            </div>
          </div>
        </div>

        <div
          className="security-recovery-card"
        >
          <div
            className="security-card-heading"
          >
            Recovery
          </div>

          {recoveryReady &&
          !recoveryUnlocked ? (
            <div
              className="security-recovery-configured"
            >
              <div
                className="security-recovery-configured-icon"
              >
                ✓
              </div>

              <div>
                <strong>
                  Recovery configured
                </strong>

                <span>
                  Cross-signing, secret storage,
                  and encrypted history backup are
                  healthy. Your recovery key is not
                  required for normal use.
                </span>
              </div>
            </div>
          ) : !recoveryUnlocked ? (
            <>
              <p
                className="security-recovery-copy"
              >
                Enter the existing recovery
                key to unlock this account's
                encrypted secret storage.
                The key stays in memory in
                this browser tab and is not
                stored in localStorage.
              </p>

              <form
                className="security-recovery-form"
                onSubmit={
                  unlockRecoveryStorage
                }
              >
                <input
                  type="password"
                  value={recoveryKey}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Enter recovery key"
                  onChange={(event) =>
                    setRecoveryKey(
                      event.target.value,
                    )
                  }
                  disabled={recoveryBusy}
                />

                <button
                  disabled={
                    recoveryBusy ||
                    !recoveryKey.trim()
                  }
                >
                  {recoveryBusy
                    ? 'Unlocking...'
                    : 'Unlock Recovery Storage'}
                </button>
              </form>
            </>
          ) : (
            <div
              className="security-recovery-unlocked"
            >
              <div>
                <span
                  className="security-status-dot good"
                />

                <strong>
                  Recovery storage unlocked
                </strong>
              </div>

              <button
                type="button"
                onClick={
                  forgetRecoveryKey
                }
              >
                Forget Key From This Tab
              </button>
            </div>
          )}

          {recoveryMessage && (
            <div
              className={
                recoveryUnlocked
                  ? 'security-inline-message good'
                  : 'security-inline-message'
              }
            >
              {recoveryMessage}
            </div>
          )}

          {recoveryUnlocked &&
            snapshot &&
            (
              !snapshot.backupVersion ||
              !snapshot.backupKeyPresent
            ) && (
              <div
                className="security-backup-setup"
              >
                <div>
                  <strong>
                    Encrypted history backup
                  </strong>

                  <span>
                    Protect the room keys
                    currently held by this
                    device and future room
                    keys with Matrix
                    server-side key backup.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void enableKeyBackup()
                  }}
                  disabled={backupBusy}
                >
                  {backupBusy
                    ? 'Configuring...'
                    : snapshot.backupVersion
                      ? 'Enable Existing Backup'
                      : 'Create Encrypted History Backup'}
                </button>
              </div>
            )}

          {backupMessage && (
            <div
              className="security-inline-message good"
            >
              {backupMessage}
            </div>
          )}
        </div>

        {snapshot && (
          <>
            <div
              className="security-grid"
            >
              <div
                className="security-card"
              >
                <div
                  className="security-card-heading"
                >
                  Device trust
                </div>

                <StatusRow
                  label="Current device"
                  value={
                    snapshot.deviceVerified === null
                      ? 'Unknown'
                      : snapshot.deviceVerified
                        ? 'Verified'
                        : 'Unverified'
                  }
                  tone={
                    snapshot.deviceVerified
                      ? 'good'
                      : 'warn'
                  }
                />

                <StatusRow
                  label="Signed by owner"
                  value={yesNo(
                    snapshot.deviceSignedByOwner === true,
                    'Yes',
                    'No',
                  )}
                  tone={
                    snapshot.deviceSignedByOwner
                      ? 'good'
                      : 'warn'
                  }
                />

                <StatusRow
                  label="Cross-signed"
                  value={yesNo(
                    snapshot.deviceCrossSigned === true,
                    'Yes',
                    'No',
                  )}
                  tone={
                    snapshot.deviceCrossSigned
                      ? 'good'
                      : 'warn'
                  }
                />

                <StatusRow
                  label="Locally verified"
                  value={yesNo(
                    snapshot.deviceLocallyVerified === true,
                    'Yes',
                    'No',
                  )}
                  tone={
                    snapshot.deviceLocallyVerified
                      ? 'good'
                      : 'neutral'
                  }
                />

                <StatusRow
                  label="Account identity"
                  value={yesNo(
                    snapshot.identityVerified,
                    'Verified',
                    'Not verified',
                  )}
                  tone={
                    snapshot.identityVerified
                      ? 'good'
                      : 'warn'
                  }
                />
              </div>

              <div
                className="security-card"
              >
                <div
                  className="security-card-heading"
                >
                  Cross-signing
                </div>

                <StatusRow
                  label="Cross-signing"
                  value={yesNo(
                    snapshot.crossSigningReady,
                  )}
                  tone={
                    snapshot.crossSigningReady
                      ? 'good'
                      : 'warn'
                  }
                />

                <StatusRow
                  label="Public keys"
                  value={yesNo(
                    snapshot.crossPublicKeys,
                    'On device',
                    'Missing',
                  )}
                  tone={
                    snapshot.crossPublicKeys
                      ? 'good'
                      : 'bad'
                  }
                />

                <StatusRow
                  label="Private keys"
                  value={yesNo(
                    snapshot.crossPrivateCached,
                    'Cached locally',
                    'Not fully cached',
                  )}
                  tone={
                    snapshot.crossPrivateCached
                      ? 'good'
                      : 'neutral'
                  }
                />

                <StatusRow
                  label="Private keys in recovery storage"
                  value={yesNo(
                    snapshot.crossPrivateInSecretStorage,
                    'Stored',
                    'Missing',
                  )}
                  tone={
                    snapshot.crossPrivateInSecretStorage
                      ? 'good'
                      : 'warn'
                  }
                />
              </div>

              <div
                className="security-card"
              >
                <div
                  className="security-card-heading"
                >
                  Recovery storage
                </div>

                <StatusRow
                  label="Secret storage"
                  value={yesNo(
                    snapshot.secretStorageReady,
                  )}
                  tone={
                    snapshot.secretStorageReady
                      ? 'good'
                      : 'warn'
                  }
                />

                <StatusRow
                  label="Recovery storage key"
                  value={
                    snapshot.secretStorageKeyId
                      ? 'Configured'
                      : 'Not configured'
                  }
                  tone={
                    snapshot.secretStorageKeyId
                      ? 'good'
                      : 'warn'
                  }
                />

                <StatusRow
                  label="Required secrets"
                  value={
                    `${snapshot.storedSecretsReady}/${snapshot.storedSecretsTotal} available`
                  }
                  tone={
                    snapshot.secretStorageReady
                      ? 'good'
                      : 'warn'
                  }
                />
              </div>

              <div
                className="security-card"
              >
                <div
                  className="security-card-heading"
                >
                  Encrypted history
                </div>

                <StatusRow
                  label="Session backup"
                  value={
                    snapshot.backupVersion
                      ? 'Active'
                      : 'Not active'
                  }
                  tone={
                    snapshot.backupVersion
                      ? 'good'
                      : 'warn'
                  }
                />

                <StatusRow
                  label="Backup version"
                  value={
                    snapshot.backupVersion ??
                    'None'
                  }
                  tone={
                    snapshot.backupVersion
                      ? 'good'
                      : 'neutral'
                  }
                />

                <StatusRow
                  label="Backup decryption key"
                  value={
                    snapshot.backupKeyPresent
                      ? 'Cached on this device'
                      : 'Not cached on this device'
                  }
                  tone={
                    snapshot.backupKeyPresent
                      ? 'good'
                      : 'warn'
                  }
                />
              </div>
            </div>

            {warnings.length > 0 && (
              <div
                className="security-warning-box"
              >
                <strong>
                  Recovery notes
                </strong>

                <ul>
                  {warnings.map(
                    (warning) => (
                      <li key={warning}>
                        {warning}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
          </>
        )}

        {/* DC COMS DEVICE SESSIONS START */}

        <ChangeMyPassword

          client={client}

        />


        <AdminUserCreate


          client={client}


        />



        <AdminUserManagement
          client={client}
        />


        <AdminPasswordReset

          client={client}

        />


        <DeviceSessions
          client={client}
          userId={userId}
          currentDeviceId={deviceId}
        />
        {/* DC COMS DEVICE SESSIONS END */}

        <footer
          className="security-panel-footer"
        >
          <span>
            The recovery key is never
            displayed, logged, or stored
            by DC Coms.
          </span>

          <span>
            Refreshing the page or
            signing out clears the
            in-memory recovery-key cache.
          </span>
        </footer>
      </section>
    </div>
  )
}
