async function inflateRaw(compressedBytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('瀏覽器不支援 ZIP 解壓縮');
  }
  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

export async function parseZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Locate End of Central Directory (EOCD: 0x06054b50)
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('無效的歌包檔案（找不到 ZIP 目錄結尾）');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = {};

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) {
      throw new Error('歌包目錄結構損毀');
    }
    const method = view.getUint16(cdOffset + 10, true);
    const compSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localOffset = view.getUint32(cdOffset + 42, true);

    const rawName = decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    const baseName = rawName.split('/').pop();
    cdOffset += 46 + nameLen + extraLen + commentLen;

    if (!baseName || rawName.endsWith('/')) continue;

    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`歌包檔案標頭損毀：${baseName}`);
    }
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compSlice = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      entries[baseName] = new Uint8Array(compSlice);
    } else if (method === 8) {
      entries[baseName] = await inflateRaw(compSlice);
    } else {
      throw new Error(`不支援的壓縮格式 (${method})：${baseName}`);
    }
  }

  return entries;
}
