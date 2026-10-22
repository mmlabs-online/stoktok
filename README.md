# stoktok

Personal stock tracking and investment assistant for the Vietnamese market. Part of mmlabs.

- Scope: [docs/spec-v1.md](docs/spec-v1.md)
- How Claude Code works in this repo (stack, rules, workflow): [CLAUDE.md](CLAUDE.md)

## Workflow quick start
```
/ticket "Add CSV import for TCInvest statements" P2   # create a ticket
/run STK-001                                          # plan → implement → review, automatically
/status                                               # board summary
```
Each ticket runs on branch `ticket/STK-xxx`. Review the result and merge into `main` yourself.

> Reference only — not investment advice.
