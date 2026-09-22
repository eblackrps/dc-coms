import {
  useState,
  type FormEvent,
} from 'react'

import type {
  MatrixClient,
} from 'matrix-js-sdk'

type Props = {
  client: MatrixClient
}

export default function ChangeMyPassword({
  client,
}: Props) {
  const [open, setOpen] =
    useState(false)

  const [
    currentPassword,
    setCurrentPassword,
  ] = useState('')

  const [
    newPassword,
    setNewPassword,
  ] = useState('')

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState('')

  const [busy, setBusy] =
    useState(false)

  const [error, setError] =
    useState('')

  const [success, setSuccess] =
    useState('')

  function clearPasswords() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  function close() {
    if (busy) return

    clearPasswords()
    setError('')
    setOpen(false)
  }

  async function submit(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (busy) return

    setError('')
    setSuccess('')

    if (!currentPassword) {
      setError(
        'Enter your current password.',
      )
      return
    }

    if (
      newPassword.length < 12
    ) {
      setError(
        'Use at least 12 characters for the new password.',
      )
      return
    }

    if (
      newPassword !==
      confirmPassword
    ) {
      setError(
        'The new passwords do not match.',
      )
      return
    }

    if (
      currentPassword ===
      newPassword
    ) {
      setError(
        'Choose a new password that differs from the current password.',
      )
      return
    }

    const token =
      client.getAccessToken()

    if (!token) {
      setError(
        'Your Matrix session is unavailable. Sign in again.',
      )
      return
    }

    setBusy(true)

    try {
      const response =
        await fetch(
          '/api/password-reset/change',
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
                current_password:
                  currentPassword,

                new_password:
                  newPassword,
              }),
          },
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
          'Unable to change password.',
        )
      }

      clearPasswords()
      setOpen(false)

      setSuccess(
        'Password changed and verified. Signing you out...',
      )

      window.setTimeout(
        () => {
          window.dispatchEvent(
            new CustomEvent(
              'dccoms-password-force-logout',
            ),
          )
        },
        800,
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to change password.',
      )

      /*
       * Do not keep password material
       * in React state after an attempt.
       */
      clearPasswords()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="self-password-card"
    >
      <div
        className="self-password-heading"
      >
        <div>
          <div
            className="security-card-heading"
          >
            Change My Password
          </div>

          <p>
            Change your own sign-in
            password without involving
            an administrator.
          </p>
        </div>

        {!open && (
          <button
            type="button"
            onClick={() => {
              setError('')
              setSuccess('')
              setOpen(true)
            }}
          >
            Change Password
          </button>
        )}
      </div>

      {success && (
        <div
          className="self-password-success"
        >
          <strong>
            Password changed
          </strong>

          <span>
            {success}
          </span>
        </div>
      )}

      {open && (
        <form
          className="self-password-form"
          onSubmit={submit}
        >
          <label>
            Current password

            <input
              type="password"
              value={
                currentPassword
              }
              autoFocus
              autoComplete="current-password"
              disabled={busy}
              onChange={(event) =>
                setCurrentPassword(
                  event.target.value,
                )
              }
            />
          </label>

          <div
            className="self-password-new-row"
          >
            <label>
              New password

              <input
                type="password"
                value={
                  newPassword
                }
                autoComplete="new-password"
                disabled={busy}
                onChange={(event) =>
                  setNewPassword(
                    event.target.value,
                  )
                }
              />
            </label>

            <label>
              Confirm new password

              <input
                type="password"
                value={
                  confirmPassword
                }
                autoComplete="new-password"
                disabled={busy}
                onChange={(event) =>
                  setConfirmPassword(
                    event.target.value,
                  )
                }
              />
            </label>
          </div>

          <div
            className="self-password-note"
          >
            Your current password is
            verified directly against
            your Matrix account. The new
            password is then changed and
            independently verified before
            DC Coms reports success.

            Your encryption recovery key,
            cross-signing identity and
            current device are unchanged.
          </div>

          {error && (
            <div
              className="self-password-error"
            >
              {error}
            </div>
          )}

          <div
            className="self-password-actions"
          >
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                busy ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
            >
              {busy
                ? 'Changing & Verifying...'
                : 'Change Password'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
