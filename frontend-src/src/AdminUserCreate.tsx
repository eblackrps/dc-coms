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

type CreatedUser = {
  user: string
  display_name: string
  code: string
  expires_in: number
}

export default function AdminUserCreate({
  client,
}: Props) {
  const [isAdmin, setIsAdmin] =
    useState(false)

  const [username, setUsername] =
    useState('')

  const [displayName, setDisplayName] =
    useState('')

  const [busy, setBusy] =
    useState(false)

  const [error, setError] =
    useState('')

  const [created, setCreated] =
    useState<CreatedUser | null>(null)

  const [copied, setCopied] =
    useState(false)

  useEffect(() => {
    const token =
      client.getAccessToken()

    if (!token) return

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
          return { admin: false }
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
  }, [client])

  async function submit(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (
      busy ||
      !username.trim()
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
    setCreated(null)

    try {
      const response =
        await fetch(
          '/api/password-reset/admin/create-user',
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                username:
                  username
                    .trim()
                    .toLowerCase(),

                display_name:
                  displayName.trim(),
              }),
          },
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
          'Unable to create user.',
        )
      }

      setCreated(
        result as CreatedUser,
      )

      setUsername('')
      setDisplayName('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create user.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function copyCode() {
    if (!created) return

    setError('')

    try {
      await navigator.clipboard
        .writeText(
          created.code,
        )

      setCopied(true)

      window.setTimeout(
        () => {
          setCopied(false)
        },
        1500,
      )
    } catch (err) {
      console.warn(
        'Unable to copy user code:',
        err,
      )

      setCopied(false)

      setError(
        'Unable to copy the code. Select it and copy it manually.',
      )
    }
  }

  if (!isAdmin) {
    return null
  }

  return (
    <section
      className="admin-create-user"
    >
      <div>
        <div
          className="security-card-heading"
        >
          Create User
        </div>

        <p>
          Create a DC Coms account.
          The user chooses their own
          password using the one-time
          setup code.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="admin-create-user-form"
      >
        <label>
          Username

          <input
            value={username}
            disabled={busy}
            autoComplete="off"
            placeholder="jane"
            onChange={(event) =>
              setUsername(
                event.target.value
                  .toLowerCase(),
              )
            }
          />
        </label>

        <label>
          Display name

          <input
            value={displayName}
            disabled={busy}
            autoComplete="off"
            placeholder="Jane Smith"
            onChange={(event) =>
              setDisplayName(
                event.target.value,
              )
            }
          />
        </label>

        <button
          type="submit"
          disabled={
            busy ||
            !username.trim()
          }
        >
          {busy
            ? 'Creating...'
            : 'Create User'}
        </button>
      </form>

      <small>
        The bootstrap password is random
        and is never shown to the admin.
      </small>

      {error && (
        <div
          className="admin-create-user-error"
        >
          {error}
        </div>
      )}

      {created && (
        <div
          className="admin-created-user"
        >
          <strong>
            {created.user}
          </strong>

          <span>
            One-time setup code:
          </span>

          <code>
            {created.code}
          </code>

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

          <small>
            Expires in 15 minutes.
            Give only this code to the user.
          </small>
        </div>
      )}
    </section>
  )
}
