export type ElementType = string;

export interface Atom {
  id: string;
  symbol: ElementType;
  x: number;
  y: number;
  lonePairs: number;
  charge: number;
}

export interface Bond {
  id: string;
  atom1Id: string;
  atom2Id: string;
  order: 0 | 1 | 2 | 3;
}

export interface Molecule {
  atoms: Atom[];
  bonds: Bond[];
}

export const ATOM_COLORS: Record<ElementType, string> = {
  C: '#1a1a1a',
  H: '#ffffff',
  O: '#ef4444',
  N: '#3b82f6',
  P: '#f97316',
  S: '#eab308',
  F: '#22c55e',
  Cl: '#10b981',
  Br: '#92400e',
  I: '#a855f7',
};

export const ATOM_TEXT_COLORS: Record<ElementType, string> = {
  C: '#ffffff',
  H: '#1a1a1a',
  O: '#ffffff',
  N: '#ffffff',
  P: '#ffffff',
  S: '#1a1a1a',
  F: '#ffffff',
  Cl: '#ffffff',
  Br: '#ffffff',
  I: '#ffffff',
};

export const ATOM_RADII: Record<ElementType, number> = {
  H: 14,
  C: 20,
  N: 19,
  O: 18,
  F: 17,
  P: 24,
  S: 23,
  Cl: 22,
  Br: 24,
  I: 26,
};
