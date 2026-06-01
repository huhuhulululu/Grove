/**
 * Synergy table (Track A · ADR-0014 rev.2) — pure data, like CARD_SETS.
 *
 * The player builds a LOADOUT from owned cards / gear / quest-buffs into a few
 * limited slots; a SYNERGY between equipped members produces a small COSMETIC
 * multiplier bundle (XP / seeds / crit). This file is the published, inspectable
 * table (ADR-0002). It is PURE DATA only — no logic, no I/O. The engine reads it
 * via src/engine/loadout.ts.
 *
 * FIREWALL (ADR-0005): every effect here is COSMETIC. A synergy multiplies
 * cosmetic XP / cosmetic seeds / cosmetic crit chance — it confers NO real-world
 * power. Track B (the real, ungated helper utility) is entirely separate and is
 * NEVER tied to this table.
 *
 * DESIGN — no dominant build (ADR-0014 acceptance): the synergies are spread so
 * that NO single one is strictly best. They favour DIFFERENT slot members and
 * lean on DIFFERENT effect fields (some XP, some seeds, some crit, some mixed),
 * so at least two distinct loadouts are equally viable depending on what you own
 * and which field you want. None dominates another on every axis. Multipliers are
 * SMALL + bounded (mirrors the existing capped economy) so totals never run away.
 */

/** What a single equipped slot member identifies. */
export type EquippedKind = 'card' | 'gear' | 'buff'

/**
 * A reference to one equipped member of the loadout.
 *  - kind 'card' → `id` is a card def id (e.g. 'tools.debugger') — see CARD_SETS.
 *  - kind 'gear' → `id` is an OWNED gear instance id (e.g. 'gear.commit-hammer.42').
 *  - kind 'buff' → `id` is a quest/buff id (e.g. 'precast-spec') — see QUESTS.
 *
 * Cards additionally carry their `set` as a TAG so a synergy can require members
 * of a set without naming each card; gear carries its `name` as a TAG so a synergy
 * can require a gear KIND without naming its random instance id. Both tags are
 * optional (a bare ref still equips) — synergy matching uses whichever it needs.
 */
export interface EquippedRef {
  kind: EquippedKind
  id: string
  /** card → set id; gear → gear name. Used by synergy tag-requirements. */
  tag?: string
}

/** A small cosmetic multiplier bundle a synergy contributes when active. */
export interface SynergyEffect {
  /** multiply XP grants (e.g. 1.05 = +5%). Default 1 (no XP effect). */
  xpMult?: number
  /** multiply seed grants (e.g. 1.05 = +5%). Default 1 (no seed effect). */
  seedMult?: number
  /** add to crit chance, as a fraction (e.g. 0.03 = +3pp). Default 0. */
  critBonus?: number
}

/**
 * One requirement clause: COUNT distinct equipped members that match.
 * A member matches when its `kind` equals `kind` AND (if `tag`/`id` is given) its
 * `tag`/`id` equals the clause's. So a clause can require:
 *  - N gear of a NAME      ({ kind:'gear', tag:'Commit Hammer', min:1 })
 *  - N cards of a SET      ({ kind:'card', tag:'tools', min:2 })
 *  - a specific buff       ({ kind:'buff', id:'precast-spec', min:1 })
 *  - N of a kind, any tag  ({ kind:'card', min:2 })
 */
export interface SynergyRequire {
  kind: EquippedKind
  /** match this set/gear-name tag (omit to match any tag of the kind). */
  tag?: string
  /** match this exact id (omit to match any id of the kind/tag). */
  id?: string
  /** how many DISTINCT equipped members must match (min 1). */
  min: number
}

/** A published synergy: a named combination → a cosmetic effect. */
export interface SynergyDef {
  id: string
  name: string
  /** ALL clauses must be satisfied for the synergy to be active. */
  requires: SynergyRequire[]
  effect: SynergyEffect
}

/**
 * The published synergy table (4-5; ADR-0014 open-question "3-5"). Each is themed
 * to an existing card set / gear / quest buff. Multipliers are small (≤ +6% per
 * field) and the fields differ across synergies so no build dominates.
 *
 *  - toolsmith   : 2 'tools' cards            → XP-leaning  (build/refactor flavour)
 *  - artisan     : Build Anvil + Refactor Blade gear → XP-leaning, gear-based ALT
 *                  (a DIFFERENT path to the same XP goal as toolsmith — neither
 *                   dominates: cards vs gear, same field)
 *  - merchant    : Commit Hammer gear + 'deploy' card → SEED-leaning (economy build)
 *  - precision   : Type Saber gear + precast-spec buff → CRIT-leaning (a third axis)
 *  - naturalist  : 3 'forest' cards          → small MIXED xp+seed (a balanced low pick)
 *
 * Viability (≥2 non-dominated builds): an XP build (toolsmith OR artisan) and a
 * SEED build (merchant) and a CRIT build (precision) each win on their own field;
 * none beats another on every axis, so the best loadout depends on what you own
 * and which field you value. naturalist is a modest all-rounder, not a strict win.
 */
export const SYNERGIES: SynergyDef[] = [
  {
    id: 'toolsmith',
    name: 'Toolsmith',
    requires: [{ kind: 'card', tag: 'tools', min: 2 }],
    effect: { xpMult: 1.05 },
  },
  {
    id: 'artisan',
    name: 'Artisan',
    requires: [
      { kind: 'gear', tag: 'Build Anvil', min: 1 },
      { kind: 'gear', tag: 'Refactor Blade', min: 1 },
    ],
    effect: { xpMult: 1.05 },
  },
  {
    id: 'merchant',
    name: 'Merchant',
    requires: [
      { kind: 'gear', tag: 'Commit Hammer', min: 1 },
      { kind: 'card', tag: 'deploy', min: 1 },
    ],
    effect: { seedMult: 1.06 },
  },
  {
    id: 'precision',
    name: 'Precision',
    requires: [
      { kind: 'gear', tag: 'Type Saber', min: 1 },
      { kind: 'buff', id: 'precast-spec', min: 1 },
    ],
    effect: { critBonus: 0.04 },
  },
  {
    id: 'naturalist',
    name: 'Naturalist',
    requires: [{ kind: 'card', tag: 'forest', min: 3 }],
    effect: { xpMult: 1.02, seedMult: 1.02 },
  },
]

/** Look up a synergy by id (null when unknown). */
export function synergyById(id: string): SynergyDef | null {
  return SYNERGIES.find((s) => s.id === id) ?? null
}
