/**
 * Request-body validation at the API boundary. Every route that reads a JSON
 * body goes through parseBody so malformed input answers one consistent shape:
 * 400 { error, issues: [{ path, message }] }.
 */
import { z } from 'zod'

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response }

export const badRequest = (message: string, issues: { path: string; message: string }[] = []) =>
  new Response(JSON.stringify({ error: message, issues }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export async function parseBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<ParsedBody<z.output<S>>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: badRequest('Request body must be valid JSON') }
  }
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  const first = issues[0]
  const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid request'
  return { ok: false, response: badRequest(message, issues) }
}

/** Like parseBody but a missing or empty body counts as `{}` (optional-body POSTs). */
export async function parseOptionalBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<ParsedBody<z.output<S>>> {
  const text = await request.clone().text().catch(() => '')
  if (!text.trim()) {
    const result = schema.safeParse({})
    return result.success
      ? { ok: true, data: result.data }
      : { ok: false, response: badRequest('Request body required') }
  }
  return parseBody(request, schema)
}

// ---- auth ----

const email = z.string().trim().min(3).max(254).email('Enter a valid email address')
const personName = z.string().trim().max(100).optional().nullable()

export const loginSchema = z.object({
  email,
  // Login accepts any existing password length; bounds only guard abuse.
  password: z.string().min(1, 'Password required').max(256),
})

export const registerSchema = z.object({
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(256, 'Password is too long'),
  firstName: personName,
  lastName: personName,
})

export const oauthCallbackSchema = z.object({ code: z.string().min(1, 'Code required').max(2048) })

// ---- admin ----

const metaObject = z.record(z.unknown()).refine((m) => JSON.stringify(m).length <= 64 * 1024, 'meta is too large')

export const resourceCreateSchema = z.object({
  kind: z.string().trim().min(1, 'kind is required').max(64),
  title: z.string().trim().min(1, 'title is required').max(300),
  id: z.string().trim().min(1).max(128).optional(),
  meta: metaObject.optional(),
  published: z.boolean().optional(),
  sort: z.number().finite().optional(),
})

export const resourcePatchSchema = z.object({
  title: z.string().max(300).optional(),
  meta: metaObject.optional(),
  published: z.boolean().optional(),
  sort: z.number().finite().optional(),
})

export const publishSchema = z.object({ published: z.boolean().optional() })

// ---- submissions ----

export const submissionCreateSchema = z.object({
  packId: z.string().trim().min(1, 'packId is required').max(63),
  note: z.string().optional().transform((n) => (n ?? '').slice(0, 500)),
  fileCount: z.number({ invalid_type_error: 'fileCount must be a number' }),
  totalBytes: z.number({ invalid_type_error: 'totalBytes must be a number' }),
})
