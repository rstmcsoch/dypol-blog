import type { CoverMotif } from "@/content/types";

export function CoverPlate({
  motif,
  index,
  category,
}: {
  motif: CoverMotif;
  index: string;
  category: string;
}) {
  return (
    <div className="plate" data-motif={motif} aria-hidden="true">
      <div className="plate__ink grain" />
      {motif === "stack" ? (
        <div className="plate__ink plate__ink--2 grain" />
      ) : null}
      <span className="plate__cat">{category}</span>
      <span className="plate__num">{index}</span>
    </div>
  );
}
