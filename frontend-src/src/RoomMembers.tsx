import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import * as sdk from 'matrix-js-sdk'

import {
  isDirectConversation,
} from './Attention'

type Props = {
  client: sdk.MatrixClient
  room: sdk.Room
  currentUserId: string
}

type PresenceState =
  | 'online'
  | 'away'
  | 'offline'

type MemberRow = {
  userId: string
  displayName: string
  presence: PresenceState
  statusMessage: string
  powerLevel: number
  role: string
  isSelf: boolean
}

function presenceRank(
  value: PresenceState,
) {
  if (value === 'online') {
    return 0
  }

  if (value === 'away') {
    return 1
  }

  return 2
}

function roleForPower(
  power: number,
) {
  if (power >= 100) {
    return 'Admin'
  }

  if (power >= 50) {
    return 'Moderator'
  }

  return ''
}

export default function RoomMembers({
  client,
  room,
  currentUserId,
}: Props) {
  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    )

  const [
    open,
    setOpen,
  ] =
    useState(false)

  const [
    tick,
    setTick,
  ] =
    useState(0)

  const [
    confirmUserId,
    setConfirmUserId,
  ] =
    useState<string | null>(null)

  const [
    busyUserId,
    setBusyUserId,
  ] =
    useState<string | null>(null)

  const [
    error,
    setError,
  ] =
    useState('')

  const [
    hiddenUsers,
    setHiddenUsers,
  ] =
    useState<Set<string>>(
      new Set(),
    )

  useEffect(() => {
    const timer =
      window.setInterval(
        () => {
          setTick(
            (value) =>
              value + 1,
          )
        },
        10_000,
      )

    return () => {
      window.clearInterval(
        timer,
      )
    }
  }, [])

  useEffect(() => {
    setConfirmUserId(null)
    setBusyUserId(null)
    setError('')
    setHiddenUsers(
      new Set(),
    )
  }, [room.roomId])

  useEffect(() => {
    function onMouseDown(
      event: MouseEvent,
    ) {
      const root =
        rootRef.current

      if (
        open &&
        root &&
        !root.contains(
          event.target as Node,
        )
      ) {
        setOpen(false)
        setConfirmUserId(null)
        setError('')
      }
    }

    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        open &&
        event.key ===
          'Escape'
      ) {
        setOpen(false)
        setConfirmUserId(null)
        setError('')
      }
    }

    document.addEventListener(
      'mousedown',
      onMouseDown,
    )

    document.addEventListener(
      'keydown',
      onKeyDown,
    )

    return () => {
      document.removeEventListener(
        'mousedown',
        onMouseDown,
      )

      document.removeEventListener(
        'keydown',
        onKeyDown,
      )
    }
  }, [open])

  const direct =
    isDirectConversation(
      room,
    )

  const currentMember =
    room.getMember(
      currentUserId,
    )

  const currentPower =
    Number(
      (currentMember as any)
        ?.powerLevel ?? 0,
    )

  const powerEvent =
    room.currentState
      .getStateEvents(
        sdk.EventType
          .RoomPowerLevels,
        '',
      ) as
      | sdk.MatrixEvent
      | null

  const powerContent =
    powerEvent?.getContent() as
      | Record<string, any>
      | undefined

  const kickLevel =
    typeof powerContent
      ?.kick ===
      'number'
      ? powerContent.kick
      : 50

  const canKick =
    !direct &&
    currentPower >=
      kickLevel

  const members =
    useMemo<MemberRow[]>(
      () => {
        void tick

        return room
          .getJoinedMembers()
          .filter(
            (member) =>
              !hiddenUsers.has(
                member.userId,
              ),
          )
          .map(
            (member) => {
              const user =
                client.getUser(
                  member.userId,
                ) as any

              const rawPresence =
                user?.presence

              const presence:
                PresenceState =
                user
                  ?.currentlyActive ===
                    true ||
                rawPresence ===
                  'online'
                  ? 'online'
                  : rawPresence ===
                      'unavailable'
                    ? 'away'
                    : 'offline'

              const powerLevel =
                Number(
                  (
                    member as any
                  ).powerLevel ??
                    0,
                )

              return {
                userId:
                  member.userId,

                displayName:
                  member.name ||
                  member.userId,

                presence,

                statusMessage:
                  user
                    ?.presenceStatusMsg ||
                  '',

                powerLevel,

                role:
                  roleForPower(
                    powerLevel,
                  ),

                isSelf:
                  member.userId ===
                  currentUserId,
              }
            },
          )
          .sort(
            (a, b) => {
              if (
                a.isSelf !==
                b.isSelf
              ) {
                return a.isSelf
                  ? -1
                  : 1
              }

              const presenceDiff =
                presenceRank(
                  a.presence,
                ) -
                presenceRank(
                  b.presence,
                )

              if (
                presenceDiff !== 0
              ) {
                return presenceDiff
              }

              return (
                a.displayName
                  .localeCompare(
                    b.displayName,
                  )
              )
            },
          )
      },
      [
        client,
        currentUserId,
        hiddenUsers,
        room,
        tick,
      ],
    )

  const onlineCount =
    members.filter(
      (member) =>
        member.presence ===
        'online',
    ).length

  function canRemove(
    member: MemberRow,
  ) {
    return (
      canKick &&
      !member.isSelf &&
      currentPower >
        member.powerLevel
    )
  }

  async function removeMember(
    member: MemberRow,
  ) {
    if (
      busyUserId ||
      !canRemove(member)
    ) {
      return
    }

    setBusyUserId(
      member.userId,
    )

    setError('')

    try {
      await client.kick(
        room.roomId,
        member.userId,
        'Removed from channel',
      )

      setHiddenUsers(
        (current) => {
          const next =
            new Set(
              current,
            )

          next.add(
            member.userId,
          )

          return next
        },
      )

      setConfirmUserId(
        null,
      )
    } catch (err) {
      console.error(
        'Remove member failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to remove member.',
      )
    } finally {
      setBusyUserId(
        null,
      )
    }
  }

  return (
    <div
      className="room-members-v2"
      ref={rootRef}
    >
      <button
        type="button"
        className="room-members-trigger-v2"
        onClick={() => {
          setOpen(
            !open,
          )

          setConfirmUserId(
            null,
          )

          setError('')
        }}
      >
        Members {members.length}
      </button>

      {open && (
        <div className="room-members-panel-v2">
          <div className="room-members-header-v2">
            <div>
              <strong>
                Members
              </strong>

              <span>
                {onlineCount}{' '}
                online
              </span>
            </div>

            <button
              type="button"
              aria-label="Close members"
              onClick={() =>
                setOpen(false)
              }
            >
              ×
            </button>
          </div>

          {canKick && (
            <div className="room-members-manage-note">
              Channel managers
              can remove members.
            </div>
          )}

          <div className="room-members-list-v2">
            {members.map(
              (member) => {
                const removable =
                  canRemove(
                    member,
                  )

                const confirming =
                  confirmUserId ===
                  member.userId

                const busy =
                  busyUserId ===
                  member.userId

                return (
                  <div
                    className="room-member-row-v2"
                    key={
                      member.userId
                    }
                  >
                    <div
                      className={
                        `member-presence-dot-v2 ${
                          member.presence
                        }`
                      }
                    />

                    <div className="room-member-info-v2">
                      <div className="room-member-name-v2">
                        <strong>
                          {member.isSelf
                            ? 'You'
                            : member.displayName}
                        </strong>

                        {member.role && (
                          <span className="room-member-role-v2">
                            {
                              member.role
                            }
                          </span>
                        )}
                      </div>

                      <span className="room-member-id-v2">
                        {
                          member.userId
                        }
                      </span>

                      {member.statusMessage && (
                        <span className="room-member-status-v2">
                          {
                            member.statusMessage
                          }
                        </span>
                      )}
                    </div>

                    {removable && (
                      <div className="room-member-remove-v2">
                        {!confirming ? (
                          <button
                            type="button"
                            className="member-remove-button-v2"
                            disabled={
                              busyUserId !==
                              null
                            }
                            onClick={() => {
                              setConfirmUserId(
                                member.userId,
                              )

                              setError('')
                            }}
                          >
                            Remove
                          </button>
                        ) : (
                          <div className="member-remove-confirm-v2">
                            <span>
                              Remove?
                            </span>

                            <button
                              type="button"
                              disabled={
                                busy
                              }
                              onClick={() =>
                                setConfirmUserId(
                                  null,
                                )
                              }
                            >
                              No
                            </button>

                            <button
                              type="button"
                              className="danger"
                              disabled={
                                busy
                              }
                              onClick={() => {
                                void removeMember(
                                  member,
                                )
                              }}
                            >
                              {busy
                                ? 'Removing...'
                                : 'Yes'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              },
            )}
          </div>

          {error && (
            <div className="room-members-error-v2">
              {error}
            </div>
          )}

          {canKick && (
            <div className="room-members-footer-v2">
              Removing someone
              removes them from
              this channel only.
              Their DC Coms
              account is not
              deleted.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
