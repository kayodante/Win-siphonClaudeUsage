const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'code',
  'code_verifier',
  'state'
]);

export function redactSensitive(value) {
  if (value instanceof Error) {
    return redactString(value.stack || `${value.name}: ${value.message}`);
  }
  if (typeof value === 'string') return redactString(value);
  if (value == null) return '';

  try {
    return redactString(JSON.stringify(redactObject(value)));
  } catch {
    return redactString(String(value));
  }
}

export function safeErrorMessage(error, fallback = 'Unexpected error') {
  const message =
    typeof error === 'string'
      ? error
      : typeof error?.message === 'string'
      ? error.message
      : '';
  const redacted = redactString(message).trim();
  return redacted || fallback;
}

export function logSafeError(label, error) {
  console.error(label, redactSensitive(error));
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      isSensitiveKey(key) ? redactSensitiveValue(nested) : redactObject(nested)
    ])
  );
}

function redactSensitiveValue(value) {
  if (typeof value === 'string' && /^Bearer\s+/i.test(value)) {
    return redactString(value);
  }
  return REDACTED;
}

function redactString(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /([?&](?:access_token|refresh_token|code|code_verifier|state)=)[^&#\s]+/gi,
      `$1${REDACTED}`
    )
    .replace(
      /\b(access_token|refresh_token|code|code_verifier|state)=([^&\s]+)/gi,
      `$1=${REDACTED}`
    )
    .replace(
      /("(?:access_token|refresh_token|accessToken|refreshToken|code_verifier|code|state)"\s*:\s*)"[^"]*"/g,
      `$1"${REDACTED}"`
    );
}

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(key);
}
