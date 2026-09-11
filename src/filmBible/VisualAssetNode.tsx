import React, { createContext, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import { BookImage, LockKeyhole } from "lucide-react";
import type { VisualBible } from "./types.ts";
import { emptyVisualBible, visualKindLabels, visualStatusLabels } from "./types.ts";

const VisualContext = createContext<VisualBible>(emptyVisualBible());

export function VisualBibleGraphProvider({
  visual,
  children,
}: {
  visual?: VisualBible;
  children: React.ReactNode;
}) {
  return (
    <VisualContext.Provider value={visual || emptyVisualBible()}>
      {children}
    </VisualContext.Provider>
  );
}

export function VisualAssetNode({
  data,
  selected,
}: {
  data: Record<string, any>;
  selected?: boolean;
}) {
  const visual = useContext(VisualContext);
  const version = visual.versions[data.visualVersionId];
  const card = version ? visual.cards[version.cardId] : undefined;
  if (!version || !card)
    return <div className="visual-node missing">视觉版本已丢失</div>;
  return (
    <div className={`visual-node ${selected ? "selected" : ""}`}>
      <div className="visual-node-heading">
        <BookImage size={15} />
        <span>{visualKindLabels[card.kind]}</span>
        {version.status === "locked" && <LockKeyhole size={13} />}
      </div>
      <strong>{card.name}</strong>
      <p>{version.spec.description}</p>
      <div className="visual-node-footer">
        <span>V{version.version}</span>
        <b className={`visual-status ${version.status}`}>
          {visualStatusLabels[version.status]}
        </b>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

