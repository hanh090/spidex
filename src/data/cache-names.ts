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

/**
 * Service-worker route matcher for pack MEDIA (never the JSON/ndjson manifests,
 * which must stay network-fresh so publish/unpublish and updates propagate).
 *
 * vite-plugin-pwa serialises this function with `toString()` into sw.js, so it
 * MUST be self-contained: no imports, no module constants. The literal below is
 * asserted equal to PACK_URL_PREFIX by a test.
 */
export function isPackMediaRequest({ url }: { url: URL }): boolean {
  return url.pathname.startsWith('/packs/')
    && /\.(webp|jpe?g|png|svg|gif|avif|mp3|ogg|opus|wav|m4a)$/i.test(url.pathname)
}
