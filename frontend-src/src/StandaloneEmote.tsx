import {
  getReactionDefinition,
} from './Reactions'

type Props = {
  emoteKey?: string
  body: string
  bigEmoji?: boolean
}

export default function StandaloneEmote({
  emoteKey,
  body,
  bigEmoji = false,
}: Props) {
  if (emoteKey) {
    const definition =
      getReactionDefinition(
        emoteKey,
      )

    if (
      definition?.image
    ) {
      return (
        <div className="standalone-emote-wrap">
          <img
            className="standalone-emote-image"
            src={definition.image}
            alt={definition.label}
            title={definition.label}
            draggable={false}
          />
        </div>
      )
    }
  }

  if (bigEmoji) {
    return (
      <div className="standalone-unicode-emoji">
        {body}
      </div>
    )
  }

  return <>{body}</>
}
