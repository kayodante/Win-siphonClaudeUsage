import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isNewer, checkForUpdate, downloadFile } from '../src/main/updateService.js';

// ── isNewer ───────────────────────────────────────────────────────────────────

test('isNewer: major bump', () => assert.ok(isNewer('2.0.0', '1.9.9')));
test('isNewer: minor bump', () => assert.ok(isNewer('1.1.0', '1.0.9')));
test('isNewer: patch bump', () => assert.ok(isNewer('1.0.10', '1.0.9')));
test('isNewer: same version returns false', () => assert.ok(!isNewer('1.0.0', '1.0.0')));
test('isNewer: older tag returns false', () => assert.ok(!isNewer('1.0.0', '1.0.1')));
test('isNewer: v-prefix stripped correctly', () => assert.ok(isNewer('v1.1.0', '1.0.0')));
test('isNewer: older major returns false', () => assert.ok(!isNewer('1.0.0', '2.0.0')));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeHttps(statusCode, release) {
  return {
    get(_url, _opts, callback) {
      const req = new EventEmitter();
      req.destroy = err => { if (err) process.nextTick(() => req.emit('error', err)); };

      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.resume = () => {};

      process.nextTick(() => {
        callback(res);
        process.nextTick(() => {
          const buf = Buffer.from(JSON.stringify(release));
          res.emit('data', buf);
          process.nextTick(() => res.emit('end'));
        });
      });

      return req;
    }
  };
}

function makeFakeHttpsLargeBody() {
  return {
    get(_url, _opts, callback) {
      const req = new EventEmitter();
      req.destroy = err => { if (err) process.nextTick(() => req.emit('error', err)); };

      const res = new EventEmitter();
      res.statusCode = 200;
      res.resume = () => {};

      process.nextTick(() => {
        callback(res);
        process.nextTick(() => {
          // single chunk larger than 512 KB triggers the body-size guard
          res.emit('data', Buffer.alloc(512 * 1024 + 1, 0x78));
          process.nextTick(() => res.emit('end'));
        });
      });

      return req;
    }
  };
}

function makeFakeHttpsError(statusCode) {
  return {
    get(_url, _opts, callback) {
      const req = new EventEmitter();
      req.destroy = () => {};

      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.resume = () => {};

      process.nextTick(() => {
        callback(res);
        process.nextTick(() => res.emit('end'));
      });

      return req;
    }
  };
}

// ── checkForUpdate ────────────────────────────────────────────────────────────

test('checkForUpdate returns null when not packaged', async () => {
  const result = await checkForUpdate({ isPackaged: false, version: '1.0.0' });
  assert.equal(result, null);
});

test('checkForUpdate returns null for draft release', async () => {
  const httpImpl = makeFakeHttps(200, { tag_name: 'v1.1.0', draft: true, prerelease: false });
  const result = await checkForUpdate({ isPackaged: true, version: '1.0.0', httpImpl });
  assert.equal(result, null);
});

test('checkForUpdate returns null for prerelease', async () => {
  const httpImpl = makeFakeHttps(200, { tag_name: 'v1.1.0', draft: false, prerelease: true });
  const result = await checkForUpdate({ isPackaged: true, version: '1.0.0', httpImpl });
  assert.equal(result, null);
});

test('checkForUpdate returns update info when newer version is available', async () => {
  const httpImpl = makeFakeHttps(200, { tag_name: 'v1.1.0', draft: false, prerelease: false });
  const result = await checkForUpdate({ isPackaged: true, version: '1.0.0', httpImpl });
  assert.equal(result?.version, '1.1.0');
  assert.ok(result?.url.includes('github.com'));
});

test('checkForUpdate returns null when already up to date', async () => {
  const httpImpl = makeFakeHttps(200, { tag_name: 'v1.0.0', draft: false, prerelease: false });
  const result = await checkForUpdate({ isPackaged: true, version: '1.0.0', httpImpl });
  assert.equal(result, null);
});

test('checkForUpdate returns null on HTTP error status', async () => {
  const httpImpl = makeFakeHttpsError(404);
  const result = await checkForUpdate({ isPackaged: true, version: '1.0.0', httpImpl });
  assert.equal(result, null);
});

test('checkForUpdate returns null when response body exceeds 512 KB', async () => {
  const result = await checkForUpdate({
    isPackaged: true,
    version: '1.0.0',
    httpImpl: makeFakeHttpsLargeBody()
  });
  assert.equal(result, null);
});

// ── downloadFile helpers ──────────────────────────────────────────────────────

function makeDownloadHttps(responses) {
  let callIndex = 0;
  return {
    get(_url, _opts, callback) {
      const req = new EventEmitter();
      req.destroy = err => { if (err) process.nextTick(() => req.emit('error', err)); };
      const { statusCode, headers = {}, body = null } = responses[callIndex++];
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.headers = headers;
      res.resume = () => {};
      process.nextTick(() => {
        callback(res);
        if (body !== null) {
          process.nextTick(() => {
            res.emit('data', Buffer.from(body));
            process.nextTick(() => res.emit('end'));
          });
        } else {
          process.nextTick(() => res.emit('end'));
        }
      });
      return req;
    }
  };
}

// ── checkForUpdate — downloadUrl ──────────────────────────────────────────────

test('checkForUpdate includes downloadUrl for installer asset', async () => {
  const release = {
    tag_name: 'v1.1.0',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'Siphon Setup 1.1.0.exe', browser_download_url: 'https://cdn.example.com/Siphon+Setup+1.1.0.exe' },
      { name: 'Siphon-Portable-1.1.0.exe', browser_download_url: 'https://cdn.example.com/Siphon-Portable-1.1.0.exe' }
    ]
  };
  const result = await checkForUpdate({ isPackaged: true, version: '1.0.0', httpImpl: makeFakeHttps(200, release) });
  assert.equal(result?.downloadUrl, 'https://cdn.example.com/Siphon+Setup+1.1.0.exe');
});

test('checkForUpdate sets downloadUrl to null when no installer asset', async () => {
  const release = { tag_name: 'v1.1.0', draft: false, prerelease: false, assets: [] };
  const result = await checkForUpdate({ isPackaged: true, version: '1.0.0', httpImpl: makeFakeHttps(200, release) });
  assert.equal(result?.downloadUrl, null);
});

// ── downloadFile ──────────────────────────────────────────────────────────────

test('downloadFile writes content to disk and reports progress', async (t) => {
  const dest = path.join(os.tmpdir(), `siphon-test-${Date.now()}.exe`);
  const body = 'fake installer content';
  const httpImpl = makeDownloadHttps([
    { statusCode: 200, headers: { 'content-length': String(body.length) }, body }
  ]);
  const progress = [];
  await downloadFile('https://example.com/setup.exe', dest, p => progress.push(p), httpImpl);
  assert.equal(fs.readFileSync(dest, 'utf8'), body);
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1), 100);
  t.after(() => fs.unlink(dest, () => {}));
});

test('downloadFile follows a single redirect', async (t) => {
  const dest = path.join(os.tmpdir(), `siphon-test-${Date.now()}.exe`);
  const body = 'redirected content';
  const httpImpl = makeDownloadHttps([
    { statusCode: 302, headers: { location: 'https://cdn.example.com/setup.exe' } },
    { statusCode: 200, headers: { 'content-length': String(body.length) }, body }
  ]);
  await downloadFile('https://example.com/setup.exe', dest, null, httpImpl);
  assert.equal(fs.readFileSync(dest, 'utf8'), body);
  t.after(() => fs.unlink(dest, () => {}));
});

test('downloadFile follows 307/308 redirects', async (t) => {
  const dest = path.join(os.tmpdir(), `siphon-test-${Date.now()}.exe`);
  const body = 'redirected content';
  const httpImpl = makeDownloadHttps([
    { statusCode: 307, headers: { location: 'https://cdn.example.com/a.exe' } },
    { statusCode: 308, headers: { location: 'https://cdn.example.com/b.exe' } },
    { statusCode: 200, headers: { 'content-length': String(body.length) }, body }
  ]);
  await downloadFile('https://example.com/setup.exe', dest, null, httpImpl);
  assert.equal(fs.readFileSync(dest, 'utf8'), body);
  t.after(() => fs.unlink(dest, () => {}));
});

test('downloadFile resolves relative redirect locations against the current URL', async (t) => {
  const dest = path.join(os.tmpdir(), `siphon-test-${Date.now()}.exe`);
  const body = 'relative redirect content';
  const urls = [];
  const inner = makeDownloadHttps([
    { statusCode: 302, headers: { location: '/files/setup.exe' } },
    { statusCode: 200, headers: { 'content-length': String(body.length) }, body }
  ]);
  const httpImpl = {
    get(url, opts, callback) {
      urls.push(url);
      return inner.get(url, opts, callback);
    }
  };
  await downloadFile('https://example.com/setup.exe', dest, null, httpImpl);
  assert.equal(urls[1], 'https://example.com/files/setup.exe');
  assert.equal(fs.readFileSync(dest, 'utf8'), body);
  t.after(() => fs.unlink(dest, () => {}));
});

test('downloadFile rejects insecure (non-https) redirects', async () => {
  const dest = path.join(os.tmpdir(), `siphon-test-${Date.now()}.exe`);
  const httpImpl = makeDownloadHttps([
    { statusCode: 302, headers: { location: 'http://evil.example.com/setup.exe' } }
  ]);
  await assert.rejects(
    () => downloadFile('https://example.com/setup.exe', dest, null, httpImpl),
    /insecure redirect/
  );
});

test('downloadFile rejects on HTTP error status', async () => {
  const dest = path.join(os.tmpdir(), `siphon-test-${Date.now()}.exe`);
  const httpImpl = makeDownloadHttps([{ statusCode: 404, headers: {} }]);
  await assert.rejects(
    () => downloadFile('https://example.com/setup.exe', dest, null, httpImpl),
    /HTTP 404/
  );
});

test('downloadFile resolves correctly when content-length is absent', async (t) => {
  const dest = path.join(os.tmpdir(), `siphon-test-${Date.now()}.exe`);
  const body = 'no content length';
  const httpImpl = makeDownloadHttps([
    { statusCode: 200, headers: {}, body }
  ]);
  const progress = [];
  await downloadFile('https://example.com/setup.exe', dest, p => progress.push(p), httpImpl);
  assert.equal(fs.readFileSync(dest, 'utf8'), body);
  assert.equal(progress.length, 0);
  t.after(() => fs.unlink(dest, () => {}));
});
