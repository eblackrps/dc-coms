import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import * as sdk from 'matrix-js-sdk'

type MentionSuggestion = {
  userId: string
  displayName: string
  token: string
}

type Props = {
  client: sdk.MatrixClient | null
  roomId: string | null
  currentUserId: string
  value: string
  placeholder: string
  disabled: boolean
  onChange: (value: string) => void
  onPasteFiles: (files: File[]) => void
}

const MentionComposerInput =
  forwardRef<HTMLInputElement, Props>(
    function MentionComposerInput(
      {
        client,
        roomId,
        currentUserId,
        value,
        placeholder,
        disabled,
        onChange,
        onPasteFiles,
      },
      ref,
    ) {
      const inputRef =
        useRef<HTMLInputElement>(null)

      const [
        suggestions,
        setSuggestions,
      ] = useState<MentionSuggestion[]>([])

      const [
        selectedIndex,
        setSelectedIndex,
      ] = useState(0)

      const [
        mentionRange,
        setMentionRange,
      ] = useState<{
        start: number
        end: number
      } | null>(null)

      useImperativeHandle(
        ref,
        () =>
          inputRef.current as HTMLInputElement,
      )

      function closeSuggestions() {
        setSuggestions([])
        setSelectedIndex(0)
        setMentionRange(null)
      }

      function refreshSuggestions(
        nextValue: string,
        cursor: number | null,
      ) {
        if (
          !client ||
          !roomId ||
          cursor === null
        ) {
          closeSuggestions()
          return
        }

        const beforeCursor =
          nextValue.slice(0, cursor)

        /*
         * Trigger only when @ begins the
         * message or follows whitespace.
         * This avoids email addresses.
         */
        const match =
          beforeCursor.match(
            /(^|\s)@([A-Za-z0-9._=+\-]*)$/,
          )

        if (!match) {
          closeSuggestions()
          return
        }

        const room =
          client.getRoom(roomId)

        if (!room) {
          closeSuggestions()
          return
        }

        const query =
          match[2].toLowerCase()

        const start =
          (match.index ?? 0) +
          match[1].length

        const nextSuggestions =
          room
            .getJoinedMembers()
            .filter(
              (member) =>
                member.userId !==
                currentUserId,
            )
            .map(
              (member) => {
                const token =
                  member.userId
                    .split(':')[0]

                const displayName =
                  member.rawDisplayName ||
                  member.name ||
                  member.userId

                return {
                  userId:
                    member.userId,
                  displayName,
                  token,
                }
              },
            )
            .filter(
              (member) => {
                if (!query) {
                  return true
                }

                const local =
                  member.token
                    .slice(1)
                    .toLowerCase()

                return (
                  local.includes(query) ||
                  member.displayName
                    .toLowerCase()
                    .includes(query) ||
                  member.userId
                    .toLowerCase()
                    .includes(query)
                )
              },
            )
            .sort(
              (a, b) =>
                a.displayName.localeCompare(
                  b.displayName,
                ),
            )
            .slice(0, 6)

        if (
          nextSuggestions.length === 0
        ) {
          closeSuggestions()
          return
        }

        setSuggestions(
          nextSuggestions,
        )

        setSelectedIndex(0)

        setMentionRange({
          start,
          end: cursor,
        })
      }

      function insertMention(
        suggestion:
          MentionSuggestion,
      ) {
        if (!mentionRange) {
          return
        }

        const currentValue =
          inputRef.current?.value ??
          value

        const insertion =
          `${suggestion.token} `

        const nextValue =
          currentValue.slice(
            0,
            mentionRange.start,
          ) +
          insertion +
          currentValue.slice(
            mentionRange.end,
          )

        const cursor =
          mentionRange.start +
          insertion.length

        onChange(nextValue)
        closeSuggestions()

        window.setTimeout(
          () => {
            const input =
              inputRef.current

            input?.focus()

            input?.setSelectionRange(
              cursor,
              cursor,
            )
          },
          0,
        )
      }

      useEffect(
        () => {
          closeSuggestions()
        },
        [roomId],
      )

      return (
        <>
          {suggestions.length > 0 && (
            <div
              className="mention-suggestions"
              role="listbox"
              aria-label="Mention someone"
            >
              {suggestions.map(
                (
                  suggestion,
                  index,
                ) => (
                  <button
                    key={
                      suggestion.userId
                    }
                    type="button"
                    role="option"
                    aria-selected={
                      index ===
                      selectedIndex
                    }
                    className={
                      index ===
                      selectedIndex
                        ? 'mention-suggestion selected'
                        : 'mention-suggestion'
                    }
                    onMouseDown={(
                      event,
                    ) => {
                      event.preventDefault()

                      insertMention(
                        suggestion,
                      )
                    }}
                  >
                    <strong>
                      {
                        suggestion
                          .displayName
                      }
                    </strong>

                    <span>
                      {
                        suggestion
                          .token
                      }
                    </span>
                  </button>
                ),
              )}
            </div>
          )}

          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onKeyDown={(event) => {
              if (
                suggestions.length === 0
              ) {
                return
              }

              if (
                event.key ===
                'ArrowDown'
              ) {
                event.preventDefault()

                setSelectedIndex(
                  (current) =>
                    (
                      current + 1
                    ) %
                    suggestions.length,
                )

                return
              }

              if (
                event.key ===
                'ArrowUp'
              ) {
                event.preventDefault()

                setSelectedIndex(
                  (current) =>
                    (
                      current -
                      1 +
                      suggestions.length
                    ) %
                    suggestions.length,
                )

                return
              }

              if (
                (
                  event.key ===
                    'Enter' ||
                  event.key ===
                    'Tab'
                ) &&
                !event.nativeEvent
                  .isComposing
              ) {
                event.preventDefault()

                const suggestion =
                  suggestions[
                    selectedIndex
                  ]

                if (suggestion) {
                  insertMention(
                    suggestion,
                  )
                }

                return
              }

              if (
                event.key ===
                'Escape'
              ) {
                event.preventDefault()
                closeSuggestions()
              }
            }}
            onChange={(event) => {
              const next =
                event.target.value

              onChange(next)

              refreshSuggestions(
                next,
                event.target
                  .selectionStart,
              )
            }}
            onPaste={(event) => {
              const files =
                Array.from(
                  event.clipboardData.files,
                )

              if (files.length > 0) {
                event.preventDefault()
                onPasteFiles(files)
              }
            }}
          />
        </>
      )
    },
  )

export default MentionComposerInput
