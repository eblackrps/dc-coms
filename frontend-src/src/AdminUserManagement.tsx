import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type {
  MatrixClient,
} from 'matrix-js-sdk'

type Props = {
  client: MatrixClient
}

type ManagedUser = {
  name: string
  displayname: string | null
  admin: boolean
  deactivated: boolean
  locked: boolean
  creation_ts: number | null
  last_seen_ts: number | null
  user_type: string | null
  is_self: boolean
  can_manage: boolean
}

type IssuedCode = {
  user: string
  code: string
  expires_in: number
  logout_devices: boolean
}

function formatTime(
  value: number | null,
) {
  if (!value) {
    return 'Never'
  }

  return new Date(
    value,
  ).toLocaleString()
}

export default function AdminUserManagement({
  client,
}: Props) {
  const [checked, setChecked] =
    useState(false)

  const [isAdmin, setIsAdmin] =
    useState(false)

  const [users, setUsers] =
    useState<ManagedUser[]>([])

  const [query, setQuery] =
    useState('')

  const [loading, setLoading] =
    useState(false)

  const [busyUser, setBusyUser] =
    useState<string | null>(null)

  const [error, setError] =
    useState('')

  const [issued, setIssued] =
    useState<IssuedCode | null>(null)

  const [copied, setCopied] =
    useState(false)

  const [
    deleteTarget,
    setDeleteTarget,
  ] = useState<ManagedUser | null>(
    null,
  )

  const [
    deleteConfirm,
    setDeleteConfirm,
  ] = useState('')

  const loadUsers =
    useCallback(
      async () => {
        const token =
          client.getAccessToken()

        if (!token) {
          return
        }

        setLoading(true)
        setError('')

        try {
          const response =
            await fetch(
              '/api/password-reset/admin/users',
              {
                headers: {
                  Authorization:
                    `Bearer ${token}`,
                },

                cache:
                  'no-store',
              },
            )

          const result =
            await response.json()

          if (!response.ok) {
            throw new Error(
              result.error ||
              'Unable to load users.',
            )
          }

          setUsers(
            Array.isArray(
              result.users,
            )
              ? result.users
              : [],
          )
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load users.',
          )
        } finally {
          setLoading(false)
        }
      },
      [client],
    )

  useEffect(() => {
    const token =
      client.getAccessToken()

    if (!token) {
      setChecked(true)
      return
    }

    void fetch(
      '/api/password-reset/admin/status',
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },

        cache:
          'no-store',
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          return {
            admin: false,
          }
        }

        return response.json()
      })
      .then((result) => {
        const admin =
          result.admin === true

        setIsAdmin(admin)

        if (admin) {
          void loadUsers()
        }
      })
      .catch(() => {
        setIsAdmin(false)
      })
      .finally(() => {
        setChecked(true)
      })
  }, [
    client,
    loadUsers,
  ])

  const visibleUsers =
    useMemo(
      () => {
        const needle =
          query
            .trim()
            .toLowerCase()

        if (!needle) {
          return users
        }

        return users.filter(
          (user) =>
            user.name
              .toLowerCase()
              .includes(
                needle,
              ) ||
            (
              user.displayname ||
              ''
            )
              .toLowerCase()
              .includes(
                needle,
              ),
        )
      },
      [
        users,
        query,
      ],
    )

  async function setLocked(
    user: ManagedUser,
    locked: boolean,
  ) {
    if (
      !user.can_manage ||
      busyUser
    ) {
      return
    }

    if (locked) {
      const confirmed =
        window.confirm(
          `Lock ${user.name} and sign out all of their current DC Coms devices?\n\n` +
          'Their Matrix recovery identity will remain intact, but they will need their recovery key after the account is unlocked and they sign in on a new device.',
        )

      if (!confirmed) {
        return
      }
    }

    const token =
      client.getAccessToken()

    if (!token) {
      setError(
        'Admin session is unavailable.',
      )
      return
    }

    setBusyUser(
      user.name,
    )

    setError('')

    try {
      const response =
        await fetch(
          '/api/password-reset/admin/user-lock',
          {
            method:
              'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                user:
                  user.name,

                locked,
              }),
          },
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
          'Unable to update account.',
        )
      }

      await loadUsers()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to update account.',
      )
    } finally {
      setBusyUser(null)
    }
  }

  async function issueReset(
    user: ManagedUser,
  ) {
    if (
      !user.can_manage ||
      busyUser
    ) {
      return
    }

    const token =
      client.getAccessToken()

    if (!token) {
      setError(
        'Admin session is unavailable.',
      )
      return
    }

    setBusyUser(
      user.name,
    )

    setError('')
    setIssued(null)
    setCopied(false)

    try {
      const response =
        await fetch(
          '/api/password-reset/admin/issue',
          {
            method:
              'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                user:
                  user.name,

                logout_devices:
                  false,
              }),
          },
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
          'Unable to issue reset code.',
        )
      }

      setIssued(
        result as IssuedCode,
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to issue reset code.',
      )
    } finally {
      setBusyUser(null)
    }
  }

  async function cancelReset() {
    if (!issued) return

    const token =
      client.getAccessToken()

    if (!token) return

    setBusyUser(
      issued.user,
    )

    setError('')

    try {
      const response =
        await fetch(
          '/api/password-reset/admin/cancel',
          {
            method:
              'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                user:
                  issued.user,
              }),
          },
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
          'Unable to cancel reset.',
        )
      }

      setIssued(null)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to cancel reset.',
      )
    } finally {
      setBusyUser(null)
    }
  }

  async function copyCode() {
    if (!issued) return

    try {
      await navigator.clipboard
        .writeText(
          issued.code,
        )

      setCopied(true)

      window.setTimeout(
        () => {
          setCopied(false)
        },
        1500,
      )
    } catch {
      setCopied(false)
    }
  }

  async function deleteUser() {
    if (
      !deleteTarget ||
      busyUser
    ) {
      return
    }

    if (
      deleteConfirm.trim() !==
      deleteTarget.name
    ) {
      setError(
        'Type the exact Matrix ID to confirm deletion.',
      )
      return
    }

    const token =
      client.getAccessToken()

    if (!token) {
      setError(
        'Admin session is unavailable.',
      )
      return
    }

    const target =
      deleteTarget.name

    setBusyUser(target)
    setError('')

    try {
      const response =
        await fetch(
          '/api/password-reset/admin/user-delete',
          {
            method:
              'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                user:
                  target,

                confirm:
                  deleteConfirm.trim(),
              }),
          },
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
          'Unable to delete user.',
        )
      }

      if (
        issued?.user ===
        target
      ) {
        setIssued(null)
      }

      setDeleteTarget(null)
      setDeleteConfirm('')

      await loadUsers()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to delete user.',
      )
    } finally {
      setBusyUser(null)
    }
  }

  if (
    !checked ||
    !isAdmin
  ) {
    return null
  }

  return (
    <section
      className="admin-user-management"
    >
      <div
        className="admin-user-management-header"
      >
        <div>
          <div
            className="security-card-heading"
          >
            User Management
          </div>

          <p>
            Manage local DC Coms
            accounts without touching
            encryption identities.
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => {
            void loadUsers()
          }}
        >
          {loading
            ? 'Loading...'
            : 'Refresh'}
        </button>
      </div>

      <input
        className="admin-user-search"
        value={query}
        placeholder="Search users..."
        autoComplete="off"
        onChange={(event) =>
          setQuery(
            event.target.value,
          )
        }
      />

      {error && (
        <div
          className="admin-user-management-error"
        >
          {error}
        </div>
      )}

      {issued && (
        <div
          className="admin-user-reset-code"
        >
          <span>
            ONE-TIME RESET CODE
          </span>

          <strong>
            {issued.code}
          </strong>

          <small>
            For {issued.user}. Expires
            in 15 minutes.
          </small>

          <div>
            <button
              type="button"
              onClick={() => {
                void copyCode()
              }}
            >
              {copied
                ? 'Copied'
                : 'Copy Code'}
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => {
                void cancelReset()
              }}
            >
              Cancel Reset
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="admin-user-delete-confirm"
        >
          <div>
            <strong>
              Delete User
            </strong>

            <p>
              This permanently disables
              the account and removes its
              devices, encryption keys,
              recovery data, sessions and
              room memberships. Existing
              messages are retained.
            </p>
          </div>

          <code>
            {deleteTarget.name}
          </code>

          <label>
            Type the exact Matrix ID to confirm

            <input
              value={deleteConfirm}
              disabled={
                busyUser ===
                deleteTarget.name
              }
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                setDeleteConfirm(
                  event.target.value,
                )
              }
            />
          </label>

          <div
            className="admin-user-delete-actions"
          >
            <button
              type="button"
              className="danger"
              disabled={
                busyUser ===
                  deleteTarget.name ||
                deleteConfirm.trim() !==
                  deleteTarget.name
              }
              onClick={() => {
                void deleteUser()
              }}
            >
              {busyUser ===
              deleteTarget.name
                ? 'Deleting...'
                : 'Delete User'}
            </button>

            <button
              type="button"
              className="secondary"
              disabled={
                busyUser ===
                deleteTarget.name
              }
              onClick={() => {
                setDeleteTarget(null)
                setDeleteConfirm('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div
        className="admin-user-list"
      >
        {visibleUsers.map(
          (user) => {
            let status =
              'Active'

            if (
              user.deactivated
            ) {
              status =
                'Deleted'
            } else if (
              user.locked
            ) {
              status =
                'Locked'
            } else if (
              user.admin
            ) {
              status =
                'Administrator'
            }

            return (
              <article
                key={user.name}
                className="admin-user-row"
              >
                <div
                  className="admin-user-identity"
                >
                  <strong>
                    {user.displayname ||
                      user.name
                        .split(':')[0]
                        .replace(
                          /^@/,
                          '',
                        )}
                  </strong>

                  <span>
                    {user.name}
                  </span>
                </div>

                <div
                  className="admin-user-meta"
                >
                  <span
                    className={
                      `admin-user-status ${
                        user.locked
                          ? 'locked'
                          : user.deactivated
                            ? 'disabled'
                            : 'active'
                      }`
                    }
                  >
                    {status}
                  </span>

                  <small>
                    Last seen:{' '}
                    {formatTime(
                      user.last_seen_ts,
                    )}
                  </small>
                </div>

                <div
                  className="admin-user-actions"
                >
                  {user.can_manage ? (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          busyUser ===
                          user.name
                        }
                        onClick={() => {
                          void issueReset(
                            user,
                          )
                        }}
                      >
                        Reset Code
                      </button>

                      <button
                        type="button"
                        className={
                          user.locked
                            ? 'secondary'
                            : 'danger'
                        }
                        disabled={
                          busyUser ===
                          user.name
                        }
                        onClick={() => {
                          void setLocked(
                            user,
                            !user.locked,
                          )
                        }}
                      >
                        {busyUser ===
                        user.name
                          ? 'Working...'
                          : user.locked
                            ? 'Unlock'
                            : 'Lock'}
                      </button>

                      <button
                        type="button"
                        className="danger"
                        disabled={
                          busyUser ===
                          user.name
                        }
                        onClick={() => {
                          setError('')
                          setDeleteConfirm('')
                          setDeleteTarget(
                            user,
                          )
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <span
                      className="admin-user-protected"
                    >
                      {user.is_self
                        ? 'Current administrator'
                        : user.admin
                          ? 'Protected administrator'
                          : 'Host-side management'}
                    </span>
                  )}
                </div>
              </article>
            )
          },
        )}

        {!loading &&
          visibleUsers.length === 0 && (
            <div
              className="admin-user-empty"
            >
              No matching users.
            </div>
          )}
      </div>
    </section>
  )
}
