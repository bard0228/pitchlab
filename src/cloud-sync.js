export function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function findNewCloudFiles(cloudFiles, existingRecords) {
  if (!Array.isArray(cloudFiles) || cloudFiles.length === 0) return [];
  const existingIds = new Set();
  const existingNames = new Set();
  for (const rec of existingRecords || []) {
    if (rec.driveFileId) existingIds.add(String(rec.driveFileId));
    if (rec.sourceFileName) existingNames.add(String(rec.sourceFileName));
  }
  return cloudFiles.filter((f) => {
    if (!f || !f.id) return false;
    if (existingIds.has(String(f.id))) return false;
    if (f.name && existingNames.has(String(f.name))) return false;
    return true;
  });
}

function appendQuery(baseUrl, params) {
  const sep = baseUrl.includes('?') ? '&' : '?';
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${baseUrl}${sep}${qs}`;
}

export async function syncCloudLibrary({
  syncUrl,
  existingRecords = [],
  fetchImpl = fetch,
  onProgress = null,
}) {
  const cleanUrl = String(syncUrl || '').trim();
  if (!cleanUrl) return [];

  const listRes = await fetchImpl(appendQuery(cleanUrl, { action: 'list' }));
  if (!listRes.ok) {
    throw new Error(`雲端清單讀取失敗 (${listRes.status})`);
  }
  const listJson = await listRes.json();
  if (!listJson || !listJson.ok || !Array.isArray(listJson.files)) {
    throw new Error(listJson?.error || '雲端清單格式不符');
  }

  const pending = findNewCloudFiles(listJson.files, existingRecords);
  const results = [];

  for (let i = 0; i < pending.length; i++) {
    const file = pending[i];
    if (onProgress) onProgress(i + 1, pending.length, file.name);
    const dlRes = await fetchImpl(appendQuery(cleanUrl, { action: 'download', id: file.id }));
    if (!dlRes.ok) {
      throw new Error(`下載 ${file.name} 失敗 (${dlRes.status})`);
    }
    const dlJson = await dlRes.json();
    if (!dlJson || !dlJson.ok || !dlJson.base64) {
      throw new Error(dlJson?.error || `下載 ${file.name} 內容為空`);
    }
    results.push({
      file,
      arrayBuffer: base64ToArrayBuffer(dlJson.base64),
    });
  }

  return results;
}
