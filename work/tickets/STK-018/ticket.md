# STK-018: Deployment to the WSL server

| Field | Value |
|---|---|
| State | DONE |
| Priority | P2 |
| Areas | architecture, security |
| Attempts | 2 |
| PR | https://github.com/mmlabs-online/stoktok/pull/18 |
| Created | 2026-10-22 |

## Goal
stoktok runs on Ming's WSL2 home server through the shared mmlabs deploy repo, reachable on its subdomain via Cloudflare Tunnel, with a runbook for deploy, rollback and logs.

## Spec reference
docs/spec-v1.md §4.1 Services, §7 Deployment, §9 Q7. CLAUDE.md Stack (Runtime), R3.

## Acceptance criteria
- [ ] Compose service definitions for `web` and `worker`, ready to add to the shared deploy repo, on the same network as cloudflared, with restart policies.
- [ ] Cloudflare Tunnel route for the app subdomain under mmlabs.online documented.
- [ ] Complete env variable list (names only, no values) matching `.env.example`; secrets stay in the deploy repo (R3).
- [ ] Worker restarts are safe: jobs are idempotent and resume from the last successful run (verified by a test or a documented check).
- [ ] Short runbook in `docs/`: deploy, roll back to a previous image tag, view logs.

## Notes / answers from Ming
- Depends on: STK-017 (images).
- **Auth is off (R6 suspended, 2026-10-23).** Do not expose the app publicly without either STK-004 done or Cloudflare Access on the subdomain — ask Ming which.
- **Input needed (⛔ blocking):** app subdomain (spec §9 Q7).
