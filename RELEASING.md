# Releasing

Publishing happens via GitHub Actions tag push, using npm Trusted Publishing (OIDC). No `NPM_TOKEN` is stored.

## Pre-release checklist

- [ ] `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass on `main`.
- [ ] **Only if `npm whoami` succeeds:** `pnpm publish:dry` passes. Not a release
      blocker — it is a local convenience check that needs a local npm login,
      while the real publish uses OIDC in CI and needs no token. A 401 here means
      you are logged out, not that anything is wrong with the packages, and the
      release workflow re-runs lint/typecheck/build/test before publishing.
- [ ] `CHANGELOG.md` entries added, and `## [Unreleased]` rolled into a
      `## [X.Y.Z] - YYYY-MM-DD` section (leave an empty `## [Unreleased]` above it).
- [ ] `repository`, `homepage`, `bugs` fields point at `signalxjs/i18n`.
- [ ] Pre-1.0: a **breaking** change bumps the MINOR, not the patch.

## Cutting a release

`main` is protected by the `sigx-standard: protect main branch` ruleset, which
requires a pull request — so the version bump cannot be committed to `main`
directly. It goes through the normal flow; only the **tag** is pushed straight.

```bash
pnpm wt new release-X.Y.Z && cd ../branches/release-X.Y.Z
pnpm version:minor          # or patch / major / an explicit X.Y.Z
# roll CHANGELOG's [Unreleased] into [X.Y.Z] - YYYY-MM-DD
git commit -am "release: vX.Y.Z"
gh pr create --base main --title "release: vX.Y.Z" --body "…" --reviewer @copilot
```

Once it is merged, tag the merge commit on `main` and push the tag. A ruleset
targeting a *branch* does not gate tags, so this part needs no PR:

```bash
git -C <repo>/main pull --ff-only
git -C <repo>/main tag vX.Y.Z
git -C <repo>/main push origin vX.Y.Z
pnpm wt rm release-X.Y.Z
```

The release workflow runs on tag push: lint → typecheck → build → test → `npm
publish` (OIDC + provenance) → GitHub release. If release-drafter already has a
draft for the tag it is promoted rather than replaced.

Afterwards, comment the release tag on any docs-repo issues the release closes
(see "Documentation" in `AGENTS.md`).

## Onboarding a new package to npm Trusted Publishing

For each package the **first publish** must be done manually with an authenticated npm account. Then on https://www.npmjs.com/package/<name>/access:

1. Settings → Trusted Publishers → Add a Trusted Publisher.
2. Provider: GitHub Actions.
3. Repository owner: `signalxjs`. Repository: `i18n`. Workflow filename: `release.yml`.

Subsequent publishes happen automatically via OIDC. Tarballs carry npm provenance attestation and the verified publisher badge.
