import { useCallback, useEffect, useState } from 'react';
import { randomSeed } from '../components/PhotoGrid/collage';
import { createHistoryMemory, entryKey } from './historyMemory';

/**
 * The seeds a public photo page deals its order and collage from. A fresh
 * visit (a history entry with nothing remembered) draws both at random, and
 * they are kept per history entry, so Back to the page, Back from the viewer
 * and a reload deal the same order and arrangement again. A shuffle seed of
 * 0 is the API's order (kept by entries remembered before visits were
 * shuffled).
 */
export interface GridSeeds {
  layout: number;
  shuffle: number;
}

const layoutSeeds = createHistoryMemory('collageSeed');
const shuffleSeeds = createHistoryMemory('shuffleSeed');

function initialSeeds(locationKey: string): GridSeeds {
  const key = entryKey(locationKey);
  return { layout: layoutSeeds.get(key) ?? randomSeed(), shuffle: shuffleSeeds.get(key) ?? randomSeed() };
}

/** The current entry's seeds, and a fresh deal (Shuffle). */
export function useEntrySeeds(locationKey: string): [GridSeeds, () => void] {
  const [state, setState] = useState(() => ({ key: locationKey, seeds: initialSeeds(locationKey) }));
  // Moving to another gallery keeps the page mounted with a new entry.
  let current = state;
  if (state.key !== locationKey) {
    current = { key: locationKey, seeds: initialSeeds(locationKey) };
    setState(current);
  }
  const { key, seeds } = current;

  useEffect(() => {
    const entry = entryKey(key);
    layoutSeeds.set(entry, seeds.layout);
    shuffleSeeds.set(entry, seeds.shuffle);
  }, [key, seeds]);

  const reshuffle = useCallback(
    () => setState((prev) => ({ key: prev.key, seeds: { layout: randomSeed(), shuffle: randomSeed() } })),
    []
  );
  return [seeds, reshuffle];
}
