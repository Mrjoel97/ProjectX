"""Pinned SkillOpt 0.2.0 adapter for Pikar's scrubbed cockpit trajectories.

The trainer's standard positional rollout and BatchSpec seams are verified by
offline tests against the installed distribution. No optimizer run is implied.
"""

from __future__ import annotations

try:  # pragma: no cover - skillopt is pip-installed only in CI
    from skillopt.envs.base import EnvAdapter
except Exception:  # pragma: no cover
    EnvAdapter = object  # type: ignore[assignment,misc]

from .dataloader import PikarCockpitDataLoader
from .rollout import run_batch

TASK_TYPES = ["cockpit_email"]


class PikarCockpitAdapter(EnvAdapter):  # type: ignore[misc,valid-type]
    def __init__(self, split_dir: str = "", workers: int = 2, **_kwargs):
        self.split_dir = split_dir
        self.workers = workers
        self.dataloader = None

    def setup(self, cfg: dict) -> None:
        super().setup(cfg)
        self.dataloader = PikarCockpitDataLoader(split_dir=self.split_dir, split_mode="split_dir")
        self.dataloader.setup(cfg)

    def get_dataloader(self):
        return self.dataloader

    def get_task_types(self):
        return list(TASK_TYPES)

    def build_env_from_batch(self, batch, **_kwargs):
        return list(batch.payload or [])

    def build_train_env(self, batch_size: int, seed: int, **kwargs):
        if self.dataloader is None:
            raise RuntimeError("PikarCockpitAdapter.setup must run before batch construction")
        batch = self.dataloader.build_train_batch(batch_size=batch_size, seed=seed, **kwargs)
        return self.build_env_from_batch(batch)

    def build_eval_env(self, env_num: int, split: str, seed: int, **kwargs):
        if self.dataloader is None:
            raise RuntimeError("PikarCockpitAdapter.setup must run before batch construction")
        batch = self.dataloader.build_eval_batch(env_num=env_num, split=split, seed=seed, **kwargs)
        return self.build_env_from_batch(batch)

    def rollout(
        self,
        env_manager,
        skill_content: str,
        out_dir: str,
        max_completion_tokens: int = 4096,
        **_kwargs,
    ):
        return run_batch(
            items=env_manager,
            skill_content=skill_content,
            out_root=out_dir,
            workers=self.workers,
            max_completion_tokens=max_completion_tokens,
        )
