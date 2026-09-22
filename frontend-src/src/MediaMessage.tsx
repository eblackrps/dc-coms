import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import * as sdk from 'matrix-js-sdk'

import {
  decryptAttachment,
} from 'matrix-encrypt-attachment'

export type DcEncryptedFile = {
  url: string
  iv: string
  hashes: Record<string, string>
  key: {
    alg?: string
    ext?: boolean
    k?: string
    key_ops?: string[]
    kty?: string
  }
  v: string
}

export type DcMediaContent = {
  msgtype: string
  body: string
  filename?: string

  file?: DcEncryptedFile
  url?: string

  info?: {
    mimetype?: string
    size?: number
    w?: number
    h?: number
  }
}

type Props = {
  client: sdk.MatrixClient
  content: DcMediaContent
}

function formatBytes(bytes?: number) {
  if (
    typeof bytes !== 'number' ||
    !Number.isFinite(bytes)
  ) {
    return ''
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`
}

async function fetchAttachment(
  client: sdk.MatrixClient,
  content: DcMediaContent,
) {
  const mxc =
    content.file?.url ??
    content.url

  if (!mxc) {
    throw new Error(
      'Attachment has no Matrix media URL.',
    )
  }

  const httpUrl =
    client.mxcUrlToHttp(
      mxc,
      undefined,
      undefined,
      undefined,
      false,
      true,
      true,
    )

  if (!httpUrl) {
    throw new Error(
      'Unable to resolve Matrix media URL.',
    )
  }

  const token =
    client.getAccessToken()

  const headers: HeadersInit = {}

  if (token) {
    headers.Authorization =
      `Bearer ${token}`
  }

  const response = await fetch(
    httpUrl,
    {
      headers,
      cache: 'no-store',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Media download failed (${response.status}).`,
    )
  }

  const data =
    await response.arrayBuffer()

  const mime =
    content.info?.mimetype ||
    'application/octet-stream'

  if (content.file) {
    const decrypted =
      await decryptAttachment(
        data,
        content.file as Parameters<
          typeof decryptAttachment
        >[1],
      )

    return new Blob(
      [decrypted],
      {
        type: mime,
      },
    )
  }

  return new Blob(
    [data],
    {
      type: mime,
    },
  )
}

export default function MediaMessage({
  client,
  content,
}: Props) {
  const [blob, setBlob] =
    useState<Blob | null>(null)

  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null)

  const [loading, setLoading] =
    useState(false)

  const [error, setError] =
    useState('')

  const filename = useMemo(
    () =>
      content.filename?.trim() ||
      content.body?.trim() ||
      'Attachment',
    [
      content.filename,
      content.body,
    ],
  )

  const mime =
    content.info?.mimetype ||
    'application/octet-stream'

  const isImage =
    content.msgtype ===
      sdk.MsgType.Image ||
    mime.startsWith('image/')

  useEffect(() => {
    if (!isImage) return

    let cancelled = false
    let objectUrl: string | null = null

    async function loadPreview() {
      setLoading(true)
      setError('')

      try {
        const nextBlob =
          await fetchAttachment(
            client,
            content,
          )

        if (cancelled) return

        objectUrl =
          URL.createObjectURL(
            nextBlob,
          )

        setBlob(nextBlob)
        setPreviewUrl(objectUrl)
      } catch (err) {
        if (cancelled) return

        console.error(
          'Image attachment decrypt failed:',
          err,
        )

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to decrypt image.',
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadPreview()

    return () => {
      cancelled = true

      if (objectUrl) {
        URL.revokeObjectURL(
          objectUrl,
        )
      }
    }
  }, [
    client,
    content,
    isImage,
  ])

  async function download() {
    setLoading(true)
    setError('')

    let temporaryUrl:
      | string
      | null = null

    try {
      const nextBlob =
        blob ??
        await fetchAttachment(
          client,
          content,
        )

      const url =
        previewUrl ??
        URL.createObjectURL(
          nextBlob,
        )

      if (!previewUrl) {
        temporaryUrl = url
      }

      const anchor =
        document.createElement('a')

      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'

      document.body.appendChild(
        anchor,
      )

      anchor.click()
      anchor.remove()

      if (temporaryUrl) {
        window.setTimeout(
          () => {
            URL.revokeObjectURL(
              temporaryUrl!,
            )
          },
          1000,
        )
      }
    } catch (err) {
      console.error(
        'Attachment download failed:',
        err,
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to download attachment.',
      )
    } finally {
      setLoading(false)
    }
  }

  if (isImage) {
    return (
      <div className="media-image-wrap">
        {loading && !previewUrl && (
          <div className="media-loading">
            Decrypting image...
          </div>
        )}

        {previewUrl && (
          <img
            className="media-image"
            src={previewUrl}
            alt={filename}
          />
        )}

        <div className="media-image-meta">
          <div>
            <strong>{filename}</strong>

            {content.info?.size && (
              <span>
                {formatBytes(
                  content.info.size,
                )}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              void download()
            }
            disabled={loading}
          >
            Download
          </button>
        </div>

        {error && (
          <div className="media-error">
            {error}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="media-file-card">
      <div className="media-file-icon">
        📎
      </div>

      <div className="media-file-info">
        <strong>{filename}</strong>

        <span>
          {content.info?.size
            ? formatBytes(
                content.info.size,
              )
            : 'Encrypted attachment'}
        </span>
      </div>

      <button
        type="button"
        onClick={() =>
          void download()
        }
        disabled={loading}
      >
        {loading
          ? 'Decrypting...'
          : 'Download'}
      </button>

      {error && (
        <div className="media-error">
          {error}
        </div>
      )}
    </div>
  )
}
