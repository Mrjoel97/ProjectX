"""SkillOpt rollout for the pikar_cockpit env (skillopt==0.2.0).

`run_batch` scores a candidate skill body by EXECUTING the real cockpit skill — it shells out to
`convex run llm:runCockpitAgent` with `skillVersions` pinned to the candidate, exactly the seam
`run-eval-golden.mjs` uses (RESEARCH Pitfall 3: there is no Python re-implementation of the cockpit
engine — the only correct execution is the live Convex deployment).

Windows/Node24: `convex run` can crash on exit teardown with a bogus non-zero exit code, and tenantIds
contain "|", so we invoke NODE DIRECTLY via subprocess (never a shell) and judge success by OUTPUT,
not exit code — mirroring smokeRun.mjs `must()` (RESEARCH Pitfall 6).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# skillopt/envs/pikar_cockpit/rollout.py -> repo root is parents[3].
REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = REPO_ROOT / "packages" / "backend"
CONVEX_BIN = BACKEND_DIR / "node_modules" / "convex" / "bin" / "main.js"

# Distinctive markers the convex CLI prints on a genuine function failure (from smokeRun.mjs).
_FAILURE = re.compile(r"Failed to run function|Uncaught Error|isn't running|not listening")

SKILL_NAME = "cockpit-agent"


def _convex_run(fn: str, args: dict) -> str:
    """Mirror smokeRun.mjs must(): `node <convex/bin/main.js> run <fn> <json>` — node directly, no
    shell, JSON args as a single argv element. Judge failure by stderr banner, return stdout."""
    proc = subprocess.run(
        ["node", str(CONVEX_BIN), "run", fn, json.dumps(args)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    stderr = proc.stderr or ""
    if _FAILURE.search(stderr):
        raise RuntimeError(f"{fn} failed: {stderr.strip()}")
    return proc.stdout


def _pin_candidate(skill_content: str, *, name: str = SKILL_NAME) -> int:
    """Materialize `skill_content` as a pinnable registry version and return its number.

    The only body->version seam that exists is POST /skillopt/writeback (08-05), which inserts a
    gated CANDIDATE (never active). ponytail: writeback also writes an audit row + owner notification
    per call, so a long train run mints several candidates — acceptable for the dormant dry-run
    (low edit budget, one run_batch -> one candidate). Upgrade path: a dedicated ephemeral no-notify
    dev-pin seam, decided at the 08-08 dry-run if a real cadence makes the noise matter.
    """
    base = os.environ["SKILLOPT_HTTP_URL"].rstrip("/")
    token = os.environ["SKILLOPT_TOKEN"]
    payload = {
        "name": name,
        "body": skill_content,
        "runId": os.environ.get("SKILLOPT_RUN_ID", "rollout"),
        "negativeRate": 0,
        "sampleCount": 0,
        "tenantId": os.environ.get("SKILLOPT_TENANT", "skillopt-rollout"),
    }
    req = urllib.request.Request(
        f"{base}/skillopt/writeback",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:  # noqa: S310 - owner's own deployment, bearer-authed
        return int(json.load(resp)["toVersion"])


def _user_turns(item: dict) -> list[str]:
    """The user-role turns to feed runCockpitAgent, from the scrubbed export item."""
    conv = item.get("conversation")
    if isinstance(conv, list) and conv:
        turns = [
            c.get("content", "")
            for c in conv
            if isinstance(c, dict) and c.get("role") == "user" and c.get("content")
        ]
        if turns:
            return turns
        strs = [c for c in conv if isinstance(c, str) and c.strip()]
        if strs:
            return strs
    td = item.get("task_description")
    return [td] if td else []


def _plan_health(plan: dict) -> float:
    """A [0,1] plan-state proxy scored with the SAME shape eval:golden asserts (status/subject/
    body/recipients). ponytail: `hard` (the exported thumbs, RESEARCH OQ1) is the primary reward;
    `soft` is this light rollout-completeness signal, refined when real feedback volume exists."""
    order = ["collecting", "proposed", "approved", "scheduled", "delivering", "done", "canceled"]
    checks = [
        order.index(plan.get("status", "collecting")) >= order.index("proposed"),
        bool(plan.get("subject")),
        bool(plan.get("body")),
        len(plan.get("recipients", []) or []) > 0,
    ]
    return sum(1 for c in checks if c) / len(checks)


def _score_item(item: dict, version: int, out_root: str, *, name: str = SKILL_NAME) -> dict:
    """Execute the candidate skill on one item's conversation, persist the trajectory, score it."""
    tenant = f"skillopt-{item['id']}"
    seeded = json.loads(_convex_run("smoke:seedCockpitPlan", {"tenant": tenant}))
    plan_id, thread_id = seeded["planId"], seeded["threadId"]

    history: list[dict] = []
    for text in _user_turns(item):
        res = json.loads(
            _convex_run(
                "llm:runCockpitAgent",
                {
                    "tenantId": tenant,
                    "threadId": thread_id,
                    "planId": plan_id,
                    "text": text,
                    **({"history": history} if history else {}),
                    "skillVersions": {name: version},
                },
            )
        )
        history += [
            {"role": "user", "content": text},
            {"role": "assistant", "content": res.get("reply", "")},
        ]

    plan = json.loads(_convex_run("plans:getById", {"planId": plan_id}))

    pred_dir = Path(out_root) / "predictions" / str(item["id"])
    pred_dir.mkdir(parents=True, exist_ok=True)
    (pred_dir / "conversation.json").write_text(
        json.dumps({"id": item["id"], "history": history, "plan": plan}, indent=2),
        encoding="utf-8",
    )

    return {"id": item["id"], "hard": item.get("hard", 0), "soft": _plan_health(plan)}


def run_batch(
    *,
    items,
    skill_content: str,
    out_root: str,
    workers: int = 4,
    max_completion_tokens: int = 4096,  # noqa: ARG001 - accepted per contract; runCockpitAgent bounds its own tokens
) -> list[dict]:
    """v0.2.0 rollout contract: run every item's conversation against `skill_content`, persist
    `<out_root>/predictions/<id>/conversation.json`, return dicts with `id`, `hard`, `soft`."""
    items = list(items)
    if not items:
        return []
    version = _pin_candidate(skill_content)  # one candidate per batch (skill_content is constant)
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(_score_item, it, version, out_root): it for it in items}
        for fut in as_completed(futures):
            results.append(fut.result())
    return results
