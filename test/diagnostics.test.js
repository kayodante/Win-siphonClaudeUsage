import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSensitive, safeErrorMessage } from '../src/shared/diagnostics.js';

test('redactSensitive masks bearer tokens', () => {
  const result = redactSensitive('Authorization: Bearer secret-access-token');

  assert.match(result, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(result, /secret-access-token/);
});

test('redactSensitive masks OAuth token fields in strings', () => {
  const result = redactSensitive(
    'Auth failed: {"access_token":"tok_123","refresh_token":"ref_456","expires_in":3600}'
  );

  assert.match(result, /"access_token":"\[REDACTED\]"/);
  assert.match(result, /"refresh_token":"\[REDACTED\]"/);
  assert.doesNotMatch(result, /tok_123/);
  assert.doesNotMatch(result, /ref_456/);
});

test('redactSensitive masks callback URLs with OAuth codes', () => {
  const result = redactSensitive(
    'https://platform.claude.com/oauth/code/callback?code=abc123&state=state456'
  );

  assert.match(result, /code=\[REDACTED\]/);
  assert.match(result, /state=\[REDACTED\]/);
  assert.doesNotMatch(result, /abc123/);
  assert.doesNotMatch(result, /state456/);
});

test('redactSensitive masks sensitive object keys recursively', () => {
  const result = redactSensitive({
    Authorization: 'Bearer top-secret',
    accessToken: 'access-value',
    refreshToken: 'refresh-value',
    nested: {
      code_verifier: 'verifier-value'
    }
  });

  assert.match(result, /"Authorization":"Bearer \[REDACTED\]"/);
  assert.match(result, /"accessToken":"\[REDACTED\]"/);
  assert.match(result, /"refreshToken":"\[REDACTED\]"/);
  assert.match(result, /"code_verifier":"\[REDACTED\]"/);
  assert.doesNotMatch(result, /top-secret|access-value|refresh-value|verifier-value/);
});

test('safeErrorMessage returns a redacted message with fallback for empty errors', () => {
  assert.equal(
    safeErrorMessage(new Error('Auth failed with code=abc123'), 'Fallback'),
    'Auth failed with code=[REDACTED]'
  );
  assert.equal(safeErrorMessage(null, 'Fallback'), 'Fallback');
});
