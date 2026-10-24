export const MIND_MAP_THEME = {
  layout: 'balanced-tree',

  root: {
    borderColor: '#22c55e',
    borderWidth: 2,
    borderRadius: 10,
    background: '#fff',
    fontSize: 28,
    fontWeight: 700,
  },

  node: {
    borderColor: '#e5e7eb',
    borderRadius: 6,
    background: '#fff',
    fontSize: 14,
  },

  edge: {
    type: 'bezier',
    stroke: '#c8c8c8',
    strokeWidth: 1.5,
  },

  spacing: {
    rootGap: 180,
    levelGap: 150,
    siblingGap: 30,
  },
} as const;
