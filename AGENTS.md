@[project rules](CLAUDE.md)

## Antigravity-only notes

- Role: Antigravity writes **test cases only**; design, implementation, refactors and
  review belong to Claude. Only change test files: `**/*.test.ts`, `**/*.test.tsx`
  (Vitest, configs in `apps/*/vitest.config.ts` and `packages/*/vitest.config.ts`).
- Run `pnpm test` before handing over.
- Output goes through the normal PR → CI → reviewer pipeline; never merge your own work.
- Headless `agy`: never `--dangerously-skip-permissions`; always set `--print-timeout`.
- Do not add `GEMINI.md` next to this file.
