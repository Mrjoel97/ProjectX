"""SkillOpt EnvAdapter for the pikar_cockpit env (skillopt==0.2.0) — thin wiring only.

Delegates loading to PikarCockpitDataLoader and scoring to run_batch (which executes the real
cockpit skill via `convex run`). No optimization logic lives here — SkillOpt's inherited `reflect()`
drives the loop; this class only supplies the env's data + rollout seams.

ponytail: the exact EnvAdapter base method signatures are LOW-confidence (RESEARCH OQ2) and are
verified in the 08-08 dry-run. Kept correct-by-contract: the delegated pieces (loader, run_batch)
match the documented v0.2.0 interfaces regardless of the adapter's wiring shape.
"""

from __future__ import annotations

try:  # pragma: no cover - import shim; skillopt is pip-installed only in CI
    from skillopt.env import EnvAdapter  # exact path verified at the 08-08 dry-run
except Exception:  # pragma: no cover
    EnvAdapter = object  # type: ignore[assignment,misc]

from .dataloader import PikarCockpitDataLoader
from .rollout import run_batch

TASK_TYPES = ["cockpit_email"]


class PikarCockpitAdapter(EnvAdapter):  # type: ignore[misc,valid-type]
    def get_task_types(self):
        return list(TASK_TYPES)

    def _loader(self):
        return PikarCockpitDataLoader()

    def build_train_env(self, *args, **kwargs):
        return self._loader()

    def build_eval_env(self, *args, **kwargs):
        return self._loader()

    def rollout(
        self,
        *,
        items,
        skill_content: str,
        out_root: str,
        workers: int = 4,
        max_completion_tokens: int = 4096,
        **_kwargs,
    ):
        return run_batch(
            items=items,
            skill_content=skill_content,
            out_root=out_root,
            workers=workers,
            max_completion_tokens=max_completion_tokens,
        )
