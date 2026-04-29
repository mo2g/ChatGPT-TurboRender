import {
  SLIDING_WINDOW_SCHEMA_VERSION,
  buildSlidingWindowPairIndex,
  buildSlidingWindowSearchIndex,
  createSlidingWindowSignature,
  serializeSlidingWindowSignature,
  type ConversationPayload,
  type SlidingWindowPairIndex,
  type SlidingWindowSearchEntry,
} from '../../shared/sliding-window';

export interface SlidingWindowCacheMeta {
  schemaVersion: number;
  conversationId: string;
  currentNodeId: string | null;
  mappingNodeCount: number;
  pairCount: number;
  payloadSignature: string;
  updatedAt: number;
  dirty: boolean;
}

export interface SlidingWindowCacheEntry {
  meta: SlidingWindowCacheMeta;
  payload: ConversationPayload;
  pairIndex: SlidingWindowPairIndex;
  searchIndex: SlidingWindowSearchEntry[];
}

export interface SlidingWindowCacheBackend {
  read(conversationId: string): Promise<SlidingWindowCacheEntry | null>;
  write(entry: SlidingWindowCacheEntry): Promise<void>;
  markDirty?(conversationId: string): Promise<void>;
  clearConversation?(conversationId: string): Promise<void>;
  clearAll?(): Promise<void>;
}

export interface SlidingWindowCacheWindow extends Window {
  __turboRenderSlidingWindowCache?: SlidingWindowCacheBackend;
}

const DB_NAME = 'chatgpt-turborender-sliding-window';
const DB_VERSION = 1;
const CONVERSATIONS_STORE = 'conversations';
const PAIR_INDEXES_STORE = 'pairIndexes';
const SEARCH_INDEXES_STORE = 'searchIndexes';
const METADATA_STORE = 'metadata';

interface CacheKeyRecord {
  cacheKey: string;
}

type MetadataRecord = CacheKeyRecord & SlidingWindowCacheMeta;
type PayloadRecord = CacheKeyRecord & { payload: ConversationPayload };
type PairIndexRecord = CacheKeyRecord & { pairIndex: SlidingWindowPairIndex };
type SearchIndexRecord = CacheKeyRecord & { searchIndex: SlidingWindowSearchEntry[] };

function createCacheKey(conversationId: string, payloadSignature: string): string {
  return `${SLIDING_WINDOW_SCHEMA_VERSION}:${conversationId}:${payloadSignature}`;
}

export function createSlidingWindowCacheEntry(
  conversationId: string,
  payload: ConversationPayload,
  options: { dirty?: boolean; updatedAt?: number } = {},
): SlidingWindowCacheEntry | null {
  const pairIndex = buildSlidingWindowPairIndex(payload);
  if (pairIndex.totalPairs <= 0) {
    return null;
  }

  const signature = createSlidingWindowSignature(payload, conversationId);
  const payloadSignature = serializeSlidingWindowSignature(signature);
  return {
    meta: {
      schemaVersion: SLIDING_WINDOW_SCHEMA_VERSION,
      conversationId,
      currentNodeId: signature.currentNodeId,
      mappingNodeCount: signature.mappingNodeCount,
      pairCount: pairIndex.totalPairs,
      payloadSignature,
      updatedAt: options.updatedAt ?? Date.now(),
      dirty: options.dirty ?? false,
    },
    payload,
    pairIndex,
    searchIndex: buildSlidingWindowSearchIndex(pairIndex),
  };
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(indexedDB: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(PAIR_INDEXES_STORE)) {
        db.createObjectStore(PAIR_INDEXES_STORE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(SEARCH_INDEXES_STORE)) {
        db.createObjectStore(SEARCH_INDEXES_STORE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const metadata = db.createObjectStore(METADATA_STORE, { keyPath: 'cacheKey' });
        metadata.createIndex('conversationId', 'conversationId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function withDatabase<T>(indexedDB: IDBFactory, callback: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDatabase(indexedDB);
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}

function latestMetadata(records: MetadataRecord[]): MetadataRecord | null {
  const compatible = records.filter((record) => record.schemaVersion === SLIDING_WINDOW_SCHEMA_VERSION);
  if (compatible.length === 0) {
    return null;
  }

  return compatible.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

export function createIndexedDbSlidingWindowCache(win: Window): SlidingWindowCacheBackend | null {
  const indexedDB = win.indexedDB;
  if (indexedDB == null) {
    return null;
  }

  return {
    async read(conversationId: string): Promise<SlidingWindowCacheEntry | null> {
      return withDatabase(indexedDB, async (db) => {
        const metadataTx = db.transaction(METADATA_STORE, 'readonly');
        const metadataStore = metadataTx.objectStore(METADATA_STORE);
        const index = metadataStore.index('conversationId');
        const metadataRecords = (await requestToPromise(index.getAll(conversationId))) as MetadataRecord[];
        await transactionDone(metadataTx);
        const meta = latestMetadata(metadataRecords);
        if (meta == null) {
          return null;
        }

        const tx = db.transaction(
          [CONVERSATIONS_STORE, PAIR_INDEXES_STORE, SEARCH_INDEXES_STORE],
          'readonly',
        );
        const payloadRecord = (await requestToPromise(
          tx.objectStore(CONVERSATIONS_STORE).get(meta.cacheKey),
        )) as PayloadRecord | undefined;
        const pairIndexRecord = (await requestToPromise(
          tx.objectStore(PAIR_INDEXES_STORE).get(meta.cacheKey),
        )) as PairIndexRecord | undefined;
        const searchIndexRecord = (await requestToPromise(
          tx.objectStore(SEARCH_INDEXES_STORE).get(meta.cacheKey),
        )) as SearchIndexRecord | undefined;
        await transactionDone(tx);

        if (payloadRecord == null || pairIndexRecord == null || searchIndexRecord == null) {
          return null;
        }

        return {
          meta,
          payload: payloadRecord.payload,
          pairIndex: pairIndexRecord.pairIndex,
          searchIndex: searchIndexRecord.searchIndex,
        };
      });
    },

    async write(entry: SlidingWindowCacheEntry): Promise<void> {
      const cacheKey = createCacheKey(entry.meta.conversationId, entry.meta.payloadSignature);
      await withDatabase(indexedDB, async (db) => {
        const tx = db.transaction(
          [CONVERSATIONS_STORE, PAIR_INDEXES_STORE, SEARCH_INDEXES_STORE, METADATA_STORE],
          'readwrite',
        );
        tx.objectStore(CONVERSATIONS_STORE).put({ cacheKey, payload: entry.payload } satisfies PayloadRecord);
        tx.objectStore(PAIR_INDEXES_STORE).put({ cacheKey, pairIndex: entry.pairIndex } satisfies PairIndexRecord);
        tx.objectStore(SEARCH_INDEXES_STORE).put({ cacheKey, searchIndex: entry.searchIndex } satisfies SearchIndexRecord);
        tx.objectStore(METADATA_STORE).put({ cacheKey, ...entry.meta } satisfies MetadataRecord);
        await transactionDone(tx);
      });
    },

    async markDirty(conversationId: string): Promise<void> {
      await withDatabase(indexedDB, async (db) => {
        const readTx = db.transaction(METADATA_STORE, 'readonly');
        const metadataRecords = (await requestToPromise(
          readTx.objectStore(METADATA_STORE).index('conversationId').getAll(conversationId),
        )) as MetadataRecord[];
        await transactionDone(readTx);

        const writeTx = db.transaction(METADATA_STORE, 'readwrite');
        const store = writeTx.objectStore(METADATA_STORE);
        for (const record of metadataRecords) {
          store.put({ ...record, dirty: true, updatedAt: Date.now() } satisfies MetadataRecord);
        }
        await transactionDone(writeTx);
      });
    },

    async clearConversation(conversationId: string): Promise<void> {
      await withDatabase(indexedDB, async (db) => {
        const readTx = db.transaction(METADATA_STORE, 'readonly');
        const metadataRecords = (await requestToPromise(
          readTx.objectStore(METADATA_STORE).index('conversationId').getAll(conversationId),
        )) as MetadataRecord[];
        await transactionDone(readTx);

        const tx = db.transaction(
          [CONVERSATIONS_STORE, PAIR_INDEXES_STORE, SEARCH_INDEXES_STORE, METADATA_STORE],
          'readwrite',
        );
        for (const record of metadataRecords) {
          tx.objectStore(CONVERSATIONS_STORE).delete(record.cacheKey);
          tx.objectStore(PAIR_INDEXES_STORE).delete(record.cacheKey);
          tx.objectStore(SEARCH_INDEXES_STORE).delete(record.cacheKey);
          tx.objectStore(METADATA_STORE).delete(record.cacheKey);
        }
        await transactionDone(tx);
      });
    },

    async clearAll(): Promise<void> {
      await withDatabase(indexedDB, async (db) => {
        const tx = db.transaction(
          [CONVERSATIONS_STORE, PAIR_INDEXES_STORE, SEARCH_INDEXES_STORE, METADATA_STORE],
          'readwrite',
        );
        tx.objectStore(CONVERSATIONS_STORE).clear();
        tx.objectStore(PAIR_INDEXES_STORE).clear();
        tx.objectStore(SEARCH_INDEXES_STORE).clear();
        tx.objectStore(METADATA_STORE).clear();
        await transactionDone(tx);
      });
    },
  };
}

export function getSlidingWindowCache(win: Window): SlidingWindowCacheBackend | null {
  const override = (win as SlidingWindowCacheWindow).__turboRenderSlidingWindowCache;
  return override ?? createIndexedDbSlidingWindowCache(win);
}
