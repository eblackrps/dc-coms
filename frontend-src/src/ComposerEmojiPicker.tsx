import {
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  QUICK_REACTIONS,
  STANDARD_REACTIONS,
  type DcReactionDefinition,
} from './Reactions'

type Props = {
  disabled?: boolean
  onSend: (
    reaction: DcReactionDefinition,
  ) => Promise<void> | void
}

export default function ComposerEmojiPicker({
  disabled = false,
  onSend,
}: Props) {
  const rootRef =
    useRef<HTMLDivElement | null>(null)

  const [open, setOpen] =
    useState(false)

  const [busy, setBusy] =
    useState(false)

  useEffect(() => {
    function closeOnOutside(
      event: MouseEvent,
    ) {
      const root = rootRef.current

      if (
        open &&
        root &&
        !root.contains(
          event.target as Node,
        )
      ) {
        setOpen(false)
      }
    }

    function closeOnEscape(
      event: KeyboardEvent,
    ) {
      if (
        open &&
        event.key === 'Escape'
      ) {
        setOpen(false)
      }
    }

    document.addEventListener(
      'mousedown',
      closeOnOutside,
    )

    document.addEventListener(
      'keydown',
      closeOnEscape,
    )

    return () => {
      document.removeEventListener(
        'mousedown',
        closeOnOutside,
      )

      document.removeEventListener(
        'keydown',
        closeOnEscape,
      )
    }
  }, [open])

  async function send(
    reaction: DcReactionDefinition,
  ) {
    if (busy || disabled) return

    setBusy(true)

    try {
      await onSend(reaction)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  function item(
    reaction: DcReactionDefinition,
  ) {
    return (
      <button
        key={reaction.key}
        type="button"
        className={
          reaction.image
            ? 'composer-emote-item graphical'
            : 'composer-emote-item'
        }
        title={reaction.label}
        disabled={busy}
        onClick={() =>
          void send(reaction)
        }
      >
        {reaction.image ? (
          <img
            src={reaction.image}
            alt={reaction.label}
            draggable={false}
          />
        ) : (
          <span>{reaction.key}</span>
        )}

        <small>
          {reaction.label}
        </small>
      </button>
    )
  }

  function section(
    name: string,
    items: DcReactionDefinition[],
  ) {
    return (
      <>
        <div className="composer-emote-heading">
          {name}
        </div>

        <div className="composer-emote-grid">
          {items.map(item)}
        </div>
      </>
    )
  }

  return (
    <div
      className="composer-emote"
      ref={rootRef}
    >
      <button
        type="button"
        className="composer-emote-button"
        aria-label="Send emoji or emote"
        title="Emoji and emotes"
        disabled={disabled}
        onClick={() =>
          setOpen(!open)
        }
      >
        🙂
      </button>

      {open && (
        <div className="composer-emote-picker">
          <div className="composer-emote-title">
            Send an emoji
          </div>

          <div className="composer-emote-note">
            Sent by itself, so it appears large.
          </div>

          {section(
            'Quick',
            QUICK_REACTIONS,
          )}

          {section(
            'Standard',
            STANDARD_REACTIONS,
          )}

        </div>
      )}
    </div>
  )
}
