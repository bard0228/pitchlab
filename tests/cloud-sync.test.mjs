import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToArrayBuffer,
  findNewCloudFiles,
  syncCloudLibrary,
} from '../src/cloud-sync.js';

test('base64ToArrayBuffer decodes base64 bytes accurately', () => {
  const original = new Uint8Array([80, 75, 3, 4, 1, 2, 255]);
  const b64 = Buffer.from(original).toString('base64');
  const ab = base64ToArrayBuffer(b64);
  assert.deepEqual(new Uint8Array(ab), original);
});

test('findNewCloudFiles skips files already stored by driveFileId or sourceFileName', () => {
  const cloudFiles = [
    { id: 'f1', name: '擱淺.zip', updatedAt: '2026-11-14T10:00:00Z' },
    { id: 'f2', name: '晴天.zip', updatedAt: '2026-11-14T11:00:00Z' },
    { id: 'f3', name: '七里香.zip', updatedAt: '2026-11-14T12:00:00Z' },
  ];
  const existing = [
    { id: 'local-1', driveFileId: 'f1', sourceFileName: '擱淺.zip' },
    { id: 'local-2', sourceFileName: '晴天.zip' },
  ];
  const pending = findNewCloudFiles(cloudFiles, existing);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'f3');
});

test('syncCloudLibrary fetches list and downloads only new zip files', async () => {
  const calls = [];
  const fakeZipBytes = Buffer.from('PK\x03\x04test').toString('base64');
  const mockFetch = async (url) => {
    calls.push(url);
    if (url.includes('action=list')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          files: [
            { id: 'old1', name: '舊歌.zip' },
            { id: 'new2', name: '新歌.zip' },
          ],
        }),
      };
    }
    if (url.includes('action=download') && url.includes('id=new2')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          id: 'new2',
          name: '新歌.zip',
          base64: fakeZipBytes,
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const downloaded = await syncCloudLibrary({
    syncUrl: 'https://script.google.com/macros/s/demo/exec',
    existingRecords: [{ id: '1', driveFileId: 'old1' }],
    fetchImpl: mockFetch,
  });

  assert.equal(calls.length, 2);
  assert.equal(downloaded.length, 1);
  assert.equal(downloaded[0].file.id, 'new2');
  assert.equal(downloaded[0].file.name, '新歌.zip');
  assert.equal(new TextDecoder().decode(downloaded[0].arrayBuffer), 'PK\x03\x04test');
});

test('syncCloudLibrary deduplicates multiple files with the same name', async () => {
  const downloadIds = [];
  const fakeZipBytes = Buffer.from('PK\x03\x04dup').toString('base64');
  const mockFetch = async (url) => {
    if (url.includes('action=list')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          files: [
            { id: 'dup1', name: '愛你.zip' },
            { id: 'dup2', name: '愛你.zip' },
          ],
        }),
      };
    }
    if (url.includes('action=download')) {
      const id = new URL(url).searchParams.get('id');
      downloadIds.push(id);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          id,
          name: '愛你.zip',
          base64: fakeZipBytes,
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const downloaded = await syncCloudLibrary({
    syncUrl: 'https://script.google.com/macros/s/demo/exec',
    existingRecords: [],
    fetchImpl: mockFetch,
  });

  assert.deepEqual(downloadIds, ['dup1']);
  assert.equal(downloaded.length, 1);
});

