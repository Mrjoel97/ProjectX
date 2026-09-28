"""SkillOpt SplitDataLoader for the pikar_cockpit env (skillopt==0.2.0).

Consumes the scrubbed trajectory JSON pulled from GET /skillopt/export (pinned in Plan 08-04):

    { "skillName": "cockpit-agent",
      "items": [ { "id", "task_description", "conversation", "hard", "soft",
                   "skillVersion", "split": "train"|"valid", "counts" }, ... ] }

`load_split_items(split_path)` maps export `train` to upstream `train/`, export `valid` to upstream
`val/`, and leaves upstream `test/` empty rather than fabricating a third partition. The separate
golden eval cases are never an export source.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

# skillopt is pip-installed only in CI (requirements.txt). Fall back to `object` so this module
# still imports for the offline self-check / lint (`python dataloader.py`) without skillopt present.
try:  # pragma: no cover - import shim
    from skillopt.datasets.base import SplitDataLoader
except Exception:  # pragma: no cover
    SplitDataLoader = object  # type: ignore[assignment,misc]

EXPORT_FILENAME = "export.json"


def norm_split(name: str) -> str:
    """Map SkillOpt train/val/test names without inventing a third export split."""
    s = str(name).strip().lower()
    if s in ("valid_seen", "val", "valid", "validation", "dev"):
        return "valid"
    if s in ("valid_unseen", "test"):
        return "test"
    if s == "train":
        return "train"
    raise ValueError(f"unsupported SkillOpt split: {name!r}")


def split_of_path(split_path) -> str:
    """Derive the split (`train`|`valid`) from the path SkillOpt hands the loader."""
    return norm_split(Path(split_path).stem or str(split_path))


def _resolve_export(split_path) -> Path:
    """Locate the export.json for this split.

    Priority: the split_path itself if it is the export json -> $SKILLOPT_EXPORT -> an export.json
    sibling of the split_path. ponytail: the CI job writes ONE export.json (Plan 08-04 shape) and
    points $SKILLOPT_EXPORT at it; SkillOpt still passes a per-split path we read the split name from.
    """
    p = Path(split_path)
    if p.is_file() and p.suffix == ".json":
        return p
    env = os.environ.get("SKILLOPT_EXPORT")
    if env:
        return Path(env)
    for cand in (p.with_name(EXPORT_FILENAME), p.parent / EXPORT_FILENAME):
        if cand.is_file():
            return cand
    raise FileNotFoundError(
        f"no {EXPORT_FILENAME} for split_path={split_path!r} (set $SKILLOPT_EXPORT to the export path)"
    )


def partition(items, split: str):
    """Pure: the items whose exported `split` field matches `split` (already normalized)."""
    want = norm_split(split)
    if not isinstance(items, list):
        raise ValueError("SkillOpt export items must be a list")
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise ValueError("SkillOpt export item needs a string id")
        if item["id"] in seen:
            raise ValueError("duplicate SkillOpt export item id")
        seen.add(item["id"])
        norm_split(item.get("split", ""))
    return [it for it in items if norm_split(it["split"]) == want]


def read_split_items(split_path):
    """Pure I/O: load the export and return the items for the split the path names."""
    export = _resolve_export(split_path)
    with open(export, encoding="utf-8") as fh:
        data = json.load(fh)
    items = data.get("items", []) if isinstance(data, dict) else data
    return partition(items, split_of_path(split_path))


class PikarCockpitDataLoader(SplitDataLoader):  # type: ignore[misc,valid-type]
    """The v0.2.0 SplitDataLoader contract: `load_split_items(split_path) -> list[dict]`."""

    def load_split_items(self, split_path):
        return read_split_items(split_path)

    def setup(self, cfg: dict) -> None:
        super().setup(cfg)
        if not self.train_items or not self.val_items:
            raise ValueError("SkillOpt requires nonempty, disjoint train and validation partitions")
        if self.test_items:
            raise ValueError("Pikar export has no independent SkillOpt test partition")


if __name__ == "__main__":
    # ONE runnable check (no network, no SkillOpt): the split partition of a tiny inline fixture
    # must match the export "split" field, with upstream val kept separate from test.
    import tempfile

    fixture = {
        "skillName": "cockpit-agent",
        "items": [
            {"id": "a", "split": "train", "hard": 1},
            {"id": "b", "split": "valid", "hard": 0},
            {"id": "c", "split": "train", "hard": 1},
            {"id": "d", "split": "valid", "hard": 1},
        ],
    }
    items = fixture["items"]
    assert [it["id"] for it in partition(items, "train")] == ["a", "c"], "train partition"
    assert [it["id"] for it in partition(items, "valid")] == ["b", "d"], "valid partition"
    assert norm_split("val") == "valid", "val normalizes to export valid"
    assert split_of_path("/x/y/val") == "valid", "path basename -> split"
    assert split_of_path("/x/y/test") == "test", "test remains separate"
    assert split_of_path("/x/y/train.json") == "train", "train path -> split"

    with tempfile.TemporaryDirectory() as d:
        (Path(d) / EXPORT_FILENAME).write_text(json.dumps(fixture), encoding="utf-8")
        loader = PikarCockpitDataLoader()
        train = loader.load_split_items(str(Path(d) / "train"))
        valid = loader.load_split_items(str(Path(d) / "val"))
        test = loader.load_split_items(str(Path(d) / "test"))
        assert {it["id"] for it in train} == {"a", "c"}, "load_split_items train"
        assert {it["id"] for it in valid} == {"b", "d"}, "load_split_items val"
        assert not test, "no fabricated third partition"

    print("dataloader self-check PASSED")
