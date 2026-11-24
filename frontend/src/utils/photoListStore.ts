import { appendPage, emptyList, hasMore, type PhotoList } from './photoList';

/** Photos per page as the admin scrolls. */
export const PAGE_SIZE = 100;
/** Photos per request when every photo is needed at once (the API's maximum). */
export const LOAD_ALL_PAGE_SIZE = 200;

export type LoadPage<T> = (offset: number, limit: number) => Promise<{ photos: T[]; total: number }>;

export interface PhotoListState<T extends { id: string }> {
  list: PhotoList<T>;
  // 'loading' until the first page arrives.
  status: 'loading' | 'ready' | 'error';
  error: string;
  loadingMore: boolean;
  // The last page failed; scrolling no longer retries by itself.
  moreFailed: boolean;
}

const message = (err: unknown) => (err instanceof Error ? err.message : 'Failed to load photos');

/**
 * A paged admin photo list, held outside React so its methods are stable and
 * every caller sees the list as of now. Every (re)load bumps a generation,
 * and a response for an older generation is dropped.
 */
export class PhotoListStore<T extends { id: string }> {
  private state: PhotoListState<T> = {
    list: emptyList<T>(),
    status: 'loading',
    error: '',
    loadingMore: false,
    moreFailed: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending: Promise<boolean> | null = null;
  private readonly loadPage: LoadPage<T>;

  constructor(loadPage: LoadPage<T>) {
    this.loadPage = loadPage;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  latest = () => this.state.list;

  update = (change: (list: PhotoList<T>) => PhotoList<T>) => {
    this.set({ list: change(this.state.list) });
  };

  /** Replaces the list with its first page. */
  reload = async (): Promise<void> => {
    const gen = ++this.generation;
    this.pending = null;
    try {
      const page = await this.loadPage(0, PAGE_SIZE);
      if (gen !== this.generation) return;
      this.set({ list: appendPage(emptyList<T>(), page), status: 'ready', error: '', moreFailed: false });
    } catch (err) {
      if (gen !== this.generation) return;
      this.set({ status: 'error', error: message(err) });
    }
  };

  loadMore = () => this.fetchNext(PAGE_SIZE);

  /**
   * Every photo of the list, fetching the pages still missing. null when a
   * page failed or a reload replaced the list meanwhile.
   */
  loadAll = async (): Promise<T[] | null> => {
    const gen = this.generation;
    while (hasMore(this.state.list)) {
      if (!(await this.fetchNext(LOAD_ALL_PAGE_SIZE))) return null;
    }
    return gen === this.generation ? this.state.list.items : null;
  };

  /** Drops responses still on their way, for an unmounted list. */
  dispose = () => {
    this.generation++;
    this.pending = null;
  };

  // Calls made while a page is on its way share it, so the scroll sentinel
  // and Select All never fetch the same offset twice. Resolves false when the
  // page failed or a reload replaced the list.
  private fetchNext(limit: number): Promise<boolean> {
    if (!hasMore(this.state.list)) return Promise.resolve(true);
    if (this.pending) return this.pending;
    const gen = this.generation;
    this.set({ loadingMore: true });
    const request: Promise<boolean> = this.loadPage(this.state.list.items.length, limit)
      .then(
        (page) => {
          if (gen !== this.generation) return false;
          this.set({ list: appendPage(this.state.list, page), moreFailed: false });
          return true;
        },
        () => {
          if (gen === this.generation) this.set({ moreFailed: true });
          return false;
        }
      )
      .finally(() => {
        if (this.pending === request) this.pending = null;
        this.set({ loadingMore: false });
      });
    this.pending = request;
    return request;
  }

  private set(patch: Partial<PhotoListState<T>>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
