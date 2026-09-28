"""Offline behavioral checks for the pinned SkillOpt v0.2.0 integration.

The canonical EnvAdapter and SplitDataLoader locations and the
``skillopt-train`` console entry point are from microsoft/SkillOpt v0.2.0.
No test invokes Convex, a model provider, or the optimizer.
"""

from __future__ import annotations

import importlib
import importlib.metadata
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
        canceled = execute_for(
            {
                "status": "canceled",
                "subject": "Update",
                "body": "Hello",
                "recipients": ["buyer@example.test"],
            }
        )
        self.assertEqual(canceled, 0)

    def test_feedback_comment_is_not_replayed_as_a_new_user_request(self):
        _, _, rollout, _, _ = _load_local_env()
        item = {
            "task_description": "Draft an update",
            "conversation": [
                {"role": "user", "content": "Draft an update"},
                {"role": "assistant", "content": "Historical answer"},
                {"role": "user", "content": "The historical answer missed the deadline"},
            ],
        }
        self.assertEqual(rollout._user_turns(item), ["Draft an update"])

    def test_workflow_invokes_the_installed_optimizer_entrypoint(self):
        workflow = (REPO_ROOT / ".github" / "workflows" / "skillopt.yml").read_text(
            encoding="utf-8"
        )
        wrapper = (REPO_ROOT / "skillopt" / "train_pikar.py").read_text(encoding="utf-8")
        self.assertIn("python skillopt/train_pikar.py", workflow)
        self.assertIn('from scripts import train as upstream', wrapper)
        self.assertIn('upstream._ENV_REGISTRY["pikar_cockpit"]', wrapper)
        self.assertIn("upstream.main()", wrapper)
        self.assertNotIn("python scripts/train.py", workflow)
        self.assertIn("SKILLOPT_RUNTIME_QUALIFIED", workflow)

    def test_installed_pinned_package_config_registration_and_split(self):
        try:
            installed = importlib.metadata.version("skillopt")
        except importlib.metadata.PackageNotFoundError:
            self.skipTest("pinned SkillOpt package not installed in this Python environment")
        self.assertEqual(installed, "0.2.0")

        for name in tuple(sys.modules):
            if name == "pikar_cockpit" or name.startswith("pikar_cockpit."):
                del sys.modules[name]
        sys.path.insert(0, str(REPO_ROOT / "skillopt"))
        try:
            import train_pikar
            from skillopt.config import flatten_config, load_config

            config_path = (
                REPO_ROOT
                / "skillopt/envs/pikar_cockpit/configs/pikar_cockpit/default.yaml"
            )
            cfg = flatten_config(load_config(str(config_path)))
            self.assertEqual(cfg["env"], "pikar_cockpit")
            self.assertEqual(cfg["optimizer_model"], "gpt-4o-mini")
            self.assertEqual(cfg["split_mode"], "split_dir")
            upstream = train_pikar.register_adapter()
            with tempfile.TemporaryDirectory() as tmp:
                split_dir = Path(tmp) / "split"
                for split in ("train", "val", "test"):
                    (split_dir / split).mkdir(parents=True)
                export = Path(tmp) / "export.json"
                export.write_text(
                    json.dumps({"items": [
                        {"id": "training", "split": "train"},
                        {"id": "held-out", "split": "valid"},
                    ]}),
                    encoding="utf-8",
                )
                cfg["split_dir"] = str(split_dir)
                with patch.dict("os.environ", {"SKILLOPT_EXPORT": str(export)}):
                    adapter = upstream.get_adapter(cfg)
                    adapter.setup(cfg)
                    loader = adapter.get_dataloader()
                    self.assertEqual(len(loader.train_items), 1)
                    self.assertEqual(len(loader.val_items), 1)
                    self.assertEqual(len(loader.test_items), 0)
                    self.assertEqual(
                        [i["id"] for i in adapter.build_train_env(1, 42)],
                        ["training"],
                    )
                    export.write_text(
                        json.dumps({"items": [{"id": "training", "split": "train"}]}),
                        encoding="utf-8",
                    )
                    with self.assertRaisesRegex(ValueError, "nonempty, disjoint"):
                        upstream.get_adapter(cfg).setup(cfg)
        finally:
            sys.path.pop(0)

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
        with self.assertRaises(ValueError):
            dataloader.partition([{"id": "unknown", "split": "other"}], "train")
        with self.assertRaises(ValueError):
            dataloader.partition([{"id": "same", "split": "train"},
                                  {"id": "same", "split": "valid"}], "train")


if __name__ == "__main__":
    unittest.main()
