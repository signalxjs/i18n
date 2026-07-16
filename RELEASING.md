# Releasing

Publishing happens via GitHub Actions tag push, using npm Trusted Publishing (OIDC). No `NPM_TOKEN` is stored.

## Pre-release checklist

- [ ] `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass on `main`.
- [ ] `pnpm publish:dry` succeeds.
- [ ] `CHANGELOG.md` entries added.
- [ ] `repository`, `homepage`, `bugs` fields point at `signalxjs/router`.

## Cutting a release

```bash
pnpm version:patch          # or minor / major / explicit
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push --follow-tags
```

The release workflow runs on tag push.

## Onboarding a new package to npm Trusted Publishing

For each package the **first publish** must be done manually with an authenticated npm account. Then on https://www.npmjs.com/package/<name>/access:

1. Settings → Trusted Publishers → Add a Trusted Publisher.
2. Provider: GitHub Actions.
3. Repository owner: `signalxjs`. Repository: `router`. Workflow filename: `release.yml`.

Subsequent publishes happen automatically via OIDC. Tarballs carry npm provenance attestation and the verified publisher badge.
