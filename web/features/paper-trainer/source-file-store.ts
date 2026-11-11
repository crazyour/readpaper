/** Durable browser storage for the paper trainer's original upload.
 *
 * Object URLs only live for the current document. Keeping the Blob in
 * IndexedDB lets a restored training session create a fresh URL after a page
 * reload instead of leaving the original-paper viewer with a dead `blob:` URL.
 */

const DB_NAME = "deeptutor-paper-trainer";
const STORE_NAME = "source-files";
const DB_VERSION = 1;

interface StoredSourceFile {
  blob: Blob;
  filename: string;
  type: string;
}

const memory = new Map<string, StoredSourceFile>();

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeIndexedDb(
  paperId: string,
  source: StoredSourceFile,
): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(source, paperId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function readIndexedDb(
  paperId: string,
): Promise<StoredSourceFile | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(paperId);
      tx.oncomplete = () =>
        resolve((request.result as StoredSourceFile | undefined) ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function savePaperSourceFile(
  paperId: string,
  file: File,
): Promise<void> {
  const source: StoredSourceFile = {
    blob: file,
    filename: file.name,
    type: file.type,
  };
  memory.set(paperId, source);
  if (!canUseIndexedDb()) return;
  try {
    await writeIndexedDb(paperId, source);
  } catch (error) {
    // Private browsing and storage quotas can disable IndexedDB. The live-tab
    // memory copy still keeps previewing functional for the current session.
    console.warn("Could not persist the paper's original file.", error);
  }
}

export async function paperSourceUrl(paperId: string): Promise<string> {
  let source = memory.get(paperId) ?? null;
  if (!source && canUseIndexedDb()) {
    try {
      source = await readIndexedDb(paperId);
      if (source) memory.set(paperId, source);
    } catch (error) {
      console.warn("Could not restore the paper's original file.", error);
    }
  }
  if (!source || typeof URL.createObjectURL !== "function") return "";
  return URL.createObjectURL(source.blob);
}
