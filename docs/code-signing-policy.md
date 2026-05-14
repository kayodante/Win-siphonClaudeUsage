# Code Signing Policy

Siphon Windows installers are signed through the [SignPath Foundation](https://signpath.org/), a non-profit organization that provides free code signing for open-source projects, using infrastructure provided by [SignPath.io](https://signpath.io/).

## Signed artifacts

The following artifact is signed for each release:

| Artifact | Type |
|----------|------|
| `Siphon.Setup.<version>.exe` | NSIS installer (Windows x64) |

## Team

| GitHub | Role | Responsibilities |
|--------|------|-----------------|
| [@kayodante](https://github.com/kayodante) | Author, Approver | Maintains the source repository and authorizes all release builds for signing |

This is a solo project. All code changes and release approvals go through the same account.

## Process

1. A GitHub Release is created from the `main` branch.
2. The installer is built via `electron-builder` in CI.
3. The artifact is submitted to SignPath.io for signing.
4. Only artifacts that pass the SignPath policy (product name and version metadata match) are signed and published.

## Privacy

See [privacy-policy.md](privacy-policy.md) for details on what data Siphon stores and what network requests it makes.

## Violations

Any suspected policy violation can be reported by opening an issue at https://github.com/kayodante/Win-siphonClaudeUsage/issues or contacting the SignPath Foundation directly.
