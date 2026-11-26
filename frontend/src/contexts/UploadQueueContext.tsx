import { useEffect, useState, type ReactNode } from 'react';
import { checkDuplicates, uploadPhoto } from '../api/client';
import { hashFile, UploadQueue } from '../utils/uploadQueue';
import { useAuth } from './auth';
import { UploadQueueContext, useUploadSummary } from './uploads';

function LeaveWarning() {
  const { active } = useUploadSummary();

  useEffect(() => {
    if (!active) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have uploads in progress. Are you sure you want to leave?';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [active]);

  return null;
}

/** Holds the admin's uploads above the routes, so they keep running (and
 *  keep their rows) while the admin moves between pages. */
export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const session = user?.id ?? null;
  const [queue] = useState(
    () =>
      new UploadQueue(
        { upload: uploadPhoto, checkDuplicates, hash: hashFile },
        { isOnline: () => navigator.onLine }
      )
  );

  // Signing out, or the session expiring, clears the user: the uploads stop.
  useEffect(() => {
    queue.setSession(session);
  }, [queue, session]);

  useEffect(() => () => queue.abortAll(), [queue]);

  // Retries wait while the browser is offline and go as soon as it is back.
  useEffect(() => {
    const handleOnline = () => queue.resumeOnline();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [queue]);

  return (
    <UploadQueueContext.Provider value={queue}>
      <LeaveWarning />
      {children}
    </UploadQueueContext.Provider>
  );
}
