import { createContext, useContext, useSyncExternalStore } from 'react';
import type { QueueSummary, TargetState, UploadQueue } from '../utils/uploadQueue';

export const UploadQueueContext = createContext<UploadQueue | null>(null);

export function useUploadQueue() {
  const queue = useContext(UploadQueueContext);
  if (!queue) {
    throw new Error('useUploadQueue must be used within an UploadQueueProvider');
  }
  return queue;
}

export function useUploadTarget(galleryId: string | null): TargetState {
  const queue = useUploadQueue();
  const snapshot = () => queue.getTarget(galleryId);
  return useSyncExternalStore(queue.subscribe, snapshot, snapshot);
}

export function useUploadSummary(): QueueSummary {
  const queue = useUploadQueue();
  return useSyncExternalStore(queue.subscribe, queue.getSummary, queue.getSummary);
}
