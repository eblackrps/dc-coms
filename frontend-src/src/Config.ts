export type DcComsRuntimeConfig = {
  homeserverUrl?: string
  serverName?: string
  reminderBotLocalpart?: string
  opsBotLocalpart?: string
}

declare global {
  interface Window {
    DC_COMS_CONFIG?: DcComsRuntimeConfig
  }
}

const runtime =
  window.DC_COMS_CONFIG ?? {}

export const HOMESERVER =
  (
    runtime.homeserverUrl ||
    window.location.origin
  ).replace(/\/+$/, '')

export const SERVER_NAME =
  runtime.serverName ||
  window.location.hostname

function matrixUserId(
  localpart: string,
) {
  return `@${localpart}:${SERVER_NAME}`
}

export const REMINDER_BOT =
  matrixUserId(
    runtime.reminderBotLocalpart ||
      'reminderbot',
  )

export const DC_OPS =
  matrixUserId(
    runtime.opsBotLocalpart ||
      'dcops',
  )
