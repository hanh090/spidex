/**
 * Pack manifest and species record contracts.
 *
 * The `traitSchema` is what lets one UI serve butterflies and birds: it
 * declares the filter vocabulary, which image aspects a species must carry,
 * and which detail sections the species page renders. No component may know
 * what a butterfly is.
 *
 * Two fields are hard validation errors rather than warnings, because both are
 * unrecoverable once content is authored at scale:
 *   - every image needs `credit` and `license`
 *   - every species needs a `sensitivity` category
 */
import { z } from 'zod'

/** English is required; de/vi fall back to it per field, never per language. */
export const zLocalizedText = z.object({
  en: z.string().min(1),
  de: z.string().min(1).optional(),
  vi: z.string().min(1).optional(),
})
export type LocalizedText = z.infer<typeof zLocalizedText>

/**
 * A field that should be localized but that older packs wrote as a bare
 * string. A bare string is accepted and read as English, which is what the
 * resolver would have done with it anyway — this only stops an un-migrated
 * pack from failing validation outright. Packs compiled after this change
 * always write the object form.
 */
export const zMaybeLocalized = z.union([
  zLocalizedText,
  z.string().min(1).transform((en): LocalizedText => ({ en })),
])

/**
 * GBIF sensitive-species categories.
 * 0 not sensitive · 1 publish nothing · 2 generalize coordinates · 3 full
 * precision only to licensed clients.
 */
export const zSensitivity = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
export type Sensitivity = z.infer<typeof zSensitivity>

export const zTraitOption = z.object({
  v: z.string().min(1),
  label: zLocalizedText.optional(),
  hex: z.string().optional(),   // swatch renderer
  img: z.string().optional(),   // referent-image renderer (bird size referents)
})
export type TraitOption = z.infer<typeof zTraitOption>

export const zTrait = z.object({
  key: z.string().min(1),
  label: zLocalizedText,
  type: z.enum(['single', 'multi']),
  render: z.enum(['chip', 'swatch', 'referent-image']).default('chip'),
  max: z.number().int().positive().optional(),
  options: z.array(zTraitOption).min(2),
})
export type Trait = z.infer<typeof zTrait>

/** Which image aspects this taxon must and may carry. */
export const zAspects = z.object({
  required: z.array(z.string()).min(1),
  optional: z.array(z.string()).default([]),
})

/** Taxon-conditional detail sections — host plants for butterflies, call for birds. */
export const zSection = z.object({
  key: z.string().min(1),
  label: zLocalizedText,
})
export type Section = z.infer<typeof zSection>

export const zTraitSchema = z.object({
  traits: z.array(zTrait).min(1),
  aspects: zAspects,
  sections: z.array(zSection).default([]),
})
export type TraitSchema = z.infer<typeof zTraitSchema>

export const zPackManifest = z.object({
  id: z.string().min(1),
  name: zLocalizedText,
  taxonGroup: z.string().min(1),
  region: z.string().min(1),
  version: z.number().int().positive(),
  traitSchema: zTraitSchema,
  license: z.string().min(1),
  sources: z.array(z.string()).default([]),
  speciesCount: z.number().int().nonnegative(),
  /** Thumbnail tier and full tier, in bytes, from the manifest — never from storage.estimate(). */
  sizeBytes: z.object({ thumb: z.number().int().nonnegative(), full: z.number().int().nonnegative() }),
  /** Taxonomic splits across versions: old species id -> new species id. */
  idRemap: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
})
export type PackManifest = z.infer<typeof zPackManifest>

export const zSpeciesImage = z.object({
  id: z.string().min(1),
  aspect: z.string().min(1),
  // Both mandatory. A pack that cannot name a photographer and a licence
  // cannot ship — this is the project's largest legal exposure.
  credit: z.string().min(1),
  license: z.string().min(1),
  thumbUrl: z.string().min(1),
  fullUrl: z.string().min(1).optional(),
})
export type SpeciesImage = z.infer<typeof zSpeciesImage>

export const zSpeciesRecord = z.object({
  id: z.string().min(1),
  /** Never localized — the universal key across every language. */
  sciName: z.string().min(1),
  commonNames: zLocalizedText,
  family: z.string().min(1),
  traits: z.record(z.union([z.string(), z.array(z.string())])),
  keyFeatures: z.array(zLocalizedText).default([]),
  habitat: zLocalizedText.optional(),
  /** Values for the pack's declared `sections`, keyed by section key. */
  taxonFields: z.record(zLocalizedText).default({}),
  similarTo: z.array(z.string()).default([]),
  /** Months present/flying, 1-12. */
  months: z.array(z.number().int().min(1).max(12)).default([]),
  sensitivity: zSensitivity,
  /**
   * Conservation / occurrence status, rendered verbatim on the species page.
   * Localized: it was a bare string, and the Vietnam packs filled it with
   * Vietnamese, so English and German readers were shown "Bản địa (Native)".
   */
  status: zMaybeLocalized.optional(),
  images: z.array(zSpeciesImage).min(1),
})
export type SpeciesRecord = z.infer<typeof zSpeciesRecord>

export interface ValidationIssue { path: string; message: string }

export interface ParsedPack {
  manifest: PackManifest
  species: SpeciesRecord[]
}

/** Parse a manifest, returning typed issues rather than throwing. */
export function parseManifest(input: unknown): { ok: true; value: PackManifest } | { ok: false; issues: ValidationIssue[] } {
  const r = zPackManifest.safeParse(input)
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }
}

/**
 * Parse NDJSON species lines. Validates every record and additionally enforces
 * the manifest's own aspect contract, which zod cannot express on its own.
 */
export function parseSpeciesNdjson(
  text: string,
  schema: TraitSchema,
): { ok: true; value: SpeciesRecord[] } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const out: SpeciesRecord[] = []

  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch {
      issues.push({ path: `line ${i + 1}`, message: 'not valid JSON' })
      return
    }
    const r = zSpeciesRecord.safeParse(raw)
    if (!r.success) {
      r.error.issues.forEach((z) => issues.push({ path: `line ${i + 1}.${z.path.join('.')}`, message: z.message }))
      return
    }
    const sp = r.data
    const present = new Set(sp.images.map((im) => im.aspect))
    for (const need of schema.aspects.required) {
      if (!present.has(need)) {
        issues.push({ path: `${sp.id}.images`, message: `missing required aspect "${need}"` })
      }
    }
    out.push(sp)
  })

  return issues.length ? { ok: false, issues } : { ok: true, value: out }
}
