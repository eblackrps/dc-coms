import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import type {
  MatrixClient,
} from 'matrix-js-sdk'

type Props = {
  client: MatrixClient
  userId: string
  deviceId: string
  onOpenSecurity: () => void
}

type CryptoCheck = {
  checked: boolean
  fresh: boolean
  ready: boolean

  deviceVerified: boolean
  identityVerified: boolean
  crossSigningReady: boolean
  secretStorageReady: boolean
  backupActive: boolean
  backupKeyPresent: boolean
}

const EMPTY: CryptoCheck = {
  checked: false,
  fresh: false,
  ready: false,

  deviceVerified: false,
  identityVerified: false,
  crossSigningReady: false,
  secretStorageReady: false,
  backupActive: false,
  backupKeyPresent: false,
}

function sleep(
  ms: number,
) {
  return new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        ms,
      )
    },
  )
}

export default function FirstLoginSecurity({
  client,
  userId,
  deviceId,
  onOpenSecurity,
}: Props) {
  const [check, setCheck] =
    useState<CryptoCheck>(
      EMPTY,
    )

  const [setupStarted, setSetupStarted] =
    useState(false)

  const [finished, setFinished] =
    useState(false)

  const [closed, setClosed] =
    useState(false)

  const [recoveryKey, setRecoveryKey] =
    useState('')

  const generatedRef =
    useRef<any>(null)

  const [saved, setSaved] =
    useState(false)

  const [password, setPassword] =
    useState('')

  const [busy, setBusy] =
    useState(false)

  const [error, setError] =
    useState('')

  const [copied, setCopied] =
    useState(false)

  const inspect =
    useCallback(
      async () => {
        const crypto =
          client.getCrypto()

        if (
          !crypto ||
          !deviceId
        ) {
          return null
        }

        try {
          const [
            secretStorage,
            hasCrossSigning,
            crossSigningReady,
            backupInfo,
            activeBackup,
            backupKey,
            deviceStatus,
            identityStatus,
          ] =
            await Promise.all([
              crypto
                .getSecretStorageStatus(),

              crypto
                .userHasCrossSigningKeys(
                  userId,
                  true,
                ),

              crypto
                .isCrossSigningReady(),

              crypto
                .getKeyBackupInfo(),

              crypto
                .getActiveSessionBackupVersion(),

              crypto
                .getSessionBackupPrivateKey(),

              crypto
                .getDeviceVerificationStatus(
                  userId,
                  deviceId,
                ),

              crypto
                .getUserVerificationStatus(
                  userId,
                ),
            ])

          const deviceVerified =
            Boolean(
              deviceStatus
                ?.isVerified(),
            )

          const identityVerified =
            identityStatus
              .isVerified()

          const backupActive =
            Boolean(
              activeBackup,
            )

          const backupKeyPresent =
            Boolean(
              backupKey,
            )

          /*
           * This is the safety gate.
           *
           * Initialization is allowed
           * only if there is absolutely
           * no existing Matrix recovery
           * identity on the account.
           */
          const fresh =
            (
              secretStorage
                .defaultKeyId === null &&
              !hasCrossSigning &&
              backupInfo === null
            )

          const ready =
            Boolean(
              deviceVerified &&
              identityVerified &&
              crossSigningReady &&
              secretStorage.ready &&
              backupActive &&
              backupKeyPresent
            )

          const result = {
            checked: true,
            fresh,
            ready,

            deviceVerified,
            identityVerified,
            crossSigningReady,

            secretStorageReady:
              secretStorage.ready,

            backupActive,
            backupKeyPresent,
          }

          setCheck(result)

          return result
        } catch (err) {
          console.warn(
            'Crypto readiness check failed:',
            err,
          )

          setCheck(
            (current) => ({
              ...current,
              checked: true,
            }),
          )

          return null
        }
      },
      [
        client,
        userId,
        deviceId,
      ],
    )

  useEffect(() => {
    void inspect()

    const timer =
      window.setInterval(
        () => {
          void inspect()
        },
        5000,
      )

    return () => {
      window.clearInterval(
        timer,
      )

      const generated =
        generatedRef.current

      if (
        generated
          ?.privateKey
          ?.fill
      ) {
        generated
          .privateKey
          .fill(0)
      }

      generatedRef.current =
        null
    }
  }, [inspect])

  async function generateRecoveryKey() {
    const crypto =
      client.getCrypto()

    if (!crypto) {
      setError(
        'Encryption is not initialized.',
      )
      return
    }

    setBusy(true)
    setError('')
    setSetupStarted(true)

    try {
      const old =
        generatedRef.current

      if (
        old
          ?.privateKey
          ?.fill
      ) {
        old.privateKey.fill(0)
      }

      const generated =
        await crypto
          .createRecoveryKeyFromPassphrase()

      if (
        !generated
          .encodedPrivateKey
      ) {
        generated
          .privateKey
          .fill(0)

        throw new Error(
          'Matrix did not return a displayable recovery key.',
        )
      }

      generatedRef.current =
        generated

      setRecoveryKey(
        generated
          .encodedPrivateKey,
      )

      setSaved(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to generate recovery key.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function copyRecoveryKey() {
    if (!recoveryKey) return

    try {
      await navigator.clipboard
        .writeText(
          recoveryKey,
        )

      setCopied(true)

      window.setTimeout(
        () => {
          setCopied(false)
        },
        1500,
      )
    } catch {
      setError(
        'Unable to copy recovery key.',
      )
    }
  }

  function saveRecoveryKeyFile() {
    if (!recoveryKey) return

    const account =
      userId
        .replace(/^@/, '')
        .split(':')[0]
        .replace(
          /[^a-zA-Z0-9._-]/g,
          '_',
        )

    const body = [
      'DC Coms Encryption Recovery Key',
      '',
      `Account: ${userId}`,
      '',
      recoveryKey,
      '',
      'Store this somewhere safe outside this browser.',
      '',
    ].join('\n')

    const blob =
      new Blob(
        [body],
        {
          type:
            'text/plain;charset=utf-8',
        },
      )

    const url =
      URL.createObjectURL(
        blob,
      )

    const link =
      document.createElement(
        'a',
      )

    link.href = url

    link.download =
      `dccoms-recovery-${account}.txt`

    document.body
      .appendChild(link)

    link.click()
    link.remove()

    URL.revokeObjectURL(
      url,
    )
  }

  async function completeSetup(
    event: FormEvent,
  ) {
    event.preventDefault()

    const crypto =
      client.getCrypto()

    const generated =
      generatedRef.current

    if (
      !crypto ||
      !generated
    ) {
      setError(
        'Generate the recovery key first.',
      )
      return
    }

    if (!saved) {
      setError(
        'Save the recovery key before continuing.',
      )
      return
    }

    if (!password) {
      setError(
        'Enter your current DC Coms password.',
      )
      return
    }

    setBusy(true)
    setError('')
    setSetupStarted(true)

    try {
      /*
       * Create secret storage only if
       * it does not already exist.
       *
       * NEVER reset an existing store.
       */
      await crypto
        .bootstrapSecretStorage({
          setupNewSecretStorage:
            false,

          setupNewKeyBackup:
            false,

          createSecretStorageKey:
            async () =>
              generated,
        })

      /*
       * Create cross-signing only if
       * this account does not already
       * have it.
       *
       * NEVER replace an existing
       * cross-signing identity.
       */
      await crypto
        .bootstrapCrossSigning({
          setupNewCrossSigning:
            false,

          authUploadDeviceSigningKeys:
            async (
              makeRequest,
            ) => {
              return makeRequest({
                type:
                  'm.login.password',

                identifier: {
                  type:
                    'm.id.user',

                  user:
                    userId,
                },

                password,
              })
            },
        })

      /*
       * Cross-signing now exists.
       * Store its private keys inside
       * the recovery-key protected
       * secret store.
       */
      await crypto
        .bootstrapSecretStorage({
          setupNewSecretStorage:
            false,

          setupNewKeyBackup:
            false,
        })

      /*
       * Fresh users should not yet
       * have a key backup.
       */
      const backup =
        await crypto
          .checkKeyBackupAndEnable()

      if (backup === null) {
        await crypto
          .resetKeyBackup()
      }

      /*
       * Ensure the backup private key
       * and cross-signing secrets are
       * all represented in SSSS.
       */
      await crypto
        .bootstrapSecretStorage({
          setupNewSecretStorage:
            false,

          setupNewKeyBackup:
            false,
        })

      crypto
        .setTrustCrossSignedDevices(
          true,
        )

      const deviceStatus =
        await crypto
          .getDeviceVerificationStatus(
            userId,
            deviceId,
          )

      if (
        !deviceStatus
          ?.isVerified()
      ) {
        await crypto
          .crossSignDevice(
            deviceId,
          )
      }

      await crypto
        .checkKeyBackupAndEnable()

      let finalState =
        await inspect()

      for (
        let attempt = 0;
        attempt < 5 &&
        !finalState?.ready;
        attempt += 1
      ) {
        await sleep(500)

        finalState =
          await inspect()
      }

      if (
        !finalState?.ready
      ) {
        throw new Error(
          'Encryption setup completed, but not every readiness check is green yet.',
        )
      }

      setPassword('')

      if (
        generated
          .privateKey
          ?.fill
      ) {
        generated
          .privateKey
          .fill(0)
      }

      generatedRef.current =
        null

      setRecoveryKey('')
      setSaved(false)
      setFinished(true)
    } catch (err) {
      setPassword('')

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to complete encryption setup.',
      )

      await inspect()
    } finally {
      setBusy(false)
    }
  }

  if (
    closed ||
    !check.checked
  ) {
    return null
  }

  /*
   * Already-healthy accounts never
   * see onboarding.
   */
  if (
    check.ready &&
    !setupStarted &&
    !finished
  ) {
    return null
  }

  /*
   * Existing but incomplete identity:
   * do NOT create anything.
   */
  if (
    !check.ready &&
    !check.fresh &&
    !setupStarted
  ) {
    return (
      <div
        className="crypto-attention"
      >
        <div>
          <strong>
            Encryption recovery needs attention
          </strong>

          <span>
            This account already has
            encryption state. DC Coms
            will not replace it.
          </span>
        </div>

        <button
          type="button"
          onClick={
            onOpenSecurity
          }
        >
          Security & Recovery
        </button>
      </div>
    )
  }

  return (
    <div
      className="crypto-first-backdrop"
    >
      <section
        className="crypto-first-card"
      >
        <p className="eyebrow">
          DC COMS SECURITY
        </p>

        <h2>
          Protect your encrypted history
        </h2>

        {finished ? (
          <>
            <p>
              Your Matrix encryption
              identity is fully configured.
            </p>

            <div
              className="crypto-checks"
            >
              <span>✓ Device verified</span>
              <span>✓ Identity verified</span>
              <span>✓ Cross-signing ready</span>
              <span>✓ Recovery key ready</span>
              <span>✓ Key backup active</span>
              <span>✓ Backup key available</span>
            </div>

            <strong
              className="crypto-all-green"
            >
              All encryption checks are green.
            </strong>

            <button
              type="button"
              onClick={() =>
                setClosed(true)
              }
            >
              Continue to DC Coms
            </button>
          </>
        ) : (
          <>
            <p>
              This is the first encrypted
              login for this account.
              Create and save your
              recovery key before using
              DC Coms.
            </p>

            {!recoveryKey ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void generateRecoveryKey()
                }}
              >
                {busy
                  ? 'Generating...'
                  : 'Generate Recovery Key'}
              </button>
            ) : (
              <form
                onSubmit={
                  completeSetup
                }
              >
                <strong>
                  Save this recovery key
                </strong>

                <code
                  className="crypto-first-key"
                >
                  {recoveryKey}
                </code>

                <div
                  className="crypto-first-actions"
                >
                  <button
                    type="button"
                    onClick={() => {
                      void copyRecoveryKey()
                    }}
                  >
                    {copied
                      ? 'Copied'
                      : 'Copy Key'}
                  </button>

                  <button
                    type="button"
                    onClick={
                      saveRecoveryKeyFile
                    }
                  >
                    Save Key File
                  </button>
                </div>

                <label
                  className="crypto-confirm"
                >
                  <input
                    type="checkbox"
                    checked={saved}
                    disabled={busy}
                    onChange={(event) =>
                      setSaved(
                        event.target.checked,
                      )
                    }
                  />

                  I saved my recovery key
                  somewhere outside this
                  browser.
                </label>

                <label>
                  Current DC Coms password

                  <input
                    type="password"
                    value={password}
                    disabled={busy}
                    autoComplete="current-password"
                    onChange={(event) =>
                      setPassword(
                        event.target.value,
                      )
                    }
                  />
                </label>

                <button
                  type="submit"
                  disabled={
                    busy ||
                    !saved ||
                    !password
                  }
                >
                  {busy
                    ? 'Configuring Encryption...'
                    : 'Complete Encryption Setup'}
                </button>
              </form>
            )}

            {error && (
              <div
                className="crypto-first-error"
              >
                {error}
              </div>
            )}

            <small>
              Do not refresh or close this
              page after setup begins.
            </small>
          </>
        )}
      </section>
    </div>
  )
}
