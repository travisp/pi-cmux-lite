# AGENTS.md

## Repo overview

This repository contains `pi-cmux-lite`, a lightweight fork of `pi-cmux` with a small subset of cmux-powered workflows for Pi.

Published extensions:
- `extensions/cmux-notify.ts` — cmux-backed notifications for Pi runs
- `extensions/cmux-split.ts` — fresh Pi sessions in a new cmux split
- `extensions/cmux-open.ts` — arbitrary shell commands in a new cmux split
- `extensions/cmux-core.ts` — shared cmux helpers

Source-of-truth files:
- `package.json` — published package contents and Pi extension entrypoints
- `README.md` — brief user-facing description of the lite fork
- `CHANGELOG.md` — lite fork change notes

## Editing guidelines

- Keep changes aligned with the lite subset only.
- Prefer small, focused edits.
- Update `package.json`, `README.md`, and `CHANGELOG.md` together when the published surface changes.
- Extra upstream files may remain in the repo, but `package.json` is the source of truth for what ships.
