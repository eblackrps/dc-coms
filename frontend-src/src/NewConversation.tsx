import { useState } from 'react'
import * as sdk from 'matrix-js-sdk'

import UserDirectoryPicker from './UserDirectoryPicker'

import {
  isDirectConversation,
} from './Attention'

type Props = {
  client: sdk.MatrixClient
  serverName: string
  currentUserId: string
  onCreated: (roomId: string) => Promise<void> | void
}

export default function NewConversation({
  client,
  serverName,
  currentUserId,
  onCreated,
}: Props) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function normalizeUserId(value: string) {
    const v = value.trim()

    if (!v) return ''

    if (v.startsWith('@') && v.includes(':')) {
      return v
    }

    if (v.startsWith('@')) {
      return `${v}:${serverName}`
    }

    return `@${v}:${serverName}`
  }

  async function createConversation(e: React.FormEvent) {
    e.preventDefault()

    const userId = normalizeUserId(target)

    if (!userId) {
      setError('Enter a username.')
      return
    }

    if (userId === currentUserId) {
      setError('You cannot start a conversation with yourself.')
      return
    }

    /* DC COMS SINGLE DM POLICY */
    const existingDm =
      client
        .getRooms()
        .filter(
          (room) =>
            room.getMyMembership() ===
              'join',
        )
        .filter(
          (room) =>
            isDirectConversation(
              room,
            ),
        )
        .filter(
          (room) =>
            room
              .getMembers()
              .some(
                (member) =>
                  member.userId ===
                    userId &&
                  (
                    member.membership ===
                      'join' ||
                    member.membership ===
                      'invite'
                  ),
              ),
        )
        .sort(
          (a, b) => {
            const aEvents =
              a.getLiveTimeline()
                .getEvents()

            const bEvents =
              b.getLiveTimeline()
                .getEvents()

            const aLast =
              aEvents.length
                ? aEvents[
                    aEvents.length - 1
                  ].getTs()
                : 0

            const bLast =
              bEvents.length
                ? bEvents[
                    bEvents.length - 1
                  ].getTs()
                : 0

            return (
              bLast -
              aLast
            )
          },
        )[0]

    if (existingDm) {
      setTarget('')
      setError('')
      setOpen(false)

      await onCreated(
        existingDm.roomId,
      )

      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await client.createRoom({
        preset: sdk.Preset.PrivateChat,
        invite: [userId],
        is_direct: true,
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

      setTarget('')
      setOpen(false)

      await onCreated(result.room_id)
    } catch (err) {
      console.error(err)

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create conversation.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="new-conversation-wrap">
        <button
          className="new-conversation-button"
          onClick={() => setOpen(true)}
        >
          + New conversation
        </button>
      </div>
    )
  }

  return (
    <div className="new-conversation-panel">
      <div className="new-conversation-title">
        New conversation
      </div>

      <form onSubmit={createConversation}>
        <UserDirectoryPicker
          client={client}
          value={target}
          onChange={(value) => {
            setTarget(value)
            setError('')
          }}
          excludedUserIds={[
            currentUserId,
          ]}
          disabled={busy}
          autoFocus
          placeholder="Search by name or username..."
        />

        {error && (
          <div className="new-conversation-error">
            {error}
          </div>
        )}

        <div className="new-conversation-actions">
          <button
            type="button"
            className="new-conversation-cancel"
            onClick={() => {
              setOpen(false)
              setError('')
            }}
            disabled={busy}
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={busy || !target.trim()}
          >
            {busy ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
