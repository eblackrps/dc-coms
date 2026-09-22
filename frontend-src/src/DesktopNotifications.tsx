import {
  useEffect,
  useState,
} from 'react'

import {
  DESKTOP_ALERTS_KEY,
} from './Attention'

type AlertState =
  | 'on'
  | 'off'
  | 'blocked'
  | 'unsupported'

function readState(): AlertState {
  if (
    typeof Notification ===
    'undefined'
  ) {
    return 'unsupported'
  }

  if (
    Notification.permission ===
    'denied'
  ) {
    return 'blocked'
  }

  if (
    Notification.permission ===
      'granted' &&
    window.localStorage.getItem(
      DESKTOP_ALERTS_KEY,
    ) === 'enabled'
  ) {
    return 'on'
  }

  return 'off'
}

export default function DesktopNotifications() {
  const [
    state,
    setState,
  ] =
    useState<AlertState>(
      'off',
    )

  const [
    busy,
    setBusy,
  ] =
    useState(false)

  useEffect(() => {
    setState(
      readState(),
    )
  }, [])

  async function toggle() {
    if (
      busy ||
      state ===
        'unsupported'
    ) {
      return
    }

    if (
      state === 'on'
    ) {
      window.localStorage.removeItem(
        DESKTOP_ALERTS_KEY,
      )

      setState('off')
      return
    }

    if (
      typeof Notification ===
      'undefined'
    ) {
      setState(
        'unsupported',
      )
      return
    }

    setBusy(true)

    try {
      let permission =
        Notification.permission

      if (
        permission ===
        'default'
      ) {
        permission =
          await Notification
            .requestPermission()
      }

      if (
        permission ===
        'granted'
      ) {
        window.localStorage.setItem(
          DESKTOP_ALERTS_KEY,
          'enabled',
        )

        setState('on')
      } else {
        window.localStorage.removeItem(
          DESKTOP_ALERTS_KEY,
        )

        setState(
          permission ===
            'denied'
            ? 'blocked'
            : 'off',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  let label =
    'Desktop alerts off'

  if (state === 'on') {
    label =
      'Desktop alerts on'
  } else if (
    state === 'blocked'
  ) {
    label =
      'Desktop alerts blocked'
  } else if (
    state === 'unsupported'
  ) {
    label =
      'Desktop alerts unavailable'
  }

  return (
    <button
      type="button"
      className={
        state === 'on'
          ? 'desktop-alert-toggle active'
          : 'desktop-alert-toggle'
      }
      disabled={
        busy ||
        state ===
          'unsupported'
      }
      title={
        state === 'blocked'
          ? 'Notifications are blocked by the browser.'
          : 'Desktop alerts for direct messages and mentions.'
      }
      onClick={() => {
        void toggle()
      }}
    >
      <span
        className="desktop-alert-icon"
      >
        {state === 'on'
          ? '●'
          : '○'}
      </span>

      {busy
        ? 'Updating alerts...'
        : label}
    </button>
  )
}
