import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import * as sdk from 'matrix-js-sdk'

import {
  isDirectConversation,
} from './Attention'


type Props = {
  client: sdk.MatrixClient
  room: sdk.Room
  label: string
}


export default function ChannelName({
  client,
  room,
  label,
}: Props) {
  const [
    editing,
    setEditing,
  ] = useState(false)

  const [
    draft,
    setDraft,
  ] = useState(label)

  const [
    localName,
    setLocalName,
  ] = useState(label)

  const [
    busy,
    setBusy,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState('')

  const [
    canRename,
    setCanRename,
  ] = useState(false)

  const direct =
    isDirectConversation(
      room,
    )


  useEffect(() => {
    setLocalName(label)

    if (!editing) {
      setDraft(label)
    }
  }, [
    label,
    editing,
  ])


  useEffect(() => {
    if (direct) {
      setCanRename(false)
      return
    }

    let cancelled = false

    function refreshPermission() {
      const allowed =
        room.currentState
          .mayClientSendStateEvent(
            sdk.EventType.RoomName,
            client,
          )

      if (!cancelled) {
        setCanRename(
          allowed,
        )
      }
    }

    refreshPermission()

    const timer =
      window.setInterval(
        refreshPermission,
        1500,
      )

    return () => {
      cancelled = true

      window.clearInterval(
        timer,
      )
    }
  }, [
    client,
    room,
    room.roomId,
    direct,
  ])


  async function save(
    event: FormEvent,
  ) {
    event.preventDefault()

    const nextName =
      draft.trim()

    if (!nextName) {
      setError(
        'Channel name cannot be empty.',
      )
      return
    }

    if (
      nextName.length > 80
    ) {
      setError(
        'Keep the channel name under 80 characters.',
      )
      return
    }

    setBusy(true)
    setError('')

    try {
      await client.setRoomName(
        room.roomId,
        nextName,
      )

      setLocalName(
        nextName,
      )

      setDraft(
        nextName,
      )

      setEditing(false)

    } catch (err) {
      console.error(
        'Channel rename failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to rename channel.',
      )

    } finally {
      setBusy(false)
    }
  }


  if (direct) {
    return (
      <h2>
        {label}
      </h2>
    )
  }


  return (
    <div className="channel-name-wrap">
      <div className="channel-name-line">
        <h2>
          {localName}
        </h2>

        {canRename && (
          <button
            type="button"
            className="channel-name-edit"
            onClick={() => {
              setDraft(
                localName,
              )

              setError('')
              setEditing(
                !editing,
              )
            }}
          >
            Edit name
          </button>
        )}
      </div>

      {editing && (
        <form
          className="channel-name-editor"
          onSubmit={save}
        >
          <input
            autoFocus
            value={draft}
            maxLength={80}
            disabled={busy}
            onChange={(event) => {
              setDraft(
                event.target.value,
              )

              setError('')
            }}
          />

          {error && (
            <div className="channel-name-error">
              {error}
            </div>
          )}

          <div className="channel-name-editor-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false)
                setDraft(
                  localName,
                )
                setError('')
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                busy ||
                !draft.trim() ||
                draft.trim() ===
                  localName
              }
            >
              {busy
                ? 'Saving...'
                : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
