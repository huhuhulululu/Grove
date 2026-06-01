/**
 * commands/loadout.ts — `sq loadout` build-a-kit UI (ADR-0014 rev.2 Track A).
 *
 * Three sub-actions (impure shell; pure engine via equip/unequip reducers):
 *   sq loadout             — view current loadout + active/one-away synergies
 *   sq loadout equip <ref> — equip a card/gear/buff ref into a free slot
 *   sq loadout unequip <N> — unequip slot N (1-based)
 *
 * ZEN: under --zen (isZen=true) the view is suppressed (calm mode, no synergy
 * nag), but equip/unequip still work and print a terse confirmation.
 *
 * COSMETIC-ONLY: loadout slots are purely cosmetic (xp/seed/crit multipliers).
 * The engine is pure; this shell handles I/O + state persistence. No real-world
 * power is gated on the loadout (ADR-0014 acceptance + ADR-0005 firewall).
 *
 * EQUIP REF FORMAT: `<kind>/<id>[/<tag>]`
 *   kind  = card | gear | buff
 *   id    = the card-def id, owned-gear instance id, or quest/buff id
 *   tag   = optional: card set or gear name (required for synergy matching)
 * Examples:
 *   card/tools.hammer/tools         (card from the tools set)
 *   gear/gear.commit-hammer.42/Commit Hammer
 *   buff/precast-spec
 */

import { loadState, saveState, withStateLock } from '../../store/store'
import { equip, unequip, SLOT_CAP } from '../../engine/loadout'
import type { EquippedRef, EquippedKind } from '../../core/synergies'
import { renderLoadoutPanel } from '../../render/loadout'
import type { Locale } from '../../i18n/types'
import { t } from '../../i18n/t'

// Valid kind values.
const VALID_KINDS: ReadonlySet<string> = new Set(['card', 'gear', 'buff'])

/**
 * Parse an equip ref string `kind/id[/tag]` into an EquippedRef.
 * Returns null when the string is malformed.
 */
export function parseEquipRef(raw: string): EquippedRef | null {
  const parts = raw.split('/')
  if (parts.length < 2) return null
  const kind = parts[0] as string
  if (!VALID_KINDS.has(kind)) return null
  const id = parts[1] as string
  if (!id) return null
  const tag = parts[2] // may be undefined — that's fine
  return { kind: kind as EquippedKind, id, ...(tag !== undefined ? { tag } : {}) }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleLoadout(
  rest: string[],
  flags: Record<string, string>,
  dir: string,
  zen: boolean,
  locale: Locale = 'en',
): number {
  const sub = rest[0] // 'equip' | 'unequip' | undefined

  if (sub === undefined) {
    // --- view ---------------------------------------------------------------
    const state = loadState(dir)
    if (!zen) {
      console.log(renderLoadoutPanel(state, false, locale))
    } else {
      // zen: still show a terse one-line summary (slots count), no synergy nag.
      const slots = state.loadout?.slots ?? []
      console.log(t(locale, 'cli.confirm', { message: t(locale, 'cli.loadout.zen_view', { n: slots.length }) }))
    }
    return 0
  }

  if (sub === 'equip') {
    const rawRef = rest[1]
    if (rawRef === undefined) {
      console.error('Error: equip requires a ref argument. Format: kind/id[/tag]')
      console.error('  e.g.  sq loadout equip card/tools.hammer/tools')
      console.error('        sq loadout equip gear/gear.commit-hammer.42/Commit Hammer')
      console.error('        sq loadout equip buff/precast-spec')
      return 2
    }
    const ref = parseEquipRef(rawRef)
    if (ref === null) {
      console.error(`Error: invalid ref "${rawRef}". Format: kind/id[/tag]  (kind = card | gear | buff)`)
      return 2
    }

    const result = withStateLock(dir, () => {
      const state = loadState(dir)
      const slots = state.loadout?.slots ?? []

      // Check if already equipped.
      if (slots.some((s) => s.kind === ref.kind && s.id === ref.id)) {
        return { state, alreadyEquipped: true, atCap: false }
      }
      // Check capacity before the reducer (mirrors equip's no-op on over-cap).
      if (slots.length >= SLOT_CAP) {
        return { state, alreadyEquipped: false, atCap: true }
      }

      const next = equip(state, ref)
      saveState(dir, next)
      return { state: next, alreadyEquipped: false, atCap: false }
    })

    if (result.alreadyEquipped) {
      console.log(t(locale, 'cli.confirm', { message: t(locale, 'cli.loadout.already_equipped', { id: ref.id }) }))
      return 0
    }
    if (result.atCap) {
      console.error(t(locale, 'cli.loadout.at_cap'))
      return 2
    }

    const label = ref.tag ?? ref.id
    const msg = zen
      ? t(locale, 'cli.confirm', { message: t(locale, 'cli.loadout.equipped', { label }) })
      : t(locale, 'cli.loadout.equipped_verbose', { label, kind: ref.kind })
    console.log(msg)
    return 0
  }

  if (sub === 'unequip') {
    const slotRaw = rest[1]
    const slotN = slotRaw !== undefined ? parseInt(slotRaw, 10) : NaN
    if (!Number.isInteger(slotN) || slotN < 1) {
      console.error('Error: unequip requires a 1-based slot number (e.g. sq loadout unequip 1)')
      return 2
    }
    const slotIndex = slotN - 1 // convert to 0-based

    const result = withStateLock(dir, () => {
      const state = loadState(dir)
      const slots = state.loadout?.slots ?? []
      if (slotIndex >= slots.length) {
        return { state, outOfRange: true }
      }
      const ref = slots[slotIndex]!
      const next = unequip(state, slotIndex)
      saveState(dir, next)
      return { state: next, outOfRange: false, removedLabel: ref.tag ?? ref.id }
    })

    if (result.outOfRange) {
      console.error(t(locale, 'cli.loadout.slot_empty_err', { n: slotN }))
      return 2
    }

    const label = result.removedLabel ?? `slot ${slotN}`
    console.log(t(locale, 'cli.confirm', {
      message: t(locale, 'cli.loadout.unequipped', { label }),
    }))
    return 0
  }

  // Unknown sub-action.
  console.error(`Unknown loadout action "${sub}". Use: sq loadout | sq loadout equip <ref> | sq loadout unequip <N>`)
  return 2
}
