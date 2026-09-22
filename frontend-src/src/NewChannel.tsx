import { useState } from 'react'
import * as sdk from 'matrix-js-sdk'

import {
  isDirectConversation,
} from './Attention'

type Props = {
  client: sdk.MatrixClient
  onCreated: (roomId: string) => Promise<void> | void
}

export default function NewChannel({
  client,
  onCreated,
}: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function createChannel(
    e: React.FormEvent,
  ) {
    e.preventDefault()

    const channelName = name.trim()
    const channelTopic = topic.trim()

    if (!channelName) {
      setError('Enter a channel name.')
      return
    }

    /* DC COMS SINGLE CHANNEL POLICY */
    const normalizedName =
      channelName
        .replace(
          /\s+/g,
          ' ',
        )
        .toLocaleLowerCase()

    const existingChannel =
      client
        .getRooms()
        .filter(
          (room) =>
            room.getMyMembership() ===
              'join',
        )
        .filter(
          (room) =>
            !isDirectConversation(
              room,
            ),
        )
        .filter(
          (room) =>
            room.name
              .trim()
              .replace(
                /\s+/g,
                ' ',
              )
              .toLocaleLowerCase() ===
            normalizedName,
        )[0]

    if (existingChannel) {
      setName('')
      setTopic('')
      setError('')
      setOpen(false)

      await onCreated(
        existingChannel.roomId,
      )

      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await client.createRoom({
        name: channelName,
        preset: sdk.Preset.PrivateChat,
        is_direct: false,
        initial_state: [
          {
            type: sdk.EventType.RoomEncryption,
            state_key: '',
            content: {
              algorithm: 'm.megolm.v1.aes-sha2',
            },
          },
        ],
      })

      /* DC COMS NEW CHANNEL MEMBER RENAME */
      try {
        const createdRoom =
          client.getRoom(
            result.room_id,
          )

        if (createdRoom) {
          const powerEvent =
            createdRoom
              .currentState
              .getStateEvents(
                sdk.EventType
                  .RoomPowerLevels,
                '',
              ) as
                sdk.MatrixEvent |
                null

          if (powerEvent) {
            const power =
              powerEvent
                .getContent() as
                  Record<
                    string,
                    any
                  >

            await client
              .sendStateEvent(
                result.room_id,

                sdk.EventType
                  .RoomPowerLevels,

                {
                  ...power,

                  events: {
                    ...(
                      power.events ||
                      {}
                    ),

                    [sdk.EventType.RoomName]:
                      0,

                    [sdk.EventType.RoomTopic]:
                      0,
                  },
                } as any,

                '',
              )
          }
        }
      } catch (err) {
        console.warn(
          'Unable to enable member channel rename:',
          err,
        )
      }

      if (channelTopic) {
        await client.setRoomTopic(
          result.room_id,
          channelTopic,
        )
      }

      setName('')
      setTopic('')
      setOpen(false)

      await onCreated(result.room_id)
    } catch (err) {
      console.error('Channel creation failed:', err)

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create channel.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="new-channel-wrap">
        <button
          className="new-channel-button"
          onClick={() => setOpen(true)}
        >
          + New channel
        </button>
      </div>
    )
  }

  return (
    <div className="new-channel-panel">
      <div className="new-channel-title">
        New channel
      </div>

      <div className="new-channel-copy">
        Create a private encrypted group conversation.
      </div>

      <form onSubmit={createChannel}>
        <label>
          Channel name

          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
            placeholder="Architecture"
            disabled={busy}
          />
        </label>

        <label>
          Topic

          <textarea
            value={topic}
            onChange={(e) =>
              setTopic(e.target.value)
            }
            placeholder="What this channel is for..."
            rows={3}
            disabled={busy}
          />
        </label>

        {error && (
          <div className="new-channel-error">
            {error}
          </div>
        )}

        <div className="new-channel-actions">
          <button
            type="button"
            className="new-channel-cancel"
            onClick={() => {
              setOpen(false)
              setName('')
              setTopic('')
              setError('')
            }}
            disabled={busy}
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={busy || !name.trim()}
          >
            {busy ? 'Creating...' : 'Create channel'}
          </button>
        </div>
      </form>
    </div>
  )
}
