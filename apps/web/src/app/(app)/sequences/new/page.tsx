import { Card, PageHeader } from "@/components/ui";
import { SequenceForm } from "./SequenceForm";

export default function NewSequencePage() {
  return (
    <>
      <PageHeader
        title="New Sequence"
        description="Create a multi-touch cadence template."
      />

      <div className="mx-auto max-w-xl p-4">
        <Card className="p-4">
          <SequenceForm />
        </Card>
      </div>
    </>
  );
}
