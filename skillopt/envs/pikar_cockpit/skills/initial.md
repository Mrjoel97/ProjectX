<!-- SkillOpt starting skill for the pikar_cockpit env — INTENTIONALLY has no prompt body. -->

The CURRENT ACTIVE `cockpit-agent` body is fetched from the Convex registry at run start and written
here by the CI job BEFORE `scripts/train.py` runs. Do NOT paste a prompt body into this file:

- A committed body goes stale the moment the registry's active version changes.
- Hardcoding an agent prompt in source violates CLAUDE.md §5 (skills load from the registry).

CI fetch (run start), judged by CLI output not exit code (Windows/Node24):

    node packages/backend/node_modules/convex/bin/main.js run skills:getActiveSkill '{"name":"cockpit-agent"}'
      -> write the returned `body` field to this path.
