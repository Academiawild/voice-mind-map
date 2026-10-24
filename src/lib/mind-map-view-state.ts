export interface MindMapPosition {
  x: number;
  y: number;
}

export interface MindMapViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface MindMapViewState {
  positions: Record<string, MindMapPosition>;
  viewport: MindMapViewport | null;
  expandedInferenceNodeIds: string[];
  aiFeedback: string[];
}

export function createDefaultMindMapViewState(): MindMapViewState {
  return {
    positions: {},
    viewport: null,
    expandedInferenceNodeIds: [],
    aiFeedback: [],
  };
}
