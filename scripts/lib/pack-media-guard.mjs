// Bundled pack media is immutable: clients cache each URL forever and only ever
// fetch URLs they do not hold, so changed bytes must ship under a new filename.
// This decides what the uploader may do with a file whose key may already exist.

/**
 * @param {Uint8Array | null} existing bytes already stored under the key, or null when absent
 * @param {Uint8Array} local the file about to be uploaded
 * @param {boolean} force the operator passed --force
 * @returns {'upload' | 'skip' | 'refuse'}
 *   upload: the key is free (or --force); skip: identical bytes already there;
 *   refuse: a different object is stored and --force was not given.
 */
export function overwriteDecision(existing, local, force) {
  if (existing == null) return 'upload'
  if (existing.length === local.length && existing.every((b, i) => b === local[i])) return 'skip'
  return force ? 'upload' : 'refuse'
}
