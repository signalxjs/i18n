# SignalX i18n — shared agent guide

> ⚠️ **BRANCH FIRST — never work on `main`.** Before touching ANY file, create a
> worktree (`pnpm wt new <N-short-slug>`) and do everything from
> `<repo>/branches/<N-short-slug>`. This applies to every change, however small —
> editing or committing in the primary checkout (`<repo>/main`) causes conflicts
> for parallel sessions. Check yourself before every commit:
> `git branch --show-current` must print your worktree's branch name — if it
> prints `main` or nothing (detached HEAD), stop.
> Already edited files in `main` by mistake? Move the work, don't commit it:
> `git stash -u` → `pnpm wt new <N-short-slug>` →
> `cd <repo>/branches/<N-short-slug>` → `git stash pop`.

Canonical guidance for **any** AI agent working in this repo (Claude Code, GitHub
Copilot CLI, work agents, …). Tool-specific notes live in `CLAUDE.md`; it defers
here for everything shared — when it conflicts with this file, the tool-specific
file wins for that tool only.

This is the sigx standard agent setup. The same pattern (this file +
`scripts/worktree.mjs` + a thin tool-specific file) is used across sigx repos —
it originates in [`signalxjs/repo-template`](https://github.com/signalxjs/repo-template).
See "Adopting this setup in another sigx repo" at the bottom.

SignalX `i18n` (`signalxjs/i18n`) — Reactive localization for SignalX: namespaces,
a master locale with automatic fallback, API-defined targets (scopes), locale
detection, SSR-safe state transfer, and easy UI binding. A pnpm monorepo (ESM,
`"type": "module"`) with the package under `packages/`. Tech stack: TypeScript
(strict), Vite 8, Vitest (happy-dom), oxlint; published to npm under the `@sigx`
scope.

## Development workflow (issue → PR → Copilot review → merge)

**This is mandatory for EVERY agent-driven change — including one-line fixes.
Never commit straight to `main`.** Repo: `signalxjs/i18n`, base branch `main`.
(Human contributors follow `CONTRIBUTING.md`, where an issue is optional; for
agents the issue-first flow below is required.)

1. **Issue first.** If no GitHub issue already tracks the work, create one *before*
   writing code and put the plan in it:
   ```sh
   gh issue create --title "<concise title>" --body "<what & why, plus the plan/checklist>"
   ```
   If you worked in plan mode, the approved plan **is** the issue body. Note the
   number it returns (`#N`).

2. **Worktree, always.** Never work on `main`. Use the worktree flow (below):
   `pnpm wt new <N-short-slug>` gives an isolated checkout on branch
   `<N-short-slug>`.

3. **Implement & verify.** For a **bug fix, write a failing unit test first** (red),
   then fix it (green). Either way, prove the change: `pnpm typecheck` (always, for
   any `.ts`) plus the relevant `pnpm test` / `pnpm build`. Stage specific files
   (`git add <path>`), never `git add -A`. No co-author trailers.

4. **Open a PR with Copilot as the reviewer.** Reference the issue so it auto-closes
   on merge:
   ```sh
   gh pr create --base main --title "<title>" \
     --body "Closes #N. <short summary of the change>" --reviewer @copilot
   ```
   If your `gh` can't resolve `@copilot`, request it via the API:
   ```sh
   gh api --method POST repos/signalxjs/i18n/pulls/<pr>/requested_reviewers \
     -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   ```

5. **Wait for Copilot's review, then fix.** Poll until a review by
   `copilot-pull-request-reviewer` appears, address every actionable comment with
   follow-up commits, re-request if needed. Repeat until clean.

   **Then resolve the threads.** The sigx-standard ruleset sets
   `required_review_thread_resolution`, so a PR with an unresolved **inline**
   comment cannot merge, even with every check green. It silently never enters
   the merge queue, and `gh pr checks` shows nothing wrong. Resolve each thread
   you address. For one you deliberately decline, reply with the reason, then
   resolve it. Pushing the fix does not resolve a thread, and neither does
   replying at PR level. There is no `gh pr` porcelain — reply on each thread
   and resolve it over GraphQL:
   ```sh
   # list the open threads
   gh api graphql -f query='query { repository(owner:"signalxjs", name:"i18n") {
     pullRequest(number:<pr>) { reviewThreads(first:100) { nodes {
       id isResolved comments(first:1){nodes{body}} } } } } }' \
     -q '.data.repository.pullRequest.reviewThreads.nodes[]
         | select(.isResolved==false) | "\(.id) \(.comments.nodes[0].body[0:60])"'

   # reply (say which commit fixed it), then resolve — pass the body as a
   # GraphQL variable, not string-interpolated: quotes and backslashes in a
   # review reply otherwise break the query
   gh api graphql -f query='mutation($t:ID!,$b:String!){
     addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t, body:$b}){ comment { id } } }' \
     -f t="<thread-id>" -f b="Fixed in <sha>. <what changed>"
   gh api graphql -f query='mutation($t:ID!){
     resolveReviewThread(input:{threadId:$t}){ thread { isResolved } } }' -f t="<thread-id>"
   ```


6. **Queue the merge yourself.** Once Copilot's feedback is resolved (threads
   included), the PR's checks are green, and, for user-facing changes, the
   docs issue is filed on the docs repo and linked from the PR (see
   "Documentation"), add the PR to `main`'s **merge queue**:
   ```sh
   pr=123                                     # your PR number (digits only)
   gh pr checks "$pr"                         # must be all green first
   gh pr merge "$pr" --squash --auto          # NOT --delete-branch: rejected
                                              # outright when a queue is enabled.
                                              # The queue deletes the branch itself.
   ```
   Check the non-required jobs too (e.g. `coverage`, `e2e`). The queue waits
   only on the required checks, so it merges without them.

   Then confirm the PR actually entered the queue. Armed auto-merge is not the
   same thing:
   ```sh
   gh api graphql -f query='query { repository(owner:"signalxjs", name:"i18n") {
     pullRequest(number:'"$pr"') {
       mergeStateStatus mergeQueueEntry { state position } } } }'
   ```
   `mergeQueueEntry: null` with `mergeStateStatus: BLOCKED` and every check
   green means something the checks don't show is blocking it. In practice that
   is an unresolved review thread (step 5). The PR just sits there until you
   clear it.

   How the queue works:
   - It tests queued PRs in groups against the latest `main` and squash-merges
     them in order. That is why the required checks are not strict: there is
     no "update branch" step, so don't rebase a PR just to make it current, and
     don't race `main` with a plain `gh pr merge`.
   - `ci.yml`'s `merge_group` trigger is what makes the checks run on the
     queue's ref. Never remove it, or queued PRs wait forever.
   - The squash commit takes the PR title plus ` (#<pr>)` as its subject and
     the PR description as its body (repo settings). Write both as the commit
     you want on `main`. Explicit `--subject`/`--body` does not apply to queue
     merges.
   - If the queue evicts a PR, there is a real conflict (usually a CHANGELOG
     `[Unreleased]` entry). Rebase on `main`, keep both sides, push, and
     enqueue again. Making the CHANGELOG entry the PR's last commit keeps that
     window small.
   - GitHub writes the queue's commit message itself, and it appends
     `Co-authored-by:` trailers when a branch commit's author differs from the
     merging account. So keep every commit on your branch authored by you.

   If you used a worktree, remove it once the PR has landed: `pnpm wt rm <name>`.

## Build, Test, Lint

```bash
pnpm install
pnpm build
pnpm test         # vitest run
pnpm test:watch
pnpm test:coverage
pnpm typecheck    # tsgo --noEmit
pnpm lint         # oxlint
pnpm lint:fix
pnpm size         # size-limit bundle-size check
pnpm verify:pack  # verify npm pack output is sane
pnpm verify:bytes # reject raw control bytes in src/ and dist/
```

`verify:bytes` also runs at the end of the package build, so `dist/` is gated on
every build — including the release one. A raw NUL there parses in Node and kills
the whole bundle on QuickJS-family engines (lynx/PrimJS); see issue #53.

To run a package script: `pnpm --filter <package-name> <script>`.

## Packages

- `packages/i18n` → `@sigx/i18n` — Reactive localization for SignalX. Subpath
  exports: `.` (core: store, `useTranslation` accessor, `<T>` component, plugin),
  `./server` (non-reactive translator for mail/jobs — same typed surface as the
  client, sigx-free), `./vite` (typed-keys codegen
  + missing-translation build gate + HMR).

## Parallel work with git worktrees

```sh
pnpm wt new <name> [--from <branch>]   # worktree at <repo>/branches/<name>
pnpm wt list
pnpm wt rm <name> [--force]
```
Layout convention (all sigx repos): the primary checkout lives at `<repo>/main`
and every worktree at `<repo>/branches/<name>`. Launch a **separate agent session
from the worktree directory**. Names: letters, digits, `.`, `_`, `-` only.

## Documentation

Docs are part of the change, not a follow-up. In-repo docs (`README.md`,
`CHANGELOG.md`, this file, the package table) ship in the same PR. The docs
**site** (`signalxjs/signalxjs.github.io`) is separate — don't edit it from here;
instead, before merging a user-facing PR, file an issue on the docs repo and link
it from the PR, and comment the release tag on those issues when you cut a release.

## Conventions & working principles

- **Plan first for non-trivial work.** Use plan mode; let the CLI manage the plan.
- **Verify before declaring done.** Run typecheck/tests; show evidence.
- **Test-first bug fixes.** Reproduce with a failing test first, then fix.
- **Dev-only code goes behind `__DEV__`.** It's a compile-time flag (false in prod
  builds), defined by `defineLibConfig` for builds and `vitest.config.ts` for
  tests; ambient type in `src/env.d.ts`.
- **Minimal, surgical edits.** No unrelated refactors; no compat shims for things
  that never shipped.
- **Cross-platform paths.** Prefer Node scripts over shell one-liners for anything
  committed.
- **Git hygiene.** Stage specific files, never `git add -A`. Run `pnpm typecheck`
  before any commit touching `.ts`. No co-author trailers.

## Adopting this setup in another sigx repo

This file, `scripts/worktree.mjs`, and `CLAUDE.md` are the portable sigx standard,
maintained in [`signalxjs/repo-template`](https://github.com/signalxjs/repo-template).
Copy `scripts/worktree.mjs` and `CLAUDE.md` verbatim; copy this `AGENTS.md` as a
template and adapt the intro, "Build, Test, Lint", and "Packages" sections; keep
the workflow/worktree/conventions sections as-is. Lock down `main`:
`node scripts/apply-branch-protection.mjs signalxjs/i18n`.
