## Summary

<!-- What does this PR do and why? -->

## Related issue

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / chore
- [ ] Docs
- [ ] Breaking change

## Testing checklist

- [ ] `npm test` passes
- [ ] `npm run test:rust` passes (if Rust changed)
- [ ] `npm run lint` passes
- [ ] Touched the reset scheduler (`crates/siphon-core/src/reset_scheduler.rs`)? Ran `npm run test:rust`
- [ ] Bumped the version (`npm version <patch|minor|major> --no-git-tag-version`) and all four manifests agree — `package.json`, both `Cargo.toml`s, `tauri.conf.json`
- [ ] Updated `CLAUDE.md`/`AGENTS.md`/`ARCHITECTURE.md`/`ROADMAP.md` if behavior they describe changed
