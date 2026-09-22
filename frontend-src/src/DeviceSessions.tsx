import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import type {
  MatrixClient,
} from 'matrix-js-sdk'

type DeviceView = {
  deviceId: string
  displayName: string
  lastSeenTs: number | null
  lastSeenIp: string | null

  verified: boolean | null
  signedByOwner: boolean | null
  crossSigned: boolean | null
  locallyVerified: boolean | null
}

type RevokeTarget = {
  deviceId: string
  displayName: string
}

type Props = {
  client: MatrixClient
  userId: string
  currentDeviceId: string
}

function formatLastSeen(
  timestamp: number | null,
) {
  if (!timestamp) {
    return 'No last-seen time reported'
  }

  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    ).format(
      new Date(timestamp),
    )
  } catch {
    return new Date(
      timestamp,
    ).toLocaleString()
  }
}

export default function DeviceSessions({
  client,
  userId,
  currentDeviceId,
}: Props) {
  const [devices, setDevices] =
    useState<DeviceView[]>([])

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState('')

  const [
    revokeTarget,
    setRevokeTarget,
  ] = useState<RevokeTarget | null>(
    null,
  )

  const [password, setPassword] =
    useState('')

  const [revoking, setRevoking] =
    useState(false)

  const [
    actionMessage,
    setActionMessage,
  ] = useState('')

  const refresh = useCallback(
    async () => {
      setLoading(true)
      setError('')

      try {
        const response =
          await client.getDevices()

        const crypto =
          client.getCrypto()

        if (crypto) {
          try {
            await crypto.getUserDeviceInfo(
              [userId],
              true,
            )
          } catch (err) {
            console.debug(
              'Unable to force-refresh crypto device info:',
              err,
            )
          }
        }

        const rows =
          await Promise.all(
            response.devices.map(
              async (device) => {
                let verified:
                  boolean | null = null

                let signedByOwner:
                  boolean | null = null

                let crossSigned:
                  boolean | null = null

                let locallyVerified:
                  boolean | null = null

                if (crypto) {
                  try {
                    const status =
                      await crypto
                        .getDeviceVerificationStatus(
                          userId,
                          device.device_id,
                        )

                    if (status) {
                      verified =
                        status.isVerified()

                      signedByOwner =
                        status.signedByOwner

                      crossSigned =
                        status
                          .crossSigningVerified

                      locallyVerified =
                        status.localVerified
                    }
                  } catch (err) {
                    console.debug(
                      `Unable to read verification status for ${device.device_id}:`,
                      err,
                    )
                  }
                }

                return {
                  deviceId:
                    device.device_id,

                  displayName:
                    device.display_name ||
                    'Unnamed Matrix device',

                  lastSeenTs:
                    typeof device.last_seen_ts ===
                    'number'
                      ? device.last_seen_ts
                      : null,

                  lastSeenIp:
                    device.last_seen_ip ||
                    null,

                  verified,
                  signedByOwner,
                  crossSigned,
                  locallyVerified,
                }
              },
            ),
          )

        rows.sort(
          (a, b) => {
            if (
              a.deviceId ===
              currentDeviceId
            ) {
              return -1
            }

            if (
              b.deviceId ===
              currentDeviceId
            ) {
              return 1
            }

            return (
              (b.lastSeenTs ?? 0) -
              (a.lastSeenTs ?? 0)
            )
          },
        )

        setDevices(rows)
      } catch (err) {
        console.error(
          'Device refresh failed:',
          err,
        )

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load Matrix devices.',
        )
      } finally {
        setLoading(false)
      }
    },
    [
      client,
      userId,
      currentDeviceId,
    ],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!revokeTarget) return

    const handleKey =
      (event: KeyboardEvent) => {
        if (
          event.key === 'Escape' &&
          !revoking
        ) {
          setPassword('')
          setRevokeTarget(null)
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
  }, [
    revokeTarget,
    revoking,
  ])

  function beginRevoke(
    device: DeviceView,
  ) {
    if (
      device.deviceId ===
      currentDeviceId
    ) {
      return
    }

    setPassword('')
    setActionMessage('')

    setRevokeTarget({
      deviceId:
        device.deviceId,

      displayName:
        device.displayName,
    })
  }

  function cancelRevoke() {
    if (revoking) return

    setPassword('')
    setRevokeTarget(null)
  }

  async function revokeDevice(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (!revokeTarget) return

    if (!password) {
      setActionMessage(
        'Enter your account password to authorize this revocation.',
      )

      return
    }

    if (
      revokeTarget.deviceId ===
      currentDeviceId
    ) {
      setActionMessage(
        'The current device cannot be revoked from this screen.',
      )

      return
    }

    setRevoking(true)
    setActionMessage('')

    try {
      /*
       * First request discovers whether the
       * homeserver requires user-interactive
       * authentication and, if so, returns
       * the UIA session identifier.
       */
      try {
        await client.deleteDevice(
          revokeTarget.deviceId,
        )
      } catch (firstError) {
        const matrixError =
          firstError as any

        const httpStatus =
          matrixError?.httpStatus ??
          matrixError?.httpStatusCode ??
          matrixError?.statusCode

        const errcode =
          matrixError?.errcode ??
          matrixError?.data?.errcode

        const needsAuth =
          httpStatus === 401 ||
          errcode ===
            'M_UNAUTHORIZED'

        if (!needsAuth) {
          throw firstError
        }

        const uiaSession =
          matrixError?.data?.session ??
          matrixError?.session

        await client.deleteDevice(
          revokeTarget.deviceId,
          {
            type:
              'm.login.password',

            identifier: {
              type:
                'm.id.user',

              user: userId,
            },

            password,

            ...(uiaSession
              ? {
                  session:
                    uiaSession,
                }
              : {}),
          } as any,
        )
      }

      const removedName =
        revokeTarget.displayName

      setPassword('')
      setRevokeTarget(null)

      setActionMessage(
        `${removedName} was revoked.`,
      )

      await refresh()
    } catch (err) {
      console.error(
        'Device revocation failed:',
        err,
      )

      const matrixError =
        err as any

      const errcode =
        matrixError?.errcode ??
        matrixError?.data?.errcode

      if (
        errcode ===
        'M_FORBIDDEN'
      ) {
        setActionMessage(
          'The password was rejected or this account is not permitted to revoke the device.',
        )
      } else {
        setActionMessage(
          err instanceof Error
            ? err.message
            : 'Unable to revoke device.',
        )
      }
    } finally {
      setPassword('')
      setRevoking(false)
    }
  }

  return (
    <section
      className="device-sessions-card"
    >
      <header
        className="device-sessions-header"
      >
        <div>
          <div
            className="security-card-heading"
          >
            Devices & Sessions
          </div>

          <p>
            Matrix devices currently
            registered to this account.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void refresh()
          }}
          disabled={loading}
        >
          {loading
            ? 'Refreshing...'
            : 'Refresh Devices'}
        </button>
      </header>

      {error && (
        <div
          className="device-sessions-error"
        >
          {error}
        </div>
      )}

      {actionMessage && (
        <div
          className="device-sessions-message"
        >
          {actionMessage}
        </div>
      )}

      {!loading &&
        devices.length === 0 && (
          <div
            className="device-sessions-empty"
          >
            No Matrix devices were
            returned by the server.
          </div>
        )}

      <div
        className="device-sessions-list"
      >
        {devices.map(
          (device) => {
            const current =
              device.deviceId ===
              currentDeviceId

            return (
              <article
                className={
                  current
                    ? 'device-session current'
                    : 'device-session'
                }
                key={device.deviceId}
              >
                <div
                  className="device-session-main"
                >
                  <div
                    className="device-session-icon"
                  >
                    {current
                      ? '●'
                      : '◆'}
                  </div>

                  <div
                    className="device-session-info"
                  >
                    <div
                      className="device-session-title"
                    >
                      <strong>
                        {
                          device.displayName
                        }
                      </strong>

                      {current && (
                        <span
                          className="device-current-badge"
                        >
                          Current device
                        </span>
                      )}

                      {device.verified ===
                        true && (
                        <span
                          className="device-verified-badge"
                        >
                          Verified
                        </span>
                      )}
                    </div>

                    <code>
                      {device.deviceId}
                    </code>

                    <div
                      className="device-session-meta"
                    >
                      <span>
                        Last seen:{' '}
                        {formatLastSeen(
                          device.lastSeenTs,
                        )}
                      </span>

                      {device.lastSeenIp && (
                        <span>
                          IP:{' '}
                          {
                            device.lastSeenIp
                          }
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className="device-session-trust"
                >
                  <span
                    className={
                      device.signedByOwner
                        ? 'good'
                        : ''
                    }
                  >
                    Owner signed:{' '}
                    {device.signedByOwner
                      ? 'Yes'
                      : 'No'}
                  </span>

                  <span
                    className={
                      device.crossSigned
                        ? 'good'
                        : ''
                    }
                  >
                    Cross-signed:{' '}
                    {device.crossSigned
                      ? 'Yes'
                      : 'No'}
                  </span>

                  <span
                    className={
                      device.locallyVerified
                        ? 'good'
                        : ''
                    }
                  >
                    Local trust:{' '}
                    {device.locallyVerified
                      ? 'Yes'
                      : 'No'}
                  </span>
                </div>

                <div
                  className="device-session-action"
                >
                  {current ? (
                    <span>
                      Sign out to end
                      this session
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="device-revoke-button"
                      onClick={() =>
                        beginRevoke(
                          device,
                        )
                      }
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </article>
            )
          },
        )}
      </div>

      {revokeTarget && (
        <div
          className="device-revoke-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !revoking
            ) {
              cancelRevoke()
            }
          }}
        >
          <form
            className="device-revoke-dialog"
            onSubmit={
              revokeDevice
            }
          >
            <div
              className="device-revoke-warning"
            >
              !
            </div>

            <h3>
              Revoke device?
            </h3>

            <p>
              This immediately invalidates
              the Matrix access token for:
            </p>

            <strong>
              {
                revokeTarget.displayName
              }
            </strong>

            <code>
              {
                revokeTarget.deviceId
              }
            </code>

            <p>
              Existing encrypted messages
              are not deleted from other
              devices by this action.
            </p>

            <label>
              Account password

              <input
                type="password"
                value={password}
                autoFocus
                autoComplete="current-password"
                onChange={(event) =>
                  setPassword(
                    event.target.value,
                  )
                }
                disabled={revoking}
              />
            </label>

            {actionMessage && (
              <div
                className="device-revoke-error"
              >
                {actionMessage}
              </div>
            )}

            <div
              className="device-revoke-actions"
            >
              <button
                type="button"
                className="secondary"
                onClick={
                  cancelRevoke
                }
                disabled={revoking}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="danger"
                disabled={
                  revoking ||
                  !password
                }
              >
                {revoking
                  ? 'Revoking...'
                  : 'Revoke Device'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
