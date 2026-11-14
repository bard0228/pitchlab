import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseZipEntries } from '../src/zip-reader.js';

function makeCrc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildTestZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const { name, data, deflate } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const rawBytes = Buffer.from(data);
    const compBytes = deflate ? zlib.deflateRawSync(rawBytes) : rawBytes;
    const method = deflate ? 8 : 0;
    const crc = makeCrc32(rawBytes);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compBytes.length, 18);
    localHeader.writeUInt32LE(rawBytes.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compBytes.length, 20);
    centralHeader.writeUInt32LE(rawBytes.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localChunks.push(localHeader, nameBytes, compBytes);
    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compBytes.length;
  }

  const centralSize = centralChunks.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

test('parseZipEntries extracts both STORED and DEFLATED entries', async () => {
  const zipBuf = buildTestZip([
    { name: 'meta.json', data: '{"title":"青花瓷"}', deflate: true },
    { name: 'inst.opus', data: 'OPUS_DUMMY_BYTES', deflate: false },
  ]);

  const entries = await parseZipEntries(zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength));
  assert.equal(new TextDecoder().decode(entries['meta.json']), '{"title":"青花瓷"}');
  assert.equal(new TextDecoder().decode(entries['inst.opus']), 'OPUS_DUMMY_BYTES');
});
