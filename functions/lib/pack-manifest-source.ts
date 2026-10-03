/**
 * Which copy of a bundled pack's manifest is live: the admin override in R2
 * (overrides/<id>/pack.json) or the file shipped in the deploy.
 *
 * The override wins only while its version is strictly above the deployed
 * version. A deploy that ships a version at or above it supersedes the edit,
 * because the edit was made against an older pack. The public route, the admin
 * media editor and the dev server all ask this one function, so they cannot
 * disagree about what users are being served.
 */

/** `version` of a pack.json body, or null when absent, unparseable or not a number. */
export function manifestVersion(text: string | null | undefined): number | null {
  if (!text) return null
  try {
    const v = (JSON.parse(text) as { version?: unknown } | null)?.version
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** True when the override is the live copy. A missing deployed version never supersedes. */
export function overrideIsLive(overrideVersion: number | null, staticVersion: number | null): boolean {
  return overrideVersion != null && (staticVersion == null || overrideVersion > staticVersion)
}
