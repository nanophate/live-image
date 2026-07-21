const DATABASE_NAME = "living-image-handoff";
const DATABASE_VERSION = 1;
const STORE_NAME = "characters";
const HANDOFF_TTL_MS = 15 * 60 * 1_000;

export interface CharacterHandoff {
  key: string;
  blob: Blob;
  filename: string;
  createdAt: number;
}

function isExpiredOrInvalid(createdAt: unknown, now: number): boolean {
  return typeof createdAt !== "number"
    || !Number.isFinite(createdAt)
    || createdAt > now
    || now - createdAt > HANDOFF_TTL_MS;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("Temporary browser handoff is unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Could not open temporary browser storage"));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Temporary browser storage is blocked by another page"));
    };
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Temporary browser storage failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Temporary browser storage was cancelled"));
  });
}

async function purgeExpired(database: IDBDatabase, now: number): Promise<void> {
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const record = cursor.value as Partial<CharacterHandoff>;
    if (isExpiredOrInvalid(record.createdAt, now)) {
      cursor.delete();
    }
    cursor.continue();
  };
  await transactionDone(transaction);
}

export async function purgeExpiredCharacterHandoffs(): Promise<void> {
  const database = await openDatabase();
  try { await purgeExpired(database, Date.now()); }
  finally { database.close(); }
}

export async function stageCharacterHandoff(blob: Blob, filename: string): Promise<string> {
  const database = await openDatabase();
  try {
    const now = Date.now();
    await purgeExpired(database, now);
    const key = crypto.randomUUID();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ key, blob, filename, createdAt: now } satisfies CharacterHandoff);
    await transactionDone(transaction);
    window.setTimeout(() => {
      void removeCharacterHandoff(key).catch(() => undefined);
    }, HANDOFF_TTL_MS);
    return key;
  } finally {
    database.close();
  }
}

export async function takeCharacterHandoff(key: string): Promise<CharacterHandoff | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    let record: CharacterHandoff | undefined;
    const request = store.get(key);
    request.onsuccess = () => {
      record = request.result as CharacterHandoff | undefined;
      if (record) store.delete(key);
    };
    request.onerror = () => transaction.abort();
    await transactionDone(transaction);
    if (!record || isExpiredOrInvalid(record.createdAt, Date.now())) return null;
    if (!(record.blob instanceof Blob) || typeof record.filename !== "string") return null;
    return record;
  } finally {
    database.close();
  }
}

async function removeCharacterHandoff(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
