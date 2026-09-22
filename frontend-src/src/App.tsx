import { useEffect, useRef, useState } from 'react'
import * as sdk from 'matrix-js-sdk'
import { encryptAttachment } from 'matrix-encrypt-attachment'
import './App.css'
import { type DcMediaContent } from './MediaMessage'
import { type DcReactionSummary, type DcReplyTarget } from './MessageActions'
import ComposerEmojiPicker from './ComposerEmojiPicker'
import {
  type DcReactionDefinition,
} from './Reactions'
import NewConversation from './NewConversation'
import NewChannel from './NewChannel'
import ChannelTopic from './ChannelTopic'
import ChannelRenamePolicy from './ChannelRenamePolicy'
import ChannelName from './ChannelName'
import RoomActions from './RoomActions'
import RoomInvite from './RoomInvite'
import RoomMembers from './RoomMembers'
import PresenceControl from './PresenceControl'
import SecurityRecovery from './SecurityRecovery'
import FirstLoginSecurity from './FirstLoginSecurity'
import ResetPassword from './ResetPassword'
import MessageSearch from './MessageSearch'
import PinnedMessages from './PinnedMessages'
import MessageTimeline from './MessageTimeline'
import MentionComposerInput from './MentionComposerInput'
import {
  ensureMessageLoaded,
} from './MessageNavigator'
import {
  type DcReminderMeta,
} from './ReminderCard'
import {
  applyTypedMentions,
  getHighlightCount,
  isDirectConversation,
  maybeShowDesktopNotification,
} from './Attention'
import DesktopNotifications from './DesktopNotifications'
import {
  cacheSecretStorageKey,
  clearRecoveryKeyCache,
  getCachedSecretStorageKey,
} from './RecoveryKeyCache'

import {
  HOMESERVER,
  SERVER_NAME,
} from './Config'

const SESSION_KEY = 'dccoms.session.v1'
const ROOM_DRAFTS_KEY = 'dccoms.roomDrafts.v1'
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

type DcSession = {
  accessToken: string
  userId: string
  deviceId: string
}

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

function loadSession(): DcSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSession(session: DcSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function removeSession() {
  localStorage.removeItem(SESSION_KEY)
}

type DcRoomDrafts =
  Record<
    string,
    Record<string, string>
  >

function loadRoomDraft(
  userId: string,
  roomId: string,
) {
  try {
    const raw =
      localStorage.getItem(
        ROOM_DRAFTS_KEY,
      )

    if (!raw) {
      return ''
    }

    const drafts =
      JSON.parse(raw) as
        DcRoomDrafts

    return (
      drafts[userId]?.[roomId] ??
      ''
    )
  } catch {
    return ''
  }
}

function saveRoomDraft(
  userId: string,
  roomId: string,
  value: string,
) {
  try {
    const raw =
      localStorage.getItem(
        ROOM_DRAFTS_KEY,
      )

    const drafts:
      DcRoomDrafts =
        raw
          ? JSON.parse(raw)
          : {}

    if (value) {
      drafts[userId] = {
        ...(drafts[userId] ?? {}),
        [roomId]: value,
      }
    } else if (drafts[userId]) {
      delete drafts[userId][roomId]

      if (
        Object.keys(
          drafts[userId],
        ).length === 0
      ) {
        delete drafts[userId]
      }
    }

    if (
      Object.keys(drafts).length === 0
    ) {
      localStorage.removeItem(
        ROOM_DRAFTS_KEY,
      )
    } else {
      localStorage.setItem(
        ROOM_DRAFTS_KEY,
        JSON.stringify(drafts),
      )
    }
  } catch (err) {
    console.warn(
      'Unable to persist room draft:',
      err,
    )
  }
}

function cryptoPrefix(session: DcSession) {
  return `dccoms-${session.userId}-${session.deviceId}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
}

function stripReplyFallback(
  body: string,
) {
  const lines = body.split('\n')

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

function getMessageKind(
  content: Record<string, any>,
):
  | 'text'
  | 'image'
  | 'file'
  | null {
  if (
    content.msgtype ===
    sdk.MsgType.Text
  ) {
    return 'text'
  }

  if (
    content.msgtype ===
    sdk.MsgType.Image
  ) {
    return 'image'
  }

  if (
    content.msgtype ===
    sdk.MsgType.File
  ) {
    return 'file'
  }

  return null
}

function getMessagePreview(
  content: Record<string, any>,
) {
  const body =
    typeof content.body === 'string'
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
        body ||
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
        body ||
        'attachment'
      }`
    )
  }

  return body
}

function isReplacementEvent(
  event: sdk.MatrixEvent,
) {
  const content =
    event.getOriginalContent() as
      Record<string, any>

  return (
    content?.['m.relates_to']
      ?.rel_type === 'm.replace'
  )
}

function roomMessages(
  room: sdk.Room,
  myUserId: string,
): ChatMessage[] {
  const events =
    room
      .getLiveTimeline()
      .getEvents()

  const messageIndex =
    new Map<
      string,
      {
        sender: string
        displayName: string
        body: string
        kind:
          | 'text'
          | 'image'
          | 'file'
      }
    >()

  for (const event of events) {
    if (
      event.getType() !==
        sdk.EventType.RoomMessage ||
      event.isDecryptionFailure() ||
      event.isRedacted() ||
      isReplacementEvent(event)
    ) {
      continue
    }

    const eventId =
      event.getId()

    if (!eventId) continue

    const content =
      event.getContent() as
        Record<string, any>

    const kind =
      getMessageKind(content)

    if (!kind) continue

    const sender =
      event.getSender() ??
      'unknown'

    const member =
      room.getMember(sender)

    messageIndex.set(
      eventId,
      {
        sender,
        displayName:
          member?.name ??
          sender,
        body:
          getMessagePreview(
            content,
          ),
        kind,
      },
    )
  }

  type ReactionAccumulator = {
    count: number
    mine: boolean
    mineEventId?: string
  }

  const reactionMap =
    new Map<
      string,
      Map<
        string,
        ReactionAccumulator
      >
    >()

  for (const event of events) {
    if (
      event.isRedacted() ||
      event.getType() !==
        sdk.EventType.Reaction
    ) {
      continue
    }

    const content =
      event.getContent() as
        Record<string, any>

    const relation =
      content['m.relates_to']

    if (
      relation?.rel_type !==
        sdk.RelationType
          .Annotation ||
      typeof relation.event_id !==
        'string' ||
      typeof relation.key !==
        'string'
    ) {
      continue
    }

    let target =
      reactionMap.get(
        relation.event_id,
      )

    if (!target) {
      target = new Map()
      reactionMap.set(
        relation.event_id,
        target,
      )
    }

    const current =
      target.get(
        relation.key,
      ) ?? {
        count: 0,
        mine: false,
      }

    current.count += 1

    if (
      event.getSender() ===
      myUserId
    ) {
      current.mine = true

      const reactionEventId =
        event.getId()

      if (reactionEventId) {
        current.mineEventId =
          reactionEventId
      }
    }

    target.set(
      relation.key,
      current,
    )
  }

  const result:
    ChatMessage[] = []

  let historicalFailureOpen =
    false

  for (const event of events) {
    const sender =
      event.getSender() ??
      'unknown'

    const member =
      room.getMember(sender)

    if (
      event.getWireType() ===
        'm.room.encrypted' &&
      event.isDecryptionFailure()
    ) {
      if (
        !historicalFailureOpen
      ) {
        result.push({
          id:
            event.getId() ??
            `history-${event.getTs()}`,
          sender: 'dccoms',
          displayName: 'DC Coms',
          body:
            'Earlier encrypted history is unavailable on this device.',
          timestamp:
            event.getTs(),
          mine: false,
          encryptedFailure:
            true,
          kind: 'system',
          reactions: [],
        })
      }

      historicalFailureOpen =
        true

      continue
    }

    historicalFailureOpen =
      false

    if (
      event.getType() !==
        sdk.EventType.RoomMessage ||
      event.isRedacted() ||
      isReplacementEvent(event)
    ) {
      continue
    }

    const content =
      event.getContent() as
        Record<string, any>

    const kind =
      getMessageKind(content)

    if (!kind) continue

    const eventId =
      event.getId() ??
      `message-${event.getTs()}`

    const originalContent =
      event.getOriginalContent() as
        Record<string, any>

    const relation =
      originalContent['m.relates_to']

    const replyEventId =
      relation?.[
        'm.in_reply_to'
      ]?.event_id

    let replyTo:
      DcReplyTarget |
      undefined

    if (
      typeof replyEventId ===
      'string'
    ) {
      const target =
        messageIndex.get(
          replyEventId,
        )

      if (target) {
        replyTo = {
          eventId:
            replyEventId,
          sender:
            target.sender,
          displayName:
            target.displayName,
          body:
            target.body,
          kind:
            target.kind,
        }
      } else {
        replyTo = {
          eventId:
            replyEventId,
          sender: '',
          displayName:
            'Earlier message',
          body:
            'Earlier message',
          kind: 'text',
        }
      }
    }

    const reactionGroups =
      reactionMap.get(
        eventId,
      )

    const reactions:
      DcReactionSummary[] =
      reactionGroups
        ? Array.from(
            reactionGroups.entries(),
          )
            .map(
              ([
                key,
                value,
              ]) => ({
                key,
                count:
                  value.count,
                mine:
                  value.mine,
                mineEventId:
                  value.mineEventId,
              }),
            )
            .sort(
              (a, b) =>
                b.count -
                  a.count ||
                a.key.localeCompare(
                  b.key,
                ),
            )
        : []

    result.push({
      id: eventId,
      sender,
      displayName:
        member?.name ??
        sender,
      body:
        typeof content.body ===
        'string'
          ? stripReplyFallback(
              content.body,
            )
          : '',
      timestamp:
        event.getTs(),
      mine:
        sender === myUserId,
      edited:
        Boolean(
          event.replacingEvent() ||
          event.replacingEventId(),
        ),

      reminder:
        (
          content[
            'com.dccoms.reminder'
          ] &&
          typeof content[
            'com.dccoms.reminder'
          ] === 'object'
        )
          ? content[
              'com.dccoms.reminder'
            ] as DcReminderMeta
          : undefined,

      kind,
      media:
        kind === 'text'
          ? undefined
          : content as
              DcMediaContent,
      replyTo,
      reactions,
      emoteKey:
        typeof content[
          'com.dccoms.emote'
        ] === 'string'
          ? content[
              'com.dccoms.emote'
            ]
          : undefined,
      bigEmoji:
        content[
          'com.dccoms.big_emoji'
        ] === true ||
        isEmojiOnlyMessage(
          typeof content.body ===
            'string'
            ? stripReplyFallback(
                content.body,
              )
            : '',
        ),
    })
  }

  return result
}

function getRoomLabel(
  room: sdk.Room,
  myUserId: string,
) {
  const nameEvent =
    room.currentState.getStateEvents(
      sdk.EventType.RoomName,
      '',
    )

  const explicitName =
    nameEvent?.getContent()?.name

  if (
    typeof explicitName === 'string' &&
    explicitName.trim()
  ) {
    return explicitName.trim()
  }

  const calculated =
    room.getDefaultRoomName(myUserId).trim()

  if (
    calculated &&
    calculated.toLowerCase() !== 'empty room'
  ) {
    return calculated
  }

  return (
    room.name?.trim() ||
    'Unnamed conversation'
  )
}

function getUnreadCount(
  room: sdk.Room,
  myUserId: string,
) {
  const serverCount =
    room.getUnreadNotificationCount() ?? 0

  /*
   * Historical pagination adds older events
   * to the live timeline. Do not let those
   * become fake unread messages.
   *
   * Anything at or before the user's latest
   * unthreaded Matrix receipt is already read.
   */
  const receipt =
    room.getLastUnthreadedReceiptFor(
      myUserId,
    )

  if (!receipt) {
    return serverCount
  }

  const receiptTs =
    receipt.ts ?? 0

  let receiptCount = 0

  for (
    const event of
    room.getLiveTimeline().getEvents()
  ) {
    if (
      event.getType() !==
        sdk.EventType.RoomMessage
    ) {
      continue
    }

    if (
      event.getSender() ===
      myUserId
    ) {
      continue
    }

    /*
     * Old paginated history is definitely
     * before the read receipt and must not
     * contribute to unread positioning.
     */
    if (
      event.getTs() <=
      receiptTs
    ) {
      continue
    }

    receiptCount += 1
  }

  /*
   * A real Matrix read receipt is more
   * authoritative than the homeserver's
   * cached notification counter here.
   *
   * The server count remains the fallback
   * only when no receipt exists.
   */
  return receiptCount
}

function getImageDimensions(
  file: File,
): Promise<{
  w: number
  h: number
}> {
  return new Promise(
    (resolve, reject) => {
      const url =
        URL.createObjectURL(file)

      const image =
        new Image()

      image.onload = () => {
        const result = {
          w: image.naturalWidth,
          h: image.naturalHeight,
        }

        URL.revokeObjectURL(url)
        resolve(result)
      }

      image.onerror = () => {
        URL.revokeObjectURL(url)

        reject(
          new Error(
            'Unable to read image dimensions.',
          ),
        )
      }

      image.src = url
    },
  )
}

function isEmojiOnlyMessage(
  value: string,
) {
  const compact =
    value.replace(/\s+/g, '')

  if (
    !compact ||
    compact.length > 32
  ) {
    return false
  }

  const remainder =
    compact.replace(
      /[\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\u20E3]/gu,
      '',
    )

  return remainder.length === 0
}

function App() {
  const clientRef =
    useRef<ReturnType<typeof sdk.createClient> | null>(null)

  const sessionRef = useRef<DcSession | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const activeRoomRef = useRef<string | null>(null)

  /*
   * Server unread counters can briefly lag
   * behind a read receipt. Once a room has
   * already been opened during this session,
   * only new live traffic should move its
   * reopening position away from latest.
   */
  const openedRoomsRef =
    useRef(
      new Set<string>(),
    )

  const bottomRef = useRef<HTMLDivElement | null>(null)

  /*
   * Last event for which this client already
   * attempted a read receipt.
   *
   * Prevents scroll events from hammering the
   * receipt endpoint for the same event.
   */
  const readReceiptEventRef =
    useRef<Record<string, string>>({})

  /*
   * RoomEvent.Timeline also fires while the
   * initial /sync response is being populated.
   * Those are history reconstruction events,
   * not new live messages.
   */
  const initialSyncReadyRef =
    useRef(false)

  const fileInputRef =
    useRef<HTMLInputElement | null>(null)

  const messageInputRef =
    useRef<HTMLInputElement | null>(null)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(true)

  const [loggedInUser, setLoggedInUser] =
    useState<string | null>(null)

  const [rooms, setRooms] = useState<sdk.Room[]>([])
  const [invites, setInvites] = useState<sdk.Room[]>([])
  const [activeRoomId, setActiveRoomId] =
    useState<string | null>(null)

  const [messages, setMessages] =
    useState<ChatMessage[]>([])

  const [liveUnread, setLiveUnread] =
    useState<Record<string, number>>({})

  const [
    entryUnread,
    setEntryUnread,
  ] = useState<{
    roomId: string
    count: number
  } | null>(null)

  const [draft, setDraft] = useState('')

  const [
    typingUsers,
    setTypingUsers,
  ] = useState<string[]>([])

  const typingRoomRef =
    useRef<string | null>(null)

  const typingStopTimerRef =
    useRef<number | null>(null)

  const typingLastSentRef =
    useRef(0)

  const [replyTarget, setReplyTarget] =
    useState<DcReplyTarget | null>(null)
  const [sending, setSending] = useState(false)

  const [uploading, setUploading] =
    useState(false)

  const [uploadProgress, setUploadProgress] =
    useState<number | null>(null)

  const [uploadName, setUploadName] =
    useState('')

  const [uploadStage, setUploadStage] =
    useState('')

  const [dragActive, setDragActive] =
    useState(false)

  const [securityOpen, setSecurityOpen] =
    useState(false)

  useEffect(() => {
    if (
      !loggedInUser ||
      !activeRoomId
    ) {
      setDraft('')
      return
    }

    setDraft(
      loadRoomDraft(
        loggedInUser,
        activeRoomId,
      ),
    )
  }, [
    loggedInUser,
    activeRoomId,
  ])


  useEffect(() => {
    setTypingUsers([])

    const client =
      clientRef.current

    if (client) {
      refreshTypingUsers(client)
    }

    return () => {
      const roomId =
        typingRoomRef.current

      if (roomId) {
        stopComposerTyping(roomId)
      }
    }
  }, [
    activeRoomId,
  ])

  useEffect(() => {
    function onPasswordChangedLogout() {
      void handleLogout()
    }

    window.addEventListener(
      'dccoms-password-force-logout',
      onPasswordChangedLogout,
    )

    return () => {
      window.removeEventListener(
        'dccoms-password-force-logout',
        onPasswordChangedLogout,
      )
    }
  }, [])

  const [searchOpen, setSearchOpen] =
    useState(false)

  const [
    highlightedMessageId,
    setHighlightedMessageId,
  ] = useState<string | null>(null)

  const messageLinkHandledRef =
    useRef(false)

  /*
   * DC COMS GLOBAL KEYBOARD SHORTCUTS
   *
   * Ctrl/Cmd+K  Open message search
   * Escape      Close message search
   * /           Focus composer
   * Alt+Up      Previous conversation
   * Alt+Down    Next conversation
   */
  useEffect(() => {
    function isEditableTarget(
      target: EventTarget | null,
    ) {
      if (
        target instanceof
          HTMLInputElement ||
        target instanceof
          HTMLTextAreaElement ||
        target instanceof
          HTMLSelectElement
      ) {
        return true
      }

      return (
        target instanceof
          HTMLElement &&
        target.isContentEditable
      )
    }

    function onGlobalKeyDown(
      event: KeyboardEvent,
    ) {
      if (!loggedInUser) {
        return
      }

      /*
       * The security UI owns its own
       * keyboard handling.
       */
      if (securityOpen) {
        return
      }

      /*
       * Message search.
       *
       * Intentionally works even while
       * focus is inside the composer.
       */
      if (
        (
          event.ctrlKey ||
          event.metaKey
        ) &&
        !event.altKey &&
        event.key.toLowerCase() ===
          'k'
      ) {
        event.preventDefault()

        setSearchOpen(true)
        return
      }

      /*
       * App-level Escape only owns
       * message search. Other dialogs
       * retain their own Escape handlers.
       */
      if (
        event.key === 'Escape' &&
        searchOpen
      ) {
        event.preventDefault()

        setSearchOpen(false)
        return
      }

      if (
        isEditableTarget(
          event.target,
        )
      ) {
        return
      }

      /*
       * Focus the composer without
       * inserting the slash character.
       */
      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        activeRoomId
      ) {
        event.preventDefault()

        messageInputRef.current
          ?.focus()

        return
      }

      /*
       * Conversation navigation.
       */
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (
          event.key !==
            'ArrowUp' &&
          event.key !==
            'ArrowDown'
        ) ||
        rooms.length === 0
      ) {
        return
      }

      event.preventDefault()

      const currentIndex =
        rooms.findIndex(
          (room) =>
            room.roomId ===
            activeRoomRef.current,
        )

      const direction =
        event.key ===
          'ArrowDown'
          ? 1
          : -1

      const baseIndex =
        currentIndex >= 0
          ? currentIndex
          : 0

      const nextIndex =
        (
          baseIndex +
          direction +
          rooms.length
        ) %
        rooms.length

      const nextRoom =
        rooms[nextIndex]

      if (
        nextRoom &&
        nextRoom.roomId !==
          activeRoomRef.current
      ) {
        setSearchOpen(false)

        void selectRoom(
          nextRoom.roomId,
        )
      }
    }

    window.addEventListener(
      'keydown',
      onGlobalKeyDown,
    )

    return () => {
      window.removeEventListener(
        'keydown',
        onGlobalKeyDown,
      )
    }
  }, [
    loggedInUser,
    securityOpen,
    searchOpen,
    activeRoomId,
    rooms,
  ])

  /* DC COMS ATTENTION TITLE */
  useEffect(() => {
    const favicon =
      document.getElementById(
        'dccoms-favicon',
      ) as HTMLLinkElement | null

    function setFavicon(
      href: string,
    ) {
      if (
        favicon &&
        favicon.getAttribute('href') !== href
      ) {
        favicon.setAttribute(
          'href',
          href,
        )
      }
    }

    if (!loggedInUser) {
      document.title =
        'DC Coms'

      setFavicon(
        '/favicon.svg',
      )

      return
    }

    let unread = 0
    let highlights = 0

    for (const room of rooms) {
      if (
        room.roomId ===
        activeRoomId
      ) {
        continue
      }

      unread +=
        Math.max(
          getUnreadCount(
            room,
            loggedInUser,
          ),
          liveUnread[
            room.roomId
          ] ?? 0,
        )

      highlights +=
        getHighlightCount(room)
    }

    const unreadLabel =
      unread > 99
        ? '99+'
        : String(unread)

    const highlightLabel =
      highlights > 99
        ? '99+'
        : String(highlights)

    if (highlights > 0) {
      document.title =
        unread > 0
          ? `(@${highlightLabel} · ${unreadLabel}) DC Coms`
          : `(@${highlightLabel}) DC Coms`

      setFavicon(
        '/favicon-mention.svg',
      )

    } else if (unread > 0) {
      document.title =
        `(${unreadLabel}) DC Coms`

      setFavicon(
        '/favicon-unread.svg',
      )

    } else {
      document.title =
        'DC Coms'

      setFavicon(
        '/favicon.svg',
      )
    }
  }, [
    rooms,
    liveUnread,
    loggedInUser,
    activeRoomId,
  ])

  function refreshTypingUsers(
    client: ReturnType<typeof sdk.createClient>,
  ) {
    const roomId =
      activeRoomRef.current

    const myUserId =
      sessionRef.current
        ?.userId

    if (
      !roomId ||
      !myUserId
    ) {
      setTypingUsers([])
      return
    }

    const room =
      client.getRoom(roomId)

    if (!room) {
      setTypingUsers([])
      return
    }

    const next =
      room
        .getJoinedMembers()
        .filter(
          (member) =>
            member.userId !==
              myUserId &&
            member.typing,
        )
        .map(
          (member) =>
            member.rawDisplayName ||
            member.name ||
            member.userId,
        )

    setTypingUsers(next)
  }


  function stopComposerTyping(
    roomId:
      string | null =
        typingRoomRef.current,
  ) {
    if (
      typingStopTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        typingStopTimerRef.current,
      )

      typingStopTimerRef.current =
        null
    }

    const client =
      clientRef.current

    if (
      client &&
      roomId
    ) {
      void client
        .sendTyping(
          roomId,
          false,
          0,
        )
        .catch((err) => {
          console.debug(
            'Unable to stop typing state:',
            err,
          )
        })
    }

    if (
      typingRoomRef.current ===
      roomId
    ) {
      typingRoomRef.current =
        null
    }

    typingLastSentRef.current = 0
  }


  function updateComposerTyping(
    value: string,
  ) {
    const client =
      clientRef.current

    const roomId =
      activeRoomRef.current

    if (
      !client ||
      !roomId
    ) {
      return
    }

    if (!value.trim()) {
      stopComposerTyping(roomId)
      return
    }

    if (
      typingRoomRef.current &&
      typingRoomRef.current !==
        roomId
    ) {
      stopComposerTyping(
        typingRoomRef.current,
      )
    }

    typingRoomRef.current =
      roomId

    const now =
      Date.now()

    if (
      now -
        typingLastSentRef.current >=
      4000
    ) {
      typingLastSentRef.current =
        now

      void client
        .sendTyping(
          roomId,
          true,
          8000,
        )
        .catch((err) => {
          console.debug(
            'Unable to send typing state:',
            err,
          )
        })
    }

    if (
      typingStopTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        typingStopTimerRef.current,
      )
    }

    typingStopTimerRef.current =
      window.setTimeout(
        () => {
          stopComposerTyping(roomId)
        },
        5000,
      )
  }


  function refreshRooms(
    client: ReturnType<typeof sdk.createClient>,
  ) {
    const joined = client
      .getVisibleRooms()
      .filter((room) => room.getMyMembership() === 'join')
      .sort(
        (a, b) =>
          b.getLastActiveTimestamp() -
          a.getLastActiveTimestamp(),
      )

    const invited = client
      .getRooms()
      .filter((room) => room.getMyMembership() === 'invite')
      .sort(
        (a, b) =>
          b.getLastActiveTimestamp() -
          a.getLastActiveTimestamp(),
      )

    setRooms([...joined])
    setInvites([...invited])

    if (!activeRoomRef.current && joined.length > 0) {
      activeRoomRef.current = joined[0].roomId

      openedRoomsRef.current.add(
        joined[0].roomId,
      )

      setActiveRoomId(joined[0].roomId)

      refreshMessages(
        client,
        joined[0].roomId,
      )
    }
  }

  function refreshMessages(
    client: ReturnType<typeof sdk.createClient>,
    roomId: string,
  ) {
    const room = client.getRoom(roomId)
    const session = sessionRef.current

    if (!room || !session) {
      setMessages([])
      return
    }

    setMessages(roomMessages(room, session.userId))
  }

  async function connectSession(session: DcSession) {
    cleanupRef.current?.()

    initialSyncReadyRef.current =
      false
    cleanupRef.current = null

    if (clientRef.current) {
      clientRef.current.stopClient()
      clientRef.current = null
    }

    setStatus('Initializing encrypted device...')

    const client = sdk.createClient({
      baseUrl: HOMESERVER,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
      timelineSupport: true,

      cryptoCallbacks: {
        getSecretStorageKey:
          getCachedSecretStorageKey,

        cacheSecretStorageKey,
      },
    })

    await client.initRustCrypto({
      useIndexedDB: true,
      cryptoDatabasePrefix: cryptoPrefix(session),
    })

    sessionRef.current = session

    const onSync = (state: string) => {
      if (
        state === 'PREPARED' ||
        state === 'SYNCING'
      ) {
        refreshRooms(client)

        if (activeRoomRef.current) {
          refreshMessages(
            client,
            activeRoomRef.current,
          )
        }

        /*
         * Everything delivered before this
         * point belongs to startup state
         * reconstruction.
         */
        initialSyncReadyRef.current =
          true
      }
    }

    const onTimeline = (
      event: sdk.MatrixEvent,
      room: sdk.Room | undefined,
      toStartOfTimeline: boolean | undefined,
    ) => {
      if (!room || toStartOfTimeline) return

      const incrementUnreadIfMessage =
        () => {
          if (
            !initialSyncReadyRef.current
          ) {
            return
          }

          if (
            isReplacementEvent(event)
          ) {
            return
          }

          if (
            event.getType() !==
            sdk.EventType.RoomMessage
          ) {
            return
          }

          const eventId =
            event.getId()

          if (!eventId) {
            return
          }

          /*
           * Do not create a local unread badge
           * for something Matrix already knows
           * this user has read.
           */
          if (
            room.hasUserReadEvent(
              session.userId,
              eventId,
            )
          ) {
            return
          }

          if (
            event.getSender() ===
              session.userId ||
            activeRoomRef.current ===
              room.roomId
          ) {
            return
          }

          setLiveUnread(
            (current) => ({
              ...current,
              [room.roomId]:
                (
                  current[
                    room.roomId
                  ] ?? 0
                ) + 1,
            }),
          )
        }

      if (!event.isEncrypted()) {
        incrementUnreadIfMessage()

        maybeShowDesktopNotification(
          event,
          room,
          session.userId,
          getRoomLabel(
            room,
            session.userId,
          ),
        )
      }

      refreshRooms(client)

      if (event.isEncrypted()) {
        event.once(
          sdk.MatrixEventEvent.Decrypted,
          () => {
            incrementUnreadIfMessage()

            maybeShowDesktopNotification(
              event,
              room,
              session.userId,
              getRoomLabel(
                room,
                session.userId,
              ),
            )

            /*
             * Force sidebar/title refresh
             * after encrypted notification
             * metadata becomes available.
             */
            refreshRooms(client)

            if (
              activeRoomRef.current === room.roomId
            ) {
              refreshMessages(client, room.roomId)
            }
          },
        )
      }

      if (activeRoomRef.current === room.roomId) {
        refreshMessages(client, room.roomId)
      }
    }

    const onTyping = () => {
      refreshTypingUsers(client)
    }

    client.on(
      sdk.ClientEvent.Sync,
      onSync,
    )

    client.on(
      sdk.RoomEvent.Timeline,
      onTimeline,
    )

    client.on(
      sdk.RoomMemberEvent.Typing,
      onTyping,
    )


    cleanupRef.current = () => {
      client.off(
        sdk.ClientEvent.Sync,
        onSync,
      )

      client.off(
        sdk.RoomEvent.Timeline,
        onTimeline,
      )

      client.off(
        sdk.RoomMemberEvent.Typing,
        onTyping,
      )

      stopComposerTyping()
    }

    setStatus('Synchronizing...')

    await client.startClient({
      initialSyncLimit: 50,
    })

    clientRef.current = client
    ;(window as any).dccomsClient = client

    setLoggedInUser(session.userId)
    setStatus('')
  }

  useEffect(() => {
    let cancelled = false

    async function restore() {
      const saved = loadSession()

      if (!saved) {
        setRestoring(false)
        return
      }

      try {
        setStatus('Restoring secure session...')
        await connectSession(saved)
      } catch (err) {
        console.error(err)

        if (!cancelled) {
          removeSession()
          sessionRef.current = null
          setLoggedInUser(null)
          setStatus(
            'Saved session expired. Sign in again.',
          )
        }
      } finally {
        if (!cancelled) setRestoring(false)
      }
    }

    restore()

    return () => {
      cancelled = true
    }
  }, [])

  /* DC COMS COMPOSER FOCUS EFFECT */
  useEffect(() => {
    if (
      sending ||
      uploading ||
      !activeRoomId
    ) {
      return
    }

    const frame =
      window.requestAnimationFrame(
        () => {
          messageInputRef
            .current
            ?.focus({
              preventScroll: true,
            })
        },
      )

    return () => {
      window.cancelAnimationFrame(
        frame,
      )
    }
  }, [
    sending,
    uploading,
    activeRoomId,
  ])

  async function jumpToMessage(
    roomId: string,
    eventId: string,
  ): Promise<boolean> {
    const client =
      clientRef.current

    if (!client) {
      return false
    }

    const room =
      client.getRoom(
        roomId,
      )

    if (
      !room ||
      room.getMyMembership() !==
        'join'
    ) {
      return false
    }

    setSearchOpen(false)

    /*
     * If navigation crosses rooms, use the
     * normal room-selection path first.
     */
    if (
      activeRoomRef.current !==
      roomId
    ) {
      await selectRoom(
        roomId,
      )
    }

    /*
     * Set this before pagination begins.
     * MessageTimeline uses the highlight
     * as a guard against treating loaded
     * history as new live traffic.
     */
    setHighlightedMessageId(
      eventId,
    )

    try {
      const found =
        await ensureMessageLoaded(
          client,
          room,
          eventId,
        )

      if (!found) {
        setHighlightedMessageId(
          (current) =>
            current === eventId
              ? null
              : current,
        )

        return false
      }

      refreshMessages(
        client,
        roomId,
      )

      window.setTimeout(
        () => {
          setHighlightedMessageId(
            (current) =>
              current === eventId
                ? null
                : current,
          )
        },
        4000,
      )

      return true

    } catch (err) {
      console.error(
        'Message navigation failed:',
        err,
      )

      setHighlightedMessageId(
        (current) =>
          current === eventId
            ? null
            : current,
      )

      return false
    }
  }


  /*
   * DC COMS MESSAGE DEEP LINKS
   *
   * Message links survive the login screen.
   * Once Matrix has completed its initial sync,
   * reuse the normal message-navigation path.
   */
  useEffect(() => {
    if (
      messageLinkHandledRef.current ||
      !loggedInUser ||
      !initialSyncReadyRef.current
    ) {
      return
    }

    const params =
      new URLSearchParams(
        window.location.search,
      )

    const roomId =
      params.get('room')

    const eventId =
      params.get('event')

    if (
      !roomId ||
      !eventId
    ) {
      messageLinkHandledRef.current =
        true
      return
    }

    const client =
      clientRef.current

    if (!client) {
      return
    }

    const room =
      client.getRoom(roomId)

    if (
      !room ||
      room.getMyMembership() !==
        'join'
    ) {
      messageLinkHandledRef.current =
        true

      setStatus(
        'Unable to open that message link.',
      )

      return
    }

    messageLinkHandledRef.current =
      true

    void jumpToMessage(
      roomId,
      eventId,
    ).then((found) => {
      if (!found) {
        setStatus(
          'Unable to find that message.',
        )
        return
      }

      const url =
        new URL(
          window.location.href,
        )

      url.searchParams.delete(
        'room',
      )

      url.searchParams.delete(
        'event',
      )

      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      )
    })
  }, [
    loggedInUser,
    rooms,
  ])


  async function markRoomReadToLatest(
    roomId: string,
  ) {
    const client =
      clientRef.current

    const userId =
      sessionRef.current
        ?.userId

    if (
      !client ||
      !userId
    ) {
      return
    }

    const room =
      client.getRoom(
        roomId,
      )

    if (!room) {
      return
    }

    const latest =
      [...room
        .getLiveTimeline()
        .getEvents()]
        .reverse()
        .find(
          (event) => {
            const eventId =
              event.getId()

            return (
              Boolean(eventId) &&
              !room.hasPendingEvent(
                eventId!,
              )
            )
          },
        )

    const eventId =
      latest?.getId()

    if (
      !latest ||
      !eventId
    ) {
      return
    }

    if (
      readReceiptEventRef
        .current[
          roomId
        ] ===
      eventId
    ) {
      return
    }

    /*
     * Set before awaiting so repeated scroll
     * events do not issue duplicate requests.
     */
    readReceiptEventRef
      .current[
        roomId
      ] =
      eventId

    try {
      /*
       * unthreaded=true:
       * this receipt applies to the main room
       * and clears room/thread notification
       * state up to this event.
       */
      await client
        .sendReadReceipt(
          latest,
          sdk.ReceiptType.Read,
          true,
        )

      /*
       * Keep DC Coms' local attention state
       * aligned immediately instead of waiting
       * for another /sync round trip.
       */
      setLiveUnread(
        (current) => {
          if (
            !(roomId in current)
          ) {
            return current
          }

          const next = {
            ...current,
          }

          delete next[
            roomId
          ]

          return next
        },
      )

      setEntryUnread(
        (current) =>
          current?.roomId ===
          roomId
            ? null
            : current,
      )

      room.setUnreadNotificationCount(
        sdk.NotificationCountType.Total,
        0,
      )

      room.setUnreadNotificationCount(
        sdk.NotificationCountType.Highlight,
        0,
      )

      refreshRooms(
        client,
      )

    } catch (err) {
      /*
       * Permit a later scroll/bottom event to
       * retry if the network request failed.
       */
      if (
        readReceiptEventRef
          .current[
            roomId
          ] ===
        eventId
      ) {
        delete (
          readReceiptEventRef
            .current[
              roomId
            ]
        )
      }

      console.warn(
        'Unable to advance read receipt:',
        err,
      )
    }
  }


  async function selectRoom(roomId: string) {
    activeRoomRef.current = roomId
    setActiveRoomId(roomId)
    setReplyTarget(null)
    setSearchOpen(false)
    setHighlightedMessageId(null)

    setLiveUnread((current) => {
      if (!(roomId in current)) {
        return current
      }

      const next = { ...current }
      delete next[roomId]
      return next
    })

    const client = clientRef.current

    if (!client) return

    const roomAtOpen =
      client.getRoom(roomId)

    const userAtOpen =
      sessionRef.current
        ?.userId || ''

    const liveUnreadAtOpen =
      liveUnread[
        roomId
      ] ?? 0

    const alreadyOpened =
      openedRoomsRef.current
        .has(
          roomId,
        )

    /*
     * First visit this session:
     *   honor Matrix/server unread state.
     *
     * Reopening a room:
     *   honor only messages that actually
     *   arrived while the user was away.
     *
     * This prevents old paginated history or
     * a lagging server counter from jumping
     * the viewport backward.
     */
    const unreadAtOpen =
      alreadyOpened
        ? liveUnreadAtOpen
        : (
            roomAtOpen &&
            userAtOpen
              ? Math.max(
                  getUnreadCount(
                    roomAtOpen,
                    userAtOpen,
                  ),
                  liveUnreadAtOpen,
                )
              : liveUnreadAtOpen
          )

    openedRoomsRef.current.add(
      roomId,
    )

    setEntryUnread({
      roomId,
      count:
        unreadAtOpen,
    })

    refreshMessages(client, roomId)

    const room = client.getRoom(roomId)

    if (!room) return

    const lastEvent = [...room
      .getLiveTimeline()
      .getEvents()]
      .reverse()
      .find((event) => Boolean(event.getId()))

    if (!lastEvent) return

    try {
      await client.sendReadReceipt(
        lastEvent,
        sdk.ReceiptType.Read,
        true,
      )

      refreshRooms(client)
    } catch (err) {
      console.warn(
        'Unable to send read receipt:',
        err,
      )
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()

    if (!username || !password) {
      setStatus('Enter your username and password.')
      return
    }

    setBusy(true)
    setStatus('Authenticating...')

    try {
      const loginClient = sdk.createClient({
        baseUrl: HOMESERVER,
      })

      const matrixUser =
        username.startsWith('@')
          ? username
          : `@${username}:${SERVER_NAME}`

      const result = await loginClient.loginRequest({
        type: 'm.login.password',
        identifier: {
          type: 'm.id.user',
          user: matrixUser,
        },
        password,
        initial_device_display_name: 'DC Coms Web',
      })

      if (
        !result.access_token ||
        !result.user_id ||
        !result.device_id
      ) {
        throw new Error(
          'Incomplete authentication response.',
        )
      }

      const session: DcSession = {
        accessToken: result.access_token,
        userId: result.user_id,
        deviceId: result.device_id,
      }

      saveSession(session)
      sessionRef.current = session

      await connectSession(session)
      setPassword('')
    } catch (err) {
      console.error(err)

      setStatus(
        err instanceof Error
          ? err.message
          : 'Unable to sign in.',
      )
    } finally {
      setBusy(false)
    }
  }

  function handleRoomRemoved(
    roomId: string,
  ) {
    if (activeRoomRef.current === roomId) {
      activeRoomRef.current = null

      readReceiptEventRef.current = {}

      initialSyncReadyRef.current =
        false
      setActiveRoomId(null)
      setMessages([])
    }

    const client = clientRef.current

    if (client) {
      refreshRooms(client)

      window.setTimeout(() => {
        refreshRooms(client)
      }, 1000)
    }
  }

  async function handleAttachmentFiles(
    files: File[],
  ) {
    const client =
      clientRef.current

    const roomId =
      activeRoomRef.current

    if (
      !client ||
      !roomId ||
      uploading ||
      files.length === 0
    ) {
      return
    }

    setUploading(true)
    setStatus('')

    try {
      for (const file of files) {
        if (
          file.size >
          MAX_UPLOAD_BYTES
        ) {
          throw new Error(
            `${file.name || 'Attachment'} exceeds the 100 MB upload limit.`,
          )
        }

        const filename =
          file.name?.trim() ||
          `attachment-${Date.now()}`

        const mimetype =
          file.type ||
          'application/octet-stream'

        const isImage =
          mimetype.startsWith(
            'image/',
          )

        setUploadName(filename)
        setUploadStage('Encrypting')
        setUploadProgress(null)

        const source =
          await file.arrayBuffer()

        const encrypted =
          await encryptAttachment(
            source,
          )

        const encryptedBlob =
          new Blob(
            [
              encrypted.data,
            ],
            {
              type:
                'application/octet-stream',
            },
          )

        setUploadStage('Uploading')
        setUploadProgress(0)

        const upload =
          await client.uploadContent(
            encryptedBlob,
            {
              name: 'encrypted',
              type:
                'application/octet-stream',
              includeFilename: false,

              progressHandler:
                (progress) => {
                  const total =
                    progress.total ||
                    file.size

                  if (!total) return

                  setUploadProgress(
                    Math.min(
                      100,
                      Math.round(
                        (
                          progress.loaded /
                          total
                        ) * 100,
                      ),
                    ),
                  )
                },
            },
          )

        if (!upload.content_uri) {
          throw new Error(
            'Synapse did not return a media URI.',
          )
        }

        const info: {
          mimetype: string
          size: number
          w?: number
          h?: number
        } = {
          mimetype,
          size: file.size,
        }

        if (isImage) {
          try {
            const dimensions =
              await getImageDimensions(
                file,
              )

            info.w = dimensions.w
            info.h = dimensions.h
          } catch (err) {
            console.debug(
              'Image dimensions unavailable:',
              err,
            )
          }
        }

        const content = {
          msgtype:
            isImage
              ? sdk.MsgType.Image
              : sdk.MsgType.File,

          body: filename,
          filename,

          file: {
            ...encrypted.info,
            url:
              upload.content_uri,
          },

          info,
        }

        setUploadStage('Sending')
        setUploadProgress(100)

        await client.sendEvent(
          roomId,
          sdk.EventType.RoomMessage,
          content as any,
        )
      }
    } catch (err) {
      console.error(
        'Attachment send failed:',
        err,
      )

      setStatus(
        err instanceof Error
          ? err.message
          : 'Unable to send attachment.',
      )
    } finally {
      setUploading(false)
      setUploadProgress(null)
      setUploadName('')
      setUploadStage('')

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function handleComposerEmote(
    reaction: DcReactionDefinition,
  ) {
    const client =
      clientRef.current

    const roomId =
      activeRoomRef.current

    if (
      !client ||
      !roomId ||
      sending
    ) {
      return
    }

    setSending(true)
    setStatus('')

    try {
      const content:
        Record<string, any> = {
        msgtype:
          sdk.MsgType.Text,
        body:
          reaction.image
            ? reaction.label
            : reaction.key,
      }

      if (reaction.image) {
        content[
          'com.dccoms.emote'
        ] = reaction.key
      } else {
        content[
          'com.dccoms.big_emoji'
        ] = true
      }

      if (replyTarget) {
        content[
          'm.relates_to'
        ] = {
          'm.in_reply_to': {
            event_id:
              replyTarget.eventId,
          },
        }
      }

      await client.sendEvent(
        roomId,
        sdk.EventType.RoomMessage,
        content as any,
      )

      setReplyTarget(null)
    } catch (err) {
      console.error(
        'Standalone emote send failed:',
        err,
      )

      setStatus(
        err instanceof Error
          ? err.message
          : 'Unable to send emoji.',
      )
    } finally {
      setSending(false)
    }
  }

  async function handleSend(
    e: React.FormEvent,
  ) {
    e.preventDefault()

    const client =
      clientRef.current

    const roomId =
      activeRoomRef.current

    const draftUserId =
      sessionRef.current
        ?.userId ||
      loggedInUser ||
      ''

    const body =
      draft.trim()

    if (
      !client ||
      !roomId ||
      !body ||
      sending
    ) {
      return
    }

    setSending(true)
    setDraft('')

    stopComposerTyping(roomId)

    try {
      const content:
        Record<string, any> = {
        msgtype:
          sdk.MsgType.Text,
        body,
      }

      if (
        isEmojiOnlyMessage(body)
      ) {
        content[
          'com.dccoms.big_emoji'
        ] = true
      }

      if (replyTarget) {
        content[
          'm.relates_to'
        ] = {
          'm.in_reply_to': {
            event_id:
              replyTarget.eventId,
          },
        }

        if (
          replyTarget.sender &&
          replyTarget.sender !==
            sessionRef.current
              ?.userId
        ) {
          content['m.mentions'] = {
            user_ids: [
              replyTarget.sender,
            ],
          }
        }
      }

      applyTypedMentions(
        content,
        client.getRoom(roomId),
        body,
        sessionRef.current
          ?.userId || '',
      )

      await client.sendEvent(
        roomId,
        sdk.EventType.RoomMessage,
        content as any,
      )

      if (draftUserId) {
        saveRoomDraft(
          draftUserId,
          roomId,
          '',
        )
      }

      setReplyTarget(null)
    } catch (err) {
      console.error(err)

      setDraft(body)

      if (draftUserId) {
        saveRoomDraft(
          draftUserId,
          roomId,
          body,
        )
      }

      setStatus(
        err instanceof Error
          ? err.message
          : 'Message failed to send.',
      )
    } finally {
      setSending(false)

      /* DC COMS COMPOSER REFOCUS */
      window.setTimeout(() => {
        messageInputRef
          .current
          ?.focus()
      }, 0)
    }
  }

  async function acceptInvite(
    roomId: string,
  ) {
    const client = clientRef.current

    if (!client) return

    setStatus('Joining conversation...')

    try {
      await client.joinRoom(roomId)

      setInvites((current) =>
        current.filter(
          (room) =>
            room.roomId !== roomId,
        ),
      )

      activeRoomRef.current = roomId
      setActiveRoomId(roomId)
      setReplyTarget(null)

      setLiveUnread((current) => {
        if (!(roomId in current)) {
          return current
        }

        const next = { ...current }
        delete next[roomId]
        return next
      })

      refreshRooms(client)

      await refreshMessages(
        client,
        roomId,
      )

      window.setTimeout(() => {
        refreshRooms(client)

        void refreshMessages(
          client,
          roomId,
        )
      }, 500)

      setStatus('')
    } catch (err) {
      console.error(
        'Join conversation failed:',
        err,
      )

      setStatus(
        err instanceof Error
          ? err.message
          : 'Unable to join conversation.',
      )
    }
  }

  async function declineInvite(
    roomId: string,
  ) {
    const client = clientRef.current

    if (!client) return

    try {
      await client.leave(roomId)

      setInvites((current) =>
        current.filter(
          (room) =>
            room.roomId !== roomId,
        ),
      )

      refreshRooms(client)
    } catch (err) {
      console.error(
        'Decline invitation failed:',
        err,
      )

      setStatus(
        err instanceof Error
          ? err.message
          : 'Unable to decline invitation.',
      )
    }
  }

  async function handleConversationCreated(
    roomId: string,
  ) {
    const client = clientRef.current

    if (!client) return

    /*
     * A newly created Matrix room is normally
     * already joined by its creator. Calling
     * joinRoom again is harmless and also helps
     * ensure the room is present in the local
     * SDK store before we select it.
     */
    try {
      await client.joinRoom(roomId)
    } catch (err) {
      console.debug(
        'Room already joined/cache pending:',
        err,
      )
    }

    activeRoomRef.current = roomId
    setActiveRoomId(roomId)
    setReplyTarget(null)

    refreshRooms(client)

    window.setTimeout(() => {
      refreshRooms(client)

      void refreshMessages(
        client,
        roomId,
      )
    }, 500)
  }

  async function handleLogout() {
    const client = clientRef.current
    const session = sessionRef.current

    const logoutWarnings: string[] = []

    setBusy(true)

    try {
      cleanupRef.current?.()
      cleanupRef.current = null

      if (client) {
        try {
          await client.logout(true)
        } catch (err) {
          console.warn(
            'Server logout failed:',
            err,
          )

          logoutWarnings.push(
            'Signed out locally, but DC Coms could not invalidate the server session. Sign in again and review Devices in Security & Recovery.',
          )
        }

        try {
          client.stopClient()
        } catch (err) {
          console.warn(
            'Matrix client stop failed:',
            err,
          )
        }

        if (session) {
          try {
            await client.clearStores({
              cryptoDatabasePrefix:
                cryptoPrefix(session),
            })
          } catch (err) {
            console.warn(
              'Local crypto store cleanup failed:',
              err,
            )

            logoutWarnings.push(
              'This browser could not fully clear the local encrypted session store.',
            )
          }
        }
      }
    } finally {
      clearRecoveryKeyCache()
      removeSession()

      clientRef.current = null
      sessionRef.current = null
      activeRoomRef.current = null

      openedRoomsRef.current.clear()

      setLoggedInUser(null)
      setRooms([])
      setInvites([])
      setMessages([])
      setLiveUnread({})
      setActiveRoomId(null)
      setUsername('')
      setPassword('')
      setStatus(
        logoutWarnings.join(' '),
      )
      setBusy(false)

      delete (window as any).dccomsClient
    }
  }

  if (restoring) {
    return (
      <main className="shell">
        <section className="success-card">
          <div className="brand-mark">DC</div>
          <p className="eyebrow">DC COMS</p>
          <h1>Connecting.</h1>
          <p className="next-copy">
            Restoring your encrypted session...
          </p>
        </section>
      </main>
    )
  }

  if (!loggedInUser) {
    return (
      <main className="shell">
        <section className="login-card">
          <div className="brand">
            <div className="brand-mark">DC</div>

            <div>
              <p className="eyebrow">DC COMS</p>
            </div>
          </div>

          <div className="intro">
            <h1>Sign in</h1>
          </div>

          <form onSubmit={handleLogin}>
            <label>
              Username
              <input
                value={username}
                autoComplete="username"
                onChange={(e) =>
                  setUsername(e.target.value)
                }
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) =>
                  setPassword(e.target.value)
                }
              />
            </label>

            <button disabled={busy}>
              {busy
                ? 'Connecting...'
                : 'Sign in'}
            </button>
          </form>

          <ResetPassword
            serverName={SERVER_NAME}
          />

          {status && (
            <div className="login-status">
              {status}
            </div>
          )}

          <footer>
            <div className="secure">
              <span className="secure-dot" />
              End-to-end encrypted
            </div>
            <span>{SERVER_NAME}</span>
          </footer>
        </section>
      </main>
    )
  }

  const activeRoom =
    rooms.find(
      (room) => room.roomId === activeRoomId,
    ) ?? null

  return (
    <main className="comms-shell">
      {clientRef.current &&
        loggedInUser &&
        sessionRef.current && (
          <FirstLoginSecurity
            client={clientRef.current}
            userId={loggedInUser}
            deviceId={
              sessionRef.current.deviceId
            }
            onOpenSecurity={() =>
              setSecurityOpen(true)
            }
          />
        )}

      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="mini-brand">DC</div>

          <div>
            <strong>DC COMS</strong>
          </div>
        </header>

        {/* DC COMS CHANNEL RENAME POLICY */}
        {clientRef.current && (
          <ChannelRenamePolicy
            client={clientRef.current}
            rooms={rooms}
          />
        )}

        {clientRef.current && (
          <NewConversation
            client={clientRef.current}
            serverName={SERVER_NAME}
            currentUserId={loggedInUser}
            onCreated={handleConversationCreated}
          />
        )}

        {clientRef.current && (
          <NewChannel
            client={clientRef.current}
            onCreated={handleConversationCreated}
          />
        )}

        {invites.length > 0 && (
          <>
            <div className="room-heading invite-heading">
              INVITATIONS
            </div>

            <div className="invite-list">
              {invites.map((room) => (
                <div
                  className="invite-card"
                  key={room.roomId}
                >
                  <div className="invite-info">
                    <strong>
                      {getRoomLabel(room, loggedInUser)}
                    </strong>

                    <span>
                      Encrypted conversation invite
                    </span>
                  </div>

                  <div className="invite-actions">
                    <button
                      className="invite-accept"
                      onClick={() =>
                        acceptInvite(room.roomId)
                      }
                    >
                      Accept
                    </button>

                    <button
                      className="invite-decline"
                      onClick={() =>
                        declineInvite(room.roomId)
                      }
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="room-heading">
          CONVERSATIONS
        </div>

        <div className="room-list">
          {rooms.length === 0 && (
            <div className="empty-sidebar">
              No rooms yet.
            </div>
          )}

          {rooms.map((room) => (
            <button
              key={room.roomId}
              className={
                room.roomId === activeRoomId
                  ? 'room-item active'
                  : 'room-item'
              }
              onClick={() =>
                selectRoom(room.roomId)
              }
            >
              <span className="room-icon">
                {isDirectConversation(room)
                  ? '@'
                  : '#'}
              </span>

              <span className="room-name">
                {getRoomLabel(room, loggedInUser)}
              </span>

              {room.roomId !== activeRoomId &&
                getHighlightCount(room) > 0 && (
                  <span
                    className="mention-badge"
                    title="Mentioned you"
                  >
                    @
                    {Math.min(
                      getHighlightCount(room),
                      99,
                    )}
                  </span>
                )}

              {room.roomId !== activeRoomId &&
                Math.max(
                  getUnreadCount(
                    room,
                    loggedInUser,
                  ),
                  liveUnread[room.roomId] ?? 0,
                ) > 0 && (
                  <span className="unread-badge">
                    {Math.min(
                      Math.max(
                        getUnreadCount(
                          room,
                          loggedInUser,
                        ),
                        liveUnread[
                          room.roomId
                        ] ?? 0,
                      ),
                      99,
                    )}
                  </span>
                )}
            </button>
          ))}
        </div>

        {/* DC COMS SECURITY NAV START */}
        <button
          type="button"
          className="sidebar-security-button"
          onClick={() =>
            setSecurityOpen(true)
          }
        >
          <span>◆</span>
          Security & Recovery
        </button>
        {/* DC COMS SECURITY NAV END */}

        <div className="sidebar-user">
          <div>
            <strong>
              {loggedInUser.split(':')[0]
                .replace('@', '')}
            </strong>
            <span>● Secure</span>

            {clientRef.current && (
              <PresenceControl
                client={clientRef.current}
                userId={loggedInUser}
              />
            )}

            <DesktopNotifications />
          </div>

          <button
            className="sidebar-logout"
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      </aside>

      <section
        className={
          dragActive
            ? 'conversation drag-active'
            : 'conversation'
        }
        onDragEnter={(event) => {
          if (
            event.dataTransfer.types.includes(
              'Files',
            )
          ) {
            event.preventDefault()
            setDragActive(true)
          }
        }}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes(
              'Files',
            )
          ) {
            event.preventDefault()
            event.dataTransfer.dropEffect =
              'copy'

            setDragActive(true)
          }
        }}
        onDragLeave={(event) => {
          const related =
            event.relatedTarget as
              | Node
              | null

          if (
            !related ||
            !event.currentTarget.contains(
              related,
            )
          ) {
            setDragActive(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)

          const files =
            Array.from(
              event.dataTransfer.files,
            )

          if (files.length > 0) {
            void handleAttachmentFiles(
              files,
            )
          }
        }}
      >
        {dragActive && activeRoom && (
          <div className="attachment-drop-overlay">
            <div>
              <strong>
                Drop to send securely
              </strong>

              <span>
                Files are encrypted before upload
              </span>
            </div>
          </div>
        )}

        {activeRoom ? (
          <>
            <header className="conversation-header">
              <div>
                <ChannelName
                  client={
                    clientRef.current!
                  }
                  room={
                    activeRoom
                  }
                  label={
                    getRoomLabel(
                      activeRoom,
                      loggedInUser,
                    )
                  }
                />

                <ChannelTopic
                  client={clientRef.current}
                  room={activeRoom}
                />

                <span>
                  🔒 End-to-end encrypted
                  {' · '}
                  {activeRoom.getJoinedMemberCount()}
                  {' '}
                  {activeRoom.getJoinedMemberCount() === 1
                    ? 'member'
                    : 'members'}
                </span>
              </div>

              <div className="conversation-header-actions">
                {clientRef.current && (
                  <>
                    <PinnedMessages
                      client={
                        clientRef.current
                      }
                      room={
                        activeRoom
                      }
                      onJump={(
                        eventId,
                      ) =>
                        jumpToMessage(
                          activeRoom.roomId,
                          eventId,
                        )
                      }
                    />

                    <button
                      type="button"
                      className="message-search-button"
                      onClick={() => {
                        setSearchOpen(true)
                      }}
                    >
                      ⌕ Search
                    </button>

                    <RoomMembers
                      client={clientRef.current}
                      room={activeRoom}
                      currentUserId={loggedInUser}
                    />

                    <RoomInvite
                      client={clientRef.current}
                      room={activeRoom}
                      serverName={SERVER_NAME}
                    />

                    <RoomActions
                      client={clientRef.current}
                      room={activeRoom}
                      roomLabel={getRoomLabel(
                        activeRoom,
                        loggedInUser,
                      )}
                      onRemoved={handleRoomRemoved}
                    />
                  </>
                )}
              </div>
            </header>

            {searchOpen &&
              clientRef.current && (
                <MessageSearch
                  client={
                    clientRef.current
                  }
                  room={
                    activeRoom
                  }
                  onClose={() => {
                    setSearchOpen(false)
                  }}
                  onJump={(
                    eventId,
                  ) => {
                    void jumpToMessage(
                      activeRoom.roomId,
                      eventId,
                    )
                  }}
                />
              )}

            <MessageTimeline
              client={
                clientRef.current!
              }
              room={
                activeRoom
              }
              messages={
                messages
              }
              newMessageCount={
                entryUnread
                  ?.roomId ===
                    activeRoom.roomId
                  ? entryUnread.count
                  : 0
              }
              highlightedMessageId={
                highlightedMessageId
              }
              bottomRef={
                bottomRef
              }
              onReadLatest={() => {
                void markRoomReadToLatest(
                  activeRoom.roomId,
                )
              }}

              onChanged={() => {
                const client =
                  clientRef.current

                if (!client) {
                  return
                }

                refreshMessages(
                  client,
                  activeRoom.roomId,
                )
              }}
              onReply={(
                target,
              ) => {
                setReplyTarget(
                  target,
                )

                window.setTimeout(
                  () => {
                    messageInputRef
                      .current
                      ?.focus()
                  },
                  0,
                )
              }}
              onJumpToMessage={(
                eventId,
              ) =>
                jumpToMessage(
                  activeRoom.roomId,
                  eventId,
                )
              }
            />


            {typingUsers.length > 0 && (
              <div
                className="typing-indicator"
                aria-live="polite"
              >
                {typingUsers.length === 1
                  ? `${typingUsers[0]} is typing…`
                  : typingUsers.length === 2
                    ? `${typingUsers[0]} and ${typingUsers[1]} are typing…`
                    : `${typingUsers[0]}, ${typingUsers[1]} and ${typingUsers.length - 2} others are typing…`}
              </div>
            )}

            <form
              className="composer"
              onSubmit={handleSend}
            >
              {replyTarget && (
                <div className="composer-reply-bar">
                  <div>
                    <strong>
                      Replying to {
                        replyTarget.displayName
                      }
                    </strong>

                    <span>
                      {replyTarget.body}
                    </span>
                  </div>

                  <button
                    type="button"
                    aria-label="Cancel reply"
                    onClick={() =>
                      setReplyTarget(null)
                    }
                  >
                    ×
                  </button>
                </div>
              )}

              {uploading && (
                <div className="attachment-upload-status">
                  <span>
                    {uploadStage}
                    {' '}
                    <strong>
                      {uploadName}
                    </strong>
                  </span>

                  {uploadProgress !== null && (
                    <span>
                      {uploadProgress}%
                    </span>
                  )}

                  {uploadProgress !== null && (
                    <div className="attachment-progress">
                      <div
                        style={{
                          width:
                            `${uploadProgress}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                className="attachment-file-input"
                type="file"
                multiple
                onChange={(event) => {
                  const files =
                    Array.from(
                      event.target.files ??
                      [],
                    )

                  if (files.length > 0) {
                    void handleAttachmentFiles(
                      files,
                    )
                  }
                }}
              />

              <button
                type="button"
                className="attachment-button"
                title="Attach files"
                aria-label="Attach files"
                disabled={
                  uploading ||
                  sending
                }
                onClick={() =>
                  fileInputRef.current?.click()
                }
              >
                📎
              </button>

              <ComposerEmojiPicker
                disabled={
                  sending ||
                  uploading
                }
                onSend={
                  handleComposerEmote
                }
              />

              <MentionComposerInput
                ref={messageInputRef}
                client={
                  clientRef.current
                }
                roomId={
                  activeRoomId
                }
                currentUserId={
                  sessionRef.current
                    ?.userId ||
                  loggedInUser ||
                  ''
                }
                value={draft}
                onChange={(next) => {
                  setDraft(next)
                  updateComposerTyping(next)

                  const userId =
                    sessionRef.current
                      ?.userId ||
                    loggedInUser

                  if (
                    userId &&
                    activeRoomId
                  ) {
                    saveRoomDraft(
                      userId,
                      activeRoomId,
                      next,
                    )
                  }
                }}
                onPasteFiles={(files) => {
                  void handleAttachmentFiles(
                    files,
                  )
                }}
                placeholder={`Message ${getRoomLabel(activeRoom, loggedInUser)}...`}
                disabled={
                  sending ||
                  uploading
                }
              />

              <button
                disabled={
                  sending ||
                  uploading ||
                  !draft.trim()
                }
              >
                {sending
                  ? '...'
                  : 'Send'}
              </button>
            </form>
          </>
        ) : (
          <div className="no-room">
            <div className="brand-mark">DC</div>
            <h2>DC Coms</h2>
            <p>Select a conversation.</p>
          </div>
        )}
      </section>
          {/* DC COMS SECURITY MODAL START */}
      {securityOpen &&
        clientRef.current && (
          <SecurityRecovery
            client={clientRef.current}
            userId={loggedInUser}
            deviceId={
              sessionRef.current?.deviceId ??
              ''
            }
            onClose={() =>
              setSecurityOpen(false)
            }
          />
        )}
      {/* DC COMS SECURITY MODAL END */}

</main>
  )
}

export default App
