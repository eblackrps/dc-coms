import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import type {
  MatrixClient,
} from 'matrix-js-sdk'

type Props = {
  client: MatrixClient
}

type IssueResult = {
  user: string
  code: string
  expires_in: number
  logout_devices: boolean
}

export default function AdminPasswordReset({
  client,
}: Props) {
  const [
    isAdmin,
    setIsAdmin,
  ] = useState(false)

  const [
    checked,
    setChecked,
  ] = useState(false)

  const [user, setUser] =
    useState('')

  const [
    revokeSessions,
    setRevokeSessions,
  ] = useState(false)

  const [busy, setBusy] =
    useState(false)

  const [error, setError] =
    useState('')

  const [
    issued,
    setIssued,
  ] = useState<
    IssueResult | null
  >(null)

  const [copied, setCopied] =
    useState(false)

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
        cache: 'no-store',
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
        setIsAdmin(
          result.admin === true,
        )
      })
      .catch(() => {
        setIsAdmin(false)
      })
      .finally(() => {
        setChecked(true)
      })
  }, [client])

  async function issueReset(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (
      busy ||
      !user.trim()
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

    setBusy(true)
    setError('')
    setIssued(null)
    setCopied(false)

    try {
      const response =
        await fetch(
          '/api/password-reset/admin/issue',
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({
              user:
                user.trim(),

              logout_devices:
                revokeSessions,
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
        result as IssueResult,
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to issue reset code.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function cancelReset() {
    if (
      !issued ||
      busy
    ) {
      return
    }

    const token =
      client.getAccessToken()

    if (!token) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const response =
        await fetch(
          '/api/password-reset/admin/cancel',
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({
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
          'Unable to cancel reset code.',
        )
      }

      setIssued(null)
      setCopied(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to cancel reset code.',
      )
    } finally {
      setBusy(false)
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
        1800,
      )
    } catch {
      setCopied(false)
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
      className="admin-reset-card"
    >
      <div
        className="admin-reset-heading"
      >
        <div>
          <div
            className="security-card-heading"
          >
            Password Reset Administration
          </div>

          <p>
            Issue a temporary reset code.
            You never choose or see the
            user's new password.
          </p>
        </div>
      </div>

      <form
        className="admin-reset-form"
        onSubmit={issueReset}
      >
        <label>
          User

          <input
            value={user}
            disabled={busy}
            placeholder="joo"
            autoComplete="off"
            onChange={(event) =>
              setUser(
                event.target.value,
              )
            }
          />
        </label>

        <label
          className="admin-reset-revoke"
        >
          <input
            type="checkbox"
            checked={
              revokeSessions
            }
            disabled={busy}
            onChange={(event) =>
              setRevokeSessions(
                event.target.checked,
              )
            }
          />

          <span>
            <strong>
              Revoke existing sessions
            </strong>

            <small>
              More secure for a suspected
              compromise, but the user's
              next login will be a new
              Matrix device and may need
              their recovery key for old
              encrypted history.
            </small>
          </span>
        </label>

        <button
          type="submit"
          disabled={
            busy ||
            !user.trim()
          }
        >
          {busy
            ? 'Issuing...'
            : 'Issue Reset Code'}
        </button>
      </form>

      {error && (
        <div
          className="admin-reset-error"
        >
          {error}
        </div>
      )}

      {issued && (
        <div
          className="admin-reset-issued"
        >
          <div>
            <span>
              ONE-TIME RESET CODE
            </span>

            <strong>
              {issued.code}
            </strong>

            <small>
              For {issued.user}. Expires
              in 15 minutes and becomes
              invalid immediately after a
              successful reset.
            </small>
          </div>

          <div
            className="admin-reset-issued-actions"
          >
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
              disabled={busy}
              onClick={() => {
                void cancelReset()
              }}
            >
              Cancel Reset
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
