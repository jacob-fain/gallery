/**
 * Fisher-Yates shuffle - returns a new shuffled array. A seeded random
 * (collage.ts) deals the same order again from the same seed.
 */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// FNV-1a over the id, then a 32-bit finalizer (murmur3's) mixed with the
// seed, so nearby ids and seeds rank far apart.
function rank(seed: number, id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= seed;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The items in a random order fixed by the seed. Each item's place comes
 * from its own id, not its position, so the order of the others holds when
 * the list gains or loses items (a refresh, a refetch, a reload). Each item
 * appears once, as in the input.
 */
export function seededOrder<T extends { id: string }>(items: T[], seed: number): T[] {
  return items
    .map((item) => ({ item, rank: rank(seed, item.id) }))
    .sort((a, b) => a.rank - b.rank || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
    .map(({ item }) => item);
}
