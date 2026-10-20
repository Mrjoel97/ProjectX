import { notFound } from "next/navigation";
import QualificationIdentity from "./QualificationIdentity";

/** Development-only identity witness using fixed server pins; no candidate or credential input. */
export default function QualificationIdentityPage() {
  if (process.env.NODE_ENV !== "development" || process.env.PHASE23_ACCESS_CHECK_ENABLED !== "1")
    notFound();

  const expectedAId = process.env.PHASE23_ACCESS_CHECK_EXPECTED_A_ID;
  const expectedBId = process.env.PHASE23_ACCESS_CHECK_EXPECTED_B_ID;
  const isDocumentId = (value: string | undefined): value is string =>
    typeof value === "string" && /^[a-z0-9]{32}$/.test(value);
  if (!isDocumentId(expectedAId) || !isDocumentId(expectedBId) || expectedAId === expectedBId)
    notFound();

  return <QualificationIdentity expectedAId={expectedAId} expectedBId={expectedBId} />;
}
