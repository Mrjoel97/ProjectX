// Six dormant native candidates, independent of the seven paid pilot pack ids.

import { verticalDataProvenance, verticalDataSkillBody } from "./verticalData";
import { verticalDesignProvenance, verticalDesignSkillBody } from "./verticalDesign";
import { verticalEngineeringProvenance, verticalEngineeringSkillBody } from "./verticalEngineering";
import { verticalHrProvenance, verticalHrSkillBody } from "./verticalHr";
import { verticalLegalProvenance, verticalLegalSkillBody } from "./verticalLegal";
import { verticalProductProvenance, verticalProductSkillBody } from "./verticalProduct";
export const VERTICAL_CANDIDATES = {
  "vertical-legal": { body: verticalLegalSkillBody, provenance: verticalLegalProvenance },
  "vertical-hr": { body: verticalHrSkillBody, provenance: verticalHrProvenance },
  "vertical-product": { body: verticalProductSkillBody, provenance: verticalProductProvenance },
  "vertical-design": { body: verticalDesignSkillBody, provenance: verticalDesignProvenance },
  "vertical-engineering": {
    body: verticalEngineeringSkillBody,
    provenance: verticalEngineeringProvenance,
  },
  "vertical-data": { body: verticalDataSkillBody, provenance: verticalDataProvenance },
} as const;
