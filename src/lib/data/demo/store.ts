import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSeedState, normalizeState, type DemoState } from "./state";

/**
 * Serialized, transactional state container for DEMO mode.
 *
 *  - `write(fn)` runs `fn` against a CLONE of the state, one writer at a time. If `fn` throws,
 *    nothing is committed (so a failed issue cannot burn a document number). On success the clone
 *    becomes the new state and is persisted atomically (temp file + rename).
 *  - `read(fn)` runs through the same queue so it never observes a half-applied write.
 *
 * This gives the demo repository the same guarantees `allocate_document_number` gives Postgres:
 * concurrent issues are serialized and numbers are unique and gapless.
 */
export interface DemoStore {
  read<T>(fn: (state: Readonly<DemoState>) => T): Promise<T>;
  write<T>(fn: (state: DemoState) => T): Promise<T>;
  /** Directory for binary artifacts (PDFs), or null for in-memory stores. */
  readonly dataDir: string | null;
}

abstract class QueuedStore implements DemoStore {
  abstract readonly dataDir: string | null;
  private tail: Promise<unknown> = Promise.resolve();

  protected abstract load(): Promise<DemoState>;
  protected abstract commit(next: DemoState): Promise<void>;

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  read<T>(fn: (state: Readonly<DemoState>) => T): Promise<T> {
    return this.enqueue(async () => fn(await this.load()));
  }

  write<T>(fn: (state: DemoState) => T): Promise<T> {
    return this.enqueue(async () => {
      const draft = structuredClone(await this.load());
      const result = fn(draft);
      await this.commit(draft);
      return result;
    });
  }
}

export class MemoryDemoStore extends QueuedStore {
  readonly dataDir = null;
  private state: DemoState;

  constructor(initial: DemoState = createSeedState()) {
    super();
    this.state = initial;
  }

  protected async load(): Promise<DemoState> {
    return this.state;
  }

  protected async commit(next: DemoState): Promise<void> {
    this.state = next;
  }
}

export class FileDemoStore extends QueuedStore {
  readonly dataDir: string;
  private readonly file: string;
  private cache: DemoState | null = null;
  private cacheMtime = 0;

  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
    this.file = path.join(dataDir, "demo-db.json");
  }

  protected async load(): Promise<DemoState> {
    try {
      const info = await stat(this.file);
      if (this.cache && info.mtimeMs === this.cacheMtime) return this.cache;
      const parsed = normalizeState(JSON.parse(await readFile(this.file, "utf8")) as DemoState);
      this.cache = parsed;
      this.cacheMtime = info.mtimeMs;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const seed = createSeedState();
      await this.commit(seed);
      return seed;
    }
  }

  protected async commit(next: DemoState): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    // OneDrive / antivirus can hold the target briefly on Windows: retry the rename a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, this.file);
        break;
      } catch (error) {
        if (attempt >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    this.cache = next;
    this.cacheMtime = (await stat(this.file)).mtimeMs;
  }
}

declare global {
  var __promptstackDemoStores: Map<string, DemoStore> | undefined;
}

/** One store instance per data directory per process (survives Next.js module re-evaluation). */
export function getFileDemoStore(dataDir: string = path.join(process.cwd(), ".data")): DemoStore {
  const registry = (globalThis.__promptstackDemoStores ??= new Map());
  let store = registry.get(dataDir);
  if (!store) {
    store = new FileDemoStore(dataDir);
    registry.set(dataDir, store);
  }
  return store;
}
