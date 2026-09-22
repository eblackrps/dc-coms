export type DcReactionDefinition = {
  key: string
  label: string
  group:
    | 'quick'
    | 'standard'
  image?: string
  animated?: boolean
}

export const QUICK_REACTIONS: DcReactionDefinition[] = [
  { key: '👍', label: 'Like', group: 'quick' },
  { key: '❤️', label: 'Love', group: 'quick' },
  { key: '😂', label: 'Laugh', group: 'quick' },
  { key: '😮', label: 'Surprised', group: 'quick' },
  { key: '😢', label: 'Sad', group: 'quick' },
  { key: '😡', label: 'Angry', group: 'quick' },
]

export const STANDARD_REACTIONS: DcReactionDefinition[] = [
  { key: '👏', label: 'Applause', group: 'standard' },
  { key: '🎉', label: 'Celebrate', group: 'standard' },
  { key: '🔥', label: 'Fire', group: 'standard' },
  { key: '✅', label: 'Done', group: 'standard' },
  { key: '👀', label: 'Watching', group: 'standard' },
  { key: '🤔', label: 'Thinking', group: 'standard' },
  { key: '💯', label: 'Hundred', group: 'standard' },
  { key: '🚀', label: 'Ship It', group: 'standard' },
  { key: '🙏', label: 'Thanks', group: 'standard' },
  { key: '🤝', label: 'Agreed', group: 'standard' },
  { key: '💡', label: 'Good Idea', group: 'standard' },
  { key: '🫡', label: 'Salute', group: 'standard' },
  { key: '😬', label: 'Yikes', group: 'standard' },
  { key: '🤦', label: 'Facepalm', group: 'standard' },
  { key: '❤️‍🔥', label: 'Love It', group: 'standard' },
  { key: '🥳', label: 'Party', group: 'standard' },
  { key: '😎', label: 'Cool', group: 'standard' },
  { key: '💀', label: 'Dead', group: 'standard' },
  { key: '⚡', label: 'Fast', group: 'standard' },
  { key: '🛠️', label: 'Fixing It', group: 'standard' },
]

export const ALL_DC_REACTIONS = [
  ...QUICK_REACTIONS,
  ...STANDARD_REACTIONS,
]

export function getReactionDefinition(
  key: string,
) {
  return ALL_DC_REACTIONS.find(
    (reaction) =>
      reaction.key === key,
  )
}

export function getReactionLabel(
  key: string,
) {
  return (
    getReactionDefinition(key)?.label ??
    key
  )
}
