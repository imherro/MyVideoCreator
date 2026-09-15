import React, { createContext, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import { BookImage, LockKeyhole } from "lucide-react";
import type { VisualBible } from "./types.ts";
import { emptyVisualBible, visualKindLabels, visualStatusLabels } from "./types.ts";
import { primaryReference } from "./references.ts";

const VisualContext = createContext<{
  visual: VisualBible;
  assets: Array<Record<string, any>>;
}>({ visual: emptyVisualBible(), assets: [] });

export function VisualBibleGraphProvider({
  visual,
  assets,
  children,
}: {
  visual?: VisualBible;
  assets?: Array<Record<string, any>>;
  children: React.ReactNode;
}) {
  return (
    <VisualContext.Provider
      value={{ visual: visual || emptyVisualBible(), assets: assets || [] }}
    >
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
  const { visual, assets } = useContext(VisualContext);
  const version = visual.versions[data.visualVersionId];
  const card = version ? visual.cards[version.cardId] : undefined;
  if (!version || !card)
    return <div className="visual-node missing">视觉版本已丢失</div>;
  const reference = primaryReference(version);
  const referenceAsset = assets.find((item) => item.id === reference?.assetId);
  return (
    <div className={`visual-node visual-node-${card.kind} ${selected ? "selected" : ""}`}>
      <div className="visual-node-heading">
        <BookImage size={15} />
        <span>{visualKindLabels[card.kind]}</span>
        {version.status === "locked" && <LockKeyhole size={13} />}
      </div>
      <strong>{card.name}</strong>
      {referenceAsset && (
        <img
          className="visual-node-reference"
          src={referenceAsset.url}
          alt={`${card.name} 主参考图`}
        />
      )}
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
