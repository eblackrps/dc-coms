import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import * as sdk from 'matrix-js-sdk'

type SearchRow = {
  eventId: string
  sender: string
  displayName: string
  body: string
  searchText: string
  timestamp: number
  kind: 'text' | 'image' | 'file'
  edited: boolean
}

type Props = {
  client: sdk.MatrixClient
  room: sdk.Room
  onClose: () => void
  onJump: (
    eventId: string,
  ) => void
}

function stripReplyFallback(
  body: string,
) {
  const lines =
    body.split('\n')

  let index = 0

  while (
    index < lines.length &&
    lines[index].startsWith('> ')
  ) {
    index += 1
  }

  if (
    index > 0 &&
    lines[index] === ''
  ) {
    index += 1
  }

  return lines
    .slice(index)
    .join('\n')
}

function isReplacementEvent(
  event: sdk.MatrixEvent,
) {
  const original =
    event.getOriginalContent() as
      Record<string, any>

  return (
    original?.['m.relates_to']
      ?.rel_type === 'm.replace'
  )
}

function rowFromEvent(
  room: sdk.Room,
  event: sdk.MatrixEvent,
): SearchRow | null {
  if (
    event.getType() !==
      sdk.EventType.RoomMessage ||
    event.isRedacted() ||
    event.isDecryptionFailure() ||
    isReplacementEvent(event)
  ) {
    return null
  }

  const eventId =
    event.getId()

  if (!eventId) {
    return null
  }

  const content =
    event.getContent() as
      Record<string, any>

  const msgtype =
    content.msgtype

  let kind:
    'text' |
    'image' |
    'file'

  if (
    msgtype === sdk.MsgType.Text
  ) {
    kind = 'text'
  } else if (
    msgtype === sdk.MsgType.Image
  ) {
    kind = 'image'
  } else if (
    msgtype === sdk.MsgType.File
  ) {
    kind = 'file'
  } else {
    return null
  }

  const rawBody =
    typeof content.body === 'string'
      ? content.body
      : ''

  const body =
    kind === 'text'
      ? stripReplyFallback(
          rawBody,
        )
      : (
          typeof content.filename ===
            'string' &&
          content.filename
            ? content.filename
            : rawBody
        )

  if (!body.trim()) {
    return null
  }

  const sender =
    event.getSender() ??
    'unknown'

  const member =
    room.getMember(sender)

  const displayName =
    member?.name ??
    sender

  return {
    eventId,
    sender,
    displayName,
    body,

    /*
     * Precompute searchable text once
     * instead of rebuilding it on every
     * keypress.
     */
    searchText:
      `${displayName}\n${body}`
        .toLocaleLowerCase(),

    timestamp:
      event.getTs(),

    kind,

    edited:
      Boolean(
        event.replacingEvent() ||
        event.replacingEventId(),
      ),
  }
}

function formatTime(
  timestamp: number,
) {
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

function truncate(
  value: string,
  max = 260,
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

async function yieldToBrowser() {
  await new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        0,
      )
    },
  )
}

function SearchInput({
  onCommit,
}: {
  onCommit: (
    value: string,
  ) => void
}) {
  /*
   * The browser owns the visible input
   * value now.
   *
   * Typing does not cause a React render.
   */
  const timerRef =
    useRef<number | null>(null)

  const valueRef =
    useRef('')

  useEffect(() => {
    return () => {
      if (
        timerRef.current !== null
      ) {
        window.clearTimeout(
          timerRef.current,
        )
      }
    }
  }, [])

  function scheduleCommit(
    value: string,
  ) {
    valueRef.current = value

    if (
      timerRef.current !== null
    ) {
      window.clearTimeout(
        timerRef.current,
      )
    }

    timerRef.current =
      window.setTimeout(
        () => {
          timerRef.current = null

          onCommit(
            valueRef.current,
          )
        },
        45,
      )
  }

  function commitNow() {
    if (
      timerRef.current !== null
    ) {
      window.clearTimeout(
        timerRef.current,
      )

      timerRef.current = null
    }

    onCommit(
      valueRef.current,
    )
  }

  return (
    <input
      type="search"
      defaultValue=""
      autoFocus
      autoComplete="off"
      spellCheck={false}
      placeholder="Search messages..."
      onInput={(event) => {
        scheduleCommit(
          event.currentTarget.value,
        )
      }}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter'
        ) {
          commitNow()
        }
      }}
    />
  )
}

export default function MessageSearch({
  client,
  room,
  onClose,
  onJump,
}: Props) {
  const [query, setQuery] =
    useState('')

  const [
    senderFilter,
    setSenderFilter,
  ] = useState('all')

  const [
    loadingOlder,
    setLoadingOlder,
  ] = useState(false)

  const [
    historyMessage,
    setHistoryMessage,
  ] = useState('')

  const [
    historyExhausted,
    setHistoryExhausted,
  ] = useState(
    (room as any)
      .oldState
      ?.paginationToken === null,
  )

  const [
    timelineRevision,
    setTimelineRevision,
  ] = useState(0)

  useEffect(() => {
    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        event.key === 'Escape'
      ) {
        onClose()
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
  }, [onClose])

  /*
   * Only rebuild the search index for
   * genuinely new live events.
   *
   * Paginated history is handled once,
   * explicitly, after scrollback finishes.
   */
  useEffect(() => {
    const onTimeline = (
      _event: sdk.MatrixEvent,
      eventRoom:
        sdk.Room | undefined,
      toStartOfTimeline:
        boolean | undefined,
    ) => {
      if (
        eventRoom?.roomId ===
          room.roomId &&
        !toStartOfTimeline
      ) {
        setTimelineRevision(
          (current) =>
            current + 1,
        )
      }
    }

    client.on(
      sdk.RoomEvent.Timeline,
      onTimeline,
    )

    return () => {
      client.off(
        sdk.RoomEvent.Timeline,
        onTimeline,
      )
    }
  }, [
    client,
    room.roomId,
  ])

  /*
   * Build the decrypted search index
   * once per timeline revision.
   *
   * Typing in the search field does NOT
   * rebuild this array.
   */
  const {
    rows,
    timelineCount,
  } = useMemo(
    () => {
      const events =
        room
          .getLiveTimeline()
          .getEvents()

      const indexed =
        events
          .map(
            (event) =>
              rowFromEvent(
                room,
                event,
              ),
          )
          .filter(
            (
              row,
            ): row is SearchRow =>
              row !== null,
          )
          .sort(
            (a, b) =>
              b.timestamp -
              a.timestamp,
          )

      return {
        rows: indexed,
        timelineCount:
          events.length,
      }
    },
    [
      room,
      timelineRevision,
    ],
  )

  const senders =
    useMemo(
      () => {
        const senderMap =
          new Map<
            string,
            string
          >()

        for (const row of rows) {
          senderMap.set(
            row.sender,
            row.displayName,
          )
        }

        return Array.from(
          senderMap.entries(),
        ).sort(
          (a, b) =>
            a[1].localeCompare(
              b[1],
            ),
        )
      },
      [rows],
    )

  /*
   * React can keep the input responsive
   * while the result list catches up.
   */
  const normalizedQuery =
    query
      .trim()
      .toLocaleLowerCase()

  const filtered =
    useMemo(
      () =>
        rows.filter(
          (row) => {
            if (
              senderFilter !==
                'all' &&
              row.sender !==
                senderFilter
            ) {
              return false
            }

            if (
              !normalizedQuery
            ) {
              return true
            }

            return row
              .searchText
              .includes(
                normalizedQuery,
              )
          },
        ),
      [
        rows,
        senderFilter,
        normalizedQuery,
      ],
    )

  /*
   * Rendering hundreds of DOM result
   * cards provides very little benefit.
   * Search still counts every match.
   */
  const visibleResults =
    useMemo(
      () =>
        filtered.slice(
          0,
          120,
        ),
      [filtered],
    )

  async function loadOlder() {
    if (
      loadingOlder ||
      historyExhausted
    ) {
      return
    }

    setLoadingOlder(true)
    setHistoryMessage('')

    try {
      const beforeEvents =
        room
          .getLiveTimeline()
          .getEvents()

      const before =
        beforeEvents.length

      const existingIds =
        new Set(
          beforeEvents
            .map(
              (event) =>
                event.getId(),
            )
            .filter(
              (
                id,
              ): id is string =>
                Boolean(id),
            ),
        )

      await client.scrollback(
        room,
        100,
      )

      const afterEvents =
        room
          .getLiveTimeline()
          .getEvents()

      /*
       * THIS is the big performance fix.
       *
       * Only decrypt events that were
       * actually added by this pagination
       * request. The old implementation
       * walked/decrypted the entire loaded
       * timeline every time.
       */
      const newlyLoaded =
        afterEvents.filter(
          (event) => {
            const id =
              event.getId()

            return (
              id !== undefined &&
              id !== null &&
              !existingIds.has(id)
            )
          },
        )

      /*
       * Decrypt in modest batches so Rust
       * Crypto/WASM does not monopolize
       * the browser's UI thread.
       */
      const DECRYPT_BATCH = 12

      for (
        let offset = 0;
        offset <
          newlyLoaded.length;
        offset +=
          DECRYPT_BATCH
      ) {
        const batch =
          newlyLoaded.slice(
            offset,
            offset +
              DECRYPT_BATCH,
          )

        await Promise.all(
          batch.map(
            async (event) => {
              if (
                !event.isEncrypted()
              ) {
                return
              }

              try {
                await client
                  .decryptEventIfNeeded(
                    event,
                  )
              } catch (err) {
                console.debug(
                  'Search history event could not be decrypted:',
                  err,
                )
              }
            },
          ),
        )

        /*
         * Give paint/input events a chance
         * between crypto batches.
         */
        await yieldToBrowser()
      }

      const after =
        afterEvents.length

      const added =
        Math.max(
          0,
          after - before,
        )

      const atBeginning =
        (room as any)
          .oldState
          ?.paginationToken ===
        null

      if (
        atBeginning ||
        added === 0
      ) {
        setHistoryExhausted(
          true,
        )
      }

      if (added > 0) {
        setHistoryMessage(
          `Loaded ${added} older timeline events.`,
        )
      } else {
        setHistoryMessage(
          'No additional history is available.',
        )
      }

      /*
       * Rebuild the search index exactly
       * once after pagination/decryption.
       */
      setTimelineRevision(
        (current) =>
          current + 1,
      )
    } catch (err) {
      console.error(
        'Unable to load older search history:',
        err,
      )

      setHistoryMessage(
        err instanceof Error
          ? err.message
          : 'Unable to load older history.',
      )
    } finally {
      setLoadingOlder(false)
    }
  }

  return (
    <div
      className="message-search-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose()
        }
      }}
    >
      <section
        className="message-search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search conversation"
      >
        <header
          className="message-search-header"
        >
          <div>
            <div
              className="message-search-eyebrow"
            >
              DC COMS
            </div>

            <h2>
              Search Conversation
            </h2>

            <p>
              Search decrypted message
              content loaded on this
              device.
            </p>
          </div>

          <button
            type="button"
            className="message-search-close"
            aria-label="Close search"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div
          className="message-search-controls"
        >
          <SearchInput
            onCommit={setQuery}
          />

          <select
            value={senderFilter}
            onChange={(event) =>
              setSenderFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              All senders
            </option>

            {senders.map(
              ([
                sender,
                displayName,
              ]) => (
                <option
                  key={sender}
                  value={sender}
                >
                  {displayName}
                </option>
              ),
            )}
          </select>
        </div>

        <div
          className="message-search-summary"
        >
          <span>
            {normalizedQuery
              ? `${filtered.length} match${
                  filtered.length === 1
                    ? ''
                    : 'es'
                }`
              : `${rows.length} searchable messages loaded`}
          </span>

          <span>
            {timelineCount}
            {' '}
            timeline events
          </span>
        </div>

        <div
          className="message-search-results"
        >
          {visibleResults.length >
          0 ? (
            visibleResults.map(
              (row) => (
                <button
                  type="button"
                  className="message-search-result"
                  key={row.eventId}
                  onClick={() =>
                    onJump(
                      row.eventId,
                    )
                  }
                >
                  <div
                    className="message-search-result-top"
                  >
                    <strong>
                      {
                        row.displayName
                      }
                    </strong>

                    <span>
                      {formatTime(
                        row.timestamp,
                      )}
                    </span>
                  </div>

                  <div
                    className="message-search-result-body"
                  >
                    {truncate(
                      row.body,
                    )}
                  </div>

                  <div
                    className="message-search-result-meta"
                  >
                    <span>
                      {row.kind ===
                      'text'
                        ? 'Message'
                        : row.kind ===
                            'image'
                          ? 'Image'
                          : 'File'}
                    </span>

                    {row.edited && (
                      <span>
                        Edited
                      </span>
                    )}
                  </div>
                </button>
              ),
            )
          ) : (
            <div
              className="message-search-empty"
            >
              <strong>
                No matches in loaded
                history.
              </strong>

              <span>
                Load older history below
                to search farther back.
              </span>
            </div>
          )}
        </div>

        {filtered.length > 120 && (
          <div
            className="message-search-limit"
          >
            Showing the newest 120 of
            {' '}
            {filtered.length}
            {' '}
            matching messages.
          </div>
        )}

        <footer
          className="message-search-footer"
        >
          <div>
            <span>
              Search is performed locally
              against decrypted events.
            </span>

            {historyMessage && (
              <strong>
                {historyMessage}
              </strong>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              void loadOlder()
            }}
            disabled={
              loadingOlder ||
              historyExhausted
            }
          >
            {historyExhausted
              ? 'Beginning of History'
              : loadingOlder
                ? 'Loading...'
                : 'Load 100 Older Events'}
          </button>
        </footer>
      </section>
    </div>
  )
}
