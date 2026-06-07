export type ElementType = string;

export interface Atom {
  id: string;
  symbol: ElementType;
  x: number;
  y: number;
  lonePairs: number;
  singleElectrons?: number;
  charge: number;
  color?: string;
  isFixed?: boolean;
}

export interface Bond {
  id: string;
  atom1Id: string;
  atom2Id: string;
  order: number;
  isFixed?: boolean;
}

export interface CanvasText {
  id: string;
  x: number;
  y: number;
  text: string;
  color?: string;
  size?: number;
  rotation?: number;
  isFixed?: boolean;
}

export interface CanvasArrow {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color?: string;
  isFixed?: boolean;
}

export interface Molecule {
  atoms: Atom[];
  bonds: Bond[];
  texts?: CanvasText[];
  arrows?: CanvasArrow[];
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
  B: '#ec4899',
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
  B: '#ffffff',
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
  B: 21,
};

export const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
};

export const getAtomColor = (symbol: string, customColor?: string) => {
    if (customColor) return customColor;
    if (ATOM_COLORS[symbol]) return ATOM_COLORS[symbol];
    return stringToColor(symbol);
};

export const getAtomTextColor = (symbol: string) => {
    if (ATOM_TEXT_COLORS[symbol]) return ATOM_TEXT_COLORS[symbol];
    return '#ffffff';
};

export const getAtomRadius = (symbol: string) => {
    if (ATOM_RADII[symbol]) return ATOM_RADII[symbol];
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
        hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
    }
    return 15 + Math.abs(hash % 11);
};
