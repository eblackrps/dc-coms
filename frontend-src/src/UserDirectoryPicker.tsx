import {
  useEffect,
  useState,
  type KeyboardEvent,
} from 'react'

import type {
  MatrixClient,
} from 'matrix-js-sdk'


type DirectoryUser = {
  user_id: string
  display_name?: string | null
}


type Props = {
  client: MatrixClient
  value: string
  onChange: (
    value: string,
  ) => void
  excludedUserIds?: string[]
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
}


export default function UserDirectoryPicker({
  client,
  value,
  onChange,
  excludedUserIds = [],
  disabled = false,
  autoFocus = false,
  placeholder =
    'Search users...',
}: Props) {
  const [
    results,
    setResults,
  ] = useState<DirectoryUser[]>([])

  const [
    searching,
    setSearching,
  ] = useState(false)

  const [
    selectedIndex,
    setSelectedIndex,
  ] = useState(0)

  const [
    open,
    setOpen,
  ] = useState(false)

  const excludedKey =
    excludedUserIds.join('|')


  useEffect(() => {
    const searchTerm =
      value.trim()

    if (
      disabled ||
      searchTerm.length < 2 ||
      (
        searchTerm.startsWith('@') &&
        searchTerm.includes(':')
      )
    ) {
      setResults([])
      setOpen(false)
      setSearching(false)
      return
    }

    const accessToken =
      client.getAccessToken()

    if (!accessToken) {
      return
    }

    const controller =
      new AbortController()

    const timer =
      window.setTimeout(
        async () => {
          setSearching(true)

          try {
            const response =
              await fetch(
                '/_matrix/client/v3/user_directory/search',
                {
                  method: 'POST',

                  headers: {
                    Authorization:
                      `Bearer ${accessToken}`,

                    'Content-Type':
                      'application/json',
                  },

                  body:
                    JSON.stringify({
                      search_term:
                        searchTerm,

                      limit: 8,
                    }),

                  signal:
                    controller.signal,
                },
              )

            if (!response.ok) {
              throw new Error(
                `User search returned ${response.status}`,
              )
            }

            const body =
              await response.json()

            const excluded =
              new Set(
                excludedUserIds,
              )

            const users =
              (
                Array.isArray(
                  body.results,
                )
                  ? body.results
                  : []
              )
                .filter(
                  (
                    user:
                      DirectoryUser,
                  ) =>
                    typeof
                      user.user_id ===
                      'string' &&
                    !excluded.has(
                      user.user_id,
                    ),
                )
                .slice(
                  0,
                  8,
                )

            setResults(
              users,
            )

            setSelectedIndex(0)

            setOpen(
              users.length > 0,
            )

          } catch (err) {
            if (
              !controller
                .signal
                .aborted
            ) {
              console.error(
                'User directory search failed:',
                err,
              )

              setResults([])
              setOpen(false)
            }

          } finally {
            if (
              !controller
                .signal
                .aborted
            ) {
              setSearching(false)
            }
          }
        },
        180,
      )

    return () => {
      window.clearTimeout(
        timer,
      )

      controller.abort()
    }
  }, [
    client,
    value,
    disabled,
    excludedKey,
  ])


  function choose(
    user: DirectoryUser,
  ) {
    onChange(
      user.user_id,
    )

    setResults([])
    setOpen(false)
  }


  function onKeyDown(
    event:
      KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      !open ||
      results.length === 0
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
          results.length,
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
          current <= 0
            ? results.length - 1
            : current - 1,
      )

      return
    }

    if (
      event.key ===
      'Enter'
    ) {
      const user =
        results[
          selectedIndex
        ]

      if (user) {
        event.preventDefault()
        choose(user)
      }

      return
    }

    if (
      event.key ===
      'Escape'
    ) {
      setOpen(false)
    }
  }


  return (
    <div
      className="user-directory-picker"
    >
      <input
        autoFocus={
          autoFocus
        }
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        placeholder={
          placeholder
        }
        onChange={(
          event,
        ) => {
          onChange(
            event.target.value,
          )
        }}
        onFocus={() => {
          if (
            results.length > 0
          ) {
            setOpen(true)
          }
        }}
        onKeyDown={
          onKeyDown
        }
      />

      {searching && (
        <div
          className="user-directory-searching"
        >
          Searching...
        </div>
      )}

      {open &&
        results.length > 0 && (
          <div
            className="user-directory-results"
          >
            {results.map(
              (
                user,
                index,
              ) => (
                <button
                  type="button"
                  key={
                    user.user_id
                  }
                  className={
                    index ===
                    selectedIndex
                      ? 'user-directory-result active'
                      : 'user-directory-result'
                  }
                  onMouseEnter={() => {
                    setSelectedIndex(
                      index,
                    )
                  }}
                  onMouseDown={(
                    event,
                  ) => {
                    event.preventDefault()
                    choose(user)
                  }}
                >
                  <strong>
                    {user
                      .display_name
                      ?.trim() ||
                      user
                        .user_id
                        .split(':')[0]
                        .replace(
                          /^@/,
                          '',
                        )}
                  </strong>

                  <span>
                    {
                      user.user_id
                    }
                  </span>
                </button>
              ),
            )}
          </div>
        )}
    </div>
  )
}
