import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeExternalUrl } from '../src/main/security.js';

test('isSafeExternalUrl returns true for trusted HTTPS URLs', () => {
  assert.equal(isSafeExternalUrl('https://claude.ai/settings/usage'), true);
  assert.equal(isSafeExternalUrl('https://github.com/kayodante/Win-siphonClaudeUsage'), true);
});

test('isSafeExternalUrl returns false for HTTP URLs even if domain is trusted', () => {
  assert.equal(isSafeExternalUrl('http://claude.ai/settings/usage'), false);
  assert.equal(isSafeExternalUrl('http://github.com/kayodante'), false);
});

test('isSafeExternalUrl returns false for untrusted domains', () => {
  assert.equal(isSafeExternalUrl('https://example.com'), false);
  assert.equal(isSafeExternalUrl('https://evil.com'), false);
  assert.equal(isSafeExternalUrl('https://github.com.evil.com'), false);
});

test('isSafeExternalUrl returns false for invalid URLs', () => {
  assert.equal(isSafeExternalUrl('not a url'), false);
  assert.equal(isSafeExternalUrl(''), false);
  assert.equal(isSafeExternalUrl(null), false);
  assert.equal(isSafeExternalUrl(undefined), false);
});

test('isSafeExternalUrl returns false for local file paths and unsupported protocols', () => {
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('data:text/html,<h1>hi</h1>'), false);
});
