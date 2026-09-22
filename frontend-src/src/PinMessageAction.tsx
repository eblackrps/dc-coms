import {
  useState,
} from 'react'

import * as sdk from 'matrix-js-sdk'

type Props = {
  client: sdk.MatrixClient
  roomId: string
  eventId: string
}

function getPinnedIds(
  client: sdk.MatrixClient,
  roomId: string,
) {
  const room =
    client.getRoom(roomId)

  if (!room) {
    return []
  }

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

export default function PinMessageAction({
  client,
  roomId,
  eventId,
}: Props) {
  const room =
    client.getRoom(roomId)

  const initialPinned =
    getPinnedIds(
      client,
      roomId,
    ).includes(
      eventId,
    )

  const [pinned, setPinned] =
    useState(
      initialPinned,
    )

  const [busy, setBusy] =
    useState(false)

  const [error, setError] =
    useState('')

  if (!room) {
    return null
  }

  const canPin =
    room.currentState
      .mayClientSendStateEvent(
        sdk.EventType
          .RoomPinnedEvents,
        client,
      )

  if (!canPin) {
    return null
  }

  async function togglePin() {
    if (busy) return

    setBusy(true)
    setError('')

    const oldPinned =
      pinned

    try {
      const current =
        getPinnedIds(
          client,
          roomId,
        )

      const currentlyPinned =
        current.includes(
          eventId,
        )

      let next: string[]

      if (currentlyPinned) {
        next =
          current.filter(
            (id) =>
              id !== eventId,
          )
      } else {
        if (
          current.length >= 50
        ) {
          throw new Error(
            'This room already has 50 pinned messages.',
          )
        }

        next = [
          ...current,
          eventId,
        ]
      }

      /*
       * Optimistic local button state.
       */
      setPinned(
        !currentlyPinned,
      )

      await client.sendStateEvent(
        roomId,
        sdk.EventType
          .RoomPinnedEvents,
        {
          pinned: next,
        },
      )

      /*
       * Tell the pins panel immediately,
       * rather than waiting for /sync.
       */
      window.dispatchEvent(
        new CustomEvent(
          'dccoms-pins-changed',
          {
            detail: {
              roomId,
              pinned: next,
            },
          },
        ),
      )
    } catch (err) {
      console.error(
        'Pin update failed:',
        err,
      )

      setPinned(
        oldPinned,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to update pin.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void togglePin()
        }}
      >
        {busy
          ? 'Updating pin...'
          : pinned
            ? 'Unpin message'
            : 'Pin message'}
      </button>

      {error && (
        <span
          className="message-pin-error"
        >
          {error}
        </span>
      )}
    </>
  )
}
