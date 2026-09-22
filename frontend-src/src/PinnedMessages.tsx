import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import * as sdk from 'matrix-js-sdk'

type Props = {
  client: sdk.MatrixClient
  room: sdk.Room

  onJump: (
    eventId: string,
  ) =>
    Promise<boolean> |
    boolean
}

type PinItem = {
  eventId: string
  sender: string
  displayName: string
  body: string
  timestamp: number | null
  loaded: boolean
  redacted: boolean
}

function readPinnedIds(
  room: sdk.Room,
) {
  const event =
    room.currentState
      .getStateEvents(
        sdk.EventType
          .RoomPinnedEvents,
        '',
      )

  const content =
    event?.getContent() as
      Record<string, any> |
      undefined

  if (
    !Array.isArray(
      content?.pinned,
    )
  ) {
    return []
  }

  return content.pinned.filter(
    (
      value: unknown,
    ): value is string =>
      typeof value === 'string',
  )
}

function previewForEvent(
  event: sdk.MatrixEvent,
) {
  if (event.isRedacted()) {
    return 'This message was deleted.'
  }

  if (
    event.isDecryptionFailure()
  ) {
    return 'Encrypted message is unavailable on this device.'
  }

  const content =
    event.getContent() as
      Record<string, any>

  if (
    content.msgtype ===
      sdk.MsgType.Image
  ) {
    return (
      `Image: ${
        content.filename ||
        content.body ||
        'image'
      }`
    )
  }

  if (
    content.msgtype ===
      sdk.MsgType.File
  ) {
    return (
      `File: ${
        content.filename ||
        content.body ||
        'attachment'
      }`
    )
  }

  if (
    typeof content.body ===
      'string' &&
    content.body.trim()
  ) {
    return content.body
  }

  return 'Matrix message'
}

function truncate(
  value: string,
  max = 220,
) {
  if (
    value.length <= max
  ) {
    return value
  }

  return (
    value.slice(
      0,
      max - 1,
    ) + '…'
  )
}

function formatTime(
  timestamp: number | null,
) {
  if (!timestamp) {
    return ''
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

function buildItem(
  room: sdk.Room,
  eventId: string,
): PinItem {
  const event =
    room.findEventById(
      eventId,
    )

  if (!event) {
    return {
      eventId,
      sender: '',
      displayName:
        'Pinned message',
      body:
        'This pinned message is not currently loaded in the local timeline.',
      timestamp: null,
      loaded: false,
      redacted: false,
    }
  }

  const sender =
    event.getSender() ??
    'unknown'

  const member =
    room.getMember(sender)

  return {
    eventId,
    sender,

    displayName:
      member?.name ??
      sender,

    body:
      previewForEvent(
        event,
      ),

    timestamp:
      event.getTs(),

    loaded: true,

    redacted:
      event.isRedacted(),
  }
}

export default function PinnedMessages({
  client,
  room,
  onJump,
}: Props) {
  const [open, setOpen] =
    useState(false)

  const [revision, setRevision] =
    useState(0)

  const [
    overridePinned,
    setOverridePinned,
  ] = useState<
    string[] | null
  >(null)

  const [
    busyEventId,
    setBusyEventId,
  ] = useState<
    string | null
  >(null)

  const [error, setError] =
    useState('')

  const pinnedIds =
    useMemo(
      () =>
        overridePinned ??
        readPinnedIds(room),
      [
        room,
        revision,
        overridePinned,
      ],
    )

  const items =
    useMemo(
      () =>
        pinnedIds
          .map(
            (eventId) =>
              buildItem(
                room,
                eventId,
              ),
          )
          .reverse(),
      [
        room,
        pinnedIds,
        revision,
      ],
    )

  const canPin =
    room.currentState
      .mayClientSendStateEvent(
        sdk.EventType
          .RoomPinnedEvents,
        client,
      )

  useEffect(() => {
    setOverridePinned(null)
    setError('')
    setOpen(false)
  }, [room.roomId])

  useEffect(() => {
    function onLocalPins(
      event: Event,
    ) {
      const custom =
        event as CustomEvent<{
          roomId?: string
          pinned?: string[]
        }>

      if (
        custom.detail?.roomId !==
          room.roomId ||
        !Array.isArray(
          custom.detail?.pinned,
        )
      ) {
        return
      }

      setOverridePinned(
        custom.detail.pinned,
      )

      setRevision(
        (current) =>
          current + 1,
      )
    }

    function onMatrixEvent(
      event: sdk.MatrixEvent,
    ) {
      if (
        event.getRoomId() !==
          room.roomId ||
        event.getType() !==
          sdk.EventType
            .RoomPinnedEvents
      ) {
        return
      }

      /*
       * Server sync is authoritative.
       */
      setOverridePinned(null)

      setRevision(
        (current) =>
          current + 1,
      )
    }

    window.addEventListener(
      'dccoms-pins-changed',
      onLocalPins,
    )

    client.on(
      sdk.ClientEvent.Event,
      onMatrixEvent,
    )

    return () => {
      window.removeEventListener(
        'dccoms-pins-changed',
        onLocalPins,
      )

      client.off(
        sdk.ClientEvent.Event,
        onMatrixEvent,
      )
    }
  }, [
    client,
    room.roomId,
  ])

  useEffect(() => {
    if (!open) return

    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        event.key === 'Escape'
      ) {
        setOpen(false)
      }
    }

    window.addEventListener(
      'keydown',
      onKeyDown,
    )

    return () => {
      window.removeEventListener(
        'keydown',
        onKeyDown,
      )
    }
  }, [open])

  async function jumpTo(
    eventId: string,
  ) {
    setError('')

    try {
      const found =
        await onJump(
          eventId,
        )

      if (!found) {
        setError(
          'That pinned message could not be loaded from room history.',
        )

        return
      }

      setOpen(false)

    } catch (err) {
      console.error(
        'Pinned message navigation failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to open that pinned message.',
      )
    }
  }


  async function unpin(
    eventId: string,
  ) {
    if (
      !canPin ||
      busyEventId
    ) {
      return
    }

    setBusyEventId(
      eventId,
    )

    setError('')

    try {
      const current =
        overridePinned ??
        readPinnedIds(room)

      const next =
        current.filter(
          (id) =>
            id !== eventId,
        )

      /*
       * Optimistic panel update.
       */
      setOverridePinned(
        next,
      )

      await client.sendStateEvent(
        room.roomId,
        sdk.EventType
          .RoomPinnedEvents,
        {
          pinned: next,
        },
      )

      window.dispatchEvent(
        new CustomEvent(
          'dccoms-pins-changed',
          {
            detail: {
              roomId:
                room.roomId,

              pinned: next,
            },
          },
        ),
      )
    } catch (err) {
      console.error(
        'Unable to unpin message:',
        err,
      )

      setOverridePinned(null)

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to unpin message.',
      )
    } finally {
      setBusyEventId(null)
    }
  }

  return (
    <div
      className="pinned-messages-wrap"
    >
      <button
        type="button"
        className="pinned-messages-button"
        onClick={() => {
          setError('')
          setOpen(true)
        }}
      >
        📌 Pins
        {pinnedIds.length > 0 && (
          <span>
            {pinnedIds.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="pinned-messages-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setOpen(false)
            }
          }}
        >
          <section
            className="pinned-messages-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Pinned messages"
          >
            <header
              className="pinned-messages-header"
            >
              <div>
                <div
                  className="pinned-messages-eyebrow"
                >
                  DC COMS
                </div>

                <h2>
                  Pinned Messages
                </h2>

                <p>
                  Important messages
                  saved for this room.
                </p>
              </div>

              <button
                type="button"
                className="pinned-messages-close"
                aria-label="Close pinned messages"
                onClick={() =>
                  setOpen(false)
                }
              >
                ×
              </button>
            </header>

            {error && (
              <div
                className="pinned-messages-error"
              >
                {error}
              </div>
            )}

            <div
              className="pinned-messages-list"
            >
              {items.length === 0 ? (
                <div
                  className="pinned-messages-empty"
                >
                  <strong>
                    Nothing pinned yet.
                  </strong>

                  <span>
                    Open a message's
                    ••• More menu and
                    choose Pin message.
                  </span>
                </div>
              ) : (
                items.map(
                  (item) => (
                    <article
                      className="pinned-message"
                      key={
                        item.eventId
                      }
                    >
                      <div
                        className="pinned-message-main"
                      >
                        <div
                          className="pinned-message-meta"
                        >
                          <strong>
                            {
                              item.displayName
                            }
                          </strong>

                          {item.timestamp && (
                            <span>
                              {formatTime(
                                item.timestamp,
                              )}
                            </span>
                          )}
                        </div>

                        <div
                          className={
                            item.redacted
                              ? 'pinned-message-body redacted'
                              : 'pinned-message-body'
                          }
                        >
                          {truncate(
                            item.body,
                          )}
                        </div>

                        {!item.loaded && (
                          <span
                            className="pinned-message-not-loaded"
                          >
                            Older history is
                            not loaded locally.
                          </span>
                        )}
                      </div>

                      <div
                        className="pinned-message-actions"
                      >
                        <button
                          type="button"
                          disabled={
                            !item.loaded
                          }
                          onClick={() =>
                            jumpTo(
                              item.eventId,
                            )
                          }
                        >
                          Jump
                        </button>

                        {canPin && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={
                              busyEventId !==
                              null
                            }
                            onClick={() => {
                              void unpin(
                                item.eventId,
                              )
                            }}
                          >
                            {busyEventId ===
                            item.eventId
                              ? 'Removing...'
                              : 'Unpin'}
                          </button>
                        )}
                      </div>
                    </article>
                  ),
                )
              )}
            </div>

            <footer
              className="pinned-messages-footer"
            >
              Pin state is shared with
              the room. Message content
              remains protected by the
              room's existing encryption.
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}
