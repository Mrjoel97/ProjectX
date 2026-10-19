import { notFound } from "next/navigation";
import AccessCheck from "./AccessCheck";

/** Local qualification only. These pins are supplied after validating the immutable handoff. */
export default function QualificationCheckPage() {
  if (process.env.NODE_ENV !== "development" || process.env.PHASE23_ACCESS_CHECK_ENABLED !== "1")
    notFound();

  const candidateId = process.env.PHASE23_ACCESS_CHECK_CANDIDATE_ID;
  const expectedBId = process.env.PHASE23_ACCESS_CHECK_EXPECTED_B_ID;
  const isDocumentId = (value: string | undefined): value is string =>
    typeof value === "string" && /^[a-z0-9]{32}$/.test(value);
  if (!isDocumentId(candidateId) || !isDocumentId(expectedBId)) notFound();

  return <AccessCheck candidateId={candidateId} expectedBId={expectedBId} />;
}
