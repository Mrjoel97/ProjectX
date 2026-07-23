"""pikar_cockpit — the SkillOpt env package that optimizes the `cockpit-agent` skill.

Scores candidate skill edits by executing the REAL cockpit skill on the Convex deployment (no second
engine); consumes the scrubbed /skillopt/export trajectory JSON; writes accepted candidates back
through /skillopt/writeback (gated -> owner-activated). Ships DORMANT (CI kill switch default OFF).
"""

from .adapter import PikarCockpitAdapter
from .dataloader import PikarCockpitDataLoader
from .rollout import run_batch

__all__ = ["PikarCockpitAdapter", "PikarCockpitDataLoader", "run_batch"]
