# AGENTS.md — dsh-offpeak-job

User-facing intro: [README.md](README.md) / [README.zh.md](README.zh.md). Keep those readable for people installing the plugin; put contributor rules here.

## Hard rule

**This plugin must fulfill its product requirements on its own.** Do not modify DeepSeek Harness framework sources (`packages/`, `apps/`, `vendor/`, or other in-repo harness packages) to unblock or improve `dsh-offpeak-job`.

- Implement Host/Client behavior only under `dsh-offpeak-job/`.
- Use existing public extension points only (Cordis inject, slots, `agent.followup` / `send`, webServer routes, etc.). If a point is insufficient, work around inside the plugin or document the gap — do not land a harness patch “for the plugin.”
- Keep the package installable alone (`npm run build` → `lib/` + patch; `dsh plugin … add`) without a paired harness PR.

Rationale and current approach: [.agents/notes/implemented/feature/2026-09-10-offpeak-park-without-harness-changes.md](../.agents/notes/implemented/feature/2026-09-10-offpeak-park-without-harness-changes.md) (from repo root).
