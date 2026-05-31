import type { Card } from '../core/rewards'
import { cardIdsInSet } from '../core/cards'

/**
 * Append a card to the collection immutably and detect set completion + duplicates.
 *
 * A set is considered complete when every card id listed in cardIdsInSet(card.set)
 * appears at least once among the NEW collection's ids (duplicates are allowed but
 * do not count as extra distinct entries).
 *
 * `duplicate` is true when the card's id was ALREADY owned before this add — it
 * drives R3 dup-compensation (a dupe still pays out seeds, so it never feels
 * worthless; audit P1 / PRIOR-ART Pandora dup-comp).
 *
 * @returns
 *   - cards          — new array with card appended
 *   - completedSets  — new array (clone or extended) reflecting completion state
 *   - newlyCompleted — the set id if it was just completed for the first time; null otherwise
 *   - duplicate      — true if the card id was already in the collection
 */
export function addCard(
  cards: Card[],
  completedSets: string[],
  card: Card,
): { cards: Card[]; completedSets: string[]; newlyCompleted: string | null; duplicate: boolean } {
  // Was this exact card id already owned? (checked BEFORE the append)
  const duplicate = cards.some((c) => c.id === card.id)

  // Immutably append the new card
  const newCards = [...cards, card]

  // Determine if the card's set is now complete for the first time
  const setAlreadyCompleted = completedSets.includes(card.set)

  if (!setAlreadyCompleted) {
    const required = cardIdsInSet(card.set)

    if (required.length > 0) {
      // Collect distinct ids present in newCards for this set
      const presentIds = new Set(newCards.filter((c) => c.set === card.set).map((c) => c.id))
      const isComplete = required.every((id) => presentIds.has(id))

      if (isComplete) {
        return {
          cards: newCards,
          completedSets: [...completedSets, card.set],
          newlyCompleted: card.set,
          duplicate,
        }
      }
    }
  }

  return {
    cards: newCards,
    completedSets: [...completedSets],
    newlyCompleted: null,
    duplicate,
  }
}
