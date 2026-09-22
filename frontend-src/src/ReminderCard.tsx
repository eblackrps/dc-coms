import {
  useEffect,
  useState,
} from 'react'

import {
  createPortal,
} from 'react-dom'

import * as sdk from 'matrix-js-sdk'


export type DcReminderMeta = {
  version?: number
  id?: number

  mode?:
    | 'personal'
    | 'channel'

  due_ts?: number
  text?: string

  origin_room_id?:
    | string
    | null

  origin_event_id?:
    | string
    | null

  origin_preview?:
    | string
    | null
}


type ContextRow = {
  id: string
  displayName: string
  body: string
  timestamp: number
  original: boolean
}


type Props = {
  client: sdk.MatrixClient
  reminder: DcReminderMeta
}


function stripReplyFallback(
  body: string,
) {
  const lines =
    body.split(
      '\n',
    )

  let index = 0

  while (
    index <
      lines.length &&
    lines[index]
      .startsWith(
        '> ',
      )
  ) {
    index += 1
  }

  if (
    index > 0 &&
    lines[index] ===
      ''
  ) {
    index += 1
  }

  return lines
    .slice(
      index,
    )
    .join(
      '\n',
    )
    .trim()
}


function isReplacement(
  event: sdk.MatrixEvent,
) {
  const content =
    event
      .getOriginalContent() as
      Record<string, any>

  return (
    content?.[
      'm.relates_to'
    ]?.rel_type ===
      'm.replace'
  )
}


function contextBody(
  event: sdk.MatrixEvent,
) {
  if (
    event.isDecryptionFailure()
  ) {
    return (
      'Encrypted message could not be decrypted on this device.'
    )
  }

  const content =
    event.getContent() as
      Record<string, any>

  const raw =
    typeof content.body ===
      'string'
      ? stripReplyFallback(
          content.body,
        )
      : ''

  if (
    content.msgtype ===
      sdk.MsgType.Image
  ) {
    return (
      `Image: ${
        content.filename ||
        raw ||
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
        raw ||
        'attachment'
      }`
    )
  }

  return (
    raw ||
    'Message'
  )
}


function formatReminderDue(
  due: number | undefined,
) {
  if (
    typeof due !==
      'number' ||
    !Number.isFinite(
      due,
    )
  ) {
    return (
      'Scheduled time unavailable'
    )
  }

  const milliseconds =
    due <
      10000000000
      ? due * 1000
      : due

  return new Date(
    milliseconds,
  ).toLocaleString(
    [],
    {
      weekday:
        'short',

      month:
        'short',

      day:
        'numeric',

      hour:
        'numeric',

      minute:
        '2-digit',
    },
  )
}


export default function ReminderCard({
  client,
  reminder,
}: Props) {
  const [
    contextOpen,
    setContextOpen,
  ] =
    useState(false)

  const [
    contextLoading,
    setContextLoading,
  ] =
    useState(false)

  const [
    contextError,
    setContextError,
  ] =
    useState('')

  const [
    contextTitle,
    setContextTitle,
  ] =
    useState(
      'Original context',
    )

  const [
    contextRows,
    setContextRows,
  ] =
    useState<ContextRow[]>(
      [],
    )


  useEffect(() => {
    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        event.key ===
        'Escape'
      ) {
        setContextOpen(
          false,
        )
      }
    }

    if (
      contextOpen
    ) {
      document.addEventListener(
        'keydown',
        onKeyDown,
      )
    }

    return () => {
      document.removeEventListener(
        'keydown',
        onKeyDown,
      )
    }
  }, [
    contextOpen,
  ])


  async function loadContext() {
    const roomId =
      reminder
        .origin_room_id

    const eventId =
      reminder
        .origin_event_id

    if (
      !roomId ||
      !eventId
    ) {
      return
    }

    setContextOpen(
      true,
    )

    setContextLoading(
      true,
    )

    setContextError(
      '',
    )

    setContextRows(
      [],
    )

    try {
      const room =
        client.getRoom(
          roomId,
        )

      if (
        !room ||
        room.getMyMembership() !==
          'join'
      ) {
        throw new Error(
          'The source conversation is no longer available to this account.',
        )
      }

      setContextTitle(
        room.name?.trim() ||
          'Original context',
      )

      let events =
        room
          .getLiveTimeline()
          .getEvents()

      let found =
        events.some(
          (event) =>
            event.getId() ===
              eventId,
        )

      if (!found) {
        const timelineSet =
          (
            room as any
          )
            .getUnfilteredTimelineSet?.()

        if (
          timelineSet
        ) {
          const eventTimeline =
            await client
              .getEventTimeline(
                timelineSet,
                eventId,
              )

          if (
            eventTimeline
          ) {
            events =
              eventTimeline
                .getEvents()

            found =
              events.some(
                (event) =>
                  event
                    .getId() ===
                  eventId,
              )
          }
        }
      }

      /*
       * Context timelines may contain freshly
       * fetched encrypted events. Ask the active
       * crypto implementation to decrypt them
       * when the SDK exposes the helper.
       */
      const decrypt =
        (
          client as any
        )
          .decryptEventIfNeeded

      if (
        typeof decrypt ===
          'function'
      ) {
        for (
          const event of
          events
        ) {
          if (
            event.isEncrypted()
          ) {
            try {
              await decrypt.call(
                client,
                event,
              )
            } catch {
              /*
               * Keep the row and show a
               * decryption-unavailable message.
               */
            }
          }
        }
      }

      const rows:
        ContextRow[] = []

      for (
        const event of
        events
      ) {
        if (
          event.getType() !==
            sdk.EventType
              .RoomMessage ||
          event.isRedacted() ||
          isReplacement(
            event,
          )
        ) {
          continue
        }

        const id =
          event.getId()

        if (!id) {
          continue
        }

        const sender =
          event.getSender() ??
          'unknown'

        const member =
          room.getMember(
            sender,
          )

        rows.push({
          id,

          displayName:
            member?.name ??
            sender,

          body:
            contextBody(
              event,
            ),

          timestamp:
            event.getTs(),

          original:
            id ===
              eventId,
        })
      }

      const targetIndex =
        rows.findIndex(
          (row) =>
            row.id ===
              eventId,
        )

      if (
        targetIndex < 0
      ) {
        throw new Error(
          found
            ? 'The original event could not be displayed.'
            : 'The original message could not be loaded from the room history.',
        )
      }

      const start =
        Math.max(
          0,
          targetIndex - 4,
        )

      const end =
        Math.min(
          rows.length,
          targetIndex + 5,
        )

      setContextRows(
        rows.slice(
          start,
          end,
        ),
      )

    } catch (err) {
      console.error(
        'Reminder context load failed:',
        err,
      )

      setContextError(
        err instanceof Error
          ? err.message
          : 'Unable to load the original context.',
      )

    } finally {
      setContextLoading(
        false,
      )
    }
  }


  const text =
    typeof reminder.text ===
      'string' &&
    reminder.text.trim()
      ? reminder.text.trim()
      : 'Reminder details unavailable.'

  const personal =
    reminder.mode ===
      'personal'

  const hasContext =
    Boolean(
      reminder
        .origin_room_id &&
      reminder
        .origin_event_id,
    )


  return (
    <>
      <section
        className={
          personal
            ? 'dc-reminder-card personal'
            : 'dc-reminder-card channel'
        }
      >
        <div className="dc-reminder-heading">
          <span>
            ⏰
          </span>

          <div>
            <strong>
              {personal
                ? 'PERSONAL REMINDER'
                : 'REMINDER'}
            </strong>

            {reminder.id !==
              undefined && (
              <small>
                #{reminder.id}
              </small>
            )}
          </div>
        </div>


        <div className="dc-reminder-text">
          {text}
        </div>


        <div className="dc-reminder-due">
          <span>
            Set for
          </span>

          <strong>
            {formatReminderDue(
              reminder.due_ts,
            )}
          </strong>
        </div>


        {reminder
          .origin_preview && (
          <button
            type="button"
            className="dc-reminder-origin"
            disabled={
              !hasContext
            }
            onClick={() => {
              void loadContext()
            }}
          >
            <span>
              ↩ Original message
            </span>

            <strong>
              {
                reminder
                  .origin_preview
              }
            </strong>
          </button>
        )}


        {hasContext &&
          !reminder
            .origin_preview && (
          <button
            type="button"
            className="dc-reminder-context-link"
            onClick={() => {
              void loadContext()
            }}
          >
            ↩ View original context
          </button>
        )}


        {hasContext &&
          reminder
            .origin_preview && (
          <button
            type="button"
            className="dc-reminder-context-link"
            onClick={() => {
              void loadContext()
            }}
          >
            View original context
          </button>
        )}
      </section>


      {contextOpen &&
        createPortal(
          <div
            className="reminder-context-overlay"
            onMouseDown={(
              event,
            ) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setContextOpen(
                  false,
                )
              }
            }}
          >
            <section className="reminder-context-panel">
              <header className="reminder-context-header">
                <div>
                  <div className="reminder-context-eyebrow">
                    REMINDER SOURCE
                  </div>

                  <h2>
                    {contextTitle}
                  </h2>

                  <p>
                    Messages around the original reminder source.
                  </p>
                </div>

                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    setContextOpen(
                      false,
                    )
                  }}
                >
                  ×
                </button>
              </header>


              <div className="reminder-context-body">
                {contextLoading && (
                  <div className="reminder-context-status">
                    Loading encrypted context...
                  </div>
                )}


                {contextError && (
                  <div className="reminder-context-error">
                    {contextError}
                  </div>
                )}


                {!contextLoading &&
                  !contextError &&
                  contextRows.map(
                    (row) => (
                      <article
                        key={
                          row.id
                        }
                        className={
                          row.original
                            ? 'reminder-context-row original'
                            : 'reminder-context-row'
                        }
                      >
                        <div className="reminder-context-meta">
                          <strong>
                            {
                              row.displayName
                            }
                          </strong>

                          <span>
                            {new Date(
                              row.timestamp,
                            ).toLocaleString(
                              [],
                              {
                                month:
                                  'short',

                                day:
                                  'numeric',

                                hour:
                                  'numeric',

                                minute:
                                  '2-digit',
                              },
                            )}
                          </span>

                          {row.original && (
                            <em>
                              Original message
                            </em>
                          )}
                        </div>

                        <div className="reminder-context-message">
                          {
                            row.body
                          }
                        </div>
                      </article>
                    ),
                  )}
              </div>


              <footer className="reminder-context-footer">
                <span>
                  Showing the original message with nearby conversation for context.
                </span>

                <button
                  type="button"
                  onClick={() => {
                    setContextOpen(
                      false,
                    )
                  }}
                >
                  Close
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}
