import * as sdk from 'matrix-js-sdk'


export type HistoryLoadResult = {
  added: number
  atBeginning: boolean
}


function yieldToBrowser() {
  return new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        0,
      )
    },
  )
}


export function findLoadedMessage(
  room: sdk.Room,
  eventId: string,
) {
  return (
    room
      .getUnfilteredTimelineSet()
      .findEventById(
        eventId,
      ) ??
    undefined
  )
}


async function decryptEvents(
  client: sdk.MatrixClient,
  events: sdk.MatrixEvent[],
) {
  const DECRYPT_BATCH = 12

  for (
    let offset = 0;
    offset < events.length;
    offset += DECRYPT_BATCH
  ) {
    const batch =
      events.slice(
        offset,
        offset +
          DECRYPT_BATCH,
      )

    await Promise.all(
      batch.map(
        async (event) => {
          if (
            !event.isEncrypted()
          ) {
            return
          }

          try {
            await client
              .decryptEventIfNeeded(
                event,
              )

          } catch (err) {
            console.debug(
              'History event could not be decrypted:',
              err,
            )
          }
        },
      ),
    )

    await yieldToBrowser()
  }
}


export async function loadOlderRoomHistory(
  client: sdk.MatrixClient,
  room: sdk.Room,
  limit = 100,
): Promise<HistoryLoadResult> {
  const beforeEvents =
    room
      .getLiveTimeline()
      .getEvents()

  const beforeIds =
    new Set(
      beforeEvents
        .map(
          (event) =>
            event.getId(),
        )
        .filter(
          (
            id,
          ): id is string =>
            Boolean(id),
        ),
    )

  const beforeCount =
    beforeEvents.length

  await client.scrollback(
    room,
    limit,
  )

  const afterEvents =
    room
      .getLiveTimeline()
      .getEvents()

  const newlyLoaded =
    afterEvents.filter(
      (event) => {
        const eventId =
          event.getId()

        return (
          Boolean(eventId) &&
          !beforeIds.has(
            eventId!,
          )
        )
      },
    )

  await decryptEvents(
    client,
    newlyLoaded,
  )

  const added =
    Math.max(
      0,
      afterEvents.length -
        beforeCount,
    )

  const backwardToken =
    room
      .getLiveTimeline()
      .getPaginationToken(
        sdk.EventTimeline.BACKWARDS,
      )

  const legacyBeginning =
    (room as any)
      .oldState
      ?.paginationToken ===
    null

  return {
    added,

    atBeginning:
      backwardToken === null ||
      legacyBeginning,
  }
}


export async function ensureMessageLoaded(
  client: sdk.MatrixClient,
  room: sdk.Room,
  eventId: string,
  maxBatches = 50,
) {
  if (
    findLoadedMessage(
      room,
      eventId,
    )
  ) {
    return true
  }

  let noProgress =
    0

  for (
    let batch = 0;
    batch < maxBatches;
    batch += 1
  ) {
    const result =
      await loadOlderRoomHistory(
        client,
        room,
        100,
      )

    if (
      findLoadedMessage(
        room,
        eventId,
      )
    ) {
      return true
    }

    if (
      result.atBeginning
    ) {
      return false
    }

    if (
      result.added === 0
    ) {
      noProgress += 1

      if (
        noProgress >= 2
      ) {
        return false
      }

    } else {
      noProgress = 0
    }
  }

  return false
}
