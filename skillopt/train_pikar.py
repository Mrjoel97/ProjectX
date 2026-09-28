"""Register Pikar's local adapter, then call SkillOpt 0.2.0's real trainer CLI.

The upstream console script `skillopt-train` calls `scripts.train:main`, whose
registry contains only upstream environments. This shim adds one local entry
before invoking that same entrypoint. It does not run unless CI's default-off
optimizer kill switch and eligibility gates have both passed.
"""

from __future__ import annotations

import sys
from importlib.metadata import version
from pathlib import Path


def register_adapter():
    """Return the pinned upstream trainer module with Pikar's adapter registered."""
    if version("skillopt") != "0.2.0":
        raise RuntimeError("Pikar optimizer requires exactly skillopt==0.2.0")

    sys.path.insert(0, str(Path(__file__).resolve().parent / "envs"))
    from pikar_cockpit.adapter import PikarCockpitAdapter
    from scripts import train as upstream

    upstream._ENV_REGISTRY["pikar_cockpit"] = PikarCockpitAdapter
    return upstream


def main() -> None:
    upstream = register_adapter()
    upstream.main()


if __name__ == "__main__":
    main()
