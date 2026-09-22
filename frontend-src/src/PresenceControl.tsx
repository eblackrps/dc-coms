import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import * as sdk from 'matrix-js-sdk'

type Props = {
  client: sdk.MatrixClient
  userId: string | null
}

type PresenceChoice =
  | 'online'
  | 'unavailable'
  | 'offline'

const OPTIONS: {
  value: PresenceChoice
  label: string
}[] = [
  {
    value: 'online',
    label: 'Online',
  },
  {
    value: 'unavailable',
    label: 'Away',
  },
  {
    value: 'offline',
    label: 'Offline',
  },
]

function toSyncPresence(
  value: PresenceChoice,
): sdk.SetPresence {
  switch (value) {
    case 'online':
      return sdk.SetPresence.Online

    case 'unavailable':
      return sdk.SetPresence.Unavailable

    default:
      return sdk.SetPresence.Offline
  }
}

function normalizePresence(
  value: string | undefined,
): PresenceChoice {
  if (value === 'online') {
    return 'online'
  }

  if (value === 'unavailable') {
    return 'unavailable'
  }

  return 'offline'
}

function presenceLabel(
  value: PresenceChoice,
) {
  return (
    OPTIONS.find(
      (option) =>
        option.value === value,
    )?.label ||
    'Offline'
  )
}

export default function PresenceControl({
  client,
  userId,
}: Props) {
  const rootRef =
    useRef<HTMLDivElement | null>(null)

  const [open, setOpen] =
    useState(false)

  const [presence, setPresence] =
    useState<PresenceChoice>(
      'online',
    )

  const [
    draftPresence,
    setDraftPresence,
  ] =
    useState<PresenceChoice>(
      'online',
    )

  const [
    statusMessage,
    setStatusMessage,
  ] =
    useState('')

  const [
    draftStatus,
    setDraftStatus,
  ] =
    useState('')

  const [busy, setBusy] =
    useState(false)

  const [error, setError] =
    useState('')

  useEffect(() => {
    if (!userId) return

    let cancelled = false

    const key =
      `dccoms.presence.${userId}`

    const stored =
      window.localStorage
        .getItem(key)

    const saved:
      PresenceChoice | null =
        stored === 'online' ||
        stored === 'unavailable' ||
        stored === 'offline'
          ? stored
          : null

    async function load() {
      try {
        const current =
          await client.getPresence(
            userId!,
          )

        if (cancelled) return

        const selected =
          saved ||
          normalizePresence(
            current.presence,
          )

        const message =
          current.status_msg || ''

        setPresence(selected)
        setDraftPresence(selected)

        setStatusMessage(message)
        setDraftStatus(message)

        if (saved) {
          await client.setSyncPresence(
            toSyncPresence(saved),
          )

          await client.setPresence({
            presence: saved,
            status_msg: message,
          })
        }
      } catch {
        if (cancelled) return

        const fallback =
          saved || 'online'

        setPresence(fallback)
        setDraftPresence(
          fallback,
        )
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [
    client,
    userId,
  ])

  useEffect(() => {
    function mouseDown(
      event: MouseEvent,
    ) {
      if (
        !open ||
        !rootRef.current ||
        !(event.target instanceof Node)
      ) {
        return
      }

      if (
        !rootRef.current.contains(
          event.target,
        )
      ) {
        setOpen(false)
        setError('')
      }
    }

    function keyDown(
      event: KeyboardEvent,
    ) {
      if (
        open &&
        event.key === 'Escape'
      ) {
        setOpen(false)
        setError('')
      }
    }

    document.addEventListener(
      'mousedown',
      mouseDown,
    )

    document.addEventListener(
      'keydown',
      keyDown,
    )

    return () => {
      document.removeEventListener(
        'mousedown',
        mouseDown,
      )

      document.removeEventListener(
        'keydown',
        keyDown,
      )
    }
  }, [open])

  if (!userId) {
    return null
  }

  async function save(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (busy) return

    setBusy(true)
    setError('')

    const message =
      draftStatus
        .trim()
        .slice(0, 80)

    try {
      await client.setSyncPresence(
        toSyncPresence(
          draftPresence,
        ),
      )

      await client.setPresence({
        presence:
          draftPresence,

        status_msg:
          message,
      })

      window.localStorage.setItem(
        `dccoms.presence.${userId}`,
        draftPresence,
      )

      setPresence(
        draftPresence,
      )

      setStatusMessage(
        message,
      )

      setDraftStatus(
        message,
      )

      setOpen(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to update status.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="presence-control"
    >
      <button
        type="button"
        className="presence-trigger"
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }

          setDraftPresence(
            presence,
          )

          setDraftStatus(
            statusMessage,
          )

          setOpen(true)
        }}
      >
        <i
          className={
            `presence-dot ` +
            presence
          }
        />

        <span>
          {presenceLabel(
            presence,
          )}

          {statusMessage && (
            <>
              {' · '}
              {statusMessage}
            </>
          )}
        </span>
      </button>

      {open && (
        <form
          className="presence-popover"
          onSubmit={save}
        >
          <div
            className="presence-popover-heading"
          >
            <strong>
              Set your status
            </strong>

            <span>
              Visible to DC Coms users
            </span>
          </div>

          <div
            className="presence-options"
          >
            {OPTIONS.map(
              (option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    draftPresence ===
                    option.value
                      ? 'presence-option active'
                      : 'presence-option'
                  }
                  disabled={busy}
                  onClick={() => {
                    setDraftPresence(
                      option.value,
                    )
                  }}
                >
                  <i
                    className={
                      `presence-dot ` +
                      option.value
                    }
                  />

                  {option.label}
                </button>
              ),
            )}
          </div>

          <label
            className="presence-message-label"
          >
            Status message

            <input
              value={draftStatus}
              maxLength={80}
              autoComplete="off"
              placeholder="What are you doing?"
              disabled={busy}
              onChange={(event) => {
                setDraftStatus(
                  event.target.value,
                )
              }}
            />
          </label>

          <div
            className="presence-character-count"
          >
            {draftStatus.length}/80
          </div>

          {error && (
            <div
              className="presence-error"
            >
              {error}
            </div>
          )}

          <div
            className="presence-actions"
          >
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setError('')
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={busy}
            >
              {busy
                ? 'Saving...'
                : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
