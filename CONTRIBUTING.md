# Contributing to Grove

Grove is a **community commons** (see [`docs/decisions.md`](docs/decisions.md) ADR-0013): the project is
co-built by people using their own AI-coding tools in idle moments — with a human in the loop on every change.
Rewards are cosmetic by construction (ADR-0005); this is not a token/coin and nothing here earns money.

## The contribution loop

1. **Pick a task** — an open issue labelled `commons` or `good first issue`.
2. **Draft with your AI** — use your own AI-coding tool (Claude Code, Cursor, Aider, Codex…) to draft a patch.
   (`sq commons`, when shipped, will help draft for a claimed task — ADR-0013 P1.)
3. **You review it** — read the diff yourself. You are the author of record; never submit unreviewed AI output.
4. **Open a PR** from your fork, under your own GitHub identity.
5. **CI must pass** — typecheck + tests + build run on every PR ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
   Grove never runs your code on its own infra; GitHub Actions sandboxes it.
6. **A maintainer reviews + merges.** A merged PR is the verified contribution.

## In scope for the commons flow

- i18n locales (`src/i18n/catalog/*`), card packs (`src/core/cards.ts`), tool adapters (`src/adapters/*`),
  docs, and tests. Small, additive, well-tested changes.

## Out of scope (maintainer-only)

- **The ethics firewall**: the pure engine (`src/engine/`, `src/core/` purity) and anything touching ADR-0005.
  Grove's core guarantee — the engine is pure and rewards are cosmetic, so your real code/commits/git history can
  never be harmed by a game outcome — must not be alterable by community reputation. These paths are
  maintainer-gated; the commons flow can never land changes there.

## Ground rules

- **TDD**: write a failing test first, then make it pass. The test suite is the spec.
- **Tone** (`docs/TONE.md`): terse, no em-dash (use `·`), no cloying filler — in every locale.
- **Keep English byte-identical** when adding i18n keys (the contract test asserts it); add the key to all
  locales (the parity test enforces no locale drops a key).
- Run `npm run typecheck && npm test && npm run build` before opening a PR.

## Licensing

By opening a PR you agree your contribution is licensed under the repository's [MIT license](LICENSE).
