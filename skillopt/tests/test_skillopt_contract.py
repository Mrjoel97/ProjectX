"""Offline behavioral checks for the pinned SkillOpt v0.2.0 integration.

The canonical EnvAdapter and SplitDataLoader locations and the
``skillopt-train`` console entry point are from microsoft/SkillOpt v0.2.0.
No test invokes Convex, a model provider, or the optimizer.
"""

from __future__ import annotations

import importlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_ROOT = REPO_ROOT / "skillopt" / "envs"


def _load_local_env():
    """Import the local package with tiny stand-ins for pinned upstream bases."""
    skillopt = types.ModuleType("skillopt")
    skillopt.__path__ = []
    envs = types.ModuleType("skillopt.envs")
    envs.__path__ = []
    env_base = types.ModuleType("skillopt.envs.base")
    datasets = types.ModuleType("skillopt.datasets")
    datasets.__path__ = []
    data_base = types.ModuleType("skillopt.datasets.base")

    class EnvAdapter:
        pass

    class SplitDataLoader:
        pass

    env_base.EnvAdapter = EnvAdapter
    data_base.SplitDataLoader = SplitDataLoader
    modules = {
        "skillopt": skillopt,
        "skillopt.envs": envs,
        "skillopt.envs.base": env_base,
        "skillopt.datasets": datasets,
        "skillopt.datasets.base": data_base,
    }
    with patch.dict(sys.modules, modules):
        sys.path.insert(0, str(ENV_ROOT))
        try:
            for name in tuple(sys.modules):
                if name == "pikar_cockpit" or name.startswith("pikar_cockpit."):
                    del sys.modules[name]
            adapter = importlib.import_module("pikar_cockpit.adapter")
            dataloader = importlib.import_module("pikar_cockpit.dataloader")
            rollout = importlib.import_module("pikar_cockpit.rollout")
        finally:
            sys.path.pop(0)
    return adapter, dataloader, rollout, EnvAdapter, SplitDataLoader


class SkillOptContractTests(unittest.TestCase):
    def test_local_environment_implements_pinned_upstream_bases(self):
        adapter, dataloader, _, env_base, data_base = _load_local_env()
        self.assertTrue(issubclass(adapter.PikarCockpitAdapter, env_base))
        self.assertTrue(issubclass(dataloader.PikarCockpitDataLoader, data_base))

    def test_upstream_rollout_call_accepts_manager_candidate_and_output_dir(self):
        adapter, _, _, _, _ = _load_local_env()
        with patch.object(adapter, "run_batch", return_value=[]) as batch:
            adapter.PikarCockpitAdapter().rollout(
                object(), "candidate skill", "offline-out"
            )
        batch.assert_called_once()
        self.assertEqual(batch.call_args.kwargs["skill_content"], "candidate skill")

    def test_candidate_result_changes_hard_reward_with_observed_outcome(self):
        _, _, rollout, _, _ = _load_local_env()
        item = {"id": "offline-1", "hard": 1, "task_description": "Draft an email"}

        def execute_for(plan):
            def fake_convex_run(function, _args):
                if function == "smoke:seedCockpitPlan":
                    return json.dumps({"planId": "p", "threadId": "t"})
                if function == "llm:runCockpitAgent":
                    return json.dumps({"reply": "done"})
                if function == "plans:getById":
                    return json.dumps(plan)
                raise AssertionError(function)

            with tempfile.TemporaryDirectory() as output_dir:
                with patch.object(rollout, "_convex_run", side_effect=fake_convex_run):
                    return rollout._score_item(item, 1, output_dir)["hard"]

        poor = execute_for({"status": "collecting", "recipients": []})
        good = execute_for(
            {
                "status": "proposed",
                "subject": "Update",
                "body": "Hello",
                "recipients": ["buyer@example.test"],
            }
        )
        self.assertGreater(good, poor)

    def test_workflow_invokes_the_installed_optimizer_entrypoint(self):
        workflow = (REPO_ROOT / ".github" / "workflows" / "skillopt.yml").read_text(
            encoding="utf-8"
        )
        self.assertTrue(
            "skillopt-train" in workflow,
            "workflow does not invoke the pinned package's skillopt-train entrypoint",
        )
        self.assertNotIn("python scripts/train.py", workflow)

    def test_exported_validation_items_stay_out_of_training_split(self):
        _, dataloader, _, _, _ = _load_local_env()
        items = [
            {"id": "training", "split": "train"},
            {"id": "held-out", "split": "valid"},
        ]
        self.assertEqual(
            [item["id"] for item in dataloader.partition(items, "train")],
            ["training"],
        )


if __name__ == "__main__":
    unittest.main()
