import {
  useEffect,
  useRef,
  useState,
} from 'react'

import * as sdk from 'matrix-js-sdk'

import {
  isDirectConversation,
} from './Attention'


import {
  DC_OPS,
  REMINDER_BOT,
} from './Config'


type Props = {
  client: sdk.MatrixClient
  room: sdk.Room
  roomLabel: string
  onRemoved: (
    roomId: string,
  ) => void
}


type BotMembership =
  | 'join'
  | 'invite'
  | 'leave'
  | 'ban'
  | 'knock'
  | null


function getPowerLevel(
  room: sdk.Room,
  userId: string,
) {
  const event =
    room.currentState
      .getStateEvents(
        sdk.EventType
          .RoomPowerLevels,
        '',
      ) as
        sdk.MatrixEvent |
        null

  const content =
    event?.getContent() as
      Record<string, any> |
      undefined

  const users =
    (
      content?.users ||
      {}
    ) as
      Record<
        string,
        number
      >

  const usersDefault =
    typeof
      content?.users_default ===
      'number'
      ? content
          .users_default
      : 0

  return (
    users[userId] ??
    usersDefault
  )
}


function canKickUser(
  client: sdk.MatrixClient,
  room: sdk.Room,
  targetUserId: string,
) {
  const me =
    client.getUserId()

  if (!me) {
    return false
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

  const content =
    event?.getContent() as
      Record<string, any> |
      undefined

  const kickRequired =
    typeof
      content?.kick ===
      'number'
      ? content.kick
      : 50

  const myPower =
    getPowerLevel(
      room,
      me,
    )

  const targetPower =
    getPowerLevel(
      room,
      targetUserId,
    )

  return (
    myPower >=
      kickRequired &&
    myPower >
      targetPower
  )
}


export default function RoomActions({
  client,
  room,
  roomLabel,
  onRemoved,
}: Props) {
  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    )

  const [
    menuOpen,
    setMenuOpen,
  ] = useState(false)

  const [
    leaveOpen,
    setLeaveOpen,
  ] = useState(false)

  const [
    deleteOpen,
    setDeleteOpen,
  ] = useState(false)

  const [
    confirmName,
    setConfirmName,
  ] = useState('')

  const [
    busy,
    setBusy,
  ] = useState(false)

  const [
    botBusy,
    setBotBusy,
  ] = useState(false)

  const [
    dcOpsBusy,
    setDcOpsBusy,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState('')

  const [
    botMembership,
    setBotMembership,
  ] =
    useState<BotMembership>(
      null,
    )

  const [
    dcOpsMembership,
    setDcOpsMembership,
  ] =
    useState<BotMembership>(
      null,
    )

  const [
    botCanBeRemoved,
    setBotCanBeRemoved,
  ] =
    useState(false)

  const [
    dcOpsCanBeRemoved,
    setDcOpsCanBeRemoved,
  ] =
    useState(false)

  const direct =
    isDirectConversation(
      room,
    )


  function refreshBotState() {
    if (direct) {
      setBotMembership(null)
      setBotCanBeRemoved(false)
      return
    }

    const membership =
      room.getMember(
        REMINDER_BOT,
      )?.membership ??
      null

    setBotMembership(
      membership as
        BotMembership,
    )

    setBotCanBeRemoved(
      canKickUser(
        client,
        room,
        REMINDER_BOT,
      ),
    )
  }


  function refreshDcOpsState() {
    if (direct) {
      setDcOpsMembership(null)
      setDcOpsCanBeRemoved(false)
      return
    }

    const membership =
      room.getMember(
        DC_OPS,
      )?.membership ??
      null

    setDcOpsMembership(
      membership as
        BotMembership,
    )

    setDcOpsCanBeRemoved(
      canKickUser(
        client,
        room,
        DC_OPS,
      ),
    )
  }


  useEffect(() => {
    refreshBotState()
    refreshDcOpsState()

    const timer =
      window.setInterval(
        () => {
          refreshBotState()
          refreshDcOpsState()
        },
        1250,
      )

    return () =>
      window.clearInterval(
        timer,
      )
  }, [
    client,
    room,
    room.roomId,
    direct,
  ])


  function closeAll() {
    setMenuOpen(false)
    setLeaveOpen(false)
    setDeleteOpen(false)
    setConfirmName('')
    setError('')
  }


  useEffect(() => {
    function outside(
      event: MouseEvent,
    ) {
      if (
        rootRef.current &&
        !rootRef.current
          .contains(
            event.target as Node,
          )
      ) {
        closeAll()
      }
    }

    function escape(
      event: KeyboardEvent,
    ) {
      if (
        event.key ===
        'Escape'
      ) {
        closeAll()
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
  }, [])


  async function addReminderBot() {
    if (
      botBusy ||
      direct
    ) {
      return
    }

    setBotBusy(true)
    setError('')

    try {
      await client.invite(
        room.roomId,
        REMINDER_BOT,
      )

      setBotMembership(
        'invite',
      )

      window.setTimeout(
        refreshBotState,
        1000,
      )

      window.setTimeout(
        refreshBotState,
        2500,
      )

    } catch (err) {
      console.error(
        'Reminder Bot invitation failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to add Reminder Bot.',
      )

    } finally {
      setBotBusy(false)
    }
  }


  async function removeReminderBot() {
    if (
      botBusy ||
      direct ||
      !botCanBeRemoved
    ) {
      return
    }

    setBotBusy(true)
    setError('')

    try {
      await client.kick(
        room.roomId,
        REMINDER_BOT,
        'Reminder Bot removed from channel',
      )

      setBotMembership(
        'leave',
      )

      window.setTimeout(
        refreshBotState,
        750,
      )

    } catch (err) {
      console.error(
        'Reminder Bot removal failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to remove Reminder Bot.',
      )

    } finally {
      setBotBusy(false)
    }
  }


  async function addDcOps() {
    if (
      dcOpsBusy ||
      direct
    ) {
      return
    }

    setDcOpsBusy(true)
    setError('')

    try {
      await client.invite(
        room.roomId,
        DC_OPS,
      )

      setDcOpsMembership(
        'invite',
      )

      window.setTimeout(
        refreshDcOpsState,
        1000,
      )

      window.setTimeout(
        refreshDcOpsState,
        2500,
      )

    } catch (err) {
      console.error(
        'DC Ops invitation failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to add DC Ops.',
      )

    } finally {
      setDcOpsBusy(false)
    }
  }


  async function removeDcOps() {
    if (
      dcOpsBusy ||
      direct ||
      !dcOpsCanBeRemoved
    ) {
      return
    }

    setDcOpsBusy(true)
    setError('')

    try {
      await client.kick(
        room.roomId,
        DC_OPS,
        'DC Ops removed from channel',
      )

      setDcOpsMembership(
        'leave',
      )

      window.setTimeout(
        refreshDcOpsState,
        750,
      )

    } catch (err) {
      console.error(
        'DC Ops removal failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to remove DC Ops.',
      )

    } finally {
      setDcOpsBusy(false)
    }
  }


  async function removeForCurrentUser() {
    setBusy(true)
    setError('')

    try {
      await client.leave(
        room.roomId,
      )

      try {
        await client.forget(
          room.roomId,
        )
      } catch (err) {
        console.warn(
          'Room left but forget failed:',
          err,
        )
      }

      closeAll()

      onRemoved(
        room.roomId,
      )

    } catch (err) {
      console.error(
        direct
          ? 'Delete conversation failed:'
          : 'Leave room failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : direct
            ? 'Unable to delete conversation.'
            : 'Unable to leave channel.',
      )

    } finally {
      setBusy(false)
    }
  }


  async function deleteChannelPermanently() {
    const token =
      client.getAccessToken()

    if (!token) {
      setError(
        'No Matrix access token is available.',
      )
      return
    }

    if (
      confirmName !==
      roomLabel
    ) {
      setError(
        'Type the channel name exactly.',
      )
      return
    }

    setBusy(true)
    setError('')

    try {
      const response =
        await fetch(
          '/api/admin/delete-room',
          {
            method:
              'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                roomId:
                  room.roomId,
              }),
          },
        )

      const result =
        await response
          .json()
          .catch(
            () => ({}),
          )

      if (!response.ok) {
        const message =
          typeof
            result?.error ===
            'string'
            ? result.error
            : typeof
                result?.message ===
                'string'
              ? result.message
              : `Delete failed (${response.status})`

        throw new Error(
          message,
        )
      }

      try {
        await client.leave(
          room.roomId,
        )
      } catch (err) {
        console.debug(
          'Leave after delete:',
          err,
        )
      }

      try {
        await client.forget(
          room.roomId,
        )
      } catch (err) {
        console.debug(
          'Forget after delete:',
          err,
        )
      }

      closeAll()

      onRemoved(
        room.roomId,
      )

    } catch (err) {
      console.error(
        'Delete channel failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to delete channel.',
      )

    } finally {
      setBusy(false)
    }
  }


  const botPresent =
    botMembership ===
      'join'

  const botInvited =
    botMembership ===
      'invite'


  return (
    <div
      className="room-actions"
      ref={rootRef}
    >
      <button
        type="button"
        className="room-actions-button"
        aria-label={
          direct
            ? 'Conversation actions'
            : 'Channel actions'
        }
        onClick={() => {
          if (
            menuOpen ||
            leaveOpen ||
            deleteOpen
          ) {
            closeAll()
          } else {
            refreshBotState()
            refreshDcOpsState()
            setMenuOpen(true)
          }
        }}
      >
        •••
      </button>


      {menuOpen && (
        <div
          className="room-actions-menu"
        >
          {!direct && (
            <>
              {!botPresent &&
                !botInvited && (
                  <button
                    type="button"
                    disabled={
                      botBusy
                    }
                    onClick={() => {
                      void addReminderBot()
                    }}
                  >
                    {botBusy
                      ? '⏰ Adding Reminder Bot...'
                      : '⏰ Add Reminder Bot'}
                  </button>
                )}

              {botInvited && (
                <button
                  type="button"
                  className="room-action-muted"
                  disabled
                >
                  ⏰ Reminder Bot invited
                </button>
              )}

              {botPresent &&
                botCanBeRemoved && (
                  <button
                    type="button"
                    disabled={
                      botBusy
                    }
                    onClick={() => {
                      void removeReminderBot()
                    }}
                  >
                    {botBusy
                      ? '⏰ Removing Reminder Bot...'
                      : '⏰ Remove Reminder Bot'}
                  </button>
                )}

              {botPresent &&
                !botCanBeRemoved && (
                  <button
                    type="button"
                    className="room-action-muted"
                    disabled
                  >
                    ⏰ Reminder Bot added
                  </button>
                )}


              {dcOpsMembership !== 'join' &&
                dcOpsMembership !== 'invite' && (
                  <button
                    type="button"
                    disabled={
                      dcOpsBusy
                    }
                    onClick={() => {
                      void addDcOps()
                    }}
                  >
                    {dcOpsBusy
                      ? '🛠 Adding DC Ops...'
                      : '🛠 Add DC Ops'}
                  </button>
                )}

              {dcOpsMembership === 'invite' && (
                <button
                  type="button"
                  className="room-action-muted"
                  disabled
                >
                  🛠 DC Ops invited
                </button>
              )}

              {dcOpsMembership === 'join' &&
                dcOpsCanBeRemoved && (
                  <button
                    type="button"
                    disabled={
                      dcOpsBusy
                    }
                    onClick={() => {
                      void removeDcOps()
                    }}
                  >
                    {dcOpsBusy
                      ? '🛠 Removing DC Ops...'
                      : '🛠 Remove DC Ops'}
                  </button>
                )}

              {dcOpsMembership === 'join' &&
                !dcOpsCanBeRemoved && (
                  <button
                    type="button"
                    className="room-action-muted"
                    disabled
                  >
                    🛠 DC Ops added
                  </button>
                )}

              <div
                className="room-actions-divider"
              />

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setLeaveOpen(true)
                  setError('')
                }}
              >
                Leave channel
              </button>

              <div
                className="room-actions-divider"
              />

              <button
                type="button"
                className="danger"
                onClick={() => {
                  setMenuOpen(false)
                  setDeleteOpen(true)
                  setError('')
                }}
              >
                Delete channel
              </button>
            </>
          )}


          {direct && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                setMenuOpen(false)
                setDeleteOpen(true)
                setError('')
              }}
            >
              Delete conversation
            </button>
          )}


          {error && (
            <div
              className="room-actions-menu-error"
            >
              {error}
            </div>
          )}
        </div>
      )}


      {leaveOpen &&
        !direct && (
          <div
            className="room-actions-dialog"
          >
            <div
              className="room-actions-title"
            >
              Leave {roomLabel}?
            </div>

            <p>
              The channel will disappear from
              your conversation list. You can
              rejoin later if someone invites
              you.
            </p>

            {error && (
              <div
                className="room-actions-error"
              >
                {error}
              </div>
            )}

            <div
              className="room-actions-confirm"
            >
              <button
                type="button"
                className="secondary"
                onClick={closeAll}
                disabled={busy}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  void removeForCurrentUser()
                }}
                disabled={busy}
              >
                {busy
                  ? 'Leaving...'
                  : 'Leave channel'}
              </button>
            </div>
          </div>
        )}


      {deleteOpen &&
        direct && (
          <div
            className="room-actions-dialog delete"
          >
            <div
              className="room-actions-title"
            >
              Delete conversation?
            </div>

            <p>
              This removes the conversation
              from your DC Coms account and
              conversation list. The other
              person keeps their copy and
              existing message history.
            </p>

            {error && (
              <div
                className="room-actions-error"
              >
                {error}
              </div>
            )}

            <div
              className="room-actions-confirm"
            >
              <button
                type="button"
                className="secondary"
                onClick={closeAll}
                disabled={busy}
              >
                Cancel
              </button>

              <button
                type="button"
                className="danger-confirm"
                onClick={() => {
                  void removeForCurrentUser()
                }}
                disabled={busy}
              >
                {busy
                  ? 'Deleting...'
                  : 'Delete conversation'}
              </button>
            </div>
          </div>
        )}


      {deleteOpen &&
        !direct && (
          <div
            className="room-actions-dialog delete"
          >
            <div
              className="room-actions-title"
            >
              Delete channel permanently?
            </div>

            <p>
              This shuts down and purges the
              Matrix room for everyone. This
              requires a Synapse admin account.
            </p>

            <label>
              Type{' '}
              <strong>
                {roomLabel}
              </strong>{' '}
              to confirm

              <input
                autoFocus
                value={confirmName}
                disabled={busy}
                onChange={(event) => {
                  setConfirmName(
                    event.target.value,
                  )

                  setError('')
                }}
              />
            </label>

            {error && (
              <div
                className="room-actions-error"
              >
                {error}
              </div>
            )}

            <div
              className="room-actions-confirm"
            >
              <button
                type="button"
                className="secondary"
                onClick={closeAll}
                disabled={busy}
              >
                Cancel
              </button>

              <button
                type="button"
                className="danger-confirm"
                onClick={() => {
                  void deleteChannelPermanently()
                }}
                disabled={
                  busy ||
                  confirmName !==
                    roomLabel
                }
              >
                {busy
                  ? 'Deleting...'
                  : 'Delete permanently'}
              </button>
            </div>
          </div>
        )}
    </div>
  )
}
