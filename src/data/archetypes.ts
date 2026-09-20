/**
 * Taxon and family archetype inference for species plates.
 *
 * An archetype is the scientific naturalist fallback shown for a species that
 * lacks a dedicated photograph or drawn plate.
 */

export function inferSpeciesArchetype(sp: {
  packId?: string
  family?: string
  sciName?: string
}): string {
  const pack = (sp.packId || '').toLowerCase()
  const fam = (sp.family || '').toLowerCase()
  const sci = (sp.sciName || '').toLowerCase()

  const isBird =
    pack.startsWith('bird') ||
    [
      'accipitridae', 'falconidae', 'pandionidae', 'strigidae', 'tytonidae',
      'ardeidae', 'ciconiidae', 'rallidae', 'laridae', 'charadriidae', 'scolopacidae',
      'podicipedidae', 'sulidae', 'anatidae', 'picidae', 'megalaimidae', 'alcedinidae',
      'meropidae', 'coraciidae', 'bucerotidae', 'columbidae', 'nectariniidae',
      'apodidae', 'hirundinidae', 'phasianidae', 'corvidae', 'dicruridae',
      'passeridae', 'motacillidae', 'emberizidae', 'fringillidae', 'estrildidae',
      'ploceidae', 'muscicapidae', 'pycnonotidae', 'turdidae', 'timaliidae',
      'zosteropidae', 'paridae', 'sittidae', 'sturnidae', 'aves',
    ].some((k) => fam.includes(k))

  if (isBird) {
    return 'bird.svg'
  }

  // Butterfly
  if (sci.includes('graphium')) {
    return 'bf-archetype-graphium.svg'
  }
  if (fam.includes('papilionidae') || ['troides', 'papilio', 'atrophaneura'].some((g) => sci.includes(g))) {
    return 'bf-archetype-papilionid.svg'
  }
  if (fam.includes('pieridae') || ['delias', 'catopsilia', 'eurema', 'pieris', 'appias', 'cepora'].some((g) => sci.includes(g))) {
    return 'bf-archetype-pierid.svg'
  }
  if (fam.includes('lycaenidae')) {
    return 'bf-archetype-lycaenid.svg'
  }
  if (fam.includes('hesperiidae')) {
    return 'bf-archetype-hesperiid.svg'
  }
  if (fam.includes('riodinidae')) {
    return 'bf-archetype-riodinid.svg'
  }
  if (fam.includes('nymphalidae')) {
    return 'bf-archetype-nymphalid.svg'
  }
  return 'bf-archetype-general.svg'
}
