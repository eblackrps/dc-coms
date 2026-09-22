import {
  useState,
  type FormEvent,
} from 'react'

type Props = {
  serverName: string
}

export default function ResetPassword({
  serverName,
}: Props) {
  const [open, setOpen] =
    useState(false)

  const [user, setUser] =
    useState('')

  const [code, setCode] =
    useState('')

  const [
    password,
    setPassword,
  ] = useState('')

  const [
    confirm,
    setConfirm,
  ] = useState('')

  const [busy, setBusy] =
    useState(false)

  const [error, setError] =
    useState('')

  const [success, setSuccess] =
    useState(false)

  function close() {
    if (busy) return

    setOpen(false)
    setCode('')
    setPassword('')
    setConfirm('')
    setError('')
    setSuccess(false)
  }

  async function submit(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (busy) return

    setError('')

    if (!user.trim()) {
      setError(
        'Enter your username.',
      )
      return
    }

    if (!code.trim()) {
      setError(
        'Enter the reset code.',
      )
      return
    }

    if (
      password.length < 12
    ) {
      setError(
        'Use at least 12 characters.',
      )
      return
    }

    if (
      password !== confirm
    ) {
      setError(
        'The passwords do not match.',
      )
      return
    }

    setBusy(true)

    try {
      const response =
        await fetch(
          '/api/password-reset/reset',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                user:
                  user.trim(),

                code:
                  code.trim(),

                new_password:
                  password,
              }),
          },
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
          'Unable to reset password.',
        )
      }

      setCode('')
      setPassword('')
      setConfirm('')
      setSuccess(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to reset password.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div
        className="login-reset-entry"
      >
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setError('')
          }}
        >
          Have a password reset code?
        </button>
      </div>
    )
  }

  return (
    <section
      className="login-reset-panel"
    >
      <div
        className="login-reset-panel-header"
      >
        <div>
          <strong>
            Reset password
          </strong>

          <span>
            Set a new password that only
            you know.
          </span>
        </div>

        <button
          type="button"
          onClick={close}
          aria-label="Close password reset"
        >
          ×
        </button>
      </div>

      {success ? (
        <div
          className="login-reset-success"
        >
          <strong>
            Password reset complete.
          </strong>

          <span>
            Sign in normally with your
            new password. A newly created
            Matrix device may require
            your encryption recovery key
            before earlier encrypted
            history becomes available.
          </span>

          <button
            type="button"
            onClick={close}
          >
            Back to Sign In
          </button>
        </div>
      ) : (
        <form
          className="login-reset-form"
          onSubmit={submit}
        >
          <label>
            Username

            <input
              value={user}
              autoComplete="username"
              disabled={busy}
              placeholder="joo"
              onChange={(event) =>
                setUser(
                  event.target.value,
                )
              }
            />
          </label>

          <label>
            One-time reset code

            <input
              value={code}
              autoComplete="off"
              disabled={busy}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              onChange={(event) =>
                setCode(
                  event.target.value
                    .toUpperCase(),
                )
              }
            />
          </label>

          <label>
            New password

            <input
              type="password"
              value={password}
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) =>
                setPassword(
                  event.target.value,
                )
              }
            />
          </label>

          <label>
            Confirm new password

            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) =>
                setConfirm(
                  event.target.value,
                )
              }
            />
          </label>

          {error && (
            <div
              className="login-reset-error"
            >
              {error}
            </div>
          )}

          <div
            className="login-reset-note"
          >
            The administrator issued the
            reset code only. Your new
            password is sent directly to
            the reset service and is
            never displayed to the
            administrator.
          </div>

          <button
            type="submit"
            disabled={busy}
          >
            {busy
              ? 'Resetting & Verifying...'
              : 'Set New Password'}
          </button>

          <small
            className="login-reset-server"
          >
            {serverName}
          </small>
        </form>
      )}
    </section>
  )
}
