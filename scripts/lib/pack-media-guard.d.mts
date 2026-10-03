export function overwriteDecision(
  existing: Uint8Array | null,
  local: Uint8Array,
  force: boolean,
): 'upload' | 'skip' | 'refuse'
