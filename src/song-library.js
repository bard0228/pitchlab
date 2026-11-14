import { parseZipEntries } from './zip-reader.js';

const DB_NAME = 'pitchlab_library_v1';
const STORE_NAME = 'songs';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('無法開啟離線歌庫'));
  });
}

export async function decodeSongPackageZip(arrayBuffer) {
  const entries = await parseZipEntries(arrayBuffer);
  if (!entries['meta.json'] || !entries['pitch.json'] || !entries['inst.opus'] || !entries['vocal.opus']) {
    throw new Error('歌包缺少必要檔案（meta.json / pitch.json / inst.opus / vocal.opus）');
  }

  const decoder = new TextDecoder('utf-8');
  const meta = JSON.parse(decoder.decode(entries['meta.json']));
  const pitchCurve = JSON.parse(decoder.decode(entries['pitch.json']));

  return {
    id: meta.id || crypto.randomUUID(),
    title: meta.title || '未命名歌曲',
    artist: meta.artist || '',
    durationMs: Number(meta.durationMs) || 0,
    createdAt: meta.createdAt || new Date().toISOString(),
    meta,
    pitchCurve,
    instBytes: entries['inst.opus'].buffer,
    vocalBytes: entries['vocal.opus'].buffer,
  };
}

export async function saveSongRecord(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve(record);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('儲存歌包失敗（空間可能不足）'));
    };
  });
}

export async function listSongRecords() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      db.close();
      const rows = (req.result || []).sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );
      resolve(rows);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('讀取離線歌庫失敗'));
    };
  });
}

export async function getSongRecord(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => {
      db.close();
      resolve(req.result || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('讀取歌曲失敗'));
    };
  });
}

export async function deleteSongRecord(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('刪除歌曲失敗'));
    };
  });
}
