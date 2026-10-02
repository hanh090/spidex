/**
 * Client for /api/submissions/* — the community pack upload flow.
 *
 * Uploads are one HTTP PUT per file: individual pack files are small enough
 * that multipart machinery would only add failure modes. `uploadPackFiles`
 * runs a small concurrency pool and reports progress per file.
 */

export interface SubmissionIssue { path: string; message: string }

export interface Submission {
  id: string
  packId: string
  status: 'uploading' | 'pending' | 'published' | 'rejected' | 'withdrawn'
  issues: SubmissionIssue[]
  summary: { name?: { en: string }; speciesCount?: number; version?: number } | null
  updatedAt: number
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error((data as any).error || `HTTP ${res.status}`) as Error & { issues?: SubmissionIssue[] }
    if (Array.isArray((data as any).issues)) err.issues = (data as any).issues
    throw err
  }
  return data as T
}

export function fetchMySubmissions(): Promise<{ submissions: Submission[] }> {
  return call('/api/submissions/mine')
}

export function createSubmission(body: {
  packId: string
  note?: string
  fileCount: number
  totalBytes: number
}): Promise<{ ok: true; id: string }> {
  return call('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** One file: `path` is the pack-relative path (pack.json, img/x.webp…). */
export function uploadSubmissionFile(submissionId: string, path: string, file: Blob): Promise<{ ok: true; received: number }> {
  return call(`/api/submissions/${encodeURIComponent(submissionId)}/files?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: file,
  })
}

export function completeSubmission(submissionId: string): Promise<{ ok: true; status: string }> {
  return call(`/api/submissions/${encodeURIComponent(submissionId)}/complete`, { method: 'POST' })
}

export function withdrawSubmission(submissionId: string): Promise<{ ok: true }> {
  return call(`/api/submissions/${encodeURIComponent(submissionId)}`, { method: 'DELETE' })
}

/**
 * Upload every file with bounded concurrency. Files are keyed by their
 * pack-relative path (File.webkitRelativePath minus the leading directory).
 */
export async function uploadPackFiles(
  submissionId: string,
  files: { path: string; file: Blob }[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let done = 0
  let cursor = 0
  const POOL = 4
  await Promise.all(Array.from({ length: Math.min(POOL, files.length) }, async () => {
    while (cursor < files.length) {
      const { path, file } = files[cursor++]!
      await uploadSubmissionFile(submissionId, path, file)
      onProgress?.(++done, files.length)
    }
  }))
}
