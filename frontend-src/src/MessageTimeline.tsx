import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react'

import * as sdk from 'matrix-js-sdk'

import MediaMessage, {
  type DcMediaContent,
} from './MediaMessage'

import MessageActions, {
  type DcReactionSummary,
  type DcReplyTarget,
} from './MessageActions'

import StandaloneEmote from './StandaloneEmote'

import ReminderCard, {
  type DcReminderMeta,
} from './ReminderCard'

import {
  loadOlderRoomHistory,
} from './MessageNavigator'

type ChatMessage = {
  id: string
  sender: string
  displayName: string
  body: string
  timestamp: number
  mine: boolean
  encryptedFailure?: boolean

  kind:
    | 'text'
    | 'image'
    | 'file'
    | 'system'

  media?: DcMediaContent
  replyTo?: DcReplyTarget
  reactions: DcReactionSummary[]
  emoteKey?: string
  bigEmoji?: boolean
  edited?: boolean
  reminder?: DcReminderMeta
}

type Props = {
  client: sdk.MatrixClient
  room: sdk.Room
  messages: ChatMessage[]
  newMessageCount: number
  highlightedMessageId:
    | string
    | null

  bottomRef:
    RefObject<HTMLDivElement | null>

  onReply: (
    target: DcReplyTarget,
  ) => void

  onChanged: () => void

  onReadLatest: () => void

  onJumpToMessage: (
    eventId: string,
  ) =>
    Promise<boolean> |
    boolean
}

const GROUP_WINDOW_MS =
  5 * 60 * 1000

const MESSAGE_TOKEN_PATTERN =
  /https?:\/\/[^\s<>]+|@[A-Za-z0-9._=+\-]+(?::[A-Za-z0-9.-]+)?/g

function splitUrlSuffix(
  value: string,
) {
  let url = value
  let suffix = ''

  while (
    url.length > 0 &&
    /[.,!?;:]/.test(
      url[url.length - 1],
    )
  ) {
    suffix =
      url[url.length - 1] +
      suffix

    url =
      url.slice(0, -1)
  }

  while (
    url.endsWith(')') &&
    (
      url.match(/\(/g)?.length ??
      0
    ) <
      (
        url.match(/\)/g)?.length ??
        0
      )
  ) {
    suffix = ')' + suffix
    url = url.slice(0, -1)
  }

  while (
    url.endsWith(']') &&
    (
      url.match(/\[/g)?.length ??
      0
    ) <
      (
        url.match(/\]/g)?.length ??
        0
      )
  ) {
    suffix = ']' + suffix
    url = url.slice(0, -1)
  }

  return {
    url,
    suffix,
  }
}

function resolveMention(
  room: sdk.Room,
  token: string,
) {
  const lowered =
    token.toLowerCase()

  return (
    room
      .getJoinedMembers()
      .find(
        (member) => {
          const full =
            member.userId
              .toLowerCase()

          const local =
            full.split(':')[0]

          return (
            lowered === full ||
            lowered === local
          )
        },
      ) ??
    null
  )
}

function LinkifiedText({
  text,
  room,
  currentUserId,
}: {
  text: string
  room: sdk.Room
  currentUserId: string
}) {
  const parts:
    ReactNode[] = []

  let lastIndex = 0

  let match:
    RegExpExecArray | null

  MESSAGE_TOKEN_PATTERN.lastIndex = 0

  while (
    (
      match =
        MESSAGE_TOKEN_PATTERN.exec(
          text,
        )
    ) !== null
  ) {
    const start =
      match.index

    if (
      start >
      lastIndex
    ) {
      parts.push(
        text.slice(
          lastIndex,
          start,
        ),
      )
    }

    const token =
      match[0]

    if (
      token.startsWith(
        'http://',
      ) ||
      token.startsWith(
        'https://',
      )
    ) {
      const {
        url,
        suffix,
      } = splitUrlSuffix(
        token,
      )

      if (url) {
        parts.push(
          <a
            key={`url-${start}-${url}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            {url}
          </a>,
        )
      }

      if (suffix) {
        parts.push(
          suffix,
        )
      }
    } else {
      const member =
        resolveMention(
          room,
          token,
        )

      if (member) {
        const mentionsMe =
          member.userId ===
          currentUserId

        parts.push(
          <span
            key={`mention-${start}-${member.userId}`}
            className={
              mentionsMe
                ? 'message-mention mine'
                : 'message-mention'
            }
            title={
              member.userId
            }
          >
            {token}
          </span>,
        )
      } else {
        parts.push(
          token,
        )
      }
    }

    lastIndex =
      start +
      token.length
  }

  if (
    lastIndex <
    text.length
  ) {
    parts.push(
      text.slice(
        lastIndex,
      ),
    )
  }

  return <>{parts}</>
}


function dayKey(
  timestamp: number,
) {
  const date =
    new Date(timestamp)

  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ].join('-')
}

function dateLabel(
  timestamp: number,
) {
  const date =
    new Date(timestamp)

  const today =
    new Date()

  const yesterday =
    new Date()

  yesterday.setDate(
    today.getDate() - 1,
  )

  if (
    dayKey(
      timestamp,
    ) ===
    dayKey(
      today.getTime(),
    )
  ) {
    return 'Today'
  }

  if (
    dayKey(
      timestamp,
    ) ===
    dayKey(
      yesterday.getTime(),
    )
  ) {
    return 'Yesterday'
  }

  return date.toLocaleDateString(
    [],
    {
      month: 'short',
      day: 'numeric',
      year:
        date.getFullYear() ===
        today.getFullYear()
          ? undefined
          : 'numeric',
    },
  )
}

function timeLabel(
  timestamp: number,
) {
  return new Date(
    timestamp,
  ).toLocaleTimeString(
    [],
    {
      hour: 'numeric',
      minute: '2-digit',
    },
  )
}

function canGroup(
  previous:
    | ChatMessage
    | undefined,

  current:
    ChatMessage,
) {
  if (!previous) {
    return false
  }

  if (
    previous.kind ===
      'system' ||
    current.kind ===
      'system' ||
    previous
      .encryptedFailure ||
    current
      .encryptedFailure ||
    current.replyTo ||
    previous.replyTo ||
    current.reminder ||
    previous.reminder
  ) {
    return false
  }

  return (
    previous.sender ===
      current.sender &&
    dayKey(
      previous.timestamp,
    ) ===
      dayKey(
        current.timestamp,
      ) &&
    current.timestamp -
      previous.timestamp <=
      GROUP_WINDOW_MS
  )
}

export default function MessageTimeline({
  client,
  room,
  messages,
  newMessageCount,
  highlightedMessageId,
  bottomRef,
  onReply,
  onChanged,
  onReadLatest,
  onJumpToMessage,
}: Props) {
  const timelineRef =
    useRef<HTMLDivElement | null>(
      null,
    )

  const nearBottomRef =
    useRef(true)

  const previousLengthRef =
    useRef(
      messages.length,
    )

  const previousRoomRef =
    useRef(
      room.roomId,
    )

  const positionedRoomRef =
    useRef('')

  const roomOpenedAtRef =
    useRef(
      Date.now(),
    )

  /*
   * Some encrypted/media-heavy rooms finish
   * rendering after the initial room-position
   * effect runs.
   *
   * Keep a read room pinned to latest briefly
   * while that initial layout settles.
   *
   * Any real user interaction cancels it.
   */
  const bottomSettleTokenRef =
    useRef(0)

  const userInterruptedSettleRef =
    useRef(false)

  /*
   * DC COMS COLD START SCROLL OWNERSHIP
   *
   * Chrome can restore a previous scroll
   * position during a full page refresh.
   * The message timeline owns its own
   * position, so browser history must not.
   */
  useEffect(() => {
    const previous =
      window.history
        .scrollRestoration

    window.history
      .scrollRestoration =
        'manual'

    return () => {
      window.history
        .scrollRestoration =
          previous
    }
  }, [])

  const [
    showJump,
    setShowJump,
  ] =
    useState(false)


  const historyLoadingRef =
    useRef(false)

  const [
    loadingOlder,
    setLoadingOlder,
  ] =
    useState(false)

  const [
    historyExhausted,
    setHistoryExhausted,
  ] =
    useState(false)

  const [
    historyError,
    setHistoryError,
  ] =
    useState('')


  function isNearBottom() {
    const node =
      timelineRef.current

    if (!node) {
      return true
    }

    return (
      node.scrollHeight -
        node.scrollTop -
        node.clientHeight <
      96
    )
  }


  function scrollToLatest(
    behavior:
      ScrollBehavior =
        'smooth',
  ) {
    const node =
      timelineRef.current

    if (node) {
      /*
       * Scroll the timeline itself instead of
       * asking scrollIntoView() to negotiate
       * with every scrollable ancestor.
       */
      if (behavior === 'auto') {
        node.scrollTop =
          node.scrollHeight

      } else {
        node.scrollTo({
          top:
            node.scrollHeight,
          behavior,
        })
      }

    } else {
      bottomRef.current
        ?.scrollIntoView({
          behavior,
          block: 'end',
        })
    }

    nearBottomRef.current =
      true

    setShowJump(false)

    onReadLatest()
  }


  function settleAtLatest(
    roomId: string,
  ) {
    const token =
      ++bottomSettleTokenRef
        .current

    userInterruptedSettleRef
      .current = false

    const startedAt =
      performance.now()

    const MAX_SETTLE_MS =
      6000

    function frame() {
      if (
        bottomSettleTokenRef
          .current !==
          token ||
        userInterruptedSettleRef
          .current ||
        positionedRoomRef
          .current !==
          roomId
      ) {
        return
      }

      const node =
        timelineRef.current

      if (!node) {
        return
      }

      const distance =
        node.scrollHeight -
        node.scrollTop -
        node.clientHeight

      /*
       * Initial decryption, emoji/media
       * rendering, and browser restoration
       * can all change the effective bottom
       * during cold start.
       */
      if (
        distance > 2
      ) {
        node.scrollTop =
          node.scrollHeight
      }

      nearBottomRef.current =
        true

      setShowJump(false)

      if (
        performance.now() -
          startedAt <
        MAX_SETTLE_MS
      ) {
        window
          .requestAnimationFrame(
            frame,
          )
      }
    }

    window
      .requestAnimationFrame(
        frame,
      )
  }


  /*
   * DC COMS STABLE ROOM POSITION
   *
   * A room switch resets positioning state.
   * It does not scroll here.
   *
   * Initial positioning is handled exactly once
   * by the effect below.
   */
  useEffect(() => {
    if (
      previousRoomRef.current ===
      room.roomId
    ) {
      return
    }

    previousRoomRef.current =
      room.roomId

    positionedRoomRef.current =
      ''

    previousLengthRef.current =
      messages.length

    roomOpenedAtRef.current =
      Date.now()

    /*
     * Cancel any delayed positioning work
     * belonging to the previous room.
     */
    bottomSettleTokenRef.current +=
      1

    userInterruptedSettleRef.current =
      false

    nearBottomRef.current =
      true

    setShowJump(false)

  }, [
    room.roomId,
    messages.length,
  ])


  /*
   * Handle messages arriving after the room
   * has already been positioned.
   *
   * Historical/decryption loading from before
   * the room was opened does not trigger the
   * Jump to latest button.
   */
  useEffect(() => {
    const previousLength =
      previousLengthRef.current

    const grew =
      messages.length >
      previousLength

    previousLengthRef.current =
      messages.length

    if (!grew) {
      return
    }

    /*
     * Historical pagination and explicit
     * message navigation must never be
     * interpreted as a newly-arrived live
     * message.
     */
    if (
      historyLoadingRef.current ||
      highlightedMessageId
    ) {
      return
    }

    const lastMessage =
      messages[
        messages.length - 1
      ]

    if (
      nearBottomRef.current ||
      lastMessage?.mine
    ) {
      window.requestAnimationFrame(
        () => {
          scrollToLatest(
            'smooth',
          )
        },
      )

      return
    }

    if (
      lastMessage &&
      lastMessage.timestamp >
        roomOpenedAtRef.current
    ) {
      setShowJump(true)
    }

  }, [
    messages,
    room.roomId,
  ])


  const newStartIndex =
    newMessageCount > 0
      ? Math.max(
          0,
          messages.length -
            newMessageCount,
        )
      : -1


  /*
   * Position a newly opened room once.
   *
   * Unread room:
   *   first unread message
   *
   * Read room:
   *   latest message
   *
   * Once positioned, message refreshes cannot
   * move the user's viewport again.
   */
  useEffect(() => {
    if (
      positionedRoomRef.current ===
      room.roomId
    ) {
      return
    }

    const timeline =
      timelineRef.current

    if (!timeline) {
      return
    }


    /*
     * During cold start the room can mount
     * before its initial messages have been
     * mapped/decrypted.
     *
     * Do not declare positioning complete
     * until there is something to position.
     */
    if (
      messages.length === 0
    ) {
      return
    }


    if (
      newMessageCount > 0 &&
      newStartIndex >= 0
    ) {
      const firstUnread =
        messages[
          newStartIndex
        ]

      if (!firstUnread) {
        return
      }

      const nodes =
        timeline
          .querySelectorAll<HTMLElement>(
            '[data-message-id]',
          )

      const target =
        Array.from(
          nodes,
        ).find(
          (node) =>
            node.dataset
              .messageId ===
            firstUnread.id,
        )

      if (!target) {
        return
      }

      target.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      })

      positionedRoomRef.current =
        room.roomId

      previousLengthRef.current =
        messages.length

      nearBottomRef.current =
        isNearBottom()

      setShowJump(false)

      return
    }


    /*
     * Read room: move the actual timeline
     * container to latest and keep it there
     * briefly while decryption/media/layout
     * finishes settling.
     */
    scrollToLatest(
      'auto',
    )

    positionedRoomRef.current =
      room.roomId

    previousLengthRef.current =
      messages.length

    nearBottomRef.current =
      true

    setShowJump(false)

    settleAtLatest(
      room.roomId,
    )

  }, [
    room.roomId,
    newMessageCount,
    newStartIndex,
    messages,
  ])


  useEffect(() => {
    if (
      !highlightedMessageId
    ) {
      return
    }

    const timeline =
      timelineRef.current

    if (!timeline) {
      return
    }

    const nodes =
      timeline
        .querySelectorAll<HTMLElement>(
          '[data-message-id]',
        )

    const target =
      Array.from(
        nodes,
      ).find(
        (node) =>
          node.dataset
            .messageId ===
          highlightedMessageId,
      )

    if (!target) {
      return
    }

    target.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })

    nearBottomRef.current =
      isNearBottom()

    setShowJump(
      !nearBottomRef.current,
    )

  }, [
    highlightedMessageId,
    messages,
    room.roomId,
  ])


  async function loadOlderMessages() {
    if (
      loadingOlder ||
      historyExhausted
    ) {
      return
    }

    const timeline =
      timelineRef.current

    const previousHeight =
      timeline?.scrollHeight ?? 0

    const previousTop =
      timeline?.scrollTop ?? 0

    historyLoadingRef.current =
      true

    setLoadingOlder(true)
    setHistoryError('')

    try {
      const result =
        await loadOlderRoomHistory(
          client,
          room,
          100,
        )

      if (
        result.atBeginning
      ) {
        setHistoryExhausted(
          true,
        )
      }

      onChanged()

      if (
        timeline &&
        result.added > 0
      ) {
        window.requestAnimationFrame(
          () => {
            window.requestAnimationFrame(
              () => {
                const heightDelta =
                  timeline.scrollHeight -
                  previousHeight

                timeline.scrollTop =
                  previousTop +
                  heightDelta

                nearBottomRef.current =
                  isNearBottom()

                historyLoadingRef.current =
                  false
              },
            )
          },
        )

      } else {
        historyLoadingRef.current =
          false
      }

    } catch (err) {
      console.error(
        'Unable to load older room history:',
        err,
      )

      historyLoadingRef.current =
        false

      setHistoryError(
        err instanceof Error
          ? err.message
          : 'Unable to load older messages.',
      )

    } finally {
      setLoadingOlder(false)
    }
  }


  return (
    <div
      className="timeline timeline-v2"
      ref={timelineRef}

      onWheel={() => {
        userInterruptedSettleRef
          .current = true

        bottomSettleTokenRef
          .current += 1
      }}

      onTouchStart={() => {
        userInterruptedSettleRef
          .current = true

        bottomSettleTokenRef
          .current += 1
      }}

      onPointerDown={() => {
        userInterruptedSettleRef
          .current = true

        bottomSettleTokenRef
          .current += 1
      }}

      onScroll={() => {
        const near =
          isNearBottom()

        nearBottomRef.current =
          near

        if (near) {
          setShowJump(
            false,
          )

          onReadLatest()
        }
      }}
    >
      {messages.length === 0 && (
        <div className="empty-room">
          No messages yet.
        </div>
      )}

      <div className="timeline-history-controls">
        {!historyExhausted ? (
          <button
            type="button"
            disabled={
              loadingOlder
            }
            onClick={() => {
              void loadOlderMessages()
            }}
          >
            {loadingOlder
              ? 'Loading older messages...'
              : 'Load older messages'}
          </button>
        ) : (
          <span>
            Beginning of conversation
          </span>
        )}

        {historyError && (
          <small>
            {historyError}
          </small>
        )}
      </div>

      {messages.map(
        (
          message,
          index,
        ) => {
          const previous =
            index > 0
              ? messages[
                  index - 1
                ]
              : undefined

          const newDay =
            !previous ||
            dayKey(
              previous.timestamp,
            ) !==
              dayKey(
                message.timestamp,
              )

          const grouped =
            !newDay &&
            canGroup(
              previous,
              message,
            )

          const highlighted =
            highlightedMessageId ===
            message.id

          const classes = [
            'message',
            message.reminder
              ? 'message-reminder'
              : '',
            message.mine
              ? 'mine'
              : '',
            grouped
              ? 'message-grouped'
              : '',
            highlighted
              ? 'message-highlighted'
              : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <Fragment
              key={message.id}
            >
              {newDay && (
                <div className="timeline-date-separator">
                  <span>
                    {dateLabel(
                      message.timestamp,
                    )}
                  </span>
                </div>
              )}

              {index ===
                newStartIndex && (
                <div className="timeline-new-divider">
                  <span>
                    New messages
                  </span>
                </div>
              )}

              <article
                className={
                  classes
                }
                data-message-id={
                  message.id
                }
              >
                {!grouped ? (
                  <div className="message-meta">
                    <strong>
                      {message.mine
                        ? 'You'
                        : message.displayName}
                    </strong>

                    <span>
                      {timeLabel(
                        message.timestamp,
                      )}
                    </span>

                    {message.edited && (
                      <span className="message-edited-label">
                        edited
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="message-group-time">
                    {timeLabel(
                      message.timestamp,
                    )}

                    {message.edited
                      ? ' · edited'
                      : ''}
                  </div>
                )}

                {message.replyTo &&
                  !message.reminder && (
                  <button
                    type="button"
                    className="message-reply-context message-reply-jump"
                    title="Open replied-to message"
                    onClick={() => {
                      void onJumpToMessage(
                        message
                          .replyTo!
                          .eventId,
                      )
                    }}
                  >
                    <strong>
                      ↩{' '}
                      {
                        message
                          .replyTo
                          .displayName
                      }
                    </strong>

                    <span>
                      {
                        message
                          .replyTo
                          .body
                      }
                    </span>
                  </button>
                )}

                {message.reminder && (
                  <ReminderCard
                    client={
                      client
                    }
                    reminder={
                      message.reminder
                    }
                  />
                )}

                <div
                  className={
                    message
                      .encryptedFailure
                      ? 'message-body decrypt-failure'
                      : 'message-body'
                  }
                >
                  {(
                    message.emoteKey ||
                    message.bigEmoji
                  ) ? (
                    <StandaloneEmote
                      emoteKey={
                        message.emoteKey
                      }
                      body={
                        message.body
                      }
                      bigEmoji={
                        message.bigEmoji
                      }
                    />
                  ) : (
                    (
                      message.kind ===
                        'image' ||
                      message.kind ===
                        'file'
                    ) &&
                    message.media
                  ) ? (
                    <MediaMessage
                      client={
                        client
                      }
                      content={
                        message.media
                      }
                    />
                  ) : (
                    message.kind ===
                      'text' &&
                    !message
                      .encryptedFailure
                      ? (
                        <LinkifiedText
                          text={
                            message.body
                          }
                          room={
                            room
                          }
                          currentUserId={
                            client.getUserId() ||
                            ''
                          }
                        />
                      )
                      : message.body
                  )}
                </div>

                {!message
                  .encryptedFailure &&
                  message.kind !==
                    'system' && (
                    <MessageActions
                      client={
                        client
                      }
                      roomId={
                        room.roomId
                      }
                      eventId={
                        message.id
                      }
                      sender={
                        message.sender
                      }
                      displayName={
                        message.displayName
                      }
                      body={
                        message.kind ===
                          'text'
                          ? message.body
                          : message.kind ===
                              'image'
                            ? `Image: ${message.body}`
                            : `File: ${message.body}`
                      }
                      kind={
                        message.kind
                      }
                      reactions={
                        message.reactions
                      }
                      mine={
                        message.mine
                      }
                      editable={
                        message.kind ===
                        'text'
                      }
                      onChanged={
                        onChanged
                      }
                      onReply={
                        onReply
                      }
                    />
                  )}
              </article>
            </Fragment>
          )
        },
      )}

      <div ref={bottomRef} />

      {showJump && (
        <button
          type="button"
          className="jump-to-latest"
          onClick={() =>
            scrollToLatest(
              'smooth',
            )
          }
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}
