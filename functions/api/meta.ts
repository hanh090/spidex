/** GET /api/meta — version negotiation for installed clients. */
import { metaResponse } from '../lib/meta'

export const onRequestGet = (context: { env: Record<string, unknown> }) => metaResponse(context.env)
