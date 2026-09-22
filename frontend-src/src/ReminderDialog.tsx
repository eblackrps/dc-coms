import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import {
  createPortal,
} from 'react-dom'

import * as sdk from 'matrix-js-sdk'

import {
  isDirectConversation,
} from './Attention'


import {
  REMINDER_BOT,
} from './Config'


type ReminderMode =
  | 'personal'
  | 'channel'


type Props = {
  client: sdk.MatrixClient
  roomId: string
  eventId: string
  sourceText: string
  onClose: () => void
}


function compactText(
  value: string,
  limit: number,
) {
  return value
    .replace(
      /\s+/g,
      ' ',
    )
    .trim()
    .slice(
      0,
      limit,
    )
}


function sleep(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        milliseconds,
      )
    },
  )
}


function reminderDmCandidate(
  room: sdk.Room,
  currentUserId: string,
) {
  if (
    room.getMyMembership() !==
      'join' ||
    !isDirectConversation(
      room,
    )
  ) {
    return false
  }

  const peers =
    room
      .getMembers()
      .filter(
        (member) =>
          member.userId !==
            currentUserId &&
          (
            member.membership ===
              'join' ||
            member.membership ===
              'invite'
          ),
      )

  return (
    peers.length === 1 &&
    peers[0].userId ===
      REMINDER_BOT
  )
}


async function waitForBotJoin(
  client: sdk.MatrixClient,
  roomId: string,
) {
  for (
    let attempt = 0;
    attempt < 40;
    attempt += 1
  ) {
    const room =
      client.getRoom(
        roomId,
      )

    const member =
      room?.getMember(
        REMINDER_BOT,
      )

    if (
      member?.membership ===
      'join'
    ) {
      return
    }

    await sleep(
      500,
    )
  }

  throw new Error(
    'Reminder Bot has not joined the private conversation yet. Try again in a few seconds.',
  )
}


async function ensureReminderDm(
  client: sdk.MatrixClient,
) {
  const currentUserId =
    client.getUserId()

  if (!currentUserId) {
    throw new Error(
      'Your Matrix session is unavailable.',
    )
  }

  const existing =
    client
      .getRooms()
      .filter(
        (room) =>
          reminderDmCandidate(
            room,
            currentUserId,
          ),
      )
      .sort(
        (a, b) =>
          b.getLastActiveTimestamp() -
          a.getLastActiveTimestamp(),
      )[0]

  if (existing) {
    const botMember =
      existing.getMember(
        REMINDER_BOT,
      )

    if (
      botMember?.membership !==
      'join'
    ) {
      await waitForBotJoin(
        client,
        existing.roomId,
      )
    }

    return existing.roomId
  }

  const result =
    await client.createRoom({
      preset:
        sdk.Preset.PrivateChat,

      invite: [
        REMINDER_BOT,
      ],

      is_direct:
        true,

      initial_state: [
        {
          type:
            sdk.EventType
              .RoomEncryption,

          state_key:
            '',

          content: {
            algorithm:
              'm.megolm.v1.aes-sha2',
          },
        },
      ],
    })

  await waitForBotJoin(
    client,
    result.room_id,
  )

  return result.room_id
}


export default function ReminderDialog({
  client,
  roomId,
  eventId,
  sourceText,
  onClose,
}: Props) {
  const sourceRoom =
    client.getRoom(
      roomId,
    )

  const sourceIsDirect =
    Boolean(
      sourceRoom &&
      isDirectConversation(
        sourceRoom,
      ),
    )

  const sourcePreview =
    useMemo(
      () =>
        compactText(
          sourceText,
          800,
        ),
      [
        sourceText,
      ],
    )

  const [
    mode,
    setMode,
  ] =
    useState<ReminderMode>(
      'personal',
    )

  const [
    when,
    setWhen,
  ] =
    useState('')

  const [
    reminderText,
    setReminderText,
  ] =
    useState(
      sourcePreview,
    )

  const [
    busy,
    setBusy,
  ] =
    useState(false)

  const [
    error,
    setError,
  ] =
    useState('')

  const [
    success,
    setSuccess,
  ] =
    useState('')


  useEffect(() => {
    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        event.key ===
          'Escape' &&
        !busy
      ) {
        onClose()
      }
    }

    document.addEventListener(
      'keydown',
      onKeyDown,
    )

    return () => {
      document.removeEventListener(
        'keydown',
        onKeyDown,
      )
    }
  }, [
    busy,
    onClose,
  ])


  async function schedule(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (busy) {
      return
    }

    const scheduleText =
      compactText(
        when,
        160,
      )

    const text =
      compactText(
        reminderText ||
          sourcePreview,
        1000,
      )

    if (!scheduleText) {
      setError(
        'Enter when you want the reminder.',
      )

      return
    }

    if (!text) {
      setError(
        'Enter what the reminder is for.',
      )

      return
    }

    if (
      mode ===
        'channel' &&
      sourceIsDirect
    ) {
      setError(
        'Shared channel reminders are not available inside a direct conversation. Use Personal instead.',
      )

      return
    }

    setBusy(
      true,
    )

    setError(
      '',
    )

    setSuccess(
      '',
    )

    try {
      let deliveryRoomId =
        roomId

      const content:
        Record<string, any> = {
        msgtype:
          sdk.MsgType.Text,

        body:
          `!remindme ${scheduleText} ${text}`,
      }

      if (
        mode ===
        'personal'
      ) {
        deliveryRoomId =
          await ensureReminderDm(
            client,
          )

        content[
          'com.dccoms.reminder.request'
        ] = {
          mode:
            'personal',

          origin_room_id:
            roomId,

          origin_event_id:
            eventId,

          origin_preview:
            sourcePreview,
        }
      } else {
        const room =
          client.getRoom(
            roomId,
          )

        const bot =
          room?.getMember(
            REMINDER_BOT,
          )

        if (
          bot?.membership !==
          'join'
        ) {
          throw new Error(
            'Reminder Bot is not in this channel. Add it from the channel three-dot menu first.',
          )
        }

        /*
         * A shared reminder request is an actual
         * Matrix reply to the source message.
         * Reminder Bot can therefore preserve the
         * original event as its context target.
         */
        content[
          'm.relates_to'
        ] = {
          'm.in_reply_to': {
            event_id:
              eventId,
          },
        }

        content[
          'com.dccoms.reminder.request'
        ] = {
          mode:
            'channel',
        }
      }

      await client.sendEvent(
        deliveryRoomId,
        sdk.EventType.RoomMessage,
        content as any,
      )

      if (
        mode ===
        'personal'
      ) {
        setSuccess(
          'Personal reminder sent privately to Reminder Bot. It will fire in your Reminder Bot conversation.',
        )
      } else {
        setSuccess(
          'Channel reminder sent. Reminder Bot will post it back into this channel.',
        )
      }

    } catch (err) {
      console.error(
        'Reminder creation failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create reminder.',
      )

    } finally {
      setBusy(
        false,
      )
    }
  }


  return createPortal(
    <div
      className="reminder-dialog-overlay"
      onMouseDown={(
        event,
      ) => {
        if (
          event.target ===
            event.currentTarget &&
          !busy
        ) {
          onClose()
        }
      }}
    >
      <form
        className="reminder-dialog"
        onSubmit={
          schedule
        }
      >
        <div className="reminder-dialog-header">
          <div>
            <div className="reminder-dialog-eyebrow">
              REMINDER BOT
            </div>

            <h2>
              Remind me
            </h2>

            <p>
              Create a private reminder or post one back into this channel.
            </p>
          </div>

          <button
            type="button"
            className="reminder-dialog-close"
            disabled={
              busy
            }
            onClick={
              onClose
            }
            aria-label="Close"
          >
            ×
          </button>
        </div>


        <div className="reminder-source-block">
          <span>
            Original message
          </span>

          <strong>
            {sourcePreview}
          </strong>
        </div>


        <div className="reminder-mode-grid">
          <label
            className={
              mode ===
                'personal'
                ? 'reminder-mode selected'
                : 'reminder-mode'
            }
          >
            <input
              type="radio"
              name="reminder-mode"
              value="personal"
              checked={
                mode ===
                'personal'
              }
              disabled={
                busy
              }
              onChange={() => {
                setMode(
                  'personal',
                )

                setError(
                  '',
                )

                setSuccess(
                  '',
                )
              }}
            />

            <div>
              <strong>
                Personal
              </strong>

              <span>
                Private. Only you and Reminder Bot see it.
              </span>
            </div>
          </label>


          <label
            className={
              mode ===
                'channel'
                ? 'reminder-mode selected'
                : 'reminder-mode'
            }
          >
            <input
              type="radio"
              name="reminder-mode"
              value="channel"
              checked={
                mode ===
                'channel'
              }
              disabled={
                busy ||
                sourceIsDirect
              }
              onChange={() => {
                setMode(
                  'channel',
                )

                setError(
                  '',
                )

                setSuccess(
                  '',
                )
              }}
            />

            <div>
              <strong>
                Channel
              </strong>

              <span>
                Shared. Reminder Bot posts it back here.
              </span>
            </div>
          </label>
        </div>


        {sourceIsDirect && (
          <div className="reminder-dialog-note">
            Direct conversations use personal reminders so Reminder Bot is not added as a third participant.
          </div>
        )}


        <label className="reminder-dialog-field">
          <span>
            When
          </span>

          <input
            autoFocus
            value={
              when
            }
            disabled={
              busy
            }
            onChange={(
              event,
            ) => {
              setWhen(
                event.target.value,
              )

              setError(
                '',
              )

              setSuccess(
                '',
              )
            }}
            placeholder="20m, tomorrow 9am, Friday 3pm..."
          />
        </label>


        <label className="reminder-dialog-field">
          <span>
            Reminder text
          </span>

          <textarea
            rows={3}
            value={
              reminderText
            }
            disabled={
              busy
            }
            onChange={(
              event,
            ) => {
              setReminderText(
                event.target.value,
              )

              setError(
                '',
              )

              setSuccess(
                '',
              )
            }}
          />
        </label>


        {error && (
          <div className="reminder-dialog-error">
            {error}
          </div>
        )}


        {success && (
          <div className="reminder-dialog-success">
            {success}
          </div>
        )}


        <div className="reminder-dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={
              busy
            }
            onClick={
              onClose
            }
          >
            {success
              ? 'Done'
              : 'Cancel'}
          </button>

          <button
            type="submit"
            disabled={
              busy ||
              Boolean(
                success,
              )
            }
          >
            {busy
              ? 'Creating...'
              : mode ===
                  'personal'
                ? 'Create private reminder'
                : 'Create channel reminder'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
