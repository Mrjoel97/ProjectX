import { notFound } from "next/navigation";
import { isPresenceExampleId } from "../../examples";
import { PresenceExampleViewer } from "../../PresenceExampleViewer";

export default async function ExamplePage({ params }: { params: Promise<{ example: string }> }) {
  const { example } = await params;
  if (!isPresenceExampleId(example)) notFound();
  return <PresenceExampleViewer key={example} exampleId={example} />;
}
