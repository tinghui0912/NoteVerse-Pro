export function scoreLocation(scoreId: string): `/score/${string}` {
  return `/score/${encodeURIComponent(scoreId)}`;
}

export function scoreEditLocation(scoreId: string): `/score/${string}/edit` {
  return `/score/${encodeURIComponent(scoreId)}/edit`;
}
