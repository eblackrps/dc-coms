import {
  useEffect,
  useRef,
  useState,
} from 'react'
import * as sdk from 'matrix-js-sdk'

type Props = {
  client: sdk.MatrixClient | null
  room: sdk.Room
}

export default function ChannelTopic({
  client,
  room,
}: Props) {
  const rootRef =
    useRef<HTMLDivElement | null>(null)

  const [topic, setTopic] = useState('')
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function closeEditor() {
    setOpen(false)
    setDraft(topic)
    setError('')
  }

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      const root = rootRef.current

      if (
        open &&
        root &&
        !root.contains(event.target as Node)
      ) {
        closeEditor()
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (open && event.key === 'Escape') {
        closeEditor()
      }
    }

    document.addEventListener(
      'mousedown',
      onMouseDown,
    )

    document.addEventListener(
      'keydown',
      onKeyDown,
    )

    return () => {
      document.removeEventListener(
        'mousedown',
        onMouseDown,
      )

      document.removeEventListener(
        'keydown',
        onKeyDown,
      )
    }
  }, [open, topic])

  useEffect(() => {
    let cancelled = false

    async function loadTopic() {
      if (!client) return

      try {
        const content =
          await client.getStateEvent(
            room.roomId,
            sdk.EventType.RoomTopic,
            '',
          )

        if (cancelled) return

        const next =
          typeof content.topic === 'string'
            ? content.topic
            : ''

        setTopic(next)
        setDraft(next)
      } catch {
        if (!cancelled) {
          setTopic('')
          setDraft('')
        }
      }
    }

    loadTopic()

    if (!client) {
      return () => {
        cancelled = true
      }
    }

    const onEvent = (
      event: sdk.MatrixEvent,
    ) => {
      if (
        event.getRoomId() !== room.roomId ||
        event.getType() !==
          sdk.EventType.RoomTopic
      ) {
        return
      }

      const content =
        event.getContent()

      const next =
        typeof content.topic === 'string'
          ? content.topic
          : ''

      setTopic(next)

      if (!open) {
        setDraft(next)
      }
    }

    client.on(
      sdk.ClientEvent.Event,
      onEvent,
    )

    return () => {
      cancelled = true

      client.off(
        sdk.ClientEvent.Event,
        onEvent,
      )
    }
  }, [client, room.roomId, open])

  function beginEdit() {
    setDraft(topic)
    setError('')
    setOpen(true)
  }

  async function saveTopic(
    event: React.FormEvent,
  ) {
    event.preventDefault()

    if (!client) return

    const next = draft.trim()

    setBusy(true)
    setError('')

    try {
      await client.setRoomTopic(
        room.roomId,
        next,
      )

      setTopic(next)
      setDraft(next)
      setOpen(false)
    } catch (err) {
      console.error(
        'Topic update failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to update topic.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeTopic() {
    if (!client) return

    setBusy(true)
    setError('')

    try {
      await client.setRoomTopic(
        room.roomId,
        '',
      )

      setTopic('')
      setDraft('')
      setOpen(false)
    } catch (err) {
      console.error(
        'Topic removal failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to remove topic.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="channel-topic-wrap"
      ref={rootRef}
    >
      <div className="channel-topic-display">
        {topic ? (
          <>
            <span className="channel-topic-text">
              {topic}
            </span>

            <button
              className="channel-topic-edit"
              onClick={beginEdit}
            >
              Edit topic
            </button>
          </>
        ) : (
          <button
            className="channel-topic-add"
            onClick={beginEdit}
          >
            + Add topic
          </button>
        )}
      </div>

      {open && (
        <div className="channel-topic-popover">
          <div className="channel-topic-title">
            Channel topic
          </div>

          <form onSubmit={saveTopic}>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setError('')
              }}
              placeholder="What is this channel for?"
              rows={4}
              disabled={busy}
            />

            {error && (
              <div className="channel-topic-error">
                {error}
              </div>
            )}

            <div className="channel-topic-actions">
              <button
                type="button"
                className="channel-topic-cancel"
                onClick={closeEditor}
                disabled={busy}
              >
                Cancel
              </button>

              {topic && (
                <button
                  type="button"
                  className="channel-topic-remove"
                  onClick={removeTopic}
                  disabled={busy}
                >
                  Remove
                </button>
              )}

              <button
                type="submit"
                disabled={
                  busy ||
                  draft.trim() === topic
                }
              >
                {busy
                  ? 'Saving...'
                  : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
