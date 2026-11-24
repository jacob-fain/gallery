/**
 * The parts of an HTTP server shutdown needs. Node's server.close() stops
 * accepting connections, closes idle keep-alive sockets, and calls back once
 * in-flight requests have finished.
 */
export interface ClosableServer {
  close(callback: (err?: Error) => void): unknown;
}

export interface ShutdownDeps {
  server: ClosableServer;
  closePool: () => Promise<void>;
  // Work that outlives requests and still needs the pool, such as analytics
  // writes started after a response was sent. Awaited before closePool.
  drain?: () => Promise<void>;
  exit: (code: number) => void;
  // Must stay below the container's stop grace period (30 s in the compose
  // files), or Docker kills the process before it can exit on its own.
  timeoutMs?: number;
  log?: (message: string) => void;
}

/**
 * Builds the SIGTERM/SIGINT handler: stop taking requests, let in-flight ones
 * finish, let background work drain, then close the database pool, so an
 * upload that has written to S3 still gets its row inserted. If draining outlasts timeoutMs the process
 * exits non-zero anyway. Repeated signals do not start a second shutdown.
 */
export const createShutdown = ({
  server,
  closePool,
  drain = async () => {},
  exit,
  timeoutMs = 25000,
  log = console.log,
}: ShutdownDeps) => {
  let started = false;

  return async (signal: string): Promise<void> => {
    if (started) return;
    started = true;
    log(`${signal} received, shutting down`);

    const timer = setTimeout(() => {
      log(`Shutdown did not finish within ${timeoutMs} ms, exiting`);
      exit(1);
    }, timeoutMs);
    timer.unref?.();

    try {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
      await drain();
      await closePool();
      clearTimeout(timer);
      exit(0);
    } catch (err) {
      clearTimeout(timer);
      log(`Shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
      exit(1);
    }
  };
};
