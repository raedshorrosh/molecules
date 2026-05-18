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
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils.ts';
import { 
  ElementType, 
  Atom, 
  Bond, 
  Molecule, 
  ATOM_COLORS, 
  ATOM_TEXT_COLORS 
} from '@/src/types.ts';

const TOOLBAR_ELEMENTS: ElementType[] = ['C', 'H', 'O', 'N', 'P', 'S', 'F', 'Cl', 'Br', 'I'];
const BOND_ORDERS: (1 | 2 | 3)[] = [1, 2, 3];

export default function App() {
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [savedMolecules, setSavedMolecules] = useState<{id: string, name: string, data: Molecule}[]>([]);
  const [mode, setMode] = useState<'atom' | 'bond' | 'erase' | 'select' | 'lone-pair' | 'charge'>('select');
  const [selectedElement, setSelectedElement] = useState<ElementType>('C');
  const [selectedBondOrder, setSelectedBondOrder] = useState<1 | 2 | 3>(1);
  const [dragStartAtom, setDragStartAtom] = useState<string | null>(null);
  const [draggingAtomId, setDraggingAtomId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  
  const svgRef = useRef<SVGSVGElement>(null);

  const getSvgCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const transform = svg.getScreenCTM()?.inverse();
    if (transform) {
      const transformed = pt.matrixTransform(transform);
      return { x: transformed.x, y: transformed.y };
    }
    return { x: 0, y: 0 };
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
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
      setAtoms([...atoms, newAtom]);
      setSelectedEntityId(newAtom.id);
    } else if (mode === 'select') {
      setSelectedEntityId(null);
    }
  };

  const handleAtomMouseDown = (e: React.MouseEvent, atomId: string) => {
    e.stopPropagation();
    setSelectedEntityId(atomId);
    if (mode === 'bond') {
      setDragStartAtom(atomId);
    } else if (mode === 'select') {
      setDraggingAtomId(atomId);
    } else if (mode === 'erase') {
      setAtoms(atoms.filter(a => a.id !== atomId));
      setBonds(bonds.filter(b => b.atom1Id !== atomId && b.atom2Id !== atomId));
      if (selectedEntityId === atomId) setSelectedEntityId(null);
    } else if (mode === 'lone-pair') {
      setAtoms(atoms.map(a => 
        a.id === atomId ? { ...a, lonePairs: (a.lonePairs + 1) % 5 } : a
      ));
    } else if (mode === 'charge') {
      setAtoms(atoms.map(a => {
        if (a.id !== atomId) return a;
        let newCharge = a.charge === 0 ? 1 : a.charge === 1 ? -1 : 0;
        return { ...a, charge: newCharge };
      }));
    } else if (mode === 'atom') {
      setAtoms(atoms.map(a => 
        a.id === atomId ? { ...a, symbol: selectedElement } : a
      ));
    }
  };

  const handleAtomMouseUp = (e: React.MouseEvent, atomId: string) => {
    e.stopPropagation();
    if (mode === 'bond' && dragStartAtom && dragStartAtom !== atomId) {
      const existingBondIndex = bonds.findIndex(b => 
        (b.atom1Id === dragStartAtom && b.atom2Id === atomId) ||
        (b.atom1Id === atomId && b.atom2Id === dragStartAtom)
      );

      if (existingBondIndex >= 0) {
        const newBonds = [...bonds];
        newBonds[existingBondIndex] = {
          ...newBonds[existingBondIndex],
          order: ((newBonds[existingBondIndex].order % 3) + 1) as 1 | 2 | 3
        };
        setBonds(newBonds);
      } else {
        const newBond: Bond = {
          id: crypto.randomUUID(),
          atom1Id: dragStartAtom,
          atom2Id: atomId,
          order: selectedBondOrder,
        };
        setBonds([...bonds, newBond]);
      }
    }
    setDragStartAtom(null);
    setDraggingAtomId(null);
  };

  const handleBondClick = (e: React.MouseEvent, bondId: string) => {
    e.stopPropagation();
    setSelectedEntityId(bondId);
    if (mode === 'erase') {
      setBonds(bonds.filter(b => b.id !== bondId));
      if (selectedEntityId === bondId) setSelectedEntityId(null);
    } else if (mode === 'bond') {
      setBonds(bonds.map(b => 
        b.id === bondId ? { ...b, order: ((b.order % 3) + 1) as 1 | 2 | 3 } : b
      ));
    }
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      const coords = getSvgCoords(e);
      setMousePos(coords);
      
      if (draggingAtomId) {
        setAtoms(prev => prev.map(a => 
          a.id === draggingAtomId ? { ...a, x: coords.x, y: coords.y } : a
        ));
      }
    };
    const handleGlobalMouseUp = () => {
      setDragStartAtom(null);
      setDraggingAtomId(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingAtomId]);

  const exportData = useMemo(() => {
    return JSON.stringify({ atoms, bonds }, null, 2);
  }, [atoms, bonds]);

  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'molecule-update', data: exportData }, '*',);
    }
  }, [exportData]);

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
    const name = prompt("Enter a name for this molecule:", `Structure ${savedMolecules.length + 1}`) || `Structure ${savedMolecules.length + 1}`;
    setSavedMolecules([...savedMolecules, {
      id: crypto.randomUUID(),
      name,
      data: { atoms, bonds }
    }]);
  };

  const loadMolecule = (mol: Molecule) => {
    setAtoms(mol.atoms);
    setBonds(mol.bonds);
    setSelectedEntityId(null);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(exportData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    if (window.parent !== window) {
      window.parent.postMessage({ type: 'molecule-update', data: exportData }, '*');
    }
  };

  const selectedAtom = atoms.find(a => a.id === selectedEntityId);
  const selectedBond = bonds.find(b => b.id === selectedEntityId);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white font-sans text-slate-900">
      {/* Header Navigation */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-20">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xl ring-2 ring-indigo-100">C</div>
            <span className="font-bold tracking-tight text-lg text-slate-800">ChemConnect Studio</span>
          </div>
          <nav className="flex space-x-1 ml-6 h-full items-center">
            <button className="px-3 py-1.5 text-sm font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors">File</button>
            <button className="px-3 py-1.5 text-sm font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors">Edit</button>
            <button className="px-3 py-1.5 text-sm font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors">Calculate</button>
            <button className="px-3 py-1.5 text-sm font-semibold rounded text-indigo-600 bg-indigo-50 border border-indigo-100 shadow-sm">Instructor View</button>
          </nav>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-green-50 border border-green-100 rounded-full">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-[10px] font-bold text-green-700 uppercase tracking-wide">STACK-Moodle Linked</span>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-slate-700">Dr. Julian Sterling</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Chemistry 101 Section B</p>
          </div>
          <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center border-2 border-white shadow-md ring-1 ring-slate-100 group cursor-pointer hover:ring-indigo-200 transition-all">
            <span className="text-xs font-bold text-slate-600 group-hover:text-indigo-600">JS</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar - Sidebar Palette */}
        <aside className="w-16 bg-white border-r border-slate-200 flex flex-col items-center py-4 space-y-4 shadow-[1px_0_4px_rgba(0,0,0,0.02)] z-10 shrink-0">
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
          {['C', 'O', 'H', 'N'].map(el => (
            <button
              key={el}
              onClick={() => {
                setSelectedElement(el as ElementType);
                setMode('atom');
              }}
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded font-bold text-lg transition-all",
                selectedElement === el && mode === 'atom'
                  ? "bg-indigo-600 text-white shadow-lg scale-110"
                  : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              )}
            >
              {el}
            </button>
          ))}

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
            onClick={() => setMode('erase')}
            icon={<Trash2 className="w-5 h-5" />}
            label="Erase"
            variant="danger"
          />
        </aside>

        {/* Main Canvas Area */}
        <main className="flex-1 bg-white relative overflow-hidden flex flex-col shadow-inner">
          <div className="flex-1 relative canvas-grid overflow-hidden">
            <svg
              ref={svgRef}
              className="w-full h-full"
              onMouseDown={handleCanvasClick}
            >
              {/* Render Bonds */}
              {bonds.map(bond => {
                const atom1 = atoms.find(a => a.id === bond.atom1Id);
                const atom2 = atoms.find(a => a.id === bond.atom2Id);
                if (!atom1 || !atom2) return null;
                return (
                  <BondRenderer 
                    key={bond.id} 
                    bond={bond} 
                    atom1={atom1} 
                    atom2={atom2} 
                    onClick={(e) => handleBondClick(e, bond.id)}
                    isEraser={mode === 'erase'}
                    isSelected={selectedEntityId === bond.id}
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
                  className="stroke-indigo-300 stroke-[3] opacity-60"
                  strokeDasharray="6 4"
                />
              )}

              {/* Render Atoms */}
              {atoms.map(atom => (
                <AtomRenderer
                  key={atom.id}
                  atom={atom}
                  onMouseDown={(e) => handleAtomMouseDown(e, atom.id)}
                  onMouseUp={(e) => handleAtomMouseUp(e, atom.id)}
                  isEraser={mode === 'erase'}
                  isSelected={selectedEntityId === atom.id}
                  currentValency={getAtomValency(atom.id)}
                  expectedValency={getExpectedValency(atom.symbol)}
                  allAtoms={atoms}
                  connectedBonds={bonds.filter(b => b.atom1Id === atom.id || b.atom2Id === atom.id)}
                />
              ))}
            </svg>

            {/* Canvas Overlay Controls */}
            <div className="absolute bottom-4 left-4 flex space-x-2 pointer-events-none">
              <div className="bg-white/80 backdrop-blur-sm px-3 py-1 border border-slate-200 rounded text-[10px] font-mono shadow-sm text-slate-500 font-bold uppercase tracking-wider">
                X: {Math.round(mousePos.x)}px Y: {Math.round(mousePos.y)}px
              </div>
              <div className="bg-white/80 backdrop-blur-sm px-3 py-1 border border-slate-200 rounded text-[10px] font-mono shadow-sm text-slate-400 font-bold uppercase">
                Scale: 1.0x
              </div>
            </div>
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
              <span className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-tighter shrink-0 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full" /> STACK: Valid
              </span>
            </div>
          </footer>
        </main>

        {/* Inspector Sidebar */}
        <aside className="w-72 bg-slate-50 border-l border-slate-200 flex flex-col overflow-hidden shadow-inner shrink-0">
          <div className="p-4 border-b border-slate-200 bg-white">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Entity Properties</h3>
            
            {selectedEntityId ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs font-bold text-slate-700">
                    {selectedAtom ? `Element: ${selectedAtom.symbol}` : `Bond: ${selectedBond?.order === 1 ? 'Single' : selectedBond?.order === 2 ? 'Double' : 'Triple'}`}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full font-mono font-bold">
                    ID: {selectedEntityId.slice(0, 4)}
                  </span>
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
                          setAtoms(atoms.map(a => a.id === selectedAtom.id ? { ...a, charge: a.charge === 0 ? 1 : a.charge === 1 ? -1 : 0 } : a))
                        }}
                        className="w-full text-left text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded px-2 py-1.5 shadow-sm hover:border-indigo-300 transition-colors"
                      >
                        {selectedAtom.charge > 0 ? "+1" : selectedAtom.charge < 0 ? "-1" : "0"}
                      </button>
                    </div>
                    <div className="space-y-1 col-span-2">
                       <label className="text-[9px] text-slate-400 uppercase font-black tracking-tight">Swap Element</label>
                       <div className="flex flex-wrap gap-1">
                          {TOOLBAR_ELEMENTS.slice(0, 5).map(el => (
                            <button
                              key={el}
                              onClick={() => setAtoms(atoms.map(a => a.id === selectedAtom.id ? { ...a, symbol: el } : a))}
                              className={cn(
                                "px-2 py-1 text-[10px] font-bold rounded border transition-all",
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
                          {[1, 2, 3].map(o => (
                            <button
                              key={o}
                              onClick={() => setBonds(bonds.map(b => b.id === selectedBond.id ? { ...b, order: o as 1|2|3 } : b))}
                              className={cn(
                                "flex-1 py-1 text-[10px] font-bold rounded border transition-all",
                                selectedBond.order === o ? "bg-indigo-600 text-white border-indigo-700 shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                              )}
                            >
                              {o === 1 ? 'Single' : o === 2 ? 'Double' : 'Triple'}
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
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Connectivity Trace</h3>
            <div className="space-y-2">
              {bonds.length === 0 && <div className="text-[10px] text-slate-300 font-bold uppercase tracking-widest text-center py-4">No bonds traced</div>}
              {bonds.map(b => {
                const a1 = atoms.find(a => a.id === b.atom1Id);
                const a2 = atoms.find(a => a.id === b.atom2Id);
                return (
                  <div key={b.id} className="text-[10px] p-2.5 bg-white border-l-4 border-indigo-500 rounded shadow-[0_1px_2px_rgba(0,0,0,0.05)] font-mono flex justify-between items-center group hover:bg-indigo-50/30 transition-colors">
                    <span className="font-bold text-slate-600">{`Atom ${a1?.symbol}-${a2?.symbol}`}</span>
                    <span className="text-slate-400 font-bold uppercase tracking-tighter">{b.order === 1 ? 'Single' : b.order === 2 ? 'Double' : 'Triple'}</span>
                  </div>
                );
              })}
              
              {atoms.filter(a => a.lonePairs > 0).map(a => (
                <div key={`${a.id}-lp`} className="text-[10px] p-2.5 bg-white border-l-4 border-blue-400 rounded shadow-[0_1px_2px_rgba(0,0,0,0.05)] font-mono flex justify-between items-center group hover:bg-blue-50/30 transition-colors">
                  <span className="font-bold text-slate-600">{`LP ${a.symbol}-Set`}</span>
                  <span className="text-slate-400 font-bold uppercase tracking-tighter">Count: {a.lonePairs}</span>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">STACK Verification</h3>
              <div className="bg-indigo-900 rounded-xl p-4 text-white shadow-lg overflow-hidden relative">
                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full -mr-12 -mt-12" />
                <p className="text-[9px] font-black text-indigo-200 uppercase mb-3 tracking-widest flex items-center gap-2">
                  <Check className="w-3 h-3" /> Output JSON for Moodle
                </p>
                <div className="bg-black/30 rounded-lg p-3 text-[10px] font-mono whitespace-pre text-indigo-100 overflow-x-auto max-h-48 custom-scrollbar border border-white/5">
                  {JSON.stringify({ 
                    atoms: atoms.length, 
                    bonds: bonds.map(b => [b.atom1Id.slice(0,2), b.atom2Id.slice(0,2), b.order]) 
                  }, null, 2)}
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
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Saved Gallery</h3>
            <div className="space-y-2 mb-4 max-h-40 overflow-y-auto custom-scrollbar">
              {savedMolecules.length === 0 && <p className="text-[10px] text-slate-300 italic text-center">No saved structures</p>}
              {savedMolecules.map(m => (
                <button
                  key={m.id}
                  onClick={() => loadMolecule(m.data)}
                  className="w-full text-left p-2 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors flex justify-between"
                >
                  <span>{m.name}</span>
                  <span className="text-slate-400 font-mono italic">{m.data.atoms.length} At</span>
                </button>
              ))}
            </div>
            
            <div className="flex items-center justify-between gap-3">
              <button 
                onClick={() => { setAtoms([]); setBonds([]); setSelectedEntityId(null); }}
                className="text-xs font-bold text-slate-400 flex items-center hover:text-red-500 transition-colors px-2 py-1"
              >
                <RotateCcw className="mr-1.5 w-3.5 h-3.5" />
                Clear
              </button>
              <button 
                onClick={saveMolecule}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white px-4 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-widest shadow-md shadow-emerald-100 transition-all"
              >
                Save Structure
              </button>
            </div>
          </div>
        </aside>
      </div>
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
        onClick={onClick}
        title={label}
        className={cn(
          "w-10 h-10 flex items-center justify-center rounded-lg border transition-all relative overflow-hidden group",
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
  onMouseDown, 
  onMouseUp,
  isEraser,
  isSelected,
  currentValency,
  expectedValency,
  allAtoms,
  connectedBonds
}: { 
  atom: Atom, 
  onMouseDown: (e: React.MouseEvent) => void,
  onMouseUp: (e: React.MouseEvent) => void,
  isEraser: boolean,
  isSelected: boolean,
  currentValency: number,
  expectedValency: number,
  allAtoms: Atom[],
  connectedBonds: Bond[],
  key?: string
}) {
  const color = ATOM_COLORS[atom.symbol];
  const textColor = ATOM_TEXT_COLORS[atom.symbol];
  const isOverValency = currentValency > expectedValency;
  const implicitH = Math.max(0, expectedValency - currentValency);

  const renderLonePairs = () => {
    const bondAngles = connectedBonds.map(b => {
      const otherId = b.atom1Id === atom.id ? b.atom2Id : b.atom1Id;
      const other = allAtoms.find(a => a.id === otherId);
      if (!other) return null;
      return Math.atan2(other.y - atom.y, other.x - atom.x);
    }).filter((a): a is number => a !== null);

    let availableAngles: number[] = [];
    if (bondAngles.length === 0) {
      availableAngles = [-Math.PI/2, 0, Math.PI/2, Math.PI];
    } else if (bondAngles.length === 1) {
      const a = bondAngles[0];
      availableAngles = [a + Math.PI, a + Math.PI/2, a - Math.PI/2, a + Math.PI * 3/4];
    } else {
      const sorted = [...bondAngles].sort((a, b) => a - b);
      const gaps = [];
      for (let i = 0; i < sorted.length; i++) {
        const next = sorted[(i + 1) % sorted.length];
        let diff = next - sorted[i];
        if (diff < 0) diff += 2 * Math.PI;
        gaps.push({ start: sorted[i], diff });
      }
      gaps.sort((a, b) => b.diff - a.diff);
      
      if (gaps[0].diff > Math.PI) {
        availableAngles.push(gaps[0].start + gaps[0].diff * 1/3);
        availableAngles.push(gaps[0].start + gaps[0].diff * 2/3);
        if (gaps.length > 1) availableAngles.push(gaps[1].start + gaps[1].diff / 2);
        availableAngles.push(gaps[0].start + gaps[0].diff * 1/2);
      } else {
        gaps.forEach(g => availableAngles.push(g.start + g.diff / 2));
      }
    }

    const pairs = [];
    const radius = 24;
    const dotSize = 2.5;
    const pairSpread = 6.5;

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
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
    >
      <circle
        cx={atom.x}
        cy={atom.y}
        r={isEraser ? 22 : isOverValency || isSelected ? 21 : 20}
        fill={color}
        className={cn(
          "stroke-2",
          isEraser ? "group-hover:stroke-red-500" : 
          isOverValency ? "stroke-red-500" :
          isSelected ? "stroke-indigo-400" : "stroke-transparent group-hover:stroke-indigo-200"
        )}
        style={{ 
          transition: 'stroke 0.3s, fill 0.3s, r 0.3s',
          filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.1))' 
        }}
      />
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
      
      {/* Implicit Hydrogens */}
      {atom.symbol !== 'H' && implicitH > 0 && (
        <text
          x={atom.x + 14}
          y={atom.y + 14}
          fill={color === '#ffffff' ? '#64748b' : color}
          className="font-bold text-[10px] pointer-events-none"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
        >
          H{implicitH > 1 ? implicitH : ''}
        </text>
      )}
      
      {atom.charge !== 0 && (
        <g transform={`translate(${atom.x + 14}, ${atom.y - 14})`}>
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
  onClick,
  isEraser,
  isSelected
}: { 
  bond: Bond, 
  atom1: Atom, 
  atom2: Atom, 
  onClick: (e: React.MouseEvent) => void,
  isEraser: boolean,
  isSelected: boolean,
  key?: string
}) {
  const dx = atom2.x - atom1.x;
  const dy = atom2.y - atom1.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const offset = 20;
  const bondLength = Math.max(0, length - offset * 2);
  
  const renderLines = () => {
    const spacing = 5;
    const strokeWidth = 4;
    const color = "#CBD5E1";
    const activeColor = "#818CF8";
    
    switch (bond.order) {
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
      transform={`translate(${atom1.x}, ${atom1.y}) rotate(${angle}) translate(${offset}, 0)`}
      onClick={onClick}
      className="cursor-pointer group"
    >
      <line x1={0} y1={0} x2={bondLength} y2={0} className="stroke-transparent stroke-[16px]" />
      <g className={cn("transition-all", isEraser ? "group-hover:[&>line]:stroke-red-500 group-hover:[&>line]:stroke-opacity-100" : isSelected ? "" : "group-hover:[&>line]:stroke-indigo-300 group-hover:opacity-100 opacity-90")}>
        {renderLines()}
      </g>
    </g>
  );
}
