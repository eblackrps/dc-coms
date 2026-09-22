import type {
  MatrixClient,
} from 'matrix-js-sdk'

import {
  decodeRecoveryKey,
} from 'matrix-js-sdk/lib/crypto-api'

type CachedRecoveryKey = {
  keyId: string
  key: Uint8Array<ArrayBuffer>
}

let cachedRecoveryKey:
  CachedRecoveryKey | null = null

export function hasCachedRecoveryKey() {
  return cachedRecoveryKey !== null
}

export function clearRecoveryKeyCache() {
  if (cachedRecoveryKey) {
    cachedRecoveryKey.key.fill(0)
  }

  cachedRecoveryKey = null
}

export async function getCachedSecretStorageKey(
  opts: {
    keys: Record<string, unknown>
  },
  _name: string,
): Promise<
  [
    string,
    Uint8Array<ArrayBuffer>,
  ] | null
> {
  if (!cachedRecoveryKey) {
    return null
  }

  if (
    !(
      cachedRecoveryKey.keyId
      in opts.keys
    )
  ) {
    return null
  }

  return [
    cachedRecoveryKey.keyId,
    cachedRecoveryKey.key,
  ]
}

export async function
validateAndCacheRecoveryKey(
  client: MatrixClient,
  recoveryKey: string,
) {
  let decoded:
    Uint8Array<ArrayBuffer>

  try {
    decoded = decodeRecoveryKey(
      recoveryKey.trim(),
    )
  } catch {
    throw new Error(
      'That recovery key is not in a valid Matrix recovery-key format.',
    )
  }

  const keyTuple =
    await client.secretStorage.getKey()

  if (!keyTuple) {
    decoded.fill(0)

    throw new Error(
      'DC Coms could not find the configured secret-storage key.',
    )
  }

  const [
    keyId,
    keyInfo,
  ] = keyTuple

  const valid =
    await client.secretStorage.checkKey(
      decoded,
      keyInfo as any,
    )

  if (!valid) {
    decoded.fill(0)

    throw new Error(
      'That recovery key does not match this account.',
    )
  }

  clearRecoveryKeyCache()

  cachedRecoveryKey = {
    keyId,
    key: decoded,
  }

  return keyId
}


export function cacheSecretStorageKey(
  keyId: string,
  _keyInfo: unknown,
  key: Uint8Array<ArrayBuffer>,
) {
  clearRecoveryKeyCache()

  cachedRecoveryKey = {
    keyId,
    key:
      new Uint8Array(
        key,
      ) as Uint8Array<ArrayBuffer>,
  }
}
