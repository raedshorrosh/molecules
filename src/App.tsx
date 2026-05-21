/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Atom as AtomIcon, 
  Trash2, 
  Plus, 
  Minus, 
  RotateCcw, 
  Download, 
  Info,
  CircleDot,
  MousePointer2,
  Copy,
  Check,
  X,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils.ts';
import { 
  ElementType, 
  Atom, 
  Bond, 
  Molecule, 
  ATOM_COLORS, 
  ATOM_TEXT_COLORS,
  ATOM_RADII
} from '@/src/types.ts';

interface CompareResult {
  match: boolean;
  message: string;
}

function areMoleculesEqual(m1: Molecule, m2: Molecule, strictMatching: boolean): CompareResult {
  const getExpectedValency = (symbol: string) => {
    const valencies: Record<string, number> = {
      C: 4, N: 3, O: 2, H: 1, F: 1, Cl: 1, Br: 1, I: 1, P: 5, S: 6
    };
    return valencies[symbol] || 0;
  };

  const buildGraph = (m: Molecule) => {
    let nextId = 0;
    const gNodes = m.atoms.map(n => ({
      id: n.id,
      symbol: n.symbol,
      lonePairs: n.lonePairs || 0,
      charge: n.charge || 0,
      adj: [] as {target: string, order: number}[]
    }));
    
    for (const b of m.bonds) {
      if (b.order === 0) continue; 
      const n1 = gNodes.find(n => n.id === b.atom1Id);
      const n2 = gNodes.find(n => n.id === b.atom2Id);
      if (n1 && n2) {
        n1.adj.push({ target: n2.id, order: b.order });
        n2.adj.push({ target: n1.id, order: b.order });
      }
    }
    
    const allNodes = [...gNodes];
    if (!strictMatching) {
      for (const n of gNodes) {
        const currentV = n.adj.reduce((sum, e) => sum + e.order, 0);
        const expectedV = getExpectedValency(n.symbol);
        const implicitH = Math.max(0, expectedV - currentV);
        for (let i = 0; i < implicitH; i++) {
          const hId = `implicit_H_${n.id}_${nextId++}`;
          const hNode = { id: hId, symbol: 'H', lonePairs: 0, charge: 0, adj: [{target: n.id, order: 1}] as any };
          allNodes.push(hNode);
          n.adj.push({ target: hId, order: 1 });
        }
      }
    }
    return allNodes;
  };

  const getSideSign = (u: Atom, v: Atom, p: Atom) => {
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const px = p.x - u.x;
      const py = p.y - u.y;
      const cross = dx * py - dy * px;
      if (Math.abs(cross) < 1e-4) return 0;
      return Math.sign(cross);
  };

  const checkStereo = (map12: Map<string, string>): boolean => {
      for (const b of m1.bonds) {
          if (b.order === 2) {
              const u = m1.atoms.find(a => a.id === b.atom1Id);
              const v = m1.atoms.find(a => a.id === b.atom2Id);
              if (!u || !v) continue;

              const u_neighbor_id = m1.bonds.find(nb => (nb.atom1Id === u.id && nb.atom2Id !== v.id))?.atom2Id 
                                 || m1.bonds.find(nb => (nb.atom2Id === u.id && nb.atom1Id !== v.id))?.atom1Id;
              const v_neighbor_id = m1.bonds.find(nb => (nb.atom1Id === v.id && nb.atom2Id !== u.id))?.atom2Id 
                                 || m1.bonds.find(nb => (nb.atom2Id === v.id && nb.atom1Id !== u.id))?.atom1Id;

              if (u_neighbor_id && v_neighbor_id) {
                  const x = m1.atoms.find(a => a.id === u_neighbor_id);
                  const y = m1.atoms.find(a => a.id === v_neighbor_id);
                  
                  const u2_id = map12.get(u.id);
                  const v2_id = map12.get(v.id);
                  const x2_id = map12.get(u_neighbor_id);
                  const y2_id = map12.get(v_neighbor_id);

                  if (x && y && u2_id && v2_id && x2_id && y2_id) {
                      const u2 = m2.atoms.find(a => a.id === u2_id);
                      const v2 = m2.atoms.find(a => a.id === v2_id);
                      const x2 = m2.atoms.find(a => a.id === x2_id);
                      const y2 = m2.atoms.find(a => a.id === y2_id);

                      if (u2 && v2 && x2 && y2) {
                          const s1 = getSideSign(u, v, x) * getSideSign(u, v, y);
                          const s2 = getSideSign(u2, v2, x2) * getSideSign(u2, v2, y2);
                          if (s1 !== 0 && s2 !== 0 && s1 !== s2) {
                              return false; // Mismatch in stereochemistry
                          }
                      }
                  }
              }
          }
      }
      return true; // All double bonds match geometry
  };

  const g1 = buildGraph(m1);
  const g2 = buildGraph(m2);

  if (g1.length !== g2.length) return { match: false, message: "❌ Not a match. Different number of atoms." };

  const symCount1 = g1.reduce((acc, n) => { acc[n.symbol] = (acc[n.symbol] || 0) + 1; return acc; }, {} as Record<string, number>);
  const symCount2 = g2.reduce((acc, n) => { acc[n.symbol] = (acc[n.symbol] || 0) + 1; return acc; }, {} as Record<string, number>);
  
  if (Object.keys(symCount1).length !== Object.keys(symCount2).length) return { match: false, message: "❌ Not a match. Different elemental composition." };
  for (const k in symCount1) if (symCount1[k] !== symCount2[k]) return { match: false, message: "❌ Not a match. Different elemental composition." };

  const degSeq1 = g1.map(n => n.adj.length).sort((a,b) => b-a).join(',');
  const degSeq2 = g2.map(n => n.adj.length).sort((a,b) => b-a).join(',');
  if (degSeq1 !== degSeq2) return { match: false, message: "❌ Not a match. Different basic connectivity." };

  const map12 = new Map<string, string>();
  const mapped2 = new Set<string>();

  let foundTopologyMatch = false;

  const isIsomorphic = (idx: number): boolean => {
    if (idx === g1.length) {
      foundTopologyMatch = true;
      if (checkStereo(map12)) {
        return true; 
      }
      return false;
    }
    
    const u = g1[idx];
    
    const candidates = g2.filter(v => 
      v.symbol === u.symbol && 
      v.adj.length === u.adj.length && 
      v.lonePairs === u.lonePairs && 
      v.charge === u.charge && 
      !mapped2.has(v.id)
    );

    for (const v of candidates) {
      let consistent = true;
      for (const e of u.adj) {
        if (map12.has(e.target)) {
          const u_neighbor = e.target;
          const v_neighbor = map12.get(u_neighbor);
          const matchedEdge = v.adj.find(ve => ve.target === v_neighbor);
          if (!matchedEdge || matchedEdge.order !== e.order) {
            consistent = false;
            break;
          }
        }
      }
      
      if (consistent) {
        map12.set(u.id, v.id);
        mapped2.add(v.id);
        
        if (isIsomorphic(idx + 1)) return true;
        
        map12.delete(u.id);
        mapped2.delete(v.id);
      }
    }
    return false;
  };
  
  g1.sort((a,b) => b.adj.length - a.adj.length);
  const match = isIsomorphic(0);

  if (match) {
    return { match: true, message: "✅ Match! The structures are chemically equivalent." };
  } else if (foundTopologyMatch) {
    return { match: false, message: "❌ Not a match. The bonds match but the geometric stereoisomerism (e.g. cis/trans) differs." };
  } else {
    return { match: false, message: "❌ Not a match. Different connectivity." };
  }
}

function parseTeacherAnswer(taString: string): Molecule | null {
  if (!taString || taString.trim() === '') return null;
  try {
    const cleanTA = taString.trim();
    const parsed = JSON.parse(cleanTA);
    if (parsed.visual && Array.isArray(parsed.visual.atoms)) {
      return parsed.visual as Molecule;
    }
    if (Array.isArray(parsed.atoms) && Array.isArray(parsed.bonds)) {
      return parsed as Molecule;
    }
  } catch (err) {
    console.warn("Failed to parse TA string as JSON direct:", err);
    try {
      let cleaned = taString.trim();
      if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
         cleaned = cleaned.substring(1, cleaned.length - 1);
      }
      cleaned = cleaned.replace(/\\"/g, '"');
      cleaned = cleaned.replace(/\\'/g, "'");
      const parsed = JSON.parse(cleaned);
      if (parsed.visual && Array.isArray(parsed.visual.atoms)) {
        return parsed.visual as Molecule;
      }
      if (Array.isArray(parsed.atoms) && Array.isArray(parsed.bonds)) {
        return parsed as Molecule;
      }
    } catch (e2) {
      console.warn("Failed second attempt to parse TA string:", e2);
    }
  }
  return null;
}

const TOOLBAR_ELEMENTS: ElementType[] = ['C', 'H', 'O', 'N', 'P', 'S', 'F', 'Cl', 'Br', 'I'];
const BOND_ORDERS: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];

export default function App() {
  const [historyState, setHistoryState] = useState({
    history: [{ atoms: [] as Atom[], bonds: [] as Bond[] }],
    index: 0
  });
  const [draftState, setDraftState] = useState<{atoms: Atom[], bonds: Bond[]} | null>(null);

  const atoms = draftState ? draftState.atoms : historyState.history[historyState.index].atoms;
  const bonds = draftState ? draftState.bonds : historyState.history[historyState.index].bonds;

  const [savedMolecules, setSavedMolecules] = useState<{id: string, name: string, data: Molecule}[]>([]);
  const [strictMatching, setStrictMatching] = useState(true);
  const [isStackEnvironment, setIsStackEnvironment] = useState(false);
  const [mode, setMode] = useState<'atom' | 'bond' | 'erase' | 'select' | 'lone-pair' | 'charge'>('select');
  const [selectedElement, setSelectedElement] = useState<ElementType>('C');
  const [selectedBondOrder, setSelectedBondOrder] = useState<0 | 1 | 2 | 3>(1);

  // Moodle STACK view states
  const [isInstructor, setIsInstructor] = useState(true);
  const [teacherAnswer, setTeacherAnswer] = useState<Molecule | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [testReadOnlyMode, setTestReadOnlyMode] = useState(false);

  const [dragStartAtom, setDragStartAtom] = useState<string | null>(null);
  const dragStartAtomRef = useRef<string | null>(null);

  const [draggingAtomIds, setDraggingAtomIds] = useState<string[]>([]);
  const dragInitialMouseRef = useRef<{x: number, y: number} | null>(null);
  const dragInitialAtomsRef = useRef<Atom[]>([]);
  const dragHasMovedRef = useRef<boolean>(false);

  const [selectionBoxStart, setSelectionBoxStart] = useState<{x: number, y: number} | null>(null);
  const [selectionBoxCurrent, setSelectionBoxCurrent] = useState<{x: number, y: number} | null>(null);
  const selectionBoxStartRef = useRef<{x: number, y: number} | null>(null);

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const mousePosRef = useRef({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const selectedEntityIdsRef = useRef<string[]>([]);
  const [scale, setScale] = useState(1.0);
  const [hideCHydrogens, setHideCHydrogens] = useState(false);
  const [skeletalMode, setSkeletalMode] = useState(false);
  const hideImplicitHydrogens = true;
  const [filledMode, setFilledMode] = useState(true);
  const [showElementPrompt, setShowElementPrompt] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [customElement, setCustomElement] = useState("");
  
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const stateRef = useRef({ atoms, bonds });
  const draftStateRef = useRef(draftState);
  const modeRef = useRef(mode);

  const selectedElementRef = useRef(selectedElement);
  const selectedBondOrderRef = useRef(selectedBondOrder);
  const rotationLastValRef = useRef(0);

  // Check URL parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    // Check design variable (1 = instructor, others = student)
    const designParam = params.get('design') || params.get('DESIGN');
    if (designParam !== null) {
      setIsInstructor(designParam === '1' || designParam.toLowerCase() === 'true' || designParam.toLowerCase() === 'instructor');
    } else {
      // Omitted or default. If loaded inside an iframe (like Moodle previewing to students), default to Student View.
      // Otherwise default to Instructor View for convenience when opened directly from browser
      const isIframe = window.self !== window.top;
      if (isIframe) {
        setIsInstructor(false);
      }
    }

    // Check teacherAnswer variable (TA)
    const taParam = params.get('ta') || params.get('TA');
    if (taParam) {
      const parsed = parseTeacherAnswer(taParam);
      if (parsed) {
        setTeacherAnswer(parsed);
      }
    }
  }, []);

  // Monitor read-only state of STACK dynamic inputs
  useEffect(() => {
    const checkReadOnly = () => {
      const globalWin = window as any;
      if (globalWin.__stackInput) {
        const inputIsReadOnly = globalWin.__stackInput.disabled || globalWin.__stackInput.readOnly;
        if (inputIsReadOnly !== isReadOnly) {
          setIsReadOnly(inputIsReadOnly);
        }
      }
    };
    
    checkReadOnly();
    const interval = setInterval(checkReadOnly, 500);
    return () => clearInterval(interval);
  }, [isReadOnly]);

  useEffect(() => {
    stateRef.current = { atoms, bonds };
    draftStateRef.current = draftState;
    modeRef.current = mode;
    selectedElementRef.current = selectedElement;
    selectedBondOrderRef.current = selectedBondOrder;
    selectedEntityIdsRef.current = selectedEntityIds;
    
    window.dispatchEvent(new CustomEvent('molecule-changed', {
      detail: { atoms, bonds }
    }));
  }, [atoms, bonds, draftState, mode, selectedElement, selectedBondOrder, selectedEntityIds]);

  useEffect(() => {
    const handleStackLoad = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        if (typeof detail === 'string' && detail.trim() !== '') {
          const parsed = JSON.parse(detail);
          console.log("Loaded STACK molecule:", parsed);
          if (parsed && parsed.atoms && parsed.bonds) {
             setHistoryState({
               history: [parsed],
               index: 0
             });
             setDraftState(null);
          }
        }
      } catch (err) {
        console.warn("Failed to parse STACK value", err);
      }
    };
    
    window.addEventListener('stack-load-molecule', handleStackLoad);
    
    const handleStackDetected = () => {
      setIsStackEnvironment(true);
    };
    window.addEventListener('stack-environment-detected', handleStackDetected);
    
    return () => {
      window.removeEventListener('stack-load-molecule', handleStackLoad);
      window.removeEventListener('stack-environment-detected', handleStackDetected);
    };
  }, []);

  const updateState = (newAtoms: Atom[], newBonds: Bond[]) => {
    if (isReadOnly || testReadOnlyMode) return;
    setHistoryState(prev => {
      const newHistory = prev.history.slice(0, prev.index + 1);
      newHistory.push(JSON.parse(JSON.stringify({ atoms: newAtoms, bonds: newBonds })));
      if (newHistory.length > 50) newHistory.shift();
      return {
        history: newHistory,
        index: newHistory.length - 1
      };
    });
    setDraftState(null);
  };

  const updateDraft = (newAtoms: Atom[], newBonds: Bond[]) => {
    if (isReadOnly || testReadOnlyMode) return;
    setDraftState({ atoms: newAtoms, bonds: newBonds });
  };

  const rotateSelection = (degrees: number) => {
    if (selectedEntityIds.length === 0 || degrees === 0) return;

    const selectedAtomIds = new Set<string>();
    selectedEntityIds.forEach(id => {
      if (atoms.some(a => a.id === id)) selectedAtomIds.add(id);
      const bond = bonds.find(b => b.id === id);
      if (bond) {
        selectedAtomIds.add(bond.atom1Id);
        selectedAtomIds.add(bond.atom2Id);
      }
    });

    const selectedAtomsList = atoms.filter(a => selectedAtomIds.has(a.id));
    if (selectedAtomsList.length < 2) return;

    const cx = selectedAtomsList.reduce((sum, a) => sum + a.x, 0) / selectedAtomsList.length;
    const cy = selectedAtomsList.reduce((sum, a) => sum + a.y, 0) / selectedAtomsList.length;

    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const newAtoms = atoms.map(a => {
      if (selectedAtomIds.has(a.id)) {
        const dx = a.x - cx;
        const dy = a.y - cy;
        return {
          ...a,
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos
        };
      }
      return a;
    });

    if (draftState) {
        updateDraft(newAtoms, bonds);
    } else {
        updateState(newAtoms, bonds);
    }
  };

  const reflectSelection = (direction: 'horizontal' | 'vertical') => {
    if (selectedEntityIds.length === 0) return;

    const selectedAtomIds = new Set<string>();
    selectedEntityIds.forEach(id => {
      if (atoms.some(a => a.id === id)) selectedAtomIds.add(id);
      const bond = bonds.find(b => b.id === id);
      if (bond) {
        selectedAtomIds.add(bond.atom1Id);
        selectedAtomIds.add(bond.atom2Id);
      }
    });

    const selectedAtomsList = atoms.filter(a => selectedAtomIds.has(a.id));
    if (selectedAtomsList.length < 2) return;

    const cx = selectedAtomsList.reduce((sum, a) => sum + a.x, 0) / selectedAtomsList.length;
    const cy = selectedAtomsList.reduce((sum, a) => sum + a.y, 0) / selectedAtomsList.length;

    const newAtoms = atoms.map(a => {
      if (selectedAtomIds.has(a.id)) {
        if (direction === 'horizontal') {
          return { ...a, x: cx - (a.x - cx) };
        } else {
          return { ...a, y: cy - (a.y - cy) };
        }
      }
      return a;
    });

    updateState(newAtoms, bonds);
  };

  const undo = () => {
    if (isReadOnly || testReadOnlyMode) return;
    setHistoryState(prev => {
      if (prev.index > 0) return { ...prev, index: prev.index - 1 };
      return prev;
    });
    setDraftState(null);
  };

  const redo = () => {
    if (isReadOnly || testReadOnlyMode) return;
    setHistoryState(prev => {
      if (prev.index < prev.history.length - 1) return { ...prev, index: prev.index + 1 };
      return prev;
    });
    setDraftState(null);
  };


  const getSvgCoords = (e: React.PointerEvent | PointerEvent | React.MouseEvent | MouseEvent) => {
    if (!svgRef.current || !gRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const transform = gRef.current.getScreenCTM()?.inverse();
    if (transform) {
      const transformed = pt.matrixTransform(transform);
      return { x: transformed.x, y: transformed.y };
    }
    return { x: 0, y: 0 };
  };

  const handleSvgPointerDown = (e: React.PointerEvent) => {
    if (isReadOnly || testReadOnlyMode) return;
    const { x, y } = getSvgCoords(e);

    if (mode === 'atom') {
      const newAtom: Atom = {
        id: crypto.randomUUID(),
        symbol: selectedElement,
        x,
        y,
        lonePairs: 0,
        charge: 0,
      };
      updateState([...atoms, newAtom], bonds);
      setSelectedEntityIds([newAtom.id]);
    } else if (mode === 'select') {
      selectionBoxStartRef.current = { x, y };
      setSelectionBoxStart({ x, y });
      setSelectionBoxCurrent({ x, y });
      if (!e.shiftKey) {
        setSelectedEntityIds([]);
      }
    }
  };

  const handleSvgPointerUp = (e: React.PointerEvent) => {
    // Moved to handleGlobalPointerUp to ensure we don't drop interactions outside SVG
  };

  const handleAtomPointerDown = (e: React.PointerEvent, atomId: string) => {
    e.stopPropagation();
    if (isReadOnly || testReadOnlyMode) return;
    
    if (mode === 'select') {
      let idsToDrag = selectedEntityIds.includes(atomId) ? selectedEntityIds.filter(id => atoms.some(a=>a.id===id)) : [atomId];
      if (!selectedEntityIds.includes(atomId)) {
        if (e.shiftKey) {
          idsToDrag = [...idsToDrag, atomId];
          setSelectedEntityIds(idsToDrag);
        } else {
          setSelectedEntityIds([atomId]);
        }
      }
      setDraggingAtomIds(idsToDrag);
      dragInitialMouseRef.current = getSvgCoords(e);
      dragInitialAtomsRef.current = atoms.filter(a => idsToDrag.includes(a.id));
      dragHasMovedRef.current = false;
    } else if (mode === 'bond' || mode === 'atom') {
      setSelectedEntityIds([atomId]);
      dragStartAtomRef.current = atomId;
      setDragStartAtom(atomId);
    } else if (mode === 'erase') {
      setSelectedEntityIds([atomId]);
      updateState(atoms.filter(a => a.id !== atomId), bonds.filter(b => b.atom1Id !== atomId && b.atom2Id !== atomId));
      if (selectedEntityIds.includes(atomId)) setSelectedEntityIds(selectedEntityIds.filter(id => id !== atomId));
    } else if (mode === 'lone-pair') {
      setSelectedEntityIds([atomId]);
      updateState(atoms.map(a => 
        a.id === atomId ? { ...a, lonePairs: (a.lonePairs + 1) % 5 } : a
      ), bonds);
    } else if (mode === 'charge') {
      setSelectedEntityIds([atomId]);
      updateState(atoms.map(a => {
        if (a.id !== atomId) return a;
        let newCharge = a.charge === 0 ? 1 : a.charge === 1 ? -1 : 0;
        return { ...a, charge: newCharge };
      }), bonds);
    }
  };

  const handleAtomPointerUp = (e: React.PointerEvent, atomId: string) => {
    e.stopPropagation();
    if ((mode === 'bond' || mode === 'atom') && dragStartAtomRef.current && dragStartAtomRef.current !== atomId) {
      const existingBondIndex = bonds.findIndex(b => 
        (b.atom1Id === dragStartAtomRef.current && b.atom2Id === atomId) ||
        (b.atom1Id === atomId && b.atom2Id === dragStartAtomRef.current)
      );

      if (existingBondIndex >= 0) {
        const newBonds = [...bonds];
        newBonds[existingBondIndex] = {
          ...newBonds[existingBondIndex],
          order: ((newBonds[existingBondIndex].order + 1) % 4) as 0 | 1 | 2 | 3
        };
        updateState(atoms, newBonds);
      } else {
        const newBond: Bond = {
          id: crypto.randomUUID(),
          atom1Id: dragStartAtomRef.current,
          atom2Id: atomId,
          order: selectedBondOrder,
        };
        updateState(atoms, [...bonds, newBond]);
      }
    } else if (mode === 'atom' && dragStartAtomRef.current === atomId) {
      updateState(atoms.map(a => 
        a.id === atomId ? { ...a, symbol: selectedElement } : a
      ), bonds);
    }
    
    dragStartAtomRef.current = null;
    setDragStartAtom(null);
    setDraggingAtomIds([]);
  };

  const handleBondPointerDown = (e: React.PointerEvent, bondId: string) => {
    e.stopPropagation();
    if (isReadOnly || testReadOnlyMode) return;
    setSelectedEntityIds([bondId]);
    if (mode === 'erase') {
      updateState(atoms, bonds.filter(b => b.id !== bondId));
      if (selectedEntityIds.includes(bondId)) setSelectedEntityIds(selectedEntityIds.filter(id => id !== bondId));
    } else if (mode === 'bond') {
      updateState(atoms, bonds.map(b => 
        b.id === bondId ? { ...b, order: ((b.order + 1) % 4) as 0 | 1 | 2 | 3 } : b
      ));
    }
  };

  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      const coords = getSvgCoords(e);
      setMousePos(coords);
      mousePosRef.current = coords;
      
      if (draggingAtomIds.length > 0 && dragInitialMouseRef.current) {
        dragHasMovedRef.current = true;
        const dx = coords.x - dragInitialMouseRef.current.x;
        const dy = coords.y - dragInitialMouseRef.current.y;
        
        const newAtoms = stateRef.current.atoms.map(a => {
           if (draggingAtomIds.includes(a.id)) {
              const initAtom = dragInitialAtomsRef.current.find(ia => ia.id === a.id);
              if (initAtom) {
                 return { ...a, x: initAtom.x + dx, y: initAtom.y + dy };
              }
           }
           return a;
        });
        updateDraft(newAtoms, stateRef.current.bonds);
      } else if (selectionBoxStartRef.current) {
        setSelectionBoxCurrent(coords);
      }
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      const coords = getSvgCoords(e);
      
      if (draggingAtomIds.length > 0) {
        if (dragHasMovedRef.current && draftStateRef.current) {
           updateState(draftStateRef.current.atoms, draftStateRef.current.bonds);
        }
        setDraggingAtomIds([]);
      }
      
      if (selectionBoxStartRef.current) {
        const start = selectionBoxStartRef.current;
        const minX = Math.min(start.x, coords.x);
        const maxX = Math.max(start.x, coords.x);
        const minY = Math.min(start.y, coords.y);
        const maxY = Math.max(start.y, coords.y);
        
        const selectedAtoms = stateRef.current.atoms.filter(a => 
          a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY
        ).map(a => a.id);
        
        const selectedBonds = stateRef.current.bonds.filter(b => {
          const a1 = stateRef.current.atoms.find(a => a.id === b.atom1Id);
          const a2 = stateRef.current.atoms.find(a => a.id === b.atom2Id);
          if (!a1 || !a2) return false;
          return a1.x >= minX && a1.x <= maxX && a1.y >= minY && a1.y <= maxY &&
                 a2.x >= minX && a2.x <= maxX && a2.y >= minY && a2.y <= maxY;
        }).map(b => b.id);

        if (e.shiftKey) {
          setSelectedEntityIds(prev => Array.from(new Set([...prev, ...selectedAtoms, ...selectedBonds])));
        } else {
          setSelectedEntityIds([...selectedAtoms, ...selectedBonds]);
        }
        
        selectionBoxStartRef.current = null;
        setSelectionBoxStart(null);
        setSelectionBoxCurrent(null);
      }
      
      if (dragStartAtomRef.current) {
         // Find if we released over an existing atom (for touch support)
         const targetAtom = stateRef.current.atoms.find(a => {
            const d = Math.hypot(coords.x - a.x, coords.y - a.y);
            return d < 25 && a.id !== dragStartAtomRef.current;
         });

         if (targetAtom) {
            // Create bond between start and target
            const startId = dragStartAtomRef.current;
            const targetId = targetAtom.id;
            const existingBondIndex = stateRef.current.bonds.findIndex(b => 
              (b.atom1Id === startId && b.atom2Id === targetId) ||
              (b.atom1Id === targetId && b.atom2Id === startId)
            );

            if (existingBondIndex >= 0) {
              const newBonds = [...stateRef.current.bonds];
              newBonds[existingBondIndex] = {
                ...newBonds[existingBondIndex],
                order: ((newBonds[existingBondIndex].order + 1) % 4) as 0 | 1 | 2 | 3
              };
              updateState(stateRef.current.atoms, newBonds);
            } else {
              const newBond: Bond = {
                id: crypto.randomUUID(),
                atom1Id: startId,
                atom2Id: targetId,
                order: selectedBondOrderRef.current,
              };
              updateState(stateRef.current.atoms, [...stateRef.current.bonds, newBond]);
            }
         } else if (modeRef.current === 'atom' || modeRef.current === 'bond') {
           // Create new atom and bond
           const startAtom = stateRef.current.atoms.find(a => a.id === dragStartAtomRef.current);
           if (startAtom) {
             const dist = Math.hypot(coords.x - startAtom.x, coords.y - startAtom.y);
             if (dist > 35) {
               const newAtom: Atom = {
                 id: crypto.randomUUID(),
                 symbol: selectedElementRef.current,
                 x: coords.x,
                 y: coords.y,
                 lonePairs: 0,
                 charge: 0,
               };
               const newBond: Bond = {
                 id: crypto.randomUUID(),
                 atom1Id: dragStartAtomRef.current,
                 atom2Id: newAtom.id,
                 order: selectedBondOrderRef.current,
               };
               updateState([...stateRef.current.atoms, newAtom], [...stateRef.current.bonds, newBond]);
               setSelectedEntityIds([newAtom.id]);
             }
           }
         }
      }
      
      dragStartAtomRef.current = null;
      setDragStartAtom(null);
    };

    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [draggingAtomIds]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEntityIds.length > 0) {
        // Prevent default if in our app, unless modifying an input
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
          return;
        }
        
        const newAtoms = atoms.filter(a => !selectedEntityIds.includes(a.id));
        const newBonds = bonds.filter(b => 
          !selectedEntityIds.includes(b.id) && 
          !selectedEntityIds.includes(b.atom1Id) && 
          !selectedEntityIds.includes(b.atom2Id)
        );
        updateState(newAtoms, newBonds);
        setSelectedEntityIds([]);
      }
    };
    
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [atoms, bonds, selectedEntityIds]);

  const exportData = useMemo(() => {
    const atomIndices = new Map<string, number>(atoms.map((a, i) => [a.id, i]));
    
    // Sort bonds so atom1 index < atom2 index for a more normalized topology output
    const normalizedBonds = bonds.map(b => {
      const idx1 = atomIndices.get(b.atom1Id) ?? -1;
      const idx2 = atomIndices.get(b.atom2Id) ?? -1;
      return {
        atom1: Math.min(idx1, idx2),
        atom2: Math.max(idx1, idx2),
        order: b.order
      };
    });
    
    // Sort array to ensure predictable bond order
    normalizedBonds.sort((a, b) => {
      if (a.atom1 !== b.atom1) return a.atom1 - b.atom1;
      if (a.atom2 !== b.atom2) return a.atom2 - b.atom2;
      return a.order - b.order;
    });

    const grading = {
      atoms: atoms.map(a => ({
        symbol: a.symbol,
        charge: a.charge,
        lonePairs: a.lonePairs
      })),
      bonds: normalizedBonds
    };
    
    return JSON.stringify({ 
      visual: { atoms, bonds }, 
      grading 
    }, null, 2);
  }, [atoms, bonds]);

  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'molecule-update', data: exportData }, '*',);
    }
  }, [exportData]);

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      
      const { atoms: currentAtoms, bonds: currentBonds } = stateRef.current;
      const selected = selectedEntityIdsRef.current;
      
      let atomsToCopy = currentAtoms;
      let bondsToCopy = currentBonds;

      if (selected.length > 0) {
        const selectedAtomIds = new Set<string>();
        const selectedBondIds = new Set<string>();
        
        selected.forEach(id => {
          if (currentAtoms.some(a => a.id === id)) selectedAtomIds.add(id);
          else if (currentBonds.some(b => b.id === id)) selectedBondIds.add(id);
        });

        selectedBondIds.forEach(bondId => {
          const bond = currentBonds.find(b => b.id === bondId);
          if (bond) {
            selectedAtomIds.add(bond.atom1Id);
            selectedAtomIds.add(bond.atom2Id);
          }
        });

        atomsToCopy = currentAtoms.filter(a => selectedAtomIds.has(a.id));
        bondsToCopy = currentBonds.filter(b => selectedAtomIds.has(b.atom1Id) && selectedAtomIds.has(b.atom2Id));
      }

      const copyPayload = JSON.stringify({
        visual: { atoms: atomsToCopy, bonds: bondsToCopy }
      });
      
      e.clipboardData?.setData('text/plain', copyPayload);
      e.preventDefault();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      try {
        const text = e.clipboardData?.getData('text/plain');
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed.visual && parsed.visual.atoms && parsed.visual.bonds) {
            e.preventDefault();
            const { atoms: currentAtoms, bonds: currentBonds } = stateRef.current;
            const pasteAtoms: Atom[] = parsed.visual.atoms;
            const pasteBonds: Bond[] = parsed.visual.bonds;
            const mouse = mousePosRef.current;

            if (pasteAtoms.length > 0) {
               const cx = pasteAtoms.reduce((sum, a) => sum + a.x, 0) / pasteAtoms.length;
               const cy = pasteAtoms.reduce((sum, a) => sum + a.y, 0) / pasteAtoms.length;
               const dx = mouse.x - cx;
               const dy = mouse.y - cy;
               
               const idMap = new Map<string, string>();
               
               const newAtoms = pasteAtoms.map(a => {
                 const newId = crypto.randomUUID();
                 idMap.set(a.id, newId);
                 return { ...a, id: newId, x: a.x + dx, y: a.y + dy };
               });
               
               const newBonds = pasteBonds.filter(b => idMap.has(b.atom1Id) && idMap.has(b.atom2Id)).map(b => ({
                 ...b,
                 id: crypto.randomUUID(),
                 atom1Id: idMap.get(b.atom1Id) as string,
                 atom2Id: idMap.get(b.atom2Id) as string
               }));

               updateState([...currentAtoms, ...newAtoms], [...currentBonds, ...newBonds]);
               
               const newEntityIds = [
                 ...newAtoms.map(a => a.id),
                 ...newBonds.map(b => b.id)
               ];
               setSelectedEntityIds(newEntityIds);
            }
          }
        }
      } catch (err) {}
    };

    window.addEventListener('copy', handleCopy);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  const getAtomValency = (atomId: string) => {
    return bonds
      .filter(b => b.atom1Id === atomId || b.atom2Id === atomId)
      .reduce((sum, b) => sum + b.order, 0);
  };

  const getExpectedValency = (symbol: ElementType) => {
    const valencies: Record<string, number> = {
      C: 4, N: 3, O: 2, H: 1, F: 1, Cl: 1, Br: 1, I: 1, P: 5, S: 6
    };
    return valencies[symbol] || 0;
  };

  const saveMolecule = () => {
    if (atoms.length === 0) return;
    setSaveName(`Structure ${savedMolecules.length + 1}`);
    setShowSavePrompt(true);
  };

  const executeSaveMolecule = () => {
    const name = saveName || `Structure ${savedMolecules.length + 1}`;
    setSavedMolecules([...savedMolecules, {
      id: crypto.randomUUID(),
      name,
      data: { atoms, bonds }
    }]);
    setShowSavePrompt(false);
  };

  const isHydrogenOnCarbon = (atomId: string) => {
    const atom = atoms.find(a => a.id === atomId);
    if (atom?.symbol !== 'H') return false;
    return bonds.some(b => {
      if (b.atom1Id === atomId) return atoms.find(a => a.id === b.atom2Id)?.symbol === 'C';
      if (b.atom2Id === atomId) return atoms.find(a => a.id === b.atom1Id)?.symbol === 'C';
      return false;
    });
  }

  const visibleAtoms = atoms.filter(a => {
    if (hideCHydrogens || skeletalMode) {
      if (isHydrogenOnCarbon(a.id)) return false;
    }
    return true;
  });

  const visibleBonds = bonds.filter(b => {
    if (hideCHydrogens || skeletalMode) {
      if (isHydrogenOnCarbon(b.atom1Id) || isHydrogenOnCarbon(b.atom2Id)) return false;
    }
    return true;
  });

  const exportImage = () => {
    if (!svgRef.current || atoms.length === 0) return;
    
    // Choose what to export: selected entities, or all if none selected
    let targetAtoms = visibleAtoms;
    let targetBonds = visibleBonds;
    
    if (selectedEntityIds.length > 0) {
      const selectedAtomIds = new Set<string>();
      selectedEntityIds.forEach(id => {
        if (visibleAtoms.some(a => a.id === id)) selectedAtomIds.add(id);
        const bond = visibleBonds.find(b => b.id === id);
        if (bond) {
          selectedAtomIds.add(bond.atom1Id);
          selectedAtomIds.add(bond.atom2Id);
        }
      });
      targetAtoms = visibleAtoms.filter(a => selectedAtomIds.has(a.id));
      targetBonds = visibleBonds.filter(b => selectedAtomIds.has(b.atom1Id) && selectedAtomIds.has(b.atom2Id));
    }

    if (targetAtoms.length === 0) return;

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    targetAtoms.forEach(a => {
      minX = Math.min(minX, a.x - 30);
      minY = Math.min(minY, a.y - 30);
      maxX = Math.max(maxX, a.x + 30);
      maxY = Math.max(maxY, a.y + 30);
    });

    const width = maxX - minX;
    const height = maxY - minY;

    // Create a standalone SVG string
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">
        <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="white" />
        <g>
          ${targetBonds.map(b => {
             const a1 = targetAtoms.find(a => a.id === b.atom1Id);
             const a2 = targetAtoms.find(a => a.id === b.atom2Id);
             if(!a1 || !a2) return '';
             const dx = a2.x - a1.x;
             const dy = a2.y - a1.y;
             const angle = Math.atan2(dy, dx) * 180 / Math.PI;
             const length = Math.sqrt(dx * dx + dy * dy);
             
             const getOffset = (atom: Pick<Atom, 'symbol'>) => {
               let base = 0;
               if (skeletalMode && atom.symbol === 'C') base = 0;
               else if (!filledMode) base = 8;
               else base = (ATOM_RADII[atom.symbol] || 20) + 1;
               
               if (b.order === 0 && atom.symbol !== 'H') {
                 base += 4;
               }
               return base;
             };
             
             const offset1 = getOffset(a1);
             const offset2 = getOffset(a2);
             const bondLength = Math.max(0, length - offset1 - offset2);
             
             let lines = '';
             const color = "#64748B";
             const strokeWidth = 2;
             const spacing = 3;
             
             if (b.order === 0) {
                lines = `<line x1="0" y1="0" x2="${bondLength}" y2="0" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="4 4" stroke-linecap="round" />`;
             } else if (b.order === 1) {
                lines = `<line x1="0" y1="0" x2="${bondLength}" y2="0" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
             } else if (b.order === 2) {
                lines = `<line x1="0" y1="${-spacing/2}" x2="${bondLength}" y2="${-spacing/2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />
                        <line x1="0" y1="${spacing/2}" x2="${bondLength}" y2="${spacing/2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
             } else {
                lines = `<line x1="0" y1="${-spacing}" x2="${bondLength}" y2="${-spacing}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />
                        <line x1="0" y1="0" x2="${bondLength}" y2="0" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />
                        <line x1="0" y1="${spacing}" x2="${bondLength}" y2="${spacing}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
             }
             
             return `<g transform="translate(${a1.x}, ${a1.y}) rotate(${angle}) translate(${offset1}, 0)">${lines}</g>`;
          }).join('')}
          ${targetAtoms.map(a => {
            const isSkeletalC = skeletalMode && a.symbol === 'C';
            if (isSkeletalC) return '';
            
            const color = ATOM_COLORS[a.symbol] || '#e2e8f0';
            const baseTextColor = ATOM_TEXT_COLORS[a.symbol] || '#475569';
            
            const shouldDrawFill = filledMode && !isSkeletalC;
            const circleFill = shouldDrawFill ? color : "transparent";
            
            let unfilledTextColor = color;
            if (a.symbol === 'H') unfilledTextColor = '#64748b';
            else if (a.symbol === 'C') unfilledTextColor = '#1e293b';
            
            const textColor = shouldDrawFill ? baseTextColor : unfilledTextColor;
            
            const currentV = bonds.filter(b => b.atom1Id === a.id || b.atom2Id === a.id).reduce((sum, b) => sum + b.order, 0);
            const expectedV = getExpectedValency(a.symbol);
            const implicitH = Math.max(0, expectedV - currentV);
            const shouldHideImplicitH = hideImplicitHydrogens || ((hideCHydrogens || skeletalMode) && a.symbol === 'C');
            
            let implicitHText = '';
            if (a.symbol !== 'H' && implicitH > 0 && !shouldHideImplicitH) {
                const hTextColor = shouldDrawFill ? (color === '#ffffff' ? '#64748b' : color) : textColor;
                implicitHText = `<text x="14" y="14" fill="${hTextColor}" font-size="10" font-weight="bold" font-family="sans-serif">H${implicitH > 1 ? implicitH : ''}</text>`;
            }

            return `<g transform="translate(${a.x}, ${a.y})">
              <circle r="16" fill="${circleFill}" stroke="white" stroke-width="2" />
              <text text-anchor="middle" dominant-baseline="central" fill="${textColor}" font-size="14" font-weight="bold" font-family="sans-serif">${a.symbol}</text>
              ${implicitHText}
            </g>`;
          }).join('')}
        </g>
      </svg>
    `;

    const blob = new Blob([svgContent], {type: "image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const pngUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.download = "molecule.png";
        a.href = pngUrl;
        a.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const cleanStructure = () => {
    if (atoms.length === 0) return;
    
    const selectedAtomIds = selectedEntityIds.filter(id => atoms.some(a => a.id === id));
    const targetAtomIds = new Set<string>(selectedAtomIds.length > 1 ? selectedAtomIds : atoms.map(a => a.id));
    
    let currentAtoms = atoms.map(a => ({ ...a, vx: 0, vy: 0 }));
    
    const iterCount = 400;
    const dt = 0.5;
    const defaultBondLengthMultiplier = 0.95;
    const repulsionStrength = 2500;
    const springStrength = 0.5;
    const angleStrength = 0.2;
    const targetAngle = 120 * (Math.PI / 180);

    const adjacentMap = new Map<string, string[]>();
    currentAtoms.forEach(a => adjacentMap.set(a.id, []));
    bonds.forEach(b => {
        adjacentMap.get(b.atom1Id)?.push(b.atom2Id);
        adjacentMap.get(b.atom2Id)?.push(b.atom1Id);
    });
    
    for (let i = 0; i < iterCount; i++) {
        const forces = new Map<string, { x: number, y: number }>();
        currentAtoms.forEach(a => forces.set(a.id, { x: 0, y: 0 }));
        
        // 1. Repulsion between all pairs
        for (let j = 0; j < currentAtoms.length; j++) {
            for (let k = j + 1; k < currentAtoms.length; k++) {
                const a1 = currentAtoms[j];
                const a2 = currentAtoms[k];
                const dx = a1.x - a2.x;
                const dy = a1.y - a2.y;
                const distSq = dx * dx + dy * dy;
                if (distSq > 0 && distSq < 300000) {
                    const dist = Math.sqrt(distSq);
                    const force = repulsionStrength / distSq;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    
                    if (targetAtomIds.has(a1.id)) {
                      forces.get(a1.id)!.x += fx;
                      forces.get(a1.id)!.y += fy;
                    }
                    if (targetAtomIds.has(a2.id)) {
                      forces.get(a2.id)!.x -= fx;
                      forces.get(a2.id)!.y -= fy;
                    }
                }
            }
        }
        
        // 2. Spring force along bonds
        bonds.forEach(b => {
             const a1 = currentAtoms.find(a => a.id === b.atom1Id);
             const a2 = currentAtoms.find(a => a.id === b.atom2Id);
             if (a1 && a2) {
                 const dx = a2.x - a1.x;
                 const dy = a2.y - a1.y;
                 const dist = Math.sqrt(dx * dx + dy * dy);
                 if (dist > 0) {
                     const r1 = ATOM_RADII[a1.symbol] || 20;
                     const r2 = ATOM_RADII[a2.symbol] || 20;
                     let idealDist = (r1 + r2) * defaultBondLengthMultiplier;
                     if (b.order === 0) idealDist *= 2.0;
                     
                     const diff = dist - idealDist;
                     const force = diff * springStrength;
                     
                     const fx = (dx / dist) * force;
                     const fy = (dy / dist) * force;
                     
                     if (targetAtomIds.has(a1.id)) {
                       forces.get(a1.id)!.x += fx;
                       forces.get(a1.id)!.y += fy;
                     }
                     if (targetAtomIds.has(a2.id)) {
                       forces.get(a2.id)!.x -= fx;
                       forces.get(a2.id)!.y -= fy;
                     }
                 }
             }
        });

        // 3. Angle forces (try to keep angles around 120 degrees for branches)
        currentAtoms.forEach(a => {
            const adj = adjacentMap.get(a.id)!;
            if (adj.length >= 2) {
                if (a.symbol === 'O') {
                    // For Oxygen, we want specific angles between specific types of bonds,
                    // regardless of their current angular sorting (to avoid topological traps).
                    for (let j = 0; j < adj.length; j++) {
                        for (let k = j + 1; k < adj.length; k++) {
                            const n1 = currentAtoms.find(na => na.id === adj[j])!;
                            const n2 = currentAtoms.find(na => na.id === adj[k])!;
                            
                            const v1x = n1.x - a.x;
                            const v1y = n1.y - a.y;
                            const v2x = n2.x - a.x;
                            const v2y = n2.y - a.y;
                            
                            const d1 = Math.sqrt(v1x*v1x + v1y*v1y);
                            const d2 = Math.sqrt(v2x*v2x + v2y*v2y);
                            
                            if (d1 > 0 && d2 > 0) {
                                const dot = (v1x*v2x + v1y*v2y) / (d1*d2);
                                let currentAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
                                
                                const b1 = bonds.find(b => (b.atom1Id === a.id && b.atom2Id === adj[j]) || (b.atom2Id === a.id && b.atom1Id === adj[j]));
                                const b2 = bonds.find(b => (b.atom1Id === a.id && b.atom2Id === adj[k]) || (b.atom2Id === a.id && b.atom1Id === adj[k]));
                                const isN1Cov = b1 && b1.order > 0;
                                const isN2Cov = b2 && b2.order > 0;
                                
                                let tAngle = -1; // -1 means don't apply force
                                if (isN1Cov && isN2Cov) {
                                  tAngle = 104.5 * Math.PI / 180;
                                } else if (!isN1Cov && !isN2Cov) {
                                  tAngle = 140 * Math.PI / 180;
                                } else if (adj.length === 2 && isN1Cov !== isN2Cov) {
                                  tAngle = 120 * Math.PI / 180;
                                }
                                
                                if (tAngle > 0) {
                                    const diff = currentAngle - tAngle;
                                    if (Math.abs(diff) > 0.05) {
                                        const sign = (v1x*v2y - v1y*v2x) > 0 ? 1 : -1;
                                        const force = diff * angleStrength * sign;
                                        
                                        const f1x = -v1y / d1 * force * d1; // rotate v1
                                        const f1y = v1x / d1 * force * d1;
                                        
                                        const f2x = v2y / d2 * force * d2;  // rotate v2 opposite
                                        const f2y = -v2x / d2 * force * d2;
                                        
                                        if (targetAtomIds.has(n1.id)) {
                                            forces.get(n1.id)!.x += f1x;
                                            forces.get(n1.id)!.y += f1y;
                                            forces.get(a.id)!.x -= f1x;
                                            forces.get(a.id)!.y -= f1y;
                                        }
                                        if (targetAtomIds.has(n2.id)) {
                                            forces.get(n2.id)!.x += f2x;
                                            forces.get(n2.id)!.y += f2y;
                                            forces.get(a.id)!.x -= f2x;
                                            forces.get(a.id)!.y -= f2y;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else if (adj.length === 2) {
                    // For simple linear chains, use original unsorted pair processing
                    // to perfectly maintain the natural zigzag generated by the drawing order bias
                    const n1Id = adj[0];
                    const n2Id = adj[1];
                    const n1 = currentAtoms.find(na => na.id === n1Id)!;
                    const n2 = currentAtoms.find(na => na.id === n2Id)!;
                    
                    const v1x = n1.x - a.x;
                    const v1y = n1.y - a.y;
                    const v2x = n2.x - a.x;
                    const v2y = n2.y - a.y;
                    
                    const d1 = Math.sqrt(v1x*v1x + v1y*v1y);
                    const d2 = Math.sqrt(v2x*v2x + v2y*v2y);
                    
                    if (d1 > 0 && d2 > 0) {
                        const dot = (v1x*v2x + v1y*v2y) / (d1*d2);
                        let currentAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
                        
                        let tAngle = targetAngle;
                        if (bonds.some(b => (b.atom1Id === n1.id && b.atom2Id === n2.id) || (b.atom1Id === n2.id && b.atom2Id === n1.id))) {
                            tAngle = Math.PI / 3;
                        } else if (a.symbol === 'H') {
                            tAngle = Math.PI;
                        } else {
                            const totalOrder = bonds.filter(b => b.atom1Id === a.id || b.atom2Id === a.id).reduce((sum, b) => sum + b.order, 0);
                            if (totalOrder === 4) tAngle = Math.PI; // sp hybridized
                            else tAngle = targetAngle;
                        }

                        const diff = currentAngle - tAngle;
                        if (Math.abs(diff) > 0.05) {
                            const sign = (v1x*v2y - v1y*v2x) > 0 ? 1 : -1;
                            const force = diff * angleStrength * sign;
                            
                            const f1x = -v1y / d1 * force * d1; // rotate v1
                            const f1y = v1x / d1 * force * d1;
                            
                            const f2x = v2y / d2 * force * d2;  // rotate v2 opposite
                            const f2y = -v2x / d2 * force * d2;
                            
                            if (targetAtomIds.has(n1.id)) {
                                forces.get(n1.id)!.x += f1x;
                                forces.get(n1.id)!.y += f1y;
                                forces.get(a.id)!.x -= f1x;
                                forces.get(a.id)!.y -= f1y;
                            }
                            if (targetAtomIds.has(n2.id)) {
                                forces.get(n2.id)!.x += f2x;
                                forces.get(n2.id)!.y += f2y;
                                forces.get(a.id)!.x -= f2x;
                                forces.get(a.id)!.y -= f2y;
                            }
                        }
                    }
                } else {
                    // For other atoms (3 or more neighbors), use angular sorting to avoid folding
                    const anglesMap = new Map<string, number>();
                    adj.forEach(nId => {
                        const n = currentAtoms.find(na => na.id === nId)!;
                        anglesMap.set(nId, Math.atan2(n.y - a.y, n.x - a.x));
                    });
                    const sortedAdj = [...adj].sort((n1, n2) => anglesMap.get(n1)! - anglesMap.get(n2)!);
                    
                    const pairsToProcess = sortedAdj.length === 2 ? 1 : sortedAdj.length;

                    for (let j = 0; j < pairsToProcess; j++) {
                        const k = (j + 1) % sortedAdj.length;
                        const n1Id = sortedAdj[j];
                        const n2Id = sortedAdj[k];
                        
                        const n1 = currentAtoms.find(na => na.id === n1Id)!;
                        const n2 = currentAtoms.find(na => na.id === n2Id)!;
                        
                        const v1x = n1.x - a.x;
                        const v1y = n1.y - a.y;
                        const v2x = n2.x - a.x;
                        const v2y = n2.y - a.y;
                        
                        const d1 = Math.sqrt(v1x*v1x + v1y*v1y);
                        const d2 = Math.sqrt(v2x*v2x + v2y*v2y);
                        
                        if (d1 > 0 && d2 > 0) {
                            const dot = (v1x*v2x + v1y*v2y) / (d1*d2);
                            let currentAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
                            
                            let tAngle = targetAngle;
                            
                            if (a.symbol === 'H' && adj.length >= 2) {
                                tAngle = Math.PI;
                            } else {
                                if (adj.length === 4) tAngle = Math.PI / 2;
                                else if (adj.length === 3) tAngle = Math.PI * 2 / 3;
                            }

                            const diff = currentAngle - tAngle;
                            
                            if (Math.abs(diff) > 0.05) {
                                // Pushing neighbors to adjust angle
                                const sign = (v1x*v2y - v1y*v2x) > 0 ? 1 : -1;
                                const force = diff * angleStrength * sign;
                                
                                const f1x = -v1y / d1 * force * d1; // rotate v1
                                const f1y = v1x / d1 * force * d1;
                                
                                const f2x = v2y / d2 * force * d2;  // rotate v2 opposite
                                const f2y = -v2x / d2 * force * d2;
                                
                                if (targetAtomIds.has(n1.id)) {
                                    forces.get(n1.id)!.x += f1x;
                                    forces.get(n1.id)!.y += f1y;
                                    forces.get(a.id)!.x -= f1x;
                                    forces.get(a.id)!.y -= f1y;
                                }
                                if (targetAtomIds.has(n2.id)) {
                                    forces.get(n2.id)!.x += f2x;
                                    forces.get(n2.id)!.y += f2y;
                                    forces.get(a.id)!.x -= f2x;
                                    forces.get(a.id)!.y -= f2y;
                                }
                            }
                        }
                    }
                }
            }
        });
        
        // Apply forces to target atoms
        currentAtoms.forEach(a => {
             if (targetAtomIds.has(a.id)) {
                 const f = forces.get(a.id)!;
                 a.vx = (a.vx + f.x * dt) * 0.7; // Damping
                 a.vy = (a.vy + f.y * dt) * 0.7;
                 a.x += a.vx * dt;
                 a.y += a.vy * dt;
             }
        });
    }
    
    // Save to state
    const newAtoms = currentAtoms.map(a => {
        const { vx, vy, ...rest } = a;
        return rest;
    });
    updateState(newAtoms, bonds);
  };

  const loadMolecule = (mol: Molecule) => {
    updateState(mol.atoms, mol.bonds);
    setSelectedEntityIds([]);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(exportData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    if (window.parent !== window) {
      window.parent.postMessage({ type: 'molecule-update', data: exportData }, '*');
    }
  };

  const selectedAtom = atoms.find(a => selectedEntityIds.length === 1 && a.id === selectedEntityIds[0]);
  const selectedBond = bonds.find(b => selectedEntityIds.length === 1 && b.id === selectedEntityIds[0]);

  const elementComparison = useMemo(() => {
    if (!teacherAnswer) return null;
    const drawnCounts: Record<string, number> = {};
    const expectedCounts: Record<string, number> = {};
    
    atoms.forEach(a => {
      drawnCounts[a.symbol] = (drawnCounts[a.symbol] || 0) + 1;
    });
    
    teacherAnswer.atoms.forEach(a => {
      expectedCounts[a.symbol] = (expectedCounts[a.symbol] || 0) + 1;
    });
    
    const allElements = Array.from(new Set([
      ...Object.keys(drawnCounts),
      ...Object.keys(expectedCounts)
    ]));
    
    return allElements.map(el => ({
      symbol: el,
      drawn: drawnCounts[el] || 0,
      expected: expectedCounts[el] || 0,
      matched: (drawnCounts[el] || 0) === (expectedCounts[el] || 0)
    }));
  }, [atoms, teacherAnswer]);

  const gradeResult = useMemo(() => {
    if (!teacherAnswer) return null;
    return areMoleculesEqual({ atoms, bonds }, teacherAnswer, strictMatching);
  }, [atoms, bonds, teacherAnswer, strictMatching]);

  const isStudentMode = isStackEnvironment && !isInstructor;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white font-sans text-slate-900">
      {/* Header Navigation */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-20">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xl ring-2 ring-indigo-100">C</div>
            <span className="font-bold tracking-tight text-lg text-slate-800 animate-fade-in">ChemConnect Studio</span>
          </div>
          <nav className="flex space-x-1 ml-6 h-full items-center">
            <button 
              onClick={undo} 
              disabled={historyState.index === 0 || testReadOnlyMode || isReadOnly}
              className="flex items-center px-3 py-1.5 text-sm font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Undo last action"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" /> Undo
            </button>
            <button 
              onClick={redo} 
              disabled={historyState.index === historyState.history.length - 1 || testReadOnlyMode || isReadOnly}
              className="flex items-center px-3 py-1.5 text-sm font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Redo previous action"
            >
              <RotateCcw className="w-4 h-4 mr-1.5 transform scale-x-[-1]" /> Redo
            </button>
            
            <div className="w-px h-6 bg-slate-200 mx-2"></div>
            
            <button 
              onClick={cleanStructure}
              disabled={testReadOnlyMode || isReadOnly}
              className="group flex items-center px-3 py-1.5 text-sm font-semibold rounded text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Optimize 2D visual layout of drawn structure"
            >
              <span className="mr-1.5 group-hover:animate-pulse">🪄</span> Clean Structure
            </button>

            {isInstructor ? (
              <span className="px-2 py-1 text-[10px] font-black uppercase text-amber-700 bg-amber-50 border border-amber-200 rounded-md ml-4 tracking-wider flex items-center gap-1 shrink-0 select-none">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                Instructor Mode
              </span>
            ) : isStudentMode ? (
              <span className="px-2 py-1 text-[10px] font-black uppercase text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md ml-4 tracking-wider flex items-center gap-1 shrink-0 select-none">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                Student Mode
              </span>
            ) : null}

            {isReadOnly && (
              <span className="px-2 py-1 text-[10px] font-bold uppercase text-rose-700 bg-rose-50 border border-rose-200 rounded-md ml-4 tracking-wider select-none shrink-0" title="Read Only — Evaluation Display">
                Read Only
              </span>
            )}
            
            <label className="flex items-center space-x-2 text-xs font-semibold text-slate-600 ml-4 cursor-pointer">
              <input type="checkbox" checked={hideCHydrogens} onChange={(e) => setHideCHydrogens(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5" />
              <span>Hide C-H</span>
            </label>
            <label className="flex items-center space-x-2 text-xs font-semibold text-slate-600 ml-4 cursor-pointer">
              <input type="checkbox" checked={skeletalMode} onChange={(e) => setSkeletalMode(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5" />
              <span>Skeletal</span>
            </label>
            <label className="flex items-center space-x-2 text-xs font-semibold text-slate-600 ml-4 cursor-pointer">
              <input type="checkbox" checked={filledMode} onChange={(e) => setFilledMode(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5" />
              <span>Filled</span>
            </label>
          </nav>
        </div>
        
        <div className="flex items-center space-x-4">
          {isInstructor && (
            <button 
              onClick={() => {
                setTestReadOnlyMode(!testReadOnlyMode);
                setSelectedEntityIds([]);
              }}
              className={cn(
                "px-3 py-1.5 rounded text-xs font-bold transition-all shadow-sm border uppercase tracking-wider",
                testReadOnlyMode 
                  ? "bg-rose-600 text-white border-rose-700 hover:bg-rose-700 font-black animate-pulse"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
              )}
            >
              {testReadOnlyMode ? "🛑 Stop Testing Submitted" : "🔬 Test Submitted State"}
            </button>
          )}

          {isStackEnvironment ? (
            <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-green-50 border border-green-100 rounded-full select-none">
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
               <span className="text-[10px] font-bold text-green-700 uppercase tracking-wide">STACK Linked</span>
            </div>
          ) : null}
          <div className="text-right hidden sm:block select-none">
            <p className="text-xs font-bold text-slate-700">{(isInstructor || !isStackEnvironment) ? "Dr. Julian Sterling" : "Student Account"}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{(isInstructor || !isStackEnvironment) ? "Chemistry 101 Section B" : "Interactive assignment"}</p>
          </div>
          <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center border-2 border-white shadow-md ring-1 ring-slate-100 group cursor-pointer hover:ring-indigo-200 transition-all select-none">
            <span className="text-xs font-bold text-slate-600 group-hover:text-indigo-600">{(isInstructor || !isStackEnvironment) ? "JS" : "ST"}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar - Sidebar Palette */}
        {(!isReadOnly && !testReadOnlyMode) ? (
          <aside className="w-20 bg-white border-r border-slate-200 flex flex-col items-center py-4 space-y-4 shadow-[1px_0_4px_rgba(0,0,0,0.02)] z-10 shrink-0 overflow-y-auto overflow-x-hidden">
            <ToolPaletteButton 
              active={mode === 'select'} 
              onClick={() => setMode('select')}
              icon={<MousePointer2 className="w-5 h-5" />}
              label="Select"
            />
            <div className="w-8 h-px bg-slate-100 my-2" />
            
            <ToolPaletteButton 
              active={mode === 'atom'} 
              onClick={() => { setMode('atom'); }}
              icon={<Plus className="w-5 h-5" />}
              label="Atom"
            />
            
            {/* Elements Quick Access */}
            <div className="flex flex-col gap-1 w-full px-2">
              {['C', 'H', 'O', 'N', 'P', 'S', 'F', 'Cl', 'Br', 'I'].map(el => (
                <button
                  key={el}
                  onClick={() => {
                    setSelectedElement(el as ElementType);
                    setMode('atom');
                  }}
                  className={cn(
                    "w-full h-8 flex items-center justify-center rounded font-bold text-sm transition-all",
                    selectedElement === el && mode === 'atom'
                      ? "bg-indigo-600 text-white shadow-lg mx-0"
                      : "text-slate-400 hover:bg-slate-50 hover:text-slate-600 mx-1 w-auto"
                  )}
                >
                  {el}
                </button>
              ))}
              <button
                onClick={() => {
                  setShowElementPrompt(true);
                }}
                title="Other element"
                className={cn(
                  "w-full h-8 flex items-center justify-center rounded font-bold text-xs transition-all",
                  !['C', 'H', 'O', 'N', 'P', 'S', 'F', 'Cl', 'Br', 'I'].includes(selectedElement) && mode === 'atom'
                    ? "bg-indigo-600 text-white shadow-lg mx-0"
                    : "text-slate-400 hover:bg-slate-50 hover:text-slate-600 mx-1 w-auto"
                )}
              >
                {['C', 'H', 'O', 'N', 'P', 'S', 'F', 'Cl', 'Br', 'I'].includes(selectedElement) ? '...' : selectedElement}
              </button>
            </div>

            <div className="w-8 h-px bg-slate-100 my-2" />
            
            <ToolPaletteButton 
              active={mode === 'bond'} 
              onClick={() => setMode('bond')}
              icon={<Minus className="w-5 h-5" />}
              label="Bond"
            />
            
            <ToolPaletteButton 
              active={mode === 'lone-pair'} 
              onClick={() => setMode('lone-pair')}
              icon={<CircleDot className="w-5 h-5" />}
              label="L-Pairs"
            />
            
            <div className="w-8 h-px bg-slate-100 my-2" />

            <ToolPaletteButton 
              active={mode === 'erase'} 
              onClick={() => {
                if (selectedEntityIds.length > 0) {
                  const newAtoms = atoms.filter(a => !selectedEntityIds.includes(a.id));
                  const newBonds = bonds.filter(b => 
                    !selectedEntityIds.includes(b.id) && 
                    !selectedEntityIds.includes(b.atom1Id) && 
                    !selectedEntityIds.includes(b.atom2Id)
                  );
                  updateState(newAtoms, newBonds);
                  setSelectedEntityIds([]);
                } else {
                  setMode('erase');
                }
              }}
              icon={<Trash2 className="w-5 h-5" />}
              label="Erase"
              variant="danger"
            />

            <div className="flex-1" />
            <button 
              onClick={() => { updateState([], []); setSelectedEntityIds([]); }}
              className="w-14 h-14 bg-rose-50 hover:bg-rose-100 border border-rose-150 text-rose-500 rounded-xl font-bold text-[9px] uppercase tracking-tighter shadow-sm transition-all flex flex-col items-center justify-center gap-1 shrink-0"
              title="Clear entire canvas drawing"
            >
              <RotateCcw className="w-4 h-4" />
              Clear
            </button>
          </aside>
        ) : (
          /* Locked Read Only display: simple static reference column */
          <aside className="w-20 bg-slate-50 border-r border-slate-200 flex flex-col items-center py-6 space-y-4 shadow-[1px_0_4px_rgba(0,0,0,0.01)] z-10 shrink-0 select-none">
            <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 rotate-270 whitespace-nowrap mt-4 inline-block font-mono">
              LOCKED
            </span>
          </aside>
        )}

        {/* Main Canvas Area */}
        <main className="flex-1 bg-white relative overflow-hidden flex flex-col shadow-inner">
          <div className="flex-1 relative canvas-grid overflow-hidden">
            <svg
              ref={svgRef}
              className="w-full h-full touch-none"
              onPointerDown={handleSvgPointerDown}
              onPointerUp={handleSvgPointerUp}
              onWheel={(e) => {
                const zoomSensitivity = 0.001;
                setScale(prev => Math.max(0.1, Math.min(prev - e.deltaY * zoomSensitivity, 5)));
              }}
            >
              <g ref={gRef} transform={`scale(${scale})`}>
              {selectionBoxStart && selectionBoxCurrent && mode === 'select' && (
                <rect 
                  x={Math.min(selectionBoxStart.x, selectionBoxCurrent.x)}
                  y={Math.min(selectionBoxStart.y, selectionBoxCurrent.y)}
                  width={Math.abs(selectionBoxCurrent.x - selectionBoxStart.x)}
                  height={Math.abs(selectionBoxCurrent.y - selectionBoxStart.y)}
                  fill="rgba(99, 102, 241, 0.1)"
                  stroke="rgba(99, 102, 241, 0.5)"
                  strokeWidth="1"
                  className="pointer-events-none"
                />
              )}

              {/* Render Bonds */}
              {visibleBonds.map(bond => {
                const atom1 = atoms.find(a => a.id === bond.atom1Id);
                const atom2 = atoms.find(a => a.id === bond.atom2Id);
                if (!atom1 || !atom2) return null;
                return (
                  <BondRenderer 
                    key={bond.id} 
                    bond={bond} 
                    atom1={atom1} 
                    atom2={atom2} 
                    onPointerDown={(e) => handleBondPointerDown(e, bond.id)}
                    isEraser={mode === 'erase'}
                    isSelected={selectedEntityIds.includes(bond.id)}
                    skeletalMode={skeletalMode}
                    filledMode={filledMode}
                  />
                );
              })}

              {/* Dragging Preview */}
              {dragStartAtom && (
                <line
                  x1={atoms.find(a => a.id === dragStartAtom)?.x}
                  y1={atoms.find(a => a.id === dragStartAtom)?.y}
                  x2={mousePos.x}
                  y2={mousePos.y}
                  className="stroke-indigo-300 stroke-[3] opacity-60 pointer-events-none"
                  strokeDasharray="6 4"
                />
              )}

              {/* Render Atoms */}
              {visibleAtoms.map(atom => (
                <AtomRenderer
                  key={atom.id}
                  atom={atom}
                  onPointerDown={(e) => handleAtomPointerDown(e, atom.id)}
                  onPointerUp={(e) => handleAtomPointerUp(e, atom.id)}
                  isEraser={mode === 'erase'}
                  isSelected={selectedEntityIds.includes(atom.id)}
                  currentValency={getAtomValency(atom.id)}
                  expectedValency={getExpectedValency(atom.symbol)}
                  allAtoms={atoms}
                  connectedBonds={bonds.filter(b => b.atom1Id === atom.id || b.atom2Id === atom.id)}
                  hideCHydrogens={hideCHydrogens}
                  skeletalMode={skeletalMode}
                  hideImplicitHydrogens={hideImplicitHydrogens}
                  filledMode={filledMode}
                />
              ))}
              </g>
            </svg>

            {/* Canvas Overlay Controls */}
            <div className="absolute bottom-4 left-4 flex space-x-2 pointer-events-none">
              <div className="bg-white/80 backdrop-blur-sm px-3 py-1 border border-slate-200 rounded text-[10px] font-mono shadow-sm text-slate-500 font-bold uppercase tracking-wider">
                X: {Math.round(mousePos.x)}px Y: {Math.round(mousePos.y)}px
              </div>
              <div className="bg-white/80 backdrop-blur-sm px-4 py-2 border border-slate-200 rounded-lg shadow-sm text-slate-400 font-bold uppercase flex items-center gap-4 pointer-events-auto">
                <button 
                  onPointerDown={() => setScale(s => Math.max(0.1, s - 0.1))}
                  className="hover:text-indigo-600 transition-colors p-2 bg-slate-50 rounded"
                >-</button>
                <span className="text-[10px] min-w-[60px] text-center">Scale: {scale.toFixed(1)}x</span>
                <button 
                  onPointerDown={() => setScale(s => Math.min(5, s + 0.1))}
                  className="hover:text-indigo-600 transition-colors p-2 bg-slate-50 rounded"
                >+</button>
              </div>
            </div>

            {/* If Student Review OR Test Mode, render the floating report */}
            {(isReadOnly || testReadOnlyMode) && (
              <div id="grading-report" className="absolute top-4 right-4 w-80 bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl rounded-2xl p-4 z-30 flex flex-col max-h-[85%] overflow-y-auto pointer-events-auto select-none">
                {teacherAnswer ? (
                  <>
                    <div className={cn(
                      "flex items-center space-x-2 pb-3 mb-3 border-b p-2 rounded-lg",
                      gradeResult?.match 
                        ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                        : "border-rose-100 bg-rose-50 text-rose-800"
                    )}>
                      {gradeResult?.match ? (
                        <>
                          <Check className="w-5 h-5 text-emerald-600 font-bold" />
                          <div className="flex-1">
                            <h4 className="font-sans font-black text-xs tracking-wider uppercase">Submission: Correct</h4>
                            <p className="text-[9px] opacity-75">Answer fits structural criteria</p>
                          </div>
                          <span className="px-2 py-0.5 bg-emerald-600 text-white rounded font-mono font-black text-[9px]">100%</span>
                        </>
                      ) : (
                        <>
                          <X className="w-5 h-5 text-rose-600 font-bold" />
                          <div className="flex-1">
                            <h4 className="font-sans font-black text-xs tracking-wider uppercase">Submission: Incorrect</h4>
                            <p className="text-[9px] opacity-75 font-bold animate-pulse">Unmatched structure</p>
                          </div>
                          <span className="px-2 py-0.5 bg-rose-600 text-white rounded font-mono font-black text-[9px]">0%</span>
                        </>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 mb-4 bg-slate-50 p-2.5 rounded border border-slate-100 leading-relaxed font-semibold">
                      {gradeResult?.message}
                    </div>

                    {/* Stats metrics */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="p-2 border border-slate-100 bg-slate-50/50 rounded text-center">
                        <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Atoms count</p>
                        <p className={cn(
                          "text-sm font-black",
                          atoms.length === teacherAnswer.atoms.length ? "text-emerald-600" : "text-rose-600"
                        )}>{atoms.length} <span className="text-xs font-medium text-slate-400">/ {teacherAnswer.atoms.length}</span></p>
                      </div>
                      <div className="p-2 border border-slate-100 bg-slate-50/50 rounded text-center">
                        <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Bonds count</p>
                        <p className={cn(
                          "text-sm font-black",
                          bonds.length === teacherAnswer.bonds.length ? "text-emerald-600" : "text-rose-600"
                        )}>{bonds.length} <span className="text-xs font-medium text-slate-400">/ {teacherAnswer.bonds.length}</span></p>
                      </div>
                    </div>

                    {/* Element counts */}
                    <div className="mb-2">
                      <p className="text-[9px] text-slate-400 uppercase font-extrabold tracking-wider mb-2">Composition Analysis</p>
                      <div className="border border-slate-100 rounded-lg overflow-hidden text-xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 text-[10px] text-slate-500 uppercase font-bold border-b border-slate-100">
                              <th className="py-1 px-2.5">Element</th>
                              <th className="py-1 px-2 text-center font-bold">Drawn</th>
                              <th className="py-1 px-2 text-center font-bold">Correct</th>
                              <th className="py-1 px-2.5 text-right font-bold">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {elementComparison?.map(item => (
                              <tr key={item.symbol} className="border-b border-slate-50 hover:bg-slate-50/40">
                                <td className="py-1.5 px-2.5 font-bold text-slate-700">{item.symbol}</td>
                                <td className="py-1.5 px-2 text-center font-semibold text-slate-600">{item.drawn}</td>
                                <td className="py-1.5 px-2 text-center font-semibold text-slate-600">{item.expected}</td>
                                <td className="py-1.5 px-2.5 text-right font-medium">
                                  {item.matched ? (
                                    <span className="text-emerald-600 text-[10px]">Matched</span>
                                  ) : (
                                    <span className="text-rose-500 text-[10px] font-bold">Mismatch</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-2 text-xs text-amber-800 flex flex-col items-center gap-2">
                    <AlertCircle className="w-8 h-8 text-amber-500 animate-bounce" />
                    <p className="font-bold text-center">No Teacher Answer Key Parameters Loaded</p>
                    <p className="text-[10px] text-amber-600 text-center leading-normal">
                      The instructor has not submitted a correct answer code `TA` for evaluation yet.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Status Bar */}
          <footer className="h-8 bg-slate-50 border-t border-slate-200 flex items-center px-4 justify-between shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.02)]">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest italic shrink-0">
              {atoms.length === 0 ? "Empty Canvas" : "Structure Modified - Ready for Export"}
            </p>
            <div className="flex space-x-6 items-center overflow-hidden">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-tighter shrink-0 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full" /> Atoms: {atoms.length}
              </span>
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-tighter shrink-0 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full" /> Bonds: {bonds.length}
              </span>
              {isStackEnvironment && (
                <span className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-tighter shrink-0 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full" /> STACK: Connected
                </span>
              )}
            </div>
          </footer>
        </main>

        {/* Inspector Sidebar */}
        {!isStudentMode && !testReadOnlyMode && (
          <aside className="w-72 bg-slate-50 border-l border-slate-200 flex flex-col overflow-hidden shadow-inner shrink-0">
          <div className="p-4 border-b border-slate-200 bg-white">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Entity Properties</h3>
            
            {selectedEntityIds.length > 0 ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs font-bold text-slate-700">
                    {selectedEntityIds.length > 1 ? `${selectedEntityIds.length} Entities Selected` : selectedAtom ? `Element: ${selectedAtom.symbol}` : `Bond: ${selectedBond?.order === 0 ? 'H-Bond' : selectedBond?.order === 1 ? 'Single' : selectedBond?.order === 2 ? 'Double' : 'Triple'}`}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full font-mono font-bold">
                    ID: {selectedEntityIds.length === 1 ? selectedEntityIds[0].slice(0, 4) : 'MULT'}
                  </span>
                </div>

                <div className="mb-4 space-y-1">
                  <div className="flex gap-1 flex-wrap items-center">
                    <button onClick={() => reflectSelection('horizontal')} className="px-2 py-1 text-[9px] font-bold rounded border bg-white text-slate-500 border-slate-200 hover:border-slate-300 transition-all flex-1">Reflect H</button>
                    <button onClick={() => reflectSelection('vertical')} className="px-2 py-1 text-[9px] font-bold rounded border bg-white text-slate-500 border-slate-200 hover:border-slate-300 transition-all flex-1">Reflect V</button>
                  </div>
                  <div className="mt-3">
                    <label className="text-[9px] text-slate-400 uppercase font-black tracking-tight mb-1 block">Rotate Freely</label>
                    <input 
                      type="range" 
                      min="-180" 
                      max="180" 
                      defaultValue="0"
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-ew-resize accent-indigo-500"
                      onPointerDown={(e) => {
                          rotationLastValRef.current = 0;
                          (e.target as HTMLInputElement).value = "0";
                      }}
                      onInput={(e) => {
                          const val = parseFloat((e.target as HTMLInputElement).value);
                          const delta = val - rotationLastValRef.current;
                          rotationLastValRef.current = val;
                          rotateSelection(delta);
                      }}
                      onPointerUp={(e) => {
                          (e.target as HTMLInputElement).value = "0";
                          rotationLastValRef.current = 0;
                      }}
                      onPointerLeave={(e) => {
                          (e.target as HTMLInputElement).value = "0";
                          rotationLastValRef.current = 0;
                      }}
                    />
                  </div>
                </div>
                
                {selectedAtom && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-400 uppercase font-black tracking-tight">Hybridization</label>
                      <div className="text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded px-2 py-1.5 shadow-sm">sp³</div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-400 uppercase font-black tracking-tight">Charge</label>
                      <button 
                        onClick={() => {
                          updateState(atoms.map(a => selectedEntityIds.includes(a.id) ? { ...a, charge: a.charge === 0 ? 1 : a.charge === 1 ? -1 : 0 } : a), bonds)
                        }}
                        className="w-full text-left text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded px-2 py-1.5 shadow-sm hover:border-indigo-300 transition-colors"
                      >
                        {selectedAtom.charge > 0 ? "+1" : selectedAtom.charge < 0 ? "-1" : "0"}
                      </button>
                    </div>
                    <div className="space-y-1 col-span-2">
                       <label className="text-[9px] text-slate-400 uppercase font-black tracking-tight">Swap Element</label>
                       <div className="flex flex-wrap gap-1">
                          {TOOLBAR_ELEMENTS.map(el => (
                            <button
                              key={el}
                              onClick={() => updateState(atoms.map(a => selectedEntityIds.includes(a.id) ? { ...a, symbol: el } : a), bonds)}
                              className={cn(
                                "px-2 py-1 text-[10px] font-bold rounded border transition-all flex-1 text-center min-w-[24px]",
                                selectedAtom.symbol === el ? "bg-indigo-600 text-white border-indigo-700 shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                              )}
                            >
                              {el}
                            </button>
                          ))}
                       </div>
                    </div>
                  </div>
                )}
                
                {selectedBond && (
                   <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-400 uppercase font-black tracking-tight">Order</label>
                        <div className="flex gap-1">
                          {[0, 1, 2, 3].map(o => (
                            <button
                              key={o}
                              onClick={() => updateState(atoms, bonds.map(b => selectedEntityIds.includes(b.id) ? { ...b, order: o as 0|1|2|3 } : b))}
                              className={cn(
                                "flex-1 py-1 text-[10px] font-bold rounded border transition-all",
                                selectedBond.order === o ? "bg-indigo-600 text-white border-indigo-700 shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                              )}
                            >
                              {o === 0 ? 'H-Bond' : o === 1 ? 'Single' : o === 2 ? 'Double' : 'Triple'}
                            </button>
                          ))}
                        </div>
                      </div>
                   </div>
                )}
              </div>
            ) : (
              <div className="p-6 bg-slate-50/50 border border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center text-center">
                <MousePointer2 className="w-8 h-8 text-slate-200 mb-2" />
                <p className="text-[10px] font-bold uppercase text-slate-300 tracking-widest">Select entity to inspect</p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="mt-8">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">STACK Verification</h3>
              <div className="bg-indigo-900 rounded-xl p-4 text-white shadow-lg overflow-hidden relative">
                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full -mr-12 -mt-12" />
                <p className="text-[9px] font-black text-indigo-200 uppercase mb-3 tracking-widest flex items-center gap-2">
                  <Check className="w-3 h-3" /> Output JSON for Moodle
                </p>
                <div className="bg-black/30 rounded-lg p-3 text-[10px] font-mono whitespace-pre text-indigo-100 overflow-x-auto max-h-48 custom-scrollbar border border-white/5">
                  {exportData}
                </div>
                <button 
                  onClick={copyToClipboard}
                  className="w-full mt-4 bg-indigo-500 hover:bg-indigo-400 active:scale-[0.98] py-2.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all shadow-md"
                >
                  {copied ? 'Synced to Question' : 'Publish Answer Key'}
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 bg-white">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Saved Gallery</h3>
            
            <div className="flex items-center gap-2 mb-3">
              <input 
                  type="checkbox" 
                  id="strictMatch" 
                  checked={strictMatching} 
                  onChange={(e) => setStrictMatching(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3 h-3"
              />
              <label htmlFor="strictMatch" className="text-[10px] font-bold text-slate-500 cursor-pointer">
                  Strict Match Drawn H&#39;s
              </label>
            </div>

            <div className="space-y-2 mb-4 max-h-40 overflow-y-auto custom-scrollbar">
              {savedMolecules.length === 0 && <p className="text-[10px] text-slate-300 italic text-center">No saved structures</p>}
              {savedMolecules.map(m => (
                <div key={m.id} className="flex gap-1">
                  <button
                    onClick={() => loadMolecule(m.data)}
                    className="flex-1 text-left p-2 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors flex justify-between"
                  >
                    <span>{m.name}</span>
                    <span className="text-slate-400 font-mono italic">{m.data.atoms.length} At</span>
                  </button>
                  <button 
                    onClick={() => {
                        const result = areMoleculesEqual({atoms, bonds}, m.data, strictMatching);
                        alert(result.message);
                    }}
                    className="px-2 bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100 rounded text-[10px] font-bold transition-all"
                    title="Compare with Drawn"
                  >
                    Compare
                  </button>
                </div>
              ))}
            </div>
            
            <div className="flex flex-col gap-2 mb-4">
              <button 
                onClick={saveMolecule}
                className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white px-4 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-widest shadow-md shadow-emerald-100 transition-all"
              >
                Save Structure
              </button>
              <button 
                onClick={() => { updateState([], []); setSelectedEntityIds([]); }}
                className="w-full bg-white hover:bg-red-50 border border-slate-200 text-red-500 active:scale-[0.98] px-4 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-widest shadow-sm transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Clear All
              </button>
            </div>
            <button 
              onClick={exportImage}
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white px-4 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-widest shadow-md shadow-indigo-100 transition-all"
            >
              Export as PNG
            </button>
          </div>
          <div className="p-4 border-t border-slate-200 bg-white">
            <a 
              href="/molecule-editor.html"
              download="molecule-editor.html"
              className="w-full flex items-center justify-center bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-widest shadow-md transition-all"
            >
              📥 Download App HTML
            </a>
          </div>
        </aside>
        )}
      </div>

      {/* Save molecule overlay modal */}
      {showSavePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-80 max-w-full">
            <h3 className="font-bold text-slate-800 text-sm mb-4">Save Structure</h3>
            <input 
              autoFocus
              type="text" 
              value={saveName} 
              onChange={(e) => setSaveName(e.target.value)} 
              onKeyDown={(e) => { 
                if (e.key === 'Enter') executeSaveMolecule(); 
                if (e.key === 'Escape') setShowSavePrompt(false); 
              }}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
              placeholder="Structure Name"
            />
            <div className="flex justify-end gap-2 text-xs font-bold font-sans">
              <button onClick={() => setShowSavePrompt(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded">CANCEL</button>
              <button onClick={executeSaveMolecule} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded">SAVE</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom element overlay modal */}
      {showElementPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-80 max-w-full">
            <h3 className="font-bold text-slate-800 text-sm mb-4">Other Element</h3>
            <input 
              autoFocus
              type="text" 
              value={customElement}
              onChange={(e) => setCustomElement(e.target.value)} 
              onKeyDown={(e) => { 
                if (e.key === 'Enter' && customElement) {
                  setSelectedElement(customElement as ElementType);
                  setMode('atom');
                  setShowElementPrompt(false);
                  setCustomElement("");
                }
                if (e.key === 'Escape') {
                  setShowElementPrompt(false);
                  setCustomElement("");
                }
              }}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
              placeholder="e.g. Fe, Na, Ag"
            />
            <div className="flex justify-end gap-2 text-xs font-bold font-sans">
              <button onClick={() => {setShowElementPrompt(false); setCustomElement("")}} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded">CANCEL</button>
              <button 
                onClick={() => {
                  if (customElement) {
                    setSelectedElement(customElement as ElementType);
                    setMode('atom');
                    setShowElementPrompt(false);
                    setCustomElement("");
                  }
                }} 
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded"
              >SELECT</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function ToolPaletteButton({ 
  active, 
  onClick, 
  icon, 
  label, 
  variant = 'primary' 
}: { 
  active: boolean, 
  onClick: () => void, 
  icon: React.ReactNode, 
  label: string,
  variant?: 'primary' | 'danger'
}) {
  return (
    <div className="flex flex-col items-center space-y-1">
      <button
        onPointerDown={onClick}
        title={label}
        className={cn(
          "w-12 h-12 flex items-center justify-center rounded-xl border transition-all relative overflow-hidden group touch-action-none",
          active 
            ? variant === 'danger' 
              ? "border-red-200 bg-red-100 text-red-600 shadow-sm"
              : "border-indigo-200 bg-indigo-50 text-indigo-600 shadow-sm"
            : "border-slate-100 bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-600"
        )}
      >
        <div className={cn("transition-transform group-active:scale-90", active && "scale-105")}>
          {icon}
        </div>
        {active && <motion.div layoutId="tool-highlight" className={cn("absolute inset-x-0 bottom-0 h-0.5", variant === 'danger' ? 'bg-red-500' : 'bg-indigo-500')} />}
      </button>
      <p className={cn("text-[8px] font-black uppercase tracking-tighter transition-colors", active ? variant === 'danger' ? 'text-red-600' : 'text-indigo-700' : 'text-slate-400')}>
        {label === 'Lone Pr' ? 'L-Pairs' : label}
      </p>
    </div>
  );
}

function AtomRenderer({ 
  atom, 
  onPointerDown, 
  onPointerUp,
  isEraser,
  isSelected,
  currentValency,
  expectedValency,
  allAtoms,
  connectedBonds,
  hideCHydrogens,
  skeletalMode,
  hideImplicitHydrogens,
  filledMode = true
}: { 
  atom: Atom, 
  onPointerDown: (e: React.PointerEvent) => void,
  onPointerUp: (e: React.PointerEvent) => void,
  isEraser: boolean,
  isSelected: boolean,
  currentValency: number,
  expectedValency: number,
  allAtoms: Atom[],
  connectedBonds: Bond[],
  hideCHydrogens?: boolean,
  skeletalMode?: boolean,
  hideImplicitHydrogens?: boolean,
  filledMode?: boolean,
  key?: string
}) {
  const color = ATOM_COLORS[atom.symbol] || '#e2e8f0'; // slate-200 callback
  const baseTextColor = ATOM_TEXT_COLORS[atom.symbol] || '#475569'; // slate-600 callback
  const isOverValency = currentValency > expectedValency;
  const implicitH = Math.max(0, expectedValency - currentValency);
  
  const isSkeletalC = skeletalMode && atom.symbol === 'C';
  const shouldHideImplicitH = hideImplicitHydrogens || ((hideCHydrogens || skeletalMode) && atom.symbol === 'C');
  
  const shouldDrawFill = filledMode && !isSkeletalC;
  const circleFill = shouldDrawFill ? color : "transparent";
  
  // If filled, use standard text color. If an unfilled C, we want slate-800. For others, use their element color
  // Exception: Hydrogen is #ffffff in ATOM_COLORS, so if unfilled, let's use #64748b (slate-500)
  let unfilledTextColor = color;
  if (atom.symbol === 'H') unfilledTextColor = '#64748b';
  else if (atom.symbol === 'C') unfilledTextColor = '#1e293b'; // slate-800
  
  const textColor = shouldDrawFill ? baseTextColor : unfilledTextColor;

  const renderLonePairs = () => {
    const hBonds = connectedBonds.filter(b => b.order === 0);
    const covBonds = connectedBonds.filter(b => b.order > 0);

    const hBondAngles = hBonds.map(b => {
      const otherId = b.atom1Id === atom.id ? b.atom2Id : b.atom1Id;
      const other = allAtoms.find(a => a.id === otherId);
      if (!other) return null;
      return Math.atan2(other.y - atom.y, other.x - atom.x);
    }).filter((a): a is number => a !== null);

    const covBondAngles = covBonds.map(b => {
      const otherId = b.atom1Id === atom.id ? b.atom2Id : b.atom1Id;
      const other = allAtoms.find(a => a.id === otherId);
      if (!other) return null;
      return Math.atan2(other.y - atom.y, other.x - atom.x);
    }).filter((a): a is number => a !== null);

    let availableAngles: number[] = [...hBondAngles];

    if (covBondAngles.length === 0) {
      availableAngles.push(...[-Math.PI/2, 0, Math.PI/2, Math.PI]);
    } else if (covBondAngles.length === 1) {
      const a = covBondAngles[0];
      availableAngles.push(...[a + Math.PI, a + Math.PI/2, a - Math.PI/2, a + Math.PI * 3/4]);
    } else {
      const sorted = [...covBondAngles].sort((a, b) => a - b);
      const gaps = [];
      for (let i = 0; i < sorted.length; i++) {
        const next = sorted[(i + 1) % sorted.length];
        let diff = next - sorted[i];
        if (diff < 0) diff += 2 * Math.PI;
        gaps.push({ start: sorted[i], diff });
      }
      gaps.sort((a, b) => b.diff - a.diff);
      
      if (gaps[0].diff > Math.PI) {
        const mid = gaps[0].start + gaps[0].diff / 2;
        const spread = 135 * Math.PI / 180; // place them 135 degrees apart
        availableAngles.push(mid - spread / 2);
        availableAngles.push(mid + spread / 2);
        if (gaps.length > 1) availableAngles.push(gaps[1].start + gaps[1].diff / 2);
        availableAngles.push(mid);
      } else {
        gaps.forEach(g => availableAngles.push(g.start + g.diff / 2));
      }
    }

    const pairs = [];
    const getBaseR = () => {
      if (isSkeletalC) return 0;
      if (!filledMode) return 9;
      return ATOM_RADII[atom.symbol] || 20;
    };
    const baseR = getBaseR();
    const radius = baseR + 2;
    const dotSize = 1.5;
    const pairSpread = 5.0;

    for (let i = 0; i < atom.lonePairs; i++) {
      const angle = availableAngles[i % availableAngles.length] || 0;
      
      const px = Math.cos(angle + Math.PI/2) * pairSpread / 2;
      const py = Math.sin(angle + Math.PI/2) * pairSpread / 2;
      
      const bx = Math.cos(angle) * radius;
      const by = Math.sin(angle) * radius;
      
      pairs.push(
        <g key={i}>
          <circle cx={atom.x + bx + px} cy={atom.y + by + py} r={dotSize} fill="#6366F1" />
          <circle cx={atom.x + bx - px} cy={atom.y + by - py} r={dotSize} fill="#6366F1" />
        </g>
      );
    }
    return pairs;
  };

  return (
    <g 
      className="select-none cursor-pointer group"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <circle
        cx={atom.x}
        cy={atom.y}
        r={isEraser ? (ATOM_RADII[atom.symbol] + 2) : isOverValency || isSelected ? (ATOM_RADII[atom.symbol] + 1) : ATOM_RADII[atom.symbol]}
        fill={circleFill}
        className={cn(
          "stroke-2",
          isEraser ? "group-hover:stroke-red-500" : 
          isOverValency ? "stroke-red-500" :
          isSelected ? "stroke-indigo-400" : "stroke-transparent group-hover:stroke-indigo-200"
        )}
        style={{ 
          transition: 'stroke 0.3s, fill 0.3s, r 0.3s',
          filter: shouldDrawFill ? 'drop-shadow(0 4px 10px rgba(0,0,0,0.1))' : 'none' 
        }}
      />
      {!isSkeletalC && (
        <text
          x={atom.x}
          y={atom.y}
          dy="0.32em"
          textAnchor="middle"
          fill={textColor}
          className="font-black text-base pointer-events-none tracking-tighter"
          style={{ fontFamily: 'var(--font-sans)', letterSpacing: '-0.05em' }}
        >
          {atom.symbol}
        </text>
      )}
      
      {/* Implicit Hydrogens */}
      {atom.symbol !== 'H' && implicitH > 0 && !shouldHideImplicitH && (
        <text
          x={atom.x + ((ATOM_RADII[atom.symbol] || 20) * 0.7)}
          y={atom.y + ((ATOM_RADII[atom.symbol] || 20) * 0.7)}
          fill={shouldDrawFill ? (color === '#ffffff' ? '#64748b' : color) : textColor}
          className="font-bold text-[10px] pointer-events-none"
          style={{ filter: shouldDrawFill ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' : 'none' }}
        >
          H{implicitH > 1 ? implicitH : ''}
        </text>
      )}
      
      {atom.charge !== 0 && (
        <g transform={`translate(${atom.x + ((ATOM_RADII[atom.symbol] || 20) * 0.7)}, ${atom.y - ((ATOM_RADII[atom.symbol] || 20) * 0.7)})`}>
          <circle r="7" fill={atom.charge > 0 ? "#10b981" : "#ef4444"} className="shadow-sm" />
          <text dy="0.35em" textAnchor="middle" fill="white" className="font-black text-[9px] pointer-events-none uppercase">
            {atom.charge > 0 ? "+" : "-"}
          </text>
        </g>
      )}
      {renderLonePairs()}
    </g>
  );
}

function BondRenderer({ 
  bond, 
  atom1, 
  atom2, 
  onPointerDown,
  isEraser,
  isSelected,
  skeletalMode,
  filledMode = true
}: { 
  bond: Bond, 
  atom1: Atom, 
  atom2: Atom, 
  onPointerDown: (e: React.PointerEvent) => void,
  isEraser: boolean,
  isSelected: boolean,
  skeletalMode?: boolean,
  filledMode?: boolean,
  key?: string
}) {
  const dx = atom2.x - atom1.x;
  const dy = atom2.y - atom1.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  
  const getOffset = (atom: Atom) => {
    let base = 0;
    if (skeletalMode && atom.symbol === 'C') base = 0;
    else if (!filledMode) base = 8;
    else base = (ATOM_RADII[atom.symbol] || 20) + 1;
    
    if (bond.order === 0 && atom.symbol !== 'H') {
      base += 4;
    }
    return base;
  };
  
  const offset1 = getOffset(atom1);
  const offset2 = getOffset(atom2);
  const bondLength = Math.max(0, length - offset1 - offset2);
  
  const renderLines = () => {
    const spacing = 3;
    const strokeWidth = 2;
    const color = "#64748B"; // darker slate-500 instead of #CBD5E1
    const activeColor = "#818CF8";
    
    switch (bond.order) {
      case 0:
        return <line x1={0} y1={0} x2={bondLength} y2={0} stroke={isSelected ? activeColor : color} strokeWidth={strokeWidth} strokeDasharray="4 4" strokeLinecap="round" />;
      case 1:
        return <line x1={0} y1={0} x2={bondLength} y2={0} stroke={isSelected ? activeColor : color} strokeWidth={strokeWidth} strokeLinecap="round" />;
      case 2:
        return (
          <>
            <line x1={0} y1={-spacing/2} x2={bondLength} y2={-spacing/2} stroke={isSelected ? activeColor : color} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1={0} y1={spacing/2} x2={bondLength} y2={spacing/2} stroke={isSelected ? activeColor : color} strokeWidth={strokeWidth} strokeLinecap="round" />
          </>
        );
      case 3:
        return (
          <>
            <line x1={0} y1={-spacing} x2={bondLength} y2={-spacing} stroke={isSelected ? activeColor : color} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1={0} y1={0} x2={bondLength} y2={0} stroke={isSelected ? activeColor : color} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1={0} y1={spacing} x2={bondLength} y2={spacing} stroke={isSelected ? activeColor : color} strokeWidth={strokeWidth} strokeLinecap="round" />
          </>
        );
    }
  };

  return (
    <g
      transform={`translate(${atom1.x}, ${atom1.y}) rotate(${angle}) translate(${offset1}, 0)`}
      onPointerDown={onPointerDown}
      className="cursor-pointer group"
    >
      <line x1={0} y1={0} x2={bondLength} y2={0} className="stroke-transparent stroke-[16px]" />
      <g className={cn("transition-all", isEraser ? "group-hover:[&>line]:stroke-red-500 group-hover:[&>line]:stroke-opacity-100" : isSelected ? "" : "group-hover:[&>line]:stroke-indigo-300 group-hover:opacity-100 opacity-90")}>
        {renderLines()}
      </g>
    </g>
  );
}
