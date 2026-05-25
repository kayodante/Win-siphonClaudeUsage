import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { isNewer, checkForUpdate } from '../src/main/updateService.js';

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
