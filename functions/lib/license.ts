/**
 * Licence token matchers shared by the media admin API, community-pack
 * submissions, the pack validator script and the bundled-pack test, so one
 * definition decides what counts as a NoDerivatives / NonCommercial licence.
 */

/** "CC-BY-ND", "CC BY-ND 4.0", "CC BY-NC-ND 4.0", "no derivatives" — token match, so "BY-NDX" does not count. */
export const isNdLicense = (l: string) => /(^|[\s_-])ND($|[\s_.-])/i.test(l) || /no\s*-?deriv/i.test(l)
export const isNcLicense = (l: string) => /(^|[\s_-])NC($|[\s_.-])/i.test(l) || /non\s*-?commercial/i.test(l)
