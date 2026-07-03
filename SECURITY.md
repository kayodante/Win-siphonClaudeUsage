# Security Policy

## Supported versions

Only the latest GitHub release is supported. Siphon doesn't maintain LTS or
patch branches — if you're on an older version, please update before
reporting an issue.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Please use GitHub's private reporting instead:

1. Go to the [Security tab](../../security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, affected version, and reproduction steps if possible.

There's no dedicated security email — the Security tab is the only channel
for reports. You'll get a response as soon as reasonably possible; this is a
solo-maintained project, so response time may vary.

## Scope

Siphon reads local Claude Code usage files and calls the Anthropic OAuth
usage endpoint. Relevant areas for security review:

- OAuth token storage (`src/main/tokenStore.js`, DPAPI encryption via
  `safeStorage`)
- The PKCE sign-in flow (`src/main/oauthService.js`)
- File permission handling (`src/main/jsonStore.js`)
- Diagnostic log redaction (`src/shared/diagnostics.js`)

See `docs/privacy-policy.md` for what data Siphon touches and where it's
stored.
