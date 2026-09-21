import { describe, it, expect } from 'vitest'
import { inferSpeciesArchetype } from '../archetypes'

describe('inferSpeciesArchetype', () => {
  describe('butterflies', () => {
    it('infers papilionid for swallowtails', () => {
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Papilionidae', sciName: 'Papilio polytes' }))
        .toBe('bf-archetype-papilionid.svg')
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Papilionidae', sciName: 'Troides helena' }))
        .toBe('bf-archetype-papilionid.svg')
    })

    it('infers graphium for swordtails', () => {
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Papilionidae', sciName: 'Graphium sarpedon' }))
        .toBe('bf-archetype-graphium.svg')
    })

    it('infers pierid for whites and yellows', () => {
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Pieridae', sciName: 'Catopsilia pomona' }))
        .toBe('bf-archetype-pierid.svg')
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Pieridae', sciName: 'Delias pasithoe' }))
        .toBe('bf-archetype-pierid.svg')
    })

    it('infers lycaenid for blues and hairstreaks', () => {
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Lycaenidae', sciName: 'Zizeeria maha' }))
        .toBe('bf-archetype-lycaenid.svg')
    })

    it('infers hesperiid for skippers', () => {
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Hesperiidae', sciName: 'Hasora badra' }))
        .toBe('bf-archetype-hesperiid.svg')
    })

    it('infers riodinid for metalmarks', () => {
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Riodinidae', sciName: 'Abisara echerius' }))
        .toBe('bf-archetype-riodinid.svg')
    })

    it('infers nymphalid for brush-footed butterflies', () => {
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Nymphalidae', sciName: 'Danaus genutia' }))
        .toBe('bf-archetype-nymphalid.svg')
    })

    it('falls back to general butterfly archetype for unknown families', () => {
      expect(inferSpeciesArchetype({ packId: 'butterfly-vn', family: 'Unknown', sciName: 'Incertae sedis' }))
        .toBe('bf-archetype-general.svg')
    })
  })

  describe('birds', () => {
    it('infers bird.svg for all kinds of birds', () => {
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Strigidae', sciName: 'Otus bakkamoena' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Tytonidae', sciName: 'Tyto alba' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Picidae', sciName: 'Dinopium javanense' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Megalaimidae', sciName: 'Psilopogon lineatus' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Columbidae', sciName: 'Spilopelia chinensis' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Nectariniidae', sciName: 'Cinnyris jugularis' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Hirundinidae', sciName: 'Hirundo rustica' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Apodidae', sciName: 'Apus affinis' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Phasianidae', sciName: 'Gallus gallus' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Alcedinidae', sciName: 'Halcyon smyrnensis' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Anatidae', sciName: 'Anas poecilorhyncha' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Ardeidae', sciName: 'Egretta garzetta' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Accipitridae', sciName: 'Haliastur indus' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Corvidae', sciName: 'Corvus macrorhynchos' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Dicruridae', sciName: 'Dicrurus macrocercus' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Passeridae', sciName: 'Passer montanus' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Muscicapidae', sciName: 'Copsychus saularis' }))
        .toBe('bird.svg')
      expect(inferSpeciesArchetype({ packId: 'bird-vn', family: 'Pycnonotidae', sciName: 'Pycnonotus jocosus' }))
        .toBe('bird.svg')
    })
  })
})
