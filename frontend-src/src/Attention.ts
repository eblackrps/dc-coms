import * as sdk from 'matrix-js-sdk'

export const DESKTOP_ALERTS_KEY =
  'dccoms.desktop-alerts.v1'

export function getHighlightCount(
  room: sdk.Room,
): number {
  return (
    room.getUnreadNotificationCount(
      sdk.NotificationCountType.Highlight,
    ) ?? 0
  )
}

export function isDirectConversation(
  room: sdk.Room,
): boolean {
  /*
   * DC Coms direct conversations are
   * created without an explicit room name.
   * Channels always have a room name.
   */
  const nameEvent =
    room.currentState.getStateEvents(
      sdk.EventType.RoomName,
      '',
    )

  return (
    !nameEvent &&
    room.getJoinedMemberCount() <= 2
  )
}

export function applyTypedMentions(
  content: Record<string, any>,
  room: sdk.Room | null,
  body: string,
  myUserId: string,
): void {
  if (
    !room ||
    !myUserId
  ) {
    return
  }

  const tokens =
    new Set(
      (
        body.match(
          /@[A-Za-z0-9._=+\-]+(?::[A-Za-z0-9.-]+)?/g,
        ) ?? []
      ).map(
        (token) =>
          token.toLowerCase(),
      ),
    )

  if (tokens.size === 0) {
    return
  }

  const typedMentionIds =
    room
      .getJoinedMembers()
      .filter((member) => {
        if (
          member.userId ===
          myUserId
        ) {
          return false
        }

        const full =
          member.userId
            .toLowerCase()

        const local =
          full.split(':')[0]

        return (
          tokens.has(full) ||
          tokens.has(local)
        )
      })
      .map(
        (member) =>
          member.userId,
      )

  if (
    typedMentionIds.length === 0
  ) {
    return
  }

  const currentIds =
    Array.isArray(
      content[
        'm.mentions'
      ]?.user_ids,
    )
      ? content[
          'm.mentions'
        ].user_ids.filter(
          (
            value: unknown,
          ): value is string =>
            typeof value ===
            'string',
        )
      : []

  const userIds = [
    ...new Set<string>([
      ...currentIds,
      ...typedMentionIds,
    ]),
  ]

  content['m.mentions'] = {
    user_ids: userIds,
  }
}

export function eventMentionsUser(
  event: sdk.MatrixEvent,
  userId: string,
): boolean {
  const content =
    event.getContent() as
      Record<string, any>

  const ids =
    content[
      'm.mentions'
    ]?.user_ids

  return (
    Array.isArray(ids) &&
    ids.includes(userId)
  )
}

function isReplacement(
  event: sdk.MatrixEvent,
): boolean {
  const content =
    event.getOriginalContent() as
      Record<string, any>

  return (
    content?.[
      'm.relates_to'
    ]?.rel_type ===
    sdk.RelationType.Replace
  )
}

export function maybeShowDesktopNotification(
  event: sdk.MatrixEvent,
  room: sdk.Room,
  myUserId: string,
  roomLabel: string,
): void {
  if (
    typeof window ===
      'undefined' ||
    typeof Notification ===
      'undefined'
  ) {
    return
  }

  if (
    window.localStorage.getItem(
      DESKTOP_ALERTS_KEY,
    ) !== 'enabled'
  ) {
    return
  }

  if (
    Notification.permission !==
    'granted'
  ) {
    return
  }

  /*
   * Sidebar attention is enough while
   * DC Coms is visible.
   */
  if (
    document.visibilityState ===
    'visible'
  ) {
    return
  }

  if (
    event.getType() !==
      sdk.EventType.RoomMessage ||
    event.isRedacted() ||
    isReplacement(event) ||
    event.getSender() === myUserId
  ) {
    return
  }

  /*
   * Avoid notifications for stale
   * timeline events during reconnect.
   */
  if (
    Date.now() -
      event.getTs() >
    60_000
  ) {
    return
  }

  const direct =
    isDirectConversation(room)

  const mentioned =
    eventMentionsUser(
      event,
      myUserId,
    )

  /*
   * Desktop notifications remain quiet:
   * DMs and mentions only.
   */
  if (
    !direct &&
    !mentioned
  ) {
    return
  }

  const senderId =
    event.getSender() ||
    'unknown'

  const sender =
    room.getMember(
      senderId,
    )?.name ||
    senderId

  const title =
    direct
      ? `${sender} · DC Coms`
      : `Mention in ${roomLabel}`

  const notification =
    new Notification(
      title,
      {
        body:
          'New encrypted message.',
        tag:
          `dccoms:${room.roomId}`,
      },
    )

  notification.onclick =
    () => {
      window.focus()
      notification.close()
    }
}
