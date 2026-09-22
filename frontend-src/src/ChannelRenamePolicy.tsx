import {
  useEffect,
} from 'react'

import * as sdk from 'matrix-js-sdk'

import {
  isDirectConversation,
} from './Attention'


type Props = {
  client: sdk.MatrixClient
  rooms: sdk.Room[]
}


/*
 * Prevent overlapping policy writes when
 * React renders while a Matrix state update
 * is still in flight.
 */
const policyWritesInFlight =
  new Set<string>()


async function allowMemberRename(
  client: sdk.MatrixClient,
  room: sdk.Room,
) {
  if (
    isDirectConversation(
      room,
    )
  ) {
    return
  }

  if (
    policyWritesInFlight.has(
      room.roomId,
    )
  ) {
    return
  }

  const canChangePower =
    room.currentState
      .mayClientSendStateEvent(
        sdk.EventType
          .RoomPowerLevels,
        client,
      )

  if (!canChangePower) {
    return
  }

  const event =
    room.currentState
      .getStateEvents(
        sdk.EventType
          .RoomPowerLevels,
        '',
      ) as
        sdk.MatrixEvent |
        null

  if (!event) {
    return
  }

  const content =
    event.getContent() as
      Record<string, any>

  const events = {
    ...(
      content.events ||
      {}
    ),
  }

  const stateDefault =
    typeof
      content
        .state_default ===
      'number'
      ? content
          .state_default
      : 50

  const nameRequired =
    typeof
      events[
        sdk.EventType
          .RoomName
      ] ===
      'number'
      ? events[
          sdk.EventType
            .RoomName
        ]
      : stateDefault

  const topicRequired =
    typeof
      events[
        sdk.EventType
          .RoomTopic
      ] ===
      'number'
      ? events[
          sdk.EventType
            .RoomTopic
        ]
      : stateDefault

  if (
    nameRequired <= 0 &&
    topicRequired <= 0
  ) {
    return
  }

  events[
    sdk.EventType.RoomName
  ] = 0

  events[
    sdk.EventType.RoomTopic
  ] = 0

  policyWritesInFlight.add(
    room.roomId,
  )

  try {
    await client.sendStateEvent(
      room.roomId,
      sdk.EventType
        .RoomPowerLevels,
      {
        ...content,
        events,
      } as any,
      '',
    )
  } finally {
    policyWritesInFlight.delete(
      room.roomId,
    )
  }
}


export default function ChannelRenamePolicy({
  client,
  rooms,
}: Props) {
  /*
   * React may hand us a fresh rooms array
   * after sync/state activity even when the
   * actual room membership is unchanged.
   *
   * Key the migration pass to room IDs
   * instead of the array identity so normal
   * Matrix state traffic cannot create a
   * power-level write loop.
   */
  const roomKey =
    rooms
      .map(
        (room) =>
          room.roomId,
      )
      .sort()
      .join('\n')

  useEffect(() => {
    let cancelled =
      false

    void (
      async () => {
        for (
          const room
          of rooms
        ) {
          if (cancelled) {
            return
          }

          try {
            await allowMemberRename(
              client,
              room,
            )
          } catch (err) {
            console.debug(
              'Channel rename policy skipped:',
              room.roomId,
              err,
            )
          }
        }
      }
    )()

    return () => {
      cancelled = true
    }

  }, [
    client,
    roomKey,
  ])

  return null
}
