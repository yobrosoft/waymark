export const LIBRARY_KEY = "library";
export const ROUTE_CACHE_KEY = "route-cache";
export const NEARBY_CACHE_KEY = "nearby-cache";
export const GEOCODE_CACHE_KEY = "geocode-cache";

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    async get(key) {
      if (!data.has(key)) return undefined;
      return structuredClone(data.get(key));
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
}

interface CacheFile<T> {
  entries: Record<string, { savedAt: number; value: T }>;
}

export async function cacheGet<T>(
  store: KeyValueStore,
  bucket: string,
  id: string,
  ttlMs: number,
  now = Date.now(),
): Promise<T | undefined> {
  const file = await store.get(bucket);
  if (!file || typeof file !== "object") return undefined;
  const hit = (file as CacheFile<T>).entries?.[id];
  if (!hit || now - hit.savedAt > ttlMs) return undefined;
  return hit.value;
}

export async function cacheSet<T>(
  store: KeyValueStore,
  bucket: string,
  id: string,
  value: T,
  maxEntries: number,
  now = Date.now(),
): Promise<void> {
  const file = await store.get(bucket);
  const entries: CacheFile<T>["entries"] =
    file && typeof file === "object" && (file as CacheFile<T>).entries
      ? { ...(file as CacheFile<T>).entries }
      : {};
  entries[id] = { savedAt: now, value };
  const ordered = Object.entries(entries).sort((a, b) => b[1].savedAt - a[1].savedAt);
  const pruned = Object.fromEntries(ordered.slice(0, maxEntries));
  await store.set(bucket, { entries: pruned });
}

let dbPromise: Promise<import("idb").IDBPDatabase> | null = null;

async function database() {
  if (!dbPromise) {
    const { openDB } = await import("idb");
    dbPromise = openDB("waymark", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      },
    });
  }
  return dbPromise;
}

export const idbStore: KeyValueStore = {
  async get(key) {
    return (await database()).get("kv", key);
  },
  async set(key, value) {
    await (await database()).put("kv", value, key);
  },
};
