import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export function ClinicianRecommendationToggle({
  clinicianName,
  selected,
  onToggle,
}: {
  clinicianName: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
      aria-label={selected ? `Remove ${clinicianName} recommendation` : `Recommend ${clinicianName}`}
      data-testid={`recommend-clinician-${clinicianName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
      onClick={onToggle}
    >
      {selected && <Check className="mr-1 h-3.5 w-3.5" />}
      {selected ? "Recommended" : "Recommend clinician"}
    </Button>
  );
}
