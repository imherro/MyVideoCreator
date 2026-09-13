import type { GlobalPanel } from "./GlobalNav";

export type GlobalPanelAction = {
  panel: GlobalPanel | null;
  loadTrash: boolean;
};

export function planGlobalPanelAction(
  active: string | null,
  next: GlobalPanel,
): GlobalPanelAction {
  const panel = active === next ? null : next;
  return { panel, loadTrash: panel === "trash" };
}

