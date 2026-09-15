/**
 * Cache Storage names, shared by the app and the service-worker config.
 *
 * Both `vite.config.ts` (which registers the runtime route that SERVES pack
 * images) and `pack-download.ts` (which WRITES them) must agree on this string
 * exactly. A typo would break offline images silently — the download would
 * succeed and the gallery would be blank with no error — so the constant lives
 * in one dependency-free module rather than being written twice.
 */

/** Build-independent: a deploy's cache cleanup must never evict a pack. */
export const PACK_IMAGE_CACHE = 'spidex-pack-images-v1'

/** Anything under this prefix is pack payload, not app shell. */
export const PACK_URL_PREFIX = '/packs/'
