import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import * as sdk from 'matrix-js-sdk'

import {
  QUICK_REACTIONS,
  STANDARD_REACTIONS,
  getReactionDefinition,
  getReactionLabel,
  type DcReactionDefinition,
} from './Reactions'

import PinMessageAction from './PinMessageAction'
import ReminderDialog from './ReminderDialog'

/* DC COMS REMINDER UI V1 */

export type DcReactionSummary = {
  key: string
  count: number
  mine: boolean
  mineEventId?: string
}

export type DcReplyTarget = {
  eventId: string
  sender: string
  displayName: string
  body: string
  kind: 'text' | 'image' | 'file'
}

type Props = {
  client: sdk.MatrixClient
  roomId: string
  eventId: string
  sender: string
  displayName: string
  body: string
  kind: 'text' | 'image' | 'file'
  reactions: DcReactionSummary[]
  mine: boolean
  editable: boolean
  onChanged: () => void
  onReply: (
    target: DcReplyTarget,
  ) => void
}

function ReactionVisual({
  reaction,
  compact = false,
}: {
  reaction: DcReactionDefinition
  compact?: boolean
}) {
  if (reaction.image) {
    return (
      <img
        className={
          compact
            ? 'doom-reaction-image compact'
            : 'doom-reaction-image'
        }
        src={reaction.image}
        alt={reaction.label}
        draggable={false}
      />
    )
  }

  return (
    <span
      className={
        compact
          ? 'reaction-emoji compact'
          : 'reaction-emoji'
      }
    >
      {reaction.key}
    </span>
  )
}

export default function MessageActions({
  client,
  roomId,
  eventId,
  sender,
  displayName,
  body,
  kind,
  reactions,
  mine,
  editable,
  onChanged,
  onReply,
}: Props) {
  const rootRef =
    useRef<HTMLDivElement | null>(null)

  const [pickerOpen, setPickerOpen] =
    useState(false)

  const [busyKey, setBusyKey] =
    useState<string | null>(null)

  const [error, setError] =
    useState('')

  const [moreOpen, setMoreOpen] =
    useState(false)

  const [editOpen, setEditOpen] =
    useState(false)

  const [editDraft, setEditDraft] =
    useState(body)

  const [editBusy, setEditBusy] =
    useState(false)

  const [deleteOpen, setDeleteOpen] =
    useState(false)

  const [deleteBusy, setDeleteBusy] =
    useState(false)

  const [
    lifecycleError,
    setLifecycleError,
  ] = useState('')

  const [copyState, setCopyState] =
    useState('Copy text')

  const [
    linkCopyState,
    setLinkCopyState,
  ] = useState('Copy link')

  const [remindOpen, setRemindOpen] =
    useState(false)

  async function copyMessageLink() {
    try {
      const url =
        new URL(
          window.location.origin +
          window.location.pathname,
        )

      url.searchParams.set(
        'room',
        roomId,
      )

      url.searchParams.set(
        'event',
        eventId,
      )

      await navigator.clipboard.writeText(
        url.toString(),
      )

      setLinkCopyState(
        'Link copied',
      )

      window.setTimeout(
        () => {
          setLinkCopyState(
            'Copy link',
          )
        },
        1600,
      )
    } catch (err) {
      console.error(
        'Unable to copy message link:',
        err,
      )

      setLinkCopyState(
        'Copy failed',
      )

      window.setTimeout(
        () => {
          setLinkCopyState(
            'Copy link',
          )
        },
        1600,
      )
    }
  }


  function closePicker() {
    setPickerOpen(false)
    setError('')
  }

  useEffect(() => {
    function onMouseDown(
      event: MouseEvent,
    ) {
      const root = rootRef.current

      if (
        pickerOpen &&
        root &&
        !root.contains(
          event.target as Node,
        )
      ) {
        closePicker()
      }
    }

    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        pickerOpen &&
        event.key === 'Escape'
      ) {
        closePicker()
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
  }, [pickerOpen])

  useEffect(() => {
    function onMouseDown(
      event: MouseEvent,
    ) {
      const root = rootRef.current

      if (
        moreOpen &&
        root &&
        !root.contains(
          event.target as Node,
        )
      ) {
        setMoreOpen(false)
      }
    }

    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (event.key !== 'Escape') {
        return
      }

      if (moreOpen) {
        setMoreOpen(false)
      }

      if (
        editOpen &&
        !editBusy
      ) {
        setEditOpen(false)
        setEditDraft(body)
        setLifecycleError('')
      }

      if (
        deleteOpen &&
        !deleteBusy
      ) {
        setDeleteOpen(false)
        setLifecycleError('')
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
  }, [
    moreOpen,
    editOpen,
    deleteOpen,
    editBusy,
    deleteBusy,
    body,
  ])

  async function toggleReaction(
    key: string,
  ) {
    if (busyKey) return

    setBusyKey(key)
    setError('')

    try {
      const existing =
        reactions.find(
          (reaction) =>
            reaction.key === key,
        )

      if (
        existing?.mine &&
        existing.mineEventId
      ) {
        await client.redactEvent(
          roomId,
          existing.mineEventId,
        )
      } else {
        await client.sendEvent(
          roomId,
          sdk.EventType.Reaction,
          {
            'm.relates_to': {
              rel_type:
                sdk.RelationType
                  .Annotation,
              event_id: eventId,
              key,
            },
          },
        )
      }

      closePicker()
    } catch (err) {
      console.error(
        'Reaction failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to react.',
      )
    } finally {
      setBusyKey(null)
    }
  }

  function isEmojiOnly(
    value: string,
  ) {
    const compact =
      value.replace(/\s+/g, '')

    if (
      !compact ||
      compact.length > 32
    ) {
      return false
    }

    const remainder =
      compact.replace(
        /[\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\u20E3]/gu,
        '',
      )

    return remainder.length === 0
  }

  async function copyMessage() {
    setLifecycleError('')

    try {
      await navigator.clipboard
        .writeText(body)

      setCopyState('Copied')

      setMoreOpen(false)

      window.setTimeout(
        () => {
          setCopyState('Copy text')
        },
        1400,
      )
    } catch (err) {
      console.error(
        'Copy message failed:',
        err,
      )

      setLifecycleError(
        'Unable to copy message text.',
      )
    }
  }

  function beginEdit() {
    if (
      !mine ||
      !editable
    ) {
      return
    }

    setMoreOpen(false)
    setPickerOpen(false)
    setDeleteOpen(false)

    setEditDraft(body)
    setLifecycleError('')
    setEditOpen(true)
  }

  function cancelEdit() {
    if (editBusy) return

    setEditDraft(body)
    setLifecycleError('')
    setEditOpen(false)
  }

  async function saveEdit(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (
      !mine ||
      !editable ||
      editBusy
    ) {
      return
    }

    const next =
      editDraft.trim()

    if (!next) {
      setLifecycleError(
        'A message cannot be empty.',
      )
      return
    }

    if (next === body) {
      setEditOpen(false)
      setLifecycleError('')
      return
    }

    setEditBusy(true)
    setLifecycleError('')

    try {
      const newContent:
        Record<string, any> = {
        msgtype:
          sdk.MsgType.Text,
        body: next,
      }

      if (isEmojiOnly(next)) {
        newContent[
          'com.dccoms.big_emoji'
        ] = true
      }

      await client.sendEvent(
        roomId,
        sdk.EventType.RoomMessage,
        {
          msgtype:
            sdk.MsgType.Text,

          body:
            `* ${next}`,

          'm.new_content':
            newContent,

          'm.relates_to': {
            rel_type:
              'm.replace',

            event_id:
              eventId,
          },
        } as any,
      )

      setEditOpen(false)
      setEditDraft(next)

      onChanged()
    } catch (err) {
      console.error(
        'Message edit failed:',
        err,
      )

      setLifecycleError(
        err instanceof Error
          ? err.message
          : 'Unable to edit message.',
      )
    } finally {
      setEditBusy(false)
    }
  }

  function beginDelete() {
    if (!mine) return

    setMoreOpen(false)
    setPickerOpen(false)
    setEditOpen(false)

    setLifecycleError('')
    setDeleteOpen(true)
  }

  function cancelDelete() {
    if (deleteBusy) return

    setLifecycleError('')
    setDeleteOpen(false)
  }

  async function deleteMessage() {
    if (
      !mine ||
      deleteBusy
    ) {
      return
    }

    setDeleteBusy(true)
    setLifecycleError('')

    try {
      await client.redactEvent(
        roomId,
        eventId,
      )

      setDeleteOpen(false)

      onChanged()
    } catch (err) {
      console.error(
        'Message deletion failed:',
        err,
      )

      setLifecycleError(
        err instanceof Error
          ? err.message
          : 'Unable to delete message.',
      )
    } finally {
      setDeleteBusy(false)
    }
  }

  function renderReactionButton(
    reaction: DcReactionDefinition,
  ) {
    return (
      <button
        type="button"
        key={reaction.key}
        title={reaction.label}
        aria-label={reaction.label}
        disabled={busyKey !== null}
        className={
          reaction.image
            ? 'reaction-picker-item graphical'
            : 'reaction-picker-item'
        }
        onClick={() =>
          void toggleReaction(
            reaction.key,
          )
        }
      >
        <ReactionVisual
          reaction={reaction}
        />

        <small>
          {reaction.label}
        </small>
      </button>
    )
  }

  return (
    <div
      className="message-interactions"
      ref={rootRef}
    >
      <div className="message-actions">
        <button
          type="button"
          onClick={() =>
            onReply({
              eventId,
              sender,
              displayName,
              body,
              kind,
            })
          }
          title="Reply"
        >
          ↩ Reply
        </button>

        <button
          type="button"
          onClick={() => {
            setMoreOpen(false)

            setPickerOpen(
              !pickerOpen,
            )

            setError('')
          }}
          title="React"
        >
          😄 React
        </button>

        <div
          className="message-more-wrap"
        >
          <button
            type="button"
            title="More actions"
            onClick={() => {
              setPickerOpen(false)

              setMoreOpen(
                !moreOpen,
              )

              setLifecycleError('')
            }}
          >
            ••• More
          </button>

          {moreOpen && (
            <div
              className="message-more-menu"
            >
              <button
                type="button"
                onClick={() => {
                  void copyMessage()
                }}
              >
                {copyState}
              </button>

              <button
                type="button"
                onClick={() => {
                  void copyMessageLink()
                }}
              >
                {linkCopyState}
              </button>

              <button

                type="button"

                onClick={() => {

                  setMoreOpen(false)

                  setPickerOpen(false)

                  setLifecycleError('')

                  setRemindOpen(true)

                }}

              >

                ⏰ Remind me

              </button>


              <PinMessageAction
                client={client}
                roomId={roomId}
                eventId={eventId}
              />

              {mine &&
                editable && (
                  <button
                    type="button"
                    onClick={
                      beginEdit
                    }
                  >
                    Edit message
                  </button>
                )}

              {mine && (
                <button
                  type="button"
                  className="danger"
                  onClick={
                    beginDelete
                  }
                >
                  Delete message
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {remindOpen && (

        <ReminderDialog

          client={client}

          roomId={roomId}

          eventId={eventId}

          sourceText={body}

          onClose={() => {

            setRemindOpen(false)

          }}

        />

      )}


      {editOpen && (
        <form
          className="message-edit-panel"
          onSubmit={saveEdit}
        >
          <textarea
            value={editDraft}
            autoFocus
            rows={3}
            disabled={editBusy}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent
                  .isComposing
              ) {
                event.preventDefault()

                event.currentTarget
                  .form
                  ?.requestSubmit()
              }
            }}
            onChange={(event) =>
              setEditDraft(
                event.target.value,
              )
            }
          />

          <div
            className="message-edit-actions"
          >
            <button
              type="button"
              className="secondary"
              disabled={editBusy}
              onClick={cancelEdit}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                editBusy ||
                !editDraft.trim()
              }
            >
              {editBusy
                ? 'Saving...'
                : 'Save edit'}
            </button>
          </div>
        </form>
      )}

      {deleteOpen && (
        <div
          className="message-delete-confirm"
        >
          <div>
            <strong>
              Delete this message?
            </strong>

            <span>
              This will redact the
              message from the Matrix
              room.
            </span>
          </div>

          <div
            className="message-delete-actions"
          >
            <button
              type="button"
              className="secondary"
              disabled={deleteBusy}
              onClick={
                cancelDelete
              }
            >
              Cancel
            </button>

            <button
              type="button"
              className="danger"
              disabled={deleteBusy}
              onClick={() => {
                void deleteMessage()
              }}
            >
              {deleteBusy
                ? 'Deleting...'
                : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {lifecycleError && (
        <div
          className="message-lifecycle-error"
        >
          {lifecycleError}
        </div>
      )}

      {reactions.length > 0 && (
        <div className="reaction-chips">
          {reactions.map(
            (reaction) => {
              const definition =
                getReactionDefinition(
                  reaction.key,
                )

              return (
                <button
                  type="button"
                  key={reaction.key}
                  className={
                    reaction.mine
                      ? 'reaction-chip mine'
                      : 'reaction-chip'
                  }
                  title={
                    getReactionLabel(
                      reaction.key,
                    )
                  }
                  aria-pressed={
                    reaction.mine
                  }
                  disabled={
                    busyKey ===
                    reaction.key
                  }
                  onClick={() =>
                    void toggleReaction(
                      reaction.key,
                    )
                  }
                >
                  {definition ? (
                    <ReactionVisual
                      reaction={
                        definition
                      }
                      compact
                    />
                  ) : (
                    <span>
                      {reaction.key}
                    </span>
                  )}

                  <strong>
                    {reaction.count}
                  </strong>
                </button>
              )
            },
          )}
        </div>
      )}

      {pickerOpen && (
        <div className="doom-reaction-picker reaction-picker-v2">
          <div className="reaction-picker-header">
            Quick
          </div>

          <div className="reaction-quick-row">
            {QUICK_REACTIONS.map(
              renderReactionButton,
            )}
          </div>

          <div className="reaction-picker-header">
            More reactions
          </div>

          <div className="reaction-picker-grid standard">
            {STANDARD_REACTIONS.map(
              renderReactionButton,
            )}
          </div>

          {error && (
            <div className="reaction-error">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
