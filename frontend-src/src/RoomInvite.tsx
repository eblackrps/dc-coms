import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import * as sdk from 'matrix-js-sdk'

import UserDirectoryPicker
  from './UserDirectoryPicker'


type Props = {
  client: sdk.MatrixClient
  room: sdk.Room
  serverName: string
}


export default function RoomInvite({
  client,
  room,
  serverName,
}: Props) {
  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    )

  const [
    open,
    setOpen,
  ] = useState(false)

  const [
    username,
    setUsername,
  ] = useState('')

  const [
    busy,
    setBusy,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState('')

  const [
    success,
    setSuccess,
  ] = useState('')


  function close() {
    setOpen(false)
    setUsername('')
    setError('')
    setSuccess('')
  }


  useEffect(() => {
    function outside(
      event: MouseEvent,
    ) {
      if (
        open &&
        rootRef.current &&
        !rootRef.current.contains(
          event.target as Node,
        )
      ) {
        close()
      }
    }

    function escape(
      event: KeyboardEvent,
    ) {
      if (
        open &&
        event.key ===
          'Escape'
      ) {
        close()
      }
    }

    document.addEventListener(
      'mousedown',
      outside,
    )

    document.addEventListener(
      'keydown',
      escape,
    )

    return () => {
      document.removeEventListener(
        'mousedown',
        outside,
      )

      document.removeEventListener(
        'keydown',
        escape,
      )
    }
  }, [open])


  function normalizeUserId(
    value: string,
  ) {
    const v =
      value.trim()

    if (!v) {
      return ''
    }

    if (
      v.startsWith('@') &&
      v.includes(':')
    ) {
      return v
    }

    if (
      v.startsWith('@')
    ) {
      return (
        `${v}:${serverName}`
      )
    }

    return (
      `@${v}:${serverName}`
    )
  }


  async function invite(
    event: FormEvent,
  ) {
    event.preventDefault()

    const userId =
      normalizeUserId(
        username,
      )

    if (!userId) {
      setError(
        'Enter a username.',
      )
      return
    }

    const existing =
      room.getMember(
        userId,
      )

    if (
      existing?.membership ===
        'join'
    ) {
      setError(
        `${userId} is already in this conversation.`,
      )
      return
    }

    if (
      existing?.membership ===
        'invite'
    ) {
      setError(
        `${userId} already has an invitation.`,
      )
      return
    }

    setBusy(true)
    setError('')
    setSuccess('')

    try {
      await client.invite(
        room.roomId,
        userId,
      )

      setSuccess(
        `Invited ${userId}.`,
      )

      setUsername('')

    } catch (err) {
      console.error(
        'Invitation failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to invite user.',
      )

    } finally {
      setBusy(false)
    }
  }


  const excluded =
    room
      .getMembers()
      .filter(
        (member) =>
          member.membership ===
            'join' ||
          member.membership ===
            'invite',
      )
      .map(
        (member) =>
          member.userId,
      )


  return (
    <div
      className="room-invite"
      ref={rootRef}
    >
      <button
        type="button"
        className="room-invite-button"
        onClick={() => {
          setOpen(
            !open,
          )

          setError('')
          setSuccess('')
        }}
      >
        + Add people
      </button>

      {open && (
        <div
          className="room-invite-popover"
        >
          <div
            className="room-invite-title"
          >
            Add people
          </div>

          <form
            onSubmit={invite}
          >
            <UserDirectoryPicker
              client={client}
              value={username}
              onChange={(value) => {
                setUsername(
                  value,
                )

                setError('')
                setSuccess('')
              }}
              excludedUserIds={
                excluded
              }
              disabled={busy}
              autoFocus
              placeholder="Search by name or username..."
            />

            {error && (
              <div
                className="room-invite-error"
              >
                {error}
              </div>
            )}

            {success && (
              <div
                className="room-invite-success"
              >
                {success}
              </div>
            )}

            <div
              className="room-invite-actions"
            >
              <button
                type="button"
                className="secondary"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={
                  busy ||
                  !username.trim()
                }
              >
                {busy
                  ? 'Inviting...'
                  : 'Invite'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
