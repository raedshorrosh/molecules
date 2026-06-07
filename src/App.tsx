/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import katex from "katex";
import {
  Atom as AtomIcon,
  Trash2,
  Plus,
  Minus,
  RotateCcw,
  Download,
  Info,
  CircleDot,
  MoreHorizontal,
  MousePointer2,
  Copy,
  Check,
  X,
  AlertCircle,
  Wand2,
  Activity,
  Type,
  ArrowRight,
  Focus,
  ClipboardPaste,
  Settings,
  ChevronDown,
  EyeOff,
  ShieldAlert,
  Share2,
  CircleDashed,
} from "lucide-react";
import { cn } from "@/src/lib/utils.ts";
import {
  ElementType,
  Atom,
  Bond,
  Molecule,
  getAtomColor,
  getAtomTextColor,
  getAtomRadius,
  CanvasText,
  CanvasArrow,
} from "@/src/types.ts";

interface CompareResult {
  match: boolean;
  message: string;
  messageKey?: keyof typeof TRANSLATIONS.Eng;
}

function getConnectedComponents(atoms: Atom[], bonds: Bond[]): Molecule[] {
  const components: Molecule[] = [];
  const visited = new Set<string>();

  const adjList = new Map<string, string[]>();
  atoms.forEach((a) => adjList.set(a.id, []));
  bonds.forEach((b) => {
    adjList.get(b.atom1Id)?.push(b.atom2Id);
    adjList.get(b.atom2Id)?.push(b.atom1Id);
  });

  for (const a of atoms) {
    if (!visited.has(a.id)) {
      const compAtoms: Atom[] = [];
      const compAtomIds = new Set<string>();

      const q = [a.id];
      visited.add(a.id);

      while (q.length > 0) {
        const currId = q.shift()!;
        compAtomIds.add(currId);
        const currAt = atoms.find((at) => at.id === currId);
        if (currAt) compAtoms.push(currAt);

        for (const neighborId of adjList.get(currId) || []) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            q.push(neighborId);
          }
        }
      }

      const compBonds = bonds.filter(
        (b) => compAtomIds.has(b.atom1Id) && compAtomIds.has(b.atom2Id),
      );
      components.push({ atoms: compAtoms, bonds: compBonds });
    }
  }

  return components;
}

function areMoleculesEqual(
  m1: Molecule,
  m2: Molecule,
  strictMatching: boolean,
): CompareResult {
  const getExpectedValency = (symbol: string) => {
    const valencies: Record<string, number> = {
      C: 4,
      N: 3,
      O: 2,
      H: 1,
      F: 1,
      Cl: 1,
      Br: 1,
      I: 1,
      P: 3,
      S: 2,
      B: 3,
    };
    return valencies[symbol] || 0;
  };

  const getExpectedLonePairs = (
    symbol: string,
    bondingSum: number,
    charge: number,
  ) => {
    const valenceElectrons: Record<string, number> = {
      H: 1,
      C: 4,
      N: 5,
      O: 6,
      F: 7,
      Cl: 7,
      Br: 7,
      I: 7,
      P: 5,
      S: 6,
      B: 3,
    };
    const val = valenceElectrons[symbol];
    if (val === undefined) return 0;
    const remaining = val - bondingSum - charge;
    return Math.max(0, Math.floor(remaining / 2));
  };

  const buildGraph = (m: Molecule) => {
    let nextId = 0;
    const gNodes = m.atoms.map((n) => ({
      id: n.id,
      symbol: n.symbol,
      lonePairs: n.lonePairs || 0,
      charge: n.charge || 0,
      singleElectrons: n.singleElectrons || 0,
      adj: [] as { target: string; order: number }[],
    }));

    for (const b of m.bonds) {
      const n1 = gNodes.find((n) => n.id === b.atom1Id);
      const n2 = gNodes.find((n) => n.id === b.atom2Id);
      if (n1 && n2) {
        n1.adj.push({ target: n2.id, order: b.order });
        n2.adj.push({ target: n1.id, order: b.order });
      }
    }

    const allNodes = [...gNodes];
    if (!strictMatching) {
      for (const n of gNodes) {
        const currentV = n.adj.reduce(
          (sum, e) =>
            sum +
            (Number(e.order) === 0
              ? 0
              : Number(e.order) === 4 || Number(e.order) === 5
                ? 1
                : Number(e.order)),
          0,
        );
        const expectedV = getExpectedValency(n.symbol);
        const implicitH = Math.max(0, expectedV - currentV);
        for (let i = 0; i < implicitH; i++) {
          const hId = `implicit_H_${n.id}_${nextId++}`;
          const hNode = {
            id: hId,
            symbol: "H",
            lonePairs: 0,
            charge: 0,
            singleElectrons: 0,
            adj: [{ target: n.id, order: 1 }] as any,
          };
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
        const u = m1.atoms.find((a) => a.id === b.atom1Id);
        const v = m1.atoms.find((a) => a.id === b.atom2Id);
        if (!u || !v) continue;

        const u_neighbor_id =
          m1.bonds.find((nb) => nb.atom1Id === u.id && nb.atom2Id !== v.id)
            ?.atom2Id ||
          m1.bonds.find((nb) => nb.atom2Id === u.id && nb.atom1Id !== v.id)
            ?.atom1Id;
        const v_neighbor_id =
          m1.bonds.find((nb) => nb.atom1Id === v.id && nb.atom2Id !== u.id)
            ?.atom2Id ||
          m1.bonds.find((nb) => nb.atom2Id === v.id && nb.atom1Id !== u.id)
            ?.atom1Id;

        if (u_neighbor_id && v_neighbor_id) {
          const x = m1.atoms.find((a) => a.id === u_neighbor_id);
          const y = m1.atoms.find((a) => a.id === v_neighbor_id);

          const u2_id = map12.get(u.id);
          const v2_id = map12.get(v.id);
          const x2_id = map12.get(u_neighbor_id);
          const y2_id = map12.get(v_neighbor_id);

          if (x && y && u2_id && v2_id && x2_id && y2_id) {
            const b2 = m2.bonds.find(
              (nb) =>
                (nb.atom1Id === u2_id && nb.atom2Id === v2_id) ||
                (nb.atom1Id === v2_id && nb.atom2Id === u2_id),
            );
            if (!b2 || b2.order !== 2) continue;

            const u2 = m2.atoms.find((a) => a.id === u2_id);
            const v2 = m2.atoms.find((a) => a.id === v2_id);
            const x2 = m2.atoms.find((a) => a.id === x2_id);
            const y2 = m2.atoms.find((a) => a.id === y2_id);

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

  if (g1.length !== g2.length)
    return {
      match: false,
      messageKey: "errDiffNumAtoms",
      message: "❌ Not a match. Different number of atoms.",
    };

  const symCount1 = g1.reduce(
    (acc, n) => {
      acc[n.symbol] = (acc[n.symbol] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const symCount2 = g2.reduce(
    (acc, n) => {
      acc[n.symbol] = (acc[n.symbol] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  if (Object.keys(symCount1).length !== Object.keys(symCount2).length)
    return {
      match: false,
      messageKey: "errDiffComposition",
      message: "❌ Not a match. Different elemental composition.",
    };
  for (const k in symCount1)
    if (symCount1[k] !== symCount2[k])
      return {
        match: false,
        messageKey: "errDiffComposition",
        message: "❌ Not a match. Different elemental composition.",
      };

  const degSeq1 = g1
    .map((n) => n.adj.length)
    .sort((a, b) => b - a)
    .join(",");
  const degSeq2 = g2
    .map((n) => n.adj.length)
    .sort((a, b) => b - a)
    .join(",");
  if (degSeq1 !== degSeq2)
    return {
      match: false,
      messageKey: "errDiffConnectivity",
      message: "❌ Not a match. Different basic connectivity.",
    };

  const map12 = new Map<string, string>();
  const mapped2 = new Set<string>();

  let foundTopologyMatch = false;
  let electronError: CompareResult | null = null;

  const isIsomorphic = (idx: number, allowKekule: boolean = false): boolean => {
    if (idx === g1.length) {
      foundTopologyMatch = true;
      if (!checkStereo(map12)) {
        return false;
      }

      // Check electron properties for this specific structural match
      for (const u of g1) {
        const vId = map12.get(u.id);
        if (!vId) continue;
        const v = g2.find((n) => n.id === vId);
        if (!v) continue;

        if (u.charge !== v.charge) {
          electronError = {
            match: false,
            messageKey: "errWrongCharge",
            message: "❌ Incorrect charge.",
          };
          return false;
        }
        if (u.singleElectrons !== v.singleElectrons) {
          electronError = {
            match: false,
            messageKey: "errWrongElectrons",
            message: "❌ Incorrect single electrons.",
          };
          return false;
        }

        if (v.lonePairs > 0) {
          if (u.lonePairs !== v.lonePairs) {
            electronError = {
              match: false,
              messageKey: "errWrongLonePairs",
              message: "❌ Incorrect lone pairs.",
            };
            return false;
          }
        } else {
          if (u.lonePairs > 0) {
            const bondingSum = u.adj.reduce(
              (sum, e) =>
                sum +
                (Number(e.order) === 4 || Number(e.order) === 5
                  ? 1
                  : Number(e.order)),
              0,
            );
            const expected = getExpectedLonePairs(
              u.symbol,
              bondingSum,
              u.charge,
            );
            if (u.lonePairs !== expected) {
              electronError = {
                match: false,
                messageKey: "errWrongLonePairs",
                message: "❌ Incorrect lone pairs.",
              };
              return false;
            }
          }
        }
      }

      return true;
    }

    const u = g1[idx];

    const candidates = g2.filter((v) => {
      if (v.symbol !== u.symbol) return false;
      if (v.adj.length !== u.adj.length) return false;
      if (mapped2.has(v.id)) return false;

      if (allowKekule) {
        const sumOrders = (atom: any) =>
          atom.adj.reduce(
            (sum: number, e: any) =>
              sum +
              (Number(e.order) === 4 || Number(e.order) === 5
                ? 1
                : Number(e.order)),
            0,
          );
        if (sumOrders(u) !== sumOrders(v)) return false;
      }

      return true;
    });

    for (const v of candidates) {
      let consistent = true;
      for (const e of u.adj) {
        if (map12.has(e.target)) {
          const u_neighbor = e.target;
          const v_neighbor = map12.get(u_neighbor);
          const matchedEdge = v.adj.find((ve) => ve.target === v_neighbor);
          if (!matchedEdge || (!allowKekule && matchedEdge.order !== e.order)) {
            consistent = false;
            break;
          }
        }
      }

      if (consistent) {
        map12.set(u.id, v.id);
        mapped2.add(v.id);

        if (isIsomorphic(idx + 1, allowKekule)) return true;

        map12.delete(u.id);
        mapped2.delete(v.id);
      }
    }
    return false;
  };

  g1.sort((a, b) => b.adj.length - a.adj.length);
  let match = isIsomorphic(0, false);
  if (!match) {
    // Retry with Kekule tolerance if strict match failed
    map12.clear();
    mapped2.clear();
    foundTopologyMatch = false;
    match = isIsomorphic(0, true);
  }

  if (match) {
    return {
      match: true,
      message: "✅ Match! The structures are chemically equivalent.",
    };
  } else if (electronError) {
    return electronError;
  } else if (foundTopologyMatch) {
    return {
      match: false,
      messageKey: "errDiffStereo",
      message:
        "❌ Not a match. The bonds match but the geometric stereoisomerism (e.g. cis/trans) differs.",
    };
  } else {
    return {
      match: false,
      messageKey: "errDiffTopology",
      message: "❌ Not a match. Different connectivity.",
    };
  }
}

// Helpers for compressing Molecule payload for STACK Maxima Variables
function shrinkMolecule(mol: Molecule): string {
  const atomIds = mol.atoms.map((a) => a.id);
  const a = mol.atoms.map((at) => {
    const arr: any[] = [
      at.symbol,
      Math.round(at.x * 10) / 10,
      Math.round(at.y * 10) / 10,
      at.lonePairs || 0,
      at.charge || 0,
    ];
    if (at.singleElectrons && at.singleElectrons > 0) {
      arr.push(at.singleElectrons);
      if (at.color) {
        arr.push(at.color);
      } else if (at.isFixed) {
        arr.push(0);
      }
    } else if (at.color || at.isFixed) {
      arr.push(0);
      if (at.color) {
        arr.push(at.color);
      } else if (at.isFixed) {
        arr.push(0);
      }
    }
    if (at.isFixed) {
      arr.push(1);
    }
    return arr;
  });
  const b = mol.bonds.map((bt) => {
    const idx1 = atomIds.indexOf(bt.atom1Id);
    const idx2 = atomIds.indexOf(bt.atom2Id);
    const arr: any[] = [Math.min(idx1, idx2), Math.max(idx1, idx2), bt.order];
    if (bt.isFixed) {
      arr.push(1);
    }
    return arr;
  });

  b.sort((b1, b2) => {
    if (b1[0] !== b2[0]) return b1[0] - b2[0];
    if (b1[1] !== b2[1]) return b1[1] - b2[1];
    return b1[2] - b2[2];
  });

  const payload: any = { a, b };

  if (mol.texts && mol.texts.length > 0) {
    payload.t = mol.texts.map((txt) => [
      Math.round(txt.x * 10) / 10,
      Math.round(txt.y * 10) / 10,
      txt.text,
      txt.size,
      txt.color,
      txt.rotation,
    ]);
  }

  if (mol.arrows && mol.arrows.length > 0) {
    payload.arr = mol.arrows.map((arr) => [
      Math.round(arr.startX * 10) / 10,
      Math.round(arr.startY * 10) / 10,
      Math.round(arr.endX * 10) / 10,
      Math.round(arr.endY * 10) / 10,
      arr.color,
    ]);
  }

  return JSON.stringify(payload).replace(/"/g, "'");
}

function parseTeacherAnswer(taString: string): Molecule | null {
  if (!taString || taString.trim() === "") return null;
  try {
    let cleanTA = taString.trim();
    if (
      (cleanTA.startsWith('"') && cleanTA.endsWith('"')) ||
      (cleanTA.startsWith("'") && cleanTA.endsWith("'"))
    ) {
      cleanTA = cleanTA.substring(1, cleanTA.length - 1);
    }
    cleanTA = cleanTA.replace(/\\"/g, '"');
    cleanTA = cleanTA.replace(/\\'/g, "'");
    cleanTA = cleanTA.replace(/'/g, '"');
    const parsed = JSON.parse(cleanTA);

    // Check if compressed format
    if (
      parsed.a &&
      parsed.b &&
      Array.isArray(parsed.a) &&
      Array.isArray(parsed.b)
    ) {
      const atoms: Atom[] = parsed.a.map((at: any[]) => ({
        id: crypto.randomUUID(),
        symbol: at[0] as ElementType,
        x: at[1],
        y: at[2],
        lonePairs: at[3],
        charge: at[4],
        singleElectrons: at.length > 5 ? at[5] : 0,
        color: at.length > 6 && at[6] !== 0 ? at[6] : undefined,
        isFixed: at.length > 7 ? at[7] === 1 : false,
      }));
      const bonds: Bond[] = parsed.b.map((bt: any[]) => ({
        id: crypto.randomUUID(),
        atom1Id: atoms[bt[0]].id,
        atom2Id: atoms[bt[1]].id,
        order: bt[2],
        isFixed: bt.length > 3 ? bt[3] === 1 : false,
      }));
      const texts: CanvasText[] | undefined = Array.isArray(parsed.t)
        ? parsed.t.map((txt: any[]) => ({
            id: crypto.randomUUID(),
            x: txt[0],
            y: txt[1],
            text: txt[2],
            size: txt[3],
            color: txt[4],
            rotation: txt[5],
          }))
        : undefined;
      const arrows: CanvasArrow[] | undefined = Array.isArray(parsed.arr)
        ? parsed.arr.map((arr: any[]) => ({
            id: crypto.randomUUID(),
            startX: arr[0],
            startY: arr[1],
            endX: arr[2],
            endY: arr[3],
            color: arr[4],
          }))
        : undefined;
      return { atoms, bonds, texts, arrows };
    }

    if (parsed.visual && Array.isArray(parsed.visual.atoms)) {
      return parsed.visual as Molecule;
    }
    if (Array.isArray(parsed.atoms) && Array.isArray(parsed.bonds)) {
      return parsed as Molecule;
    }
  } catch (err) {
    try {
      let cleaned = taString.trim();
      if (
        (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))
      ) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
      }
      cleaned = cleaned.replace(/\\"/g, '"');
      cleaned = cleaned.replace(/\\'/g, "'");
      cleaned = cleaned.replace(/'/g, '"');
      const parsed = JSON.parse(cleaned);

      if (
        parsed.a &&
        parsed.b &&
        Array.isArray(parsed.a) &&
        Array.isArray(parsed.b)
      ) {
        const atoms: Atom[] = parsed.a.map((at: any[]) => ({
          id: crypto.randomUUID(),
          symbol: at[0] as ElementType,
          x: at[1],
          y: at[2],
          lonePairs: at[3],
          charge: at[4],
          singleElectrons: at.length > 5 ? at[5] : 0,
          color: at.length > 6 && at[6] !== 0 ? at[6] : undefined,
          isFixed: at.length > 7 ? at[7] === 1 : false,
        }));
        const bonds: Bond[] = parsed.b.map((bt: any[]) => ({
          id: crypto.randomUUID(),
          atom1Id: atoms[bt[0]].id,
          atom2Id: atoms[bt[1]].id,
          order: bt[2],
          isFixed: bt.length > 3 ? bt[3] === 1 : false,
        }));
        const texts: CanvasText[] | undefined = Array.isArray(parsed.t)
          ? parsed.t.map((txt: any[]) => ({
              id: crypto.randomUUID(),
              x: txt[0],
              y: txt[1],
              text: txt[2],
              size: txt[3],
              color: txt[4],
              rotation: txt[5],
            }))
          : undefined;
        const arrows: CanvasArrow[] | undefined = Array.isArray(parsed.arr)
          ? parsed.arr.map((arr: any[]) => ({
              id: crypto.randomUUID(),
              startX: arr[0],
              startY: arr[1],
              endX: arr[2],
              endY: arr[3],
              color: arr[4],
            }))
          : undefined;
        return { atoms, bonds, texts, arrows };
      }

      if (parsed.visual && Array.isArray(parsed.visual.atoms)) {
        return parsed.visual as Molecule;
      }
      if (Array.isArray(parsed.atoms) && Array.isArray(parsed.bonds)) {
        return parsed as Molecule;
      }
    } catch (e2) {
      // Ignore
    }
  }
  return null;
}

type Language = "Eng" | "Heb" | "Ara";

const TRANSLATIONS = {
  Eng: {
    appTitle: "PeTeL Chem Editor",
    undo: "Undo",
    redo: "Redo",
    centerStructure: "Center",
    cleanStructure: "Clean",
    addH: "Add H",
    settingsBtn: "Settings",
    instructorMode: "Instructor Mode",
    studentMode: "Student Mode",
    readOnly: "Read Only",
    valencyWarnings: "Valency",
    hideCH: "C-H",
    skeletal: "Skeletal",
    filled: "Filled",
    select: "Select",
    atom: "Atom",
    bond: "Bond",
    chain: "Chain",
    lonePairsBtn: "L-Pairs",
    erase: "Erase",
    clear: "Clear",
    locked: "LOCKED",
    scale: "Scale",
    submissionCorrect: "Submission: Correct",
    submissionIncorrect: "Submission: Incorrect",
    answerFits: "Answer fits structural criteria",
    unmatchedStructure: "Unmatched structure",
    errDuplicateMatch:
      "Drawn correctly but it is chemically identical to a structure you have already drawn.",
    errDiffNumAtoms: "Not a match. Different number of atoms.",
    errDiffComposition: "Not a match. Different elemental composition.",
    errDiffConnectivity: "Not a match. Different basic connectivity.",
    errDiffStereo:
      "Not a match. The bonds match but the geometric stereoisomerism differs.",
    errDiffTopology: "Not a match. Different connectivity.",
    errWrongCharge: "Incorrect charge on atom(s).",
    errWrongLonePairs: "Incorrect number of lone pairs on atom(s).",
    errWrongElectrons: "Incorrect number of single electrons on atom(s).",
    errMissingMol:
      "The answer does not fit the question. You must answer all components of the question and draw everything required.",
    errExtraMol: "Extra molecules detected.",
    atomsCount: "Atoms count",
    bondsCount: "Bonds count",
    compositionAnalysis: "Composition Analysis",
    element: "Element",
    drawn: "Drawn",
    correct: "Correct",
    status: "Status",
    matched: "Matched",
    mismatch: "Mismatch",
    noAnswerKey: "No Teacher Answer Key Parameters Loaded",
    noAnswerSubtext:
      "The instructor has not submitted a correct answer code `TA` for evaluation yet.",
    emptyCanvas: "Empty Canvas",
    readyForExport: "Structure Modified - Ready for Export",
    atoms: "Atoms",
    bonds: "Bonds",
    stackConnected: "STACK: Connected",
    entityProperties: "Entity Properties",
    entitiesSelected: "Entities Selected",
    elementLabel: "Element",
    bondLabel: "Bond",
    reflectH: "Reflect H",
    reflectV: "Reflect V",
    rotateFreely: "Rotate Freely",
    hybridization: "Hybridization",
    charge: "Charge",
    swapElement: "Swap Element",
    order: "Order",
    selectToInspect: "Select entity to inspect",
    normalChain: "Normal Chain",
    fattyAcid: "Fatty Acid",
    toggleCisTrans: "Toggle Cis/Trans",
    stackVerification: "STACK Verification",
    stackMaximaString: "STACK Maxima 'ta' String",
    compressed: "COMPRESSED",
    publishAnswerKey: "Publish Answer Key",
    syncedToQuestion: "Synced to Question",
    answerKeySupplied:
      "Answer key supplied. You can use 'Test Submitted State' to test it.",
    savedGallery: "Saved Gallery",
    strictMatch: "Strict Match Drawn H's",
    noSavedStructures: "No saved structures",
    compare: "Compare",
    saveStructureBtn: "Save Structure",
    clearAll: "Clear All",
    exportImage: "Export Image",
    exportSvg: "SVG",
    exportPng: "PNG",
    exportJpg: "JPG",
    importPubChem: "Import PubChem",
    downloadHtml: "Download App HTML",
    saveTitle: "Save Structure",
    cancelBtn: "CANCEL",
    saveBtn: "SAVE",
    copyBtn: "Copy",
    pasteBtn: "Paste",
    otherElementTitle: "Other Element",
    selectBtn: "SELECT",
    drName: "Dr. Julian Sterling",
    courseName: "Chemistry 101 Section B",
    studentAccount: "Student Account",
    interactiveAssignment: "Interactive assignment",
    stopTesting: "Stop Testing Submitted",
    testSubmitted: "Test Submitted State",
    stackLinked: "STACK Linked",
    studentGuideTitle: "How to Build Molecules?",
    addAtomsLabel: "Add Atoms",
    addAtomsDesc:
      "Select an element from the left toolbar, then click anywhere on the canvas to place it.",
    addBondsLabel: "Add Bonds",
    addBondsDesc:
      "Drag from one atom and drop on another to connect them. Click any existing bond to change its order (single, double, triple, wedge, dash).",
    addLonePairsLabel: "Electron Lone Pairs & Single Electrons",
    addLonePairsDesc:
      "Select the [Lone Pair] tool (:) or [Single Electron] tool (.) from the left, then click on an atom to add electrons.",
    eraseEditLabel: "Erase / Edit",
    eraseEditDesc:
      "Use the [Eraser] tool (🗑️) to delete items, or click [Select] mode to drag, rotate, or modify existing elements.",
  },
  Heb: {
    appTitle: "עורך כימיה PeTeL",
    undo: "בטל",
    redo: "בצע שוב",
    centerStructure: "מרכז מבנה",
    cleanStructure: "נקה",
    addH: "הוסף מימנים",
    settingsBtn: "הגדרות",
    instructorMode: "מצב מורה",
    studentMode: "מצב תלמיד",
    readOnly: "קריאה בלבד",
    valencyWarnings: "ערכיות",
    hideCH: "C-H",
    skeletal: "שלד",
    filled: "מלא",
    select: "בחר",
    atom: "אטום",
    bond: "קשר",
    chain: "שרשרת",
    lonePairsBtn: "זוגות אלק",
    erase: "מחק",
    clear: "נקה",
    locked: "נעול",
    scale: "קנה מידה",
    submissionCorrect: "ההגשה נכונה",
    submissionIncorrect: "ההגשה שגויה",
    answerFits: "התשובה מתאימה למבנה",
    unmatchedStructure: "מבנה לא תואם",
    errDuplicateMatch: "השרטוט נכון, אך זהה מבחינה כימית למבנה שכבר שרטטת.",
    errDiffNumAtoms: "לא מתאים. מספר אטומים שונה.",
    errDiffComposition: "לא מתאים. הרכב יסודות שונה.",
    errDiffConnectivity: "לא מתאים. קישוריות בסיסית שונה.",
    errDiffStereo: "לא מתאים. הקשרים מתאימים אך איזומריה סטראומטרית שונה.",
    errDiffTopology: "לא מתאים. קישוריות שונה.",
    errWrongCharge: "מטען שגוי.",
    errWrongLonePairs: "מספר זוגות אלקטרונים שגוי.",
    errWrongElectrons: "מספר אלקטרונים בודדים שגוי.",
    errMissingMol:
      "התשובה לא מתאימה לשאלה. יש לענות על כל מרכיבי השאלה ולשרטט כל מה שדרוש.",
    errExtraMol: "התגלו מולקולות מיותרות.",
    atomsCount: "מספר אטומים",
    bondsCount: "מספר קשרים",
    compositionAnalysis: "ניתוח הרכב",
    element: "יסוד",
    drawn: "מצויר",
    correct: "נכון",
    status: "סטטוס",
    matched: "תואם",
    mismatch: "לא תואם",
    noAnswerKey: "לא נטען מפתח תשובות מהמורה",
    noAnswerSubtext: "המורה עדיין לא הזין קוד `TA` לבדיקה.",
    emptyCanvas: "משטח עבודה ריק",
    readyForExport: "המבנה שונה - מוכן לייצוא",
    atoms: "אטומים",
    bonds: "קשרים",
    stackConnected: "STACK: מחובר",
    entityProperties: "מאפייני ישות",
    entitiesSelected: "ישויות נבחרו",
    elementLabel: "יסוד",
    bondLabel: "קשר",
    reflectH: "שקף אופקית",
    reflectV: "שקף אנכית",
    rotateFreely: "סובב חופשי",
    hybridization: "הכלאה",
    charge: "מטען",
    swapElement: "החלף יסוד",
    order: "סדר קשר",
    selectToInspect: "בחר ישות כדי לבחון",
    normalChain: "שרשרת צד רגילה",
    fattyAcid: "חומצת שומן",
    toggleCisTrans: "החלף ציס/טראנס",
    stackVerification: "אימות STACK",
    stackMaximaString: "מחרוזת 'ta' עבור STACK Maxima",
    compressed: "דחוס",
    publishAnswerKey: "פרסם מפתח תשובות",
    syncedToQuestion: "סונכרן לשאלה",
    answerKeySupplied:
      "מפתח התשובות הוגדר. ניתן להשתמש ב'בדוק מצב מוגש' כדי לבדוק אותו.",
    savedGallery: "גלריה שמורות",
    strictMatch: "התאמה קפדנית למימנים המצוירים",
    noSavedStructures: "אין מבנים שמורים",
    compare: "השווה",
    saveStructureBtn: "שמור מבנה",
    clearAll: "נקה הכל",
    exportImage: "ייצוא תמונה",
    exportSvg: "SVG",
    exportPng: "PNG",
    exportJpg: "JPG",
    importPubChem: "ייבא מ-PubChem",
    downloadHtml: "הורדת קובץ HTML",
    saveTitle: "שמור מבנה",
    cancelBtn: "ביטול",
    saveBtn: "שמור",
    copyBtn: "העתק",
    pasteBtn: "הדבק",
    otherElementTitle: "יסוד אחר",
    selectBtn: "בחר",
    drName: "Dr. Julian Sterling",
    courseName: "Chemistry 101 Section B",
    studentAccount: "חשבון תלמיד",
    interactiveAssignment: "מטלה אינטראקטיבית",
    stopTesting: "הפסק בדיקת ההגשה",
    testSubmitted: "בדוק מצב מוגש",
    stackLinked: "STACK מקושר",
    studentGuideTitle: "כיצד לבנות מולקולות?",
    addAtomsLabel: "הוספת אטומים",
    addAtomsDesc:
      "בחרו יסוד מסרגל הכלים הימני (למשל פחמן C או מימן H) ולחצו בכל נקודה ריקה על גבי משטח העבודה כדי להניח אותו.",
    addBondsLabel: "הוספת קשרים",
    addBondsDesc:
      "לחצו וגררו עם העכבר/מגע מאטום אחד ישירות לאטום אחר כדי ליצור קשר ביניהם. לחצו על קשר קיים כדי לשנות את סדר הקשר (יחיד, כפול, משולש וכד').",
    addLonePairsLabel: "זוגות אלקטרונים ואלקטרונים בודדים",
    addLonePairsDesc:
      "בחרו בכלי [זוגות אלק] (:) או [אלקטרון בודד] (.) בסרגל הימני, ולאחר מכן לחצו על האטום הרצוי במשטח העבודה כדי להוסיף לו אלקטרונים.",
    eraseEditLabel: "מחיקה ועריכה",
    eraseEditDesc:
      "השתמשו בכלי המחק (🗑️) כדי למחוק אטומים או קשרים, או השתמשו בכלי הבחירה כדי לגרור, לסובב או לשנות מאפיינים.",
  },
  Ara: {
    appTitle: "محرر الكيمياء PeTeL",
    undo: "تراجع",
    redo: "إعادة",
    centerStructure: "توسيط المبنى",
    cleanStructure: "تنظيف",
    addH: "إضافة H",
    settingsBtn: "إعدادات",
    instructorMode: "وضع المعلم",
    studentMode: "وضع الطالب",
    readOnly: "قراءة فقط",
    valencyWarnings: "التكافؤ",
    hideCH: "C-H",
    skeletal: "مبنى",
    filled: "ممتلئ",
    select: "تحديد",
    atom: "ذرة",
    bond: "رابطة",
    chain: "سلسلة",
    lonePairsBtn: "زوج إلك",
    erase: "مسح",
    clear: "مسح",
    locked: "مغلق",
    scale: "تكبير/تصغير",
    submissionCorrect: "التسليم صحيح",
    submissionIncorrect: "التسليم غير صحيح",
    answerFits: "الإجابة تناسب مباني المعلم",
    unmatchedStructure: "مبنى غير متطابق",
    errDuplicateMatch:
      "الرسم صحيح، ولكنه مطابق كيميائيًا لتركيب قمت برسمه سابقًا.",
    errDiffNumAtoms: "غير متطابق. عدد ذرات مختلف.",
    errDiffComposition: "غير متطابق. تكوين عنصري مختلف.",
    errDiffConnectivity: "غير متطابق. ترابط أساسي مختلف.",
    errDiffStereo:
      "غير متطابق. الروابط تتطابق ولكن التماكب الفراغي الهندسي يختلف.",
    errDiffTopology: "غير متطابق. ترابط مختلف.",
    errWrongCharge: "شحنة غير صحيحة.",
    errWrongLonePairs: "عدد أزواج الإلكترونات غير صحيح.",
    errWrongElectrons: "عدد الإلكترونات الفردية غير صحيح.",
    errMissingMol:
      "الإجابة لا تتناسب مع السؤال. يجب الإجابة على جميع مكونات السؤال ورسم كل ما هو مطلوب.",
    errExtraMol: "تم اكتشاف جزيئات إضافية.",
    atomsCount: "عدد الذرات",
    bondsCount: "عدد الروابط",
    compositionAnalysis: "تحليل التركيب",
    element: "عنصر",
    drawn: "مرسوم",
    correct: "صحيح",
    status: "الحالة",
    matched: "متطابق",
    mismatch: "عدم تطابق",
    noAnswerKey: "لم يتم تحميل مفتاح إجابة المعلم",
    noAnswerSubtext: "المعلم لم يقم بإرسال إجابة `TA` للتقييم بعد.",
    emptyCanvas: "لوحة فارغة",
    readyForExport: "تم تعديل المبنى - جاهز للتصدير",
    atoms: "ذرات",
    bonds: "روابط",
    stackConnected: "STACK: متصل",
    entityProperties: "خصائص الكيان",
    entitiesSelected: "كيانات محددة",
    elementLabel: "عنصر",
    bondLabel: "رابطة",
    reflectH: "انعكاس أفقي",
    reflectV: "انعكاس عمودي",
    rotateFreely: "تدوير حر",
    hybridization: "تهجين",
    charge: "شحنة",
    swapElement: "تبديل العنصر",
    order: "رتبة الرابطة",
    selectToInspect: "حدد كيانا للفحص",
    normalChain: "سلسلة عادية",
    fattyAcid: "حمض دهني",
    toggleCisTrans: "تبديل رابطة Cis/Trans",
    stackVerification: "تحقق STACK",
    stackMaximaString: "سلسلة STACK Maxima 'ta'",
    compressed: "مضغوط",
    publishAnswerKey: "نشر مفتاح الإجابات",
    syncedToQuestion: "متزامن مع السؤال",
    answerKeySupplied:
      "تم توفير مفتاح الإجابات. يمكنك استخدام 'تقييم التسليم' لاختباره.",
    savedGallery: "المعرض المحفوظ",
    strictMatch: "تطابق دقيق للـ H",
    noSavedStructures: "لا توجد مبانٍ محفوظة",
    compare: "قارن",
    saveStructureBtn: "حفظ المبنى",
    clearAll: "مسح الكل",
    exportImage: "تصدير صورة",
    exportSvg: "SVG",
    exportPng: "PNG",
    exportJpg: "JPG",
    importPubChem: "استيراد من PubChem",
    downloadHtml: "تحميل ملف HTML",
    saveTitle: "حفظ المبنى",
    cancelBtn: "إلغاء",
    saveBtn: "حفظ",
    copyBtn: "نسخ",
    pasteBtn: "لصق",
    otherElementTitle: "عنصر آخر",
    selectBtn: "تحديد",
    drName: "Dr. Julian Sterling",
    courseName: "Chemistry 101 Section B",
    studentAccount: "حساب طالب",
    interactiveAssignment: "مهمة تفاعلية",
    stopTesting: "إيقاف تقييم التسليم",
    testSubmitted: "تقييم التسليم",
    stackLinked: "STACK متصل",
    studentGuideTitle: "كيفية بناء الجزيئات؟",
    addAtomsLabel: "إضافة الذرات",
    addAtomsDesc:
      "اختر عنصراً من شريط الأدوات الأيمن (مثل الكربون C أو الهيدروجين H) واضغط في أي مكان فارغ لوضعه.",
    addBondsLabel: "إضافة الروابط",
    addBondsDesc:
      "اضغط واسحب من ذرة إلى أخرى لإنشاء رابطة بينهما. انقر على رابطة لتغيير رتبتها (أحادية، ثنائية، ثلاثية إلخ).",
    addLonePairsLabel: "أزواج الإلكترونات والإلكترونات المنفردة",
    addLonePairsDesc:
      "اختر أداة [أزواج الالكترونات] (:) أو [إلكترون منفرد] (.) على اليمين ثم انقر على الذرة لإضافة إلكترونات عليها.",
    eraseEditLabel: "الحذف والتعديل",
    eraseEditDesc:
      "استخدم أداة الممحاة (🗑️) لحذف ذرات أو روابط، أو استخدم وضع التحديد (السهم) لتحريك العناصر وتعديلها.",
  },
};

const getInitialLang = (): Language => {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    let lang = params.get("lang") || params.get("LANG");

    // Check if there is a DOM element injected by Moodle/STACK
    if (!lang) {
      const langEl = document.getElementById("stack-lang-param");
      if (langEl && langEl.textContent) {
        const text = langEl.textContent.trim();
        if (text && text.toLowerCase() !== "lang" && !text.includes("{#")) {
          lang = text;
        }
      }
    }

    // Check global window variables
    const globalWin = window as any;
    if (!lang) {
      lang =
        globalWin.__stackLang || globalWin.stackLang || globalWin.__stack_lang;
    }

    if (lang) {
      const lower = lang.toLowerCase();
      if (lower === "heb" || lower === "hebrew" || lower === "he") return "Heb";
      if (lower === "ara" || lower === "arabic" || lower === "ar") return "Ara";
      if (lower === "eng" || lower === "english" || lower === "en")
        return "Eng";
    }
  }
  return "Eng";
};

const BOND_ORDERS: number[] = [0, 1, 2, 3, 4, 5];

export default function App() {
  const [language, setLanguage] = useState<Language>(getInitialLang());
  const t = (key: keyof typeof TRANSLATIONS.Eng) =>
    TRANSLATIONS[language][key] || TRANSLATIONS.Eng[key];

  const [historyState, setHistoryState] = useState({
    history: [
      {
        atoms: [] as Atom[],
        bonds: [] as Bond[],
        texts: [] as CanvasText[],
        arrows: [] as CanvasArrow[],
      },
    ],
    index: 0,
  });
  const [draftState, setDraftState] = useState<{
    atoms: Atom[];
    bonds: Bond[];
    texts: CanvasText[];
    arrows: CanvasArrow[];
  } | null>(null);

  const atoms = draftState
    ? draftState.atoms
    : historyState.history[historyState.index].atoms;
  const bonds = draftState
    ? draftState.bonds
    : historyState.history[historyState.index].bonds;
  const texts = draftState
    ? draftState.texts
    : historyState.history[historyState.index].texts || [];
  const arrows = draftState
    ? draftState.arrows
    : historyState.history[historyState.index].arrows || [];

  const [savedMolecules, setSavedMolecules] = useState<
    { id: string; name: string; data: Molecule }[]
  >([]);
  const [strictMatching, setStrictMatching] = useState(true);
  const [showStudentGuide, setShowStudentGuide] = useState(false);
  const [isStackEnvironment, setIsStackEnvironment] = useState(false);
  const [mode, setMode] = useState<
    | "atom"
    | "bond"
    | "chain"
    | "erase"
    | "select"
    | "lone-pair"
    | "single-electron"
    | "charge"
    | "text"
    | "arrow"
  >("select");
  const [chainType, setChainType] = useState<"normal" | "fatty-acid">("normal");
  const [selectedElement, setSelectedElement] = useState<ElementType>("C");
  const [selectedBondOrder, setSelectedBondOrder] = useState<0 | 1 | 2 | 3>(1);

  // Moodle STACK view states
  const [isInstructor, setIsInstructor] = useState(true);
  const [teacherAnswer, setTeacherAnswer] = useState<Molecule | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [testReadOnlyMode, setTestReadOnlyMode] = useState(false);

  const quickElements = useMemo(() => {
    const defaults = ["C", "H", "N", "O", "P", "S", "F", "Cl", "Br", "I", "B"];
    const teacherElements = new Set<string>();
    if (teacherAnswer) {
      teacherAnswer.atoms.forEach((a) => teacherElements.add(a.symbol));
    }
    const result = [...defaults];
    for (const el of teacherElements) {
      if (!result.includes(el)) result.push(el);
    }
    return result;
  }, [teacherAnswer]);

  const [dragStartAtom, setDragStartAtom] = useState<string | null>(null);
  const dragStartAtomRef = useRef<string | null>(null);
  const [dragStartArrow, setDragStartArrow] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const dragStartArrowRef = useRef<{ x: number; y: number } | null>(null);
  const customColorsRef = useRef<Record<string, string>>({});

  const [gradePanelOffset, setGradePanelOffset] = useState({ x: 0, y: 0 });
  const isDraggingGradeRef = useRef(false);
  const dragGradeStartRef = useRef({ x: 0, y: 0 });
  const dragGradeInitialOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (isDraggingGradeRef.current) {
        setGradePanelOffset({
          x:
            dragGradeInitialOffsetRef.current.x +
            (e.clientX - dragGradeStartRef.current.x),
          y:
            dragGradeInitialOffsetRef.current.y +
            (e.clientY - dragGradeStartRef.current.y),
        });
      }
    };
    const handleUp = () => {
      isDraggingGradeRef.current = false;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const { gradeResult, componentMatchResults, score, teacherMoleculesCount } =
    useMemo(() => {
      if (!teacherAnswer)
        return {
          gradeResult: null,
          componentMatchResults: [],
          score: null,
          teacherMoleculesCount: 0,
        };

      const fullGrade = areMoleculesEqual(
        { atoms, bonds },
        teacherAnswer,
        strictMatching,
      );

      // Calculate individual grading
      const studentMolecules = getConnectedComponents(atoms, bonds);
      const teacherMolecules = getConnectedComponents(
        teacherAnswer.atoms,
        teacherAnswer.bonds,
      );

      const isPurelyFixed = (mol: Molecule) =>
        mol.atoms.length > 0 && mol.atoms.every((a) => a.isFixed);

      const teacherPreloadIndices = new Set<number>();
      studentMolecules
        .filter((smol) => isPurelyFixed(smol))
        .forEach((smol) => {
          const matchIndex = teacherMolecules.findIndex((tmol, j) => {
            if (teacherPreloadIndices.has(j)) return false;
            return areMoleculesEqual(smol, tmol, strictMatching).match;
          });
          if (matchIndex >= 0) teacherPreloadIndices.add(matchIndex);
        });

      const activeTeacherMolecules = teacherMolecules.filter(
        (_, i) => !teacherPreloadIndices.has(i),
      );
      const activeStudentMolecules = studentMolecules.filter(
        (smol) => !isPurelyFixed(smol),
      );

      const checkedTeacherIndices = new Set<number>();

      const matchResults = activeStudentMolecules.map((smol) => {
        const matchIndex = activeTeacherMolecules.findIndex((tmol, j) => {
          if (checkedTeacherIndices.has(j)) return false;
          return areMoleculesEqual(smol, tmol, strictMatching).match;
        });

        let isMatch = false;
        let closestErrorKey: keyof typeof TRANSLATIONS.Eng | undefined =
          undefined;

        if (matchIndex >= 0) {
          isMatch = true;
          checkedTeacherIndices.add(matchIndex);
        } else {
          const duplicateMatchIndex = activeTeacherMolecules.findIndex(
            (tmol) => {
              return areMoleculesEqual(smol, tmol, strictMatching).match;
            },
          );

          if (duplicateMatchIndex >= 0) {
            closestErrorKey = "errDuplicateMatch";
          } else {
            const unmatchedTIndices = activeTeacherMolecules
              .map((_, i) => i)
              .filter((i) => !checkedTeacherIndices.has(i));
            if (unmatchedTIndices.length > 0) {
              let bestSeverity = 999;
              for (const idx of unmatchedTIndices) {
                const res = areMoleculesEqual(
                  smol,
                  activeTeacherMolecules[idx],
                  strictMatching,
                );
                const key = res.messageKey as
                  | keyof typeof TRANSLATIONS.Eng
                  | undefined;
                let severity = 7;
                if (
                  key === "errWrongCharge" ||
                  key === "errWrongLonePairs" ||
                  key === "errWrongElectrons"
                )
                  severity = 1;
                else if (key === "errDiffStereo") severity = 2;
                else if (key === "errDiffTopology") severity = 3;
                else if (key === "errDiffConnectivity") severity = 4;
                else if (key === "errDiffComposition") severity = 5;
                else if (key === "errDiffNumAtoms") severity = 6;

                if (severity < bestSeverity) {
                  bestSeverity = severity;
                  closestErrorKey = key;
                }
              }
            } else {
              closestErrorKey = "unmatchedStructure";
            }
          }
        }

        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        if (smol.atoms.length > 0) {
          smol.atoms.forEach((a) => {
            minX = Math.min(minX, a.x);
            maxX = Math.max(maxX, a.x);
            minY = Math.min(minY, a.y);
            maxY = Math.max(maxY, a.y);
          });
        } else {
          minX = 0;
          maxX = 0;
          minY = 0;
          maxY = 0;
        }
        const cx = (minX + maxX) / 2;
        const cy = minY - 50;

        return {
          molecule: smol,
          isMatch,
          cx,
          cy,
          errorKey: closestErrorKey,
        };
      });

      let matchCount = matchResults.filter((r) => r.isMatch).length;

      const urlParams = new URLSearchParams(window.location.search);
      let correctNStr =
        urlParams.get("correct_n") || urlParams.get("CORRECT_N");
      if (!correctNStr) {
        const el = document.getElementById("stack-correct-n");
        if (el) correctNStr = el.innerText.trim();
      }
      let score = 0;

      if (correctNStr && !isNaN(parseInt(correctNStr, 10))) {
        const correctN = parseInt(correctNStr, 10);
        if (correctN > 0) {
          score = Math.min(1, matchCount / correctN);
          // Optional: If you want to penalize for spamming extra molecules, you could do it here
          // But requested logic: "answered at least 4 correct he/she should get full grade"
        } else {
          score = fullGrade.match ? 1 : 0;
        }
      } else {
        let totalExpectedComponents = Math.max(
          activeTeacherMolecules.length,
          activeStudentMolecules.length,
        );
        score =
          totalExpectedComponents > 0
            ? matchCount / totalExpectedComponents
            : fullGrade.match
              ? 1
              : 0;
      }

      // STACK might expect score to be capped at 1
      score = Math.min(1, Math.max(0, score));

      return {
        gradeResult: fullGrade,
        componentMatchResults: matchResults,
        score,
        teacherMoleculesCount: activeTeacherMolecules.length,
      };
    }, [atoms, bonds, teacherAnswer, strictMatching]);

  const [draggingAtomIds, setDraggingAtomIds] = useState<string[]>([]);
  const dragInitialMouseRef = useRef<{ x: number; y: number } | null>(null);
  const dragInitialAtomsRef = useRef<Atom[]>([]);
  const dragInitialTextsRef = useRef<CanvasText[]>([]);
  const dragInitialArrowsRef = useRef<CanvasArrow[]>([]);
  const dragHasMovedRef = useRef<boolean>(false);

  const [selectionBoxStart, setSelectionBoxStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectionBoxCurrent, setSelectionBoxCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const selectionBoxStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDownClickInfoRef = useRef<{
    id: string;
    wasSelected: boolean;
    isMulti: boolean;
  } | null>(null);

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const mousePosRef = useRef({ x: 0, y: 0 });
  const isCleaningRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [taValue, setTaValue] = useState("");
  const [selectedEntityIds, _setSelectedEntityIds] = useState<string[]>([]);
  const setSelectedEntityIds = useCallback(
    (val: string[] | ((prev: string[]) => string[])) => {
      _setSelectedEntityIds((prev) => {
        const next = typeof val === "function" ? val(prev) : val;
        const currentAtoms = stateRef.current.atoms;
        const currentBonds = stateRef.current.bonds;
        const atomIds = new Set(
          next.filter((id) => currentAtoms.some((a) => a.id === id)),
        );
        const autoBondIds = currentBonds
          .filter((b) => atomIds.has(b.atom1Id) && atomIds.has(b.atom2Id))
          .map((b) => b.id);
        return Array.from(new Set([...next, ...autoBondIds]));
      });
    },
    [],
  );
  const selectedEntityIdsRef = useRef<string[]>([]);
  const [scale, setScale] = useState(1.0);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [hideCHydrogens, setHideCHydrogens] = useState(false);
  const [showValencyWarnings, setShowValencyWarnings] = useState(false);
  const [skeletalMode, setSkeletalMode] = useState(false);
  const hideImplicitHydrogens = true;
  const [filledMode, setFilledMode] = useState(true);
  const [showElementPrompt, setShowElementPrompt] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [showPubChemPrompt, setShowPubChemPrompt] = useState(false);
  const [pubChemQuery, setPubChemQuery] = useState("");
  const [pubChemLoading, setPubChemLoading] = useState(false);
  const [pubChemError, setPubChemError] = useState("");
  const [saveName, setSaveName] = useState("");
  const [customElement, setCustomElement] = useState("");

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const stateRef = useRef({ atoms, bonds, texts, arrows });
  const draftStateRef = useRef(draftState);
  const modeRef = useRef(mode);
  const chainTypeRef = useRef(chainType);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(event.target as Node)
      ) {
        setShowSettingsMenu(false);
      }
    };
    if (showSettingsMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSettingsMenu]);

  const selectedElementRef = useRef(selectedElement);
  const selectedBondOrderRef = useRef(selectedBondOrder);
  const rotationLastValRef = useRef(0);
  const scaleLastValRef = useRef(100);

  // Check URL parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Check design variable (1 = instructor, others = student)
    let designParam = params.get("design") || params.get("DESIGN");
    if (!designParam) {
      const designEl = document.getElementById("stack-design-param");
      if (designEl && designEl.textContent) {
        const text = designEl.textContent.trim();
        if (text && text.toLowerCase() !== "design" && !text.includes("{#")) {
          designParam = text;
        }
      }
    }

    if (designParam !== null) {
      setIsInstructor(
        designParam === "1" ||
          designParam.toLowerCase() === "true" ||
          designParam.toLowerCase() === "instructor",
      );
    } else {
      // Omitted or default. If loaded inside an iframe (like Moodle previewing to students), default to Student View.
      // Otherwise default to Instructor View for convenience when opened directly from browser
      const isIframe = window.self !== window.top;
      if (isIframe) {
        setIsInstructor(false);
      }
    }

    // Check teacherAnswer variable (TA)
    let taParam = params.get("ta") || params.get("TA");
    if (!taParam) {
      const taEl = document.getElementById("stack-ta-param");
      if (taEl && taEl.textContent) {
        const text = taEl.textContent.trim();
        if (text && text.toLowerCase() !== "ta" && !text.includes("{#")) {
          taParam = text;
        }
      }
    }

    if (taParam) {
      const parsed = parseTeacherAnswer(taParam);
      if (parsed) {
        setTeacherAnswer(parsed);
      }
    }

    // Check PRELOAD variable
    let preloadParam = params.get("preload") || params.get("PRELOAD");
    if (!preloadParam) {
      const preloadEl = document.getElementById("stack-preload-param");
      if (preloadEl && preloadEl.textContent) {
        const text = preloadEl.textContent.trim();
        if (text && text.toLowerCase() !== "preload" && !text.includes("{#")) {
          preloadParam = text;
        }
      }
    }

    let fixedParam = params.get("fixed") || params.get("FIXED");
    if (!fixedParam) {
      const fixedEl = document.getElementById("stack-fixed-param");
      if (fixedEl && fixedEl.textContent) {
        const text = fixedEl.textContent.trim();
        if (text && text.toLowerCase() !== "fixed" && !text.includes("{#")) {
          fixedParam = text;
        }
      }
    }
    // "make the fixed of the preload to be the default."
    // So if fixedParam is false, "0", or "false", we do NOT fix it. Otherwise we do.
    const isPreloadFixed = fixedParam
      ? fixedParam.toLowerCase() !== "false" && fixedParam !== "0"
      : true;

    const globalWin = window as any;
    // We should only use preload if there is no student answer initially loaded by STACK or from local storage (if any).
    // STACK will later override it if 'stack-load-molecule' is invoked, which is correct behavior.
    if (preloadParam) {
      const parsed = parseTeacherAnswer(preloadParam);
      if (parsed) {
        if (isPreloadFixed) {
          parsed.atoms.forEach((a) => (a.isFixed = true));
          parsed.bonds.forEach((b) => (b.isFixed = true));
          if (parsed.texts) parsed.texts.forEach((t) => (t.isFixed = true));
          if (parsed.arrows) parsed.arrows.forEach((a) => (a.isFixed = true));
        }
        setHistoryState({
          history: [
            {
              atoms: parsed.atoms,
              bonds: parsed.bonds,
              texts: parsed.texts || [],
              arrows: parsed.arrows || [],
            },
          ],
          index: 0,
        });
      }
    }

    // Check lang variable (LANG/lang)
    let langParam = params.get("lang") || params.get("LANG");
    if (!langParam) {
      const langEl = document.getElementById("stack-lang-param");
      if (langEl && langEl.textContent) {
        const text = langEl.textContent.trim();
        if (text && text.toLowerCase() !== "lang" && !text.includes("{#")) {
          langParam = text;
        }
      }
    }

    if (!langParam) {
      langParam =
        globalWin.__stackLang || globalWin.stackLang || globalWin.__stack_lang;
    }

    if (langParam) {
      const lower = langParam.toLowerCase();
      if (lower === "heb" || lower === "hebrew" || lower === "he")
        setLanguage("Heb");
      else if (lower === "ara" || lower === "arabic" || lower === "ar")
        setLanguage("Ara");
      else if (lower === "eng" || lower === "english" || lower === "en")
        setLanguage("Eng");
    }
  }, []);

  // Monitor read-only state of STACK dynamic inputs
  useEffect(() => {
    const checkReadOnly = () => {
      const globalWin = window as any;
      if (globalWin.__stackInput) {
        const inputIsReadOnly =
          globalWin.__stackInput.disabled || globalWin.__stackInput.readOnly;
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
    stateRef.current = { atoms, bonds, texts, arrows };
    draftStateRef.current = draftState;
    modeRef.current = mode;
    chainTypeRef.current = chainType;
    selectedElementRef.current = selectedElement;
    selectedBondOrderRef.current = selectedBondOrder;
    selectedEntityIdsRef.current = selectedEntityIds;

    if (score !== null) {
      const payloadStr = shrinkMolecule({ atoms, bonds, texts, arrows });
      const payload = JSON.parse(payloadStr.replace(/'/g, '"'));
      payload._score = score;
      window.dispatchEvent(
        new CustomEvent("molecule-changed", {
          detail: payload,
        }),
      );
    } else {
      const payloadStr = shrinkMolecule({ atoms, bonds, texts, arrows });
      const payload = JSON.parse(payloadStr.replace(/'/g, '"'));
      window.dispatchEvent(
        new CustomEvent("molecule-changed", {
          detail: payload,
        }),
      );
    }
  }, [
    atoms,
    bonds,
    texts,
    arrows,
    draftState,
    mode,
    selectedElement,
    selectedBondOrder,
    selectedEntityIds,
    score,
  ]);

  useEffect(() => {
    const handleStackLoad = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        if (typeof detail === "string" && detail.trim() !== "") {
          const parsed = parseTeacherAnswer(detail);
          console.log("Loaded STACK molecule:", parsed);
          if (parsed && parsed.atoms && parsed.bonds) {
            setHistoryState({
              history: [
                {
                  atoms: parsed.atoms,
                  bonds: parsed.bonds,
                  texts: parsed.texts || [],
                  arrows: parsed.arrows || [],
                },
              ],
              index: 0,
            });
            setDraftState(null);
          }
        }
      } catch (err) {
        console.warn("Failed to parse STACK value", err);
      }
    };

    window.addEventListener("stack-load-molecule", handleStackLoad);

    const handleStackDetected = () => {
      setIsStackEnvironment(true);
    };
    window.addEventListener("stack-environment-detected", handleStackDetected);

    return () => {
      window.removeEventListener("stack-load-molecule", handleStackLoad);
      window.removeEventListener(
        "stack-environment-detected",
        handleStackDetected,
      );
    };
  }, []);

  const updateState = (
    newAtoms: Atom[],
    newBonds: Bond[],
    newTexts?: CanvasText[],
    newArrows?: CanvasArrow[],
  ) => {
    if (isReadOnly || testReadOnlyMode) return;
    setHistoryState((prev) => {
      const newHistory = prev.history.slice(0, prev.index + 1);
      const currTexts =
        newTexts !== undefined
          ? newTexts
          : prev.history[prev.index].texts || [];
      const currArrows =
        newArrows !== undefined
          ? newArrows
          : prev.history[prev.index].arrows || [];
      newHistory.push(
        JSON.parse(
          JSON.stringify({
            atoms: newAtoms,
            bonds: newBonds,
            texts: currTexts,
            arrows: currArrows,
          }),
        ),
      );
      if (newHistory.length > 50) newHistory.shift();
      return {
        history: newHistory,
        index: newHistory.length - 1,
      };
    });
    setDraftState(null);
  };

  const updateDraft = (
    newAtoms: Atom[],
    newBonds: Bond[],
    newTexts?: CanvasText[],
    newArrows?: CanvasArrow[],
  ) => {
    if (isReadOnly || testReadOnlyMode) return;
    setDraftState({
      atoms: newAtoms,
      bonds: newBonds,
      texts: newTexts !== undefined ? newTexts : texts,
      arrows: newArrows !== undefined ? newArrows : arrows,
    });
  };

  const rotateSelection = (degrees: number) => {
    if (selectedEntityIds.length === 0 || degrees === 0) return;

    const selectedAtomIds = new Set<string>();
    selectedEntityIds.forEach((id) => {
      if (atoms.some((a) => a.id === id)) selectedAtomIds.add(id);
      const bond = bonds.find((b) => b.id === id);
      if (bond) {
        selectedAtomIds.add(bond.atom1Id);
        selectedAtomIds.add(bond.atom2Id);
      }
    });

    const selectedAtomsList = atoms.filter((a) => selectedAtomIds.has(a.id));
    const selectedTextsList = texts.filter((t) =>
      selectedEntityIds.includes(t.id),
    );
    const selectedArrowsList = arrows.filter((a) =>
      selectedEntityIds.includes(a.id),
    );

    if (
      selectedAtomsList.length < 2 &&
      selectedTextsList.length === 0 &&
      selectedArrowsList.length === 0
    )
      return;

    let sumX = 0,
      sumY = 0,
      count = 0;
    selectedAtomsList.forEach((a) => {
      sumX += a.x;
      sumY += a.y;
      count++;
    });
    selectedTextsList.forEach((t) => {
      sumX += t.x;
      sumY += t.y;
      count++;
    });
    selectedArrowsList.forEach((a) => {
      sumX += a.startX + a.endX;
      sumY += a.startY + a.endY;
      count += 2;
    });

    if (count === 0) return;
    const cx = sumX / count;
    const cy = sumY / count;

    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const newAtoms = atoms.map((a) => {
      if (selectedAtomIds.has(a.id) && !a.isFixed) {
        const dx = a.x - cx;
        const dy = a.y - cy;
        return {
          ...a,
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
        };
      }
      return a;
    });

    const newTexts = texts.map((t) => {
      if (selectedEntityIds.includes(t.id) && !t.isFixed) {
        const dx = t.x - cx;
        const dy = t.y - cy;
        return {
          ...t,
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
          rotation: (t.rotation || 0) + degrees,
        };
      }
      return t;
    });

    const newArrows = arrows.map((a) => {
      if (selectedEntityIds.includes(a.id) && !a.isFixed) {
        const dx1 = a.startX - cx;
        const dy1 = a.startY - cy;
        const dx2 = a.endX - cx;
        const dy2 = a.endY - cy;
        return {
          ...a,
          startX: cx + dx1 * cos - dy1 * sin,
          startY: cy + dx1 * sin + dy1 * cos,
          endX: cx + dx2 * cos - dy2 * sin,
          endY: cy + dx2 * sin + dy2 * cos,
        };
      }
      return a;
    });

    if (draftState) {
      updateDraft(newAtoms, bonds, newTexts, newArrows);
    } else {
      updateState(newAtoms, bonds, newTexts, newArrows);
    }
  };

  const alignSelectionHorizontal = () => {
    if (selectedEntityIds.length < 2) return;

    const selectedAtomIds = new Set<string>();
    selectedEntityIds.forEach((id) => {
      if (atoms.some((a) => a.id === id)) selectedAtomIds.add(id);
      const bond = bonds.find((b) => b.id === id);
      if (bond) {
        selectedAtomIds.add(bond.atom1Id);
        selectedAtomIds.add(bond.atom2Id);
      }
    });

    const sAtoms = atoms.filter((a) => selectedAtomIds.has(a.id));
    if (sAtoms.length < 2) return;

    let maxDistSq = -1;
    let p1: Atom = sAtoms[0];
    let p2: Atom = sAtoms[1];

    for (let i = 0; i < sAtoms.length; i++) {
      for (let j = i + 1; j < sAtoms.length; j++) {
        const dx = sAtoms[j].x - sAtoms[i].x;
        const dy = sAtoms[j].y - sAtoms[i].y;
        const distSq = dx * dx + dy * dy;
        if (distSq > maxDistSq) {
          maxDistSq = distSq;
          p1 = sAtoms[i];
          p2 = sAtoms[j];
        }
      }
    }

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    // Align so the longest axis is perfectly horizontal
    const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    const degrees = -currentAngle;

    // If exactly 2 atoms are selected (or 1 bond linking them), rotate the entire
    // connected component around the midpoint of these two atoms.
    const hasOnlyTwoAtoms =
      sAtoms.length === 2 &&
      selectedEntityIds.every(
        (id) => !id.startsWith("text-") && !id.startsWith("arrow-"),
      );

    if (hasOnlyTwoAtoms) {
      const rad = (degrees * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // Find connected components encompassing these two atoms
      const componentAtomIds = new Set<string>();
      for (const startAtomId of [p1.id, p2.id]) {
        if (componentAtomIds.has(startAtomId)) continue;
        const queue = [startAtomId];
        componentAtomIds.add(startAtomId);
        while (queue.length > 0) {
          const currentId = queue.shift()!;
          const connected = bonds.filter(
            (b) => b.atom1Id === currentId || b.atom2Id === currentId,
          );
          for (const b of connected) {
            const nextId = b.atom1Id === currentId ? b.atom2Id : b.atom1Id;
            if (!componentAtomIds.has(nextId)) {
              componentAtomIds.add(nextId);
              queue.push(nextId);
            }
          }
        }
      }

      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;

      const newAtoms = atoms.map((a) => {
        if (componentAtomIds.has(a.id) && !a.isFixed) {
          const adx = a.x - cx;
          const ady = a.y - cy;
          return {
            ...a,
            x: cx + adx * cos - ady * sin,
            y: cy + adx * sin + ady * cos,
          };
        }
        return a;
      });

      if (draftState) {
        updateDraft(newAtoms, bonds, texts, arrows);
      } else {
        updateState(newAtoms, bonds, texts, arrows);
      }
    } else {
      rotateSelection(degrees);
    }
  };

  const scaleSelection = (factor: number) => {
    if (selectedEntityIds.length === 0 || factor === 1) return;

    const selectedAtomIds = new Set<string>();
    selectedEntityIds.forEach((id) => {
      if (atoms.some((a) => a.id === id)) selectedAtomIds.add(id);
      const bond = bonds.find((b) => b.id === id);
      if (bond) {
        selectedAtomIds.add(bond.atom1Id);
        selectedAtomIds.add(bond.atom2Id);
      }
    });

    const selectedAtomsList = atoms.filter((a) => selectedAtomIds.has(a.id));
    const selectedTextsList = texts.filter((t) =>
      selectedEntityIds.includes(t.id),
    );
    const selectedArrowsList = arrows.filter((a) =>
      selectedEntityIds.includes(a.id),
    );

    if (
      selectedAtomsList.length < 2 &&
      selectedTextsList.length === 0 &&
      selectedArrowsList.length === 0
    )
      return;

    let sumX = 0,
      sumY = 0,
      count = 0;
    selectedAtomsList.forEach((a) => {
      sumX += a.x;
      sumY += a.y;
      count++;
    });
    selectedTextsList.forEach((t) => {
      sumX += t.x;
      sumY += t.y;
      count++;
    });
    selectedArrowsList.forEach((a) => {
      sumX += a.startX + a.endX;
      sumY += a.startY + a.endY;
      count += 2;
    });

    if (count === 0) return;
    const cx = sumX / count;
    const cy = sumY / count;

    const newAtoms = atoms.map((a) => {
      if (selectedAtomIds.has(a.id) && !a.isFixed) {
        return {
          ...a,
          x: cx + (a.x - cx) * factor,
          y: cy + (a.y - cy) * factor,
        };
      }
      return a;
    });

    const newTexts = texts.map((t) => {
      if (selectedEntityIds.includes(t.id) && !t.isFixed) {
        return {
          ...t,
          x: cx + (t.x - cx) * factor,
          y: cy + (t.y - cy) * factor,
          size: (t.size || 1) * factor,
        };
      }
      return t;
    });

    const newArrows = arrows.map((a) => {
      if (selectedEntityIds.includes(a.id) && !a.isFixed) {
        return {
          ...a,
          startX: cx + (a.startX - cx) * factor,
          startY: cy + (a.startY - cy) * factor,
          endX: cx + (a.endX - cx) * factor,
          endY: cy + (a.endY - cy) * factor,
        };
      }
      return a;
    });

    if (draftState) {
      updateDraft(newAtoms, bonds, newTexts, newArrows);
    } else {
      updateState(newAtoms, bonds, newTexts, newArrows);
    }
  };

  const reflectSelection = (direction: "horizontal" | "vertical") => {
    if (selectedEntityIds.length === 0) return;

    const selectedAtomIds = new Set<string>();
    selectedEntityIds.forEach((id) => {
      if (atoms.some((a) => a.id === id)) selectedAtomIds.add(id);
      const bond = bonds.find((b) => b.id === id);
      if (bond) {
        selectedAtomIds.add(bond.atom1Id);
        selectedAtomIds.add(bond.atom2Id);
      }
    });

    const selectedAtomsList = atoms.filter((a) => selectedAtomIds.has(a.id));
    const selectedTextsList = texts.filter((t) =>
      selectedEntityIds.includes(t.id),
    );
    const selectedArrowsList = arrows.filter((a) =>
      selectedEntityIds.includes(a.id),
    );

    if (
      selectedAtomsList.length < 2 &&
      selectedTextsList.length === 0 &&
      selectedArrowsList.length === 0
    )
      return;

    let sumX = 0,
      sumY = 0,
      count = 0;
    selectedAtomsList.forEach((a) => {
      sumX += a.x;
      sumY += a.y;
      count++;
    });
    selectedTextsList.forEach((t) => {
      sumX += t.x;
      sumY += t.y;
      count++;
    });
    selectedArrowsList.forEach((a) => {
      sumX += a.startX + a.endX;
      sumY += a.startY + a.endY;
      count += 2;
    });

    if (count === 0) return;
    const cx = sumX / count;
    const cy = sumY / count;

    const newAtoms = atoms.map((a) => {
      if (selectedAtomIds.has(a.id) && !a.isFixed) {
        if (direction === "horizontal") {
          return { ...a, x: cx - (a.x - cx) };
        } else {
          return { ...a, y: cy - (a.y - cy) };
        }
      }
      return a;
    });

    const newTexts = texts.map((t) => {
      if (selectedEntityIds.includes(t.id) && !t.isFixed) {
        if (direction === "horizontal") {
          return { ...t, x: cx - (t.x - cx) };
        } else {
          return { ...t, y: cy - (t.y - cy) };
        }
      }
      return t;
    });

    const newArrows = arrows.map((a) => {
      if (selectedEntityIds.includes(a.id) && !a.isFixed) {
        if (direction === "horizontal") {
          return {
            ...a,
            startX: cx - (a.startX - cx),
            endX: cx - (a.endX - cx),
          };
        } else {
          return {
            ...a,
            startY: cy - (a.startY - cy),
            endY: cy - (a.endY - cy),
          };
        }
      }
      return a;
    });

    updateState(newAtoms, bonds, newTexts, newArrows);
  };

  const ensureInBounds = (atomsArray: Atom[]) => {
    if (atomsArray.length === 0) return atomsArray;
    const svgArea = svgRef.current?.getBoundingClientRect();
    if (!svgArea) return atomsArray;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    atomsArray.forEach((a) => {
      minX = Math.min(minX, a.x);
      maxX = Math.max(maxX, a.x);
      minY = Math.min(minY, a.y);
      maxY = Math.max(maxY, a.y);
    });

    const margin = 50;
    const width = maxX - minX;
    const height = maxY - minY;

    const availableW = svgArea.width / scale;
    const availableH = svgArea.height / scale;

    let shiftX = 0;
    let shiftY = 0;

    if (minX < margin) shiftX = margin - minX;
    else if (maxX > availableW - margin) shiftX = availableW - margin - maxX;

    if (minY < margin) shiftY = margin - minY;
    else if (maxY > availableH - margin) shiftY = availableH - margin - maxY;

    if (width > availableW - 2 * margin)
      shiftX = availableW / 2 - (minX + maxX) / 2;
    if (height > availableH - 2 * margin)
      shiftY = availableH / 2 - (minY + maxY) / 2;

    if (shiftX !== 0 || shiftY !== 0) {
      return atomsArray.map((a) => ({
        ...a,
        x: a.x + shiftX,
        y: a.y + shiftY,
      }));
    }
    return atomsArray;
  };

  const toggleCisTrans = () => {
    const selectedBonds = bonds.filter((b) => selectedEntityIds.includes(b.id));
    if (selectedBonds.length !== 1) return;
    const selectedBond = selectedBonds[0];

    // Find all atoms on one side of the bond (atom2 side)
    const visited = new Set<string>();
    visited.add(selectedBond.atom1Id);

    const sideMembers = new Set<string>();
    const stack = [selectedBond.atom2Id];
    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      sideMembers.add(curr);

      const adj = bonds.filter((b) => b.atom1Id === curr || b.atom2Id === curr);
      adj.forEach((b) => {
        const other = b.atom1Id === curr ? b.atom2Id : b.atom1Id;
        if (!visited.has(other)) stack.push(other);
      });
    }

    const a1 = atoms.find((a) => a.id === selectedBond.atom1Id);
    const a2 = atoms.find((a) => a.id === selectedBond.atom2Id);
    if (!a1 || !a2) return;

    const dx = a2.x - a1.x;
    const dy = a2.y - a1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return;

    const newAtoms = atoms.map((a) => {
      if (sideMembers.has(a.id)) {
        const vx = a.x - a1.x;
        const vy = a.y - a1.y;

        const dot = (vx * dx + vy * dy) / lenSq;
        const projx = dx * dot;
        const projy = dy * dot;

        const perpx = vx - projx;
        const perpy = vy - projy;

        return {
          ...a,
          x: a1.x + projx - perpx,
          y: a1.y + projy - perpy,
        };
      }
      return a;
    });

    // Auto-straighten the rotated molecule
    // 1. Find all atoms in the connected component of the bond
    const componentAtomIds = new Set<string>();
    const queue = [selectedBond.atom1Id];
    componentAtomIds.add(selectedBond.atom1Id);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const connected = bonds.filter(
        (b) => b.atom1Id === currentId || b.atom2Id === currentId,
      );
      for (const b of connected) {
        const nextId = b.atom1Id === currentId ? b.atom2Id : b.atom1Id;
        if (!componentAtomIds.has(nextId)) {
          componentAtomIds.add(nextId);
          queue.push(nextId);
        }
      }
    }

    const cAtoms = newAtoms.filter((a) => componentAtomIds.has(a.id));

    // 2. Find the longest axis within this connected component
    if (cAtoms.length >= 2) {
      let maxDistSq = -1;
      let p1: Atom = cAtoms[0];
      let p2: Atom = cAtoms[1];

      for (let i = 0; i < cAtoms.length; i++) {
        for (let j = i + 1; j < cAtoms.length; j++) {
          const dx_ = cAtoms[j].x - cAtoms[i].x;
          const dy_ = cAtoms[j].y - cAtoms[i].y;
          const distSq = dx_ * dx_ + dy_ * dy_;
          if (distSq > maxDistSq) {
            maxDistSq = distSq;
            p1 = cAtoms[i];
            p2 = cAtoms[j];
          }
        }
      }

      // 3. Calculate rotation angle to make this longest axis perfectly horizontal
      const bx = p2.x - p1.x;
      const by = p2.y - p1.y;
      const currentAngle = Math.atan2(by, bx) * (180 / Math.PI);
      const degrees = -currentAngle;
      const rad = (degrees * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // 4. Find the center of the molecule
      let cx = 0;
      let cy = 0;
      cAtoms.forEach((a) => {
        cx += a.x;
        cy += a.y;
      });
      cx /= cAtoms.length;
      cy /= cAtoms.length;

      // 5. Rotate the molecule
      const finalAtoms = newAtoms.map((a) => {
        if (componentAtomIds.has(a.id)) {
          const adx = a.x - cx;
          const ady = a.y - cy;
          return {
            ...a,
            x: cx + adx * cos - ady * sin,
            y: cy + adx * sin + ady * cos,
          };
        }
        return a;
      });

      updateState(ensureInBounds(finalAtoms), bonds);
    } else {
      updateState(ensureInBounds(newAtoms), bonds);
    }
  };

  const undo = () => {
    if (isReadOnly || testReadOnlyMode) return;
    setHistoryState((prev) => {
      if (prev.index > 0) return { ...prev, index: prev.index - 1 };
      return prev;
    });
    setDraftState(null);
  };

  const redo = () => {
    if (isReadOnly || testReadOnlyMode) return;
    setHistoryState((prev) => {
      if (prev.index < prev.history.length - 1)
        return { ...prev, index: prev.index + 1 };
      return prev;
    });
    setDraftState(null);
  };

  const getSvgCoords = (
    e: React.PointerEvent | PointerEvent | React.MouseEvent | MouseEvent,
  ) => {
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

  const [textPrompt, setTextPrompt] = useState<{
    id?: string;
    x?: number;
    y?: number;
    initialValue: string;
    initialSize: number;
  } | null>(null);

  const handleSvgPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (isReadOnly || testReadOnlyMode) return;
    const { x, y } = getSvgCoords(e);

    if (mode === "text") {
      setTextPrompt({ x, y, initialValue: "", initialSize: 1 });
    } else if (mode === "arrow") {
      dragStartArrowRef.current = { x, y };
      setDragStartArrow({ x, y });
    } else if (mode === "atom" || mode === "chain") {
      const newAtom: Atom = {
        id: crypto.randomUUID(),
        symbol: selectedElement,
        x,
        y,
        lonePairs: 0,
        charge: 0,
        color: customColorsRef.current[selectedElement],
      };
      updateState([...atoms, newAtom], bonds);
      setSelectedEntityIds([newAtom.id]);
      if (mode === "chain") {
        dragStartAtomRef.current = newAtom.id;
        setDragStartAtom(newAtom.id);
      }
    } else if (mode !== "select") {
      setMode("select");
    } else if (mode === "select") {
      selectionBoxStartRef.current = { x, y };
      setSelectionBoxStart({ x, y });
      setSelectionBoxCurrent({ x, y });
      const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!isMulti) {
        setSelectedEntityIds([]);
      }
    }
  };

  const handleSvgPointerUp = (e: React.PointerEvent) => {
    // Moved to handleGlobalPointerUp to ensure we don't drop interactions outside SVG
  };

  const handleAtomPointerDown = (e: React.PointerEvent, atomId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReadOnly || testReadOnlyMode) return;

    if (mode === "select") {
      const isMulti =
        e.shiftKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.pointerType === "touch" ||
        e.pointerType === "pen";

      let idsToDrag = selectedEntityIds.includes(atomId)
        ? selectedEntityIds.filter((id) => atoms.some((a) => a.id === id))
        : [atomId];
      if (!selectedEntityIds.includes(atomId)) {
        if (isMulti) {
          idsToDrag = [...selectedEntityIds, atomId];
          setSelectedEntityIds(idsToDrag);
        } else {
          setSelectedEntityIds([atomId]);
        }
      }
      setDraggingAtomIds(idsToDrag.filter((id) => !isEntityFixed(id)));
      dragInitialMouseRef.current = getSvgCoords(e);
      dragInitialAtomsRef.current = atoms.filter((a) =>
        idsToDrag.includes(a.id),
      );
      dragInitialTextsRef.current = texts.filter((t) =>
        idsToDrag.includes(t.id),
      );
      dragInitialArrowsRef.current = arrows.filter((a) =>
        idsToDrag.includes(a.id),
      );
      dragHasMovedRef.current = false;
      pointerDownClickInfoRef.current = {
        id: atomId,
        wasSelected: selectedEntityIds.includes(atomId),
        isMulti,
      };
    } else if (mode === "bond" || mode === "atom" || mode === "chain") {
      if (isEntityFixed(atomId)) return;
      setSelectedEntityIds([atomId]);
      dragStartAtomRef.current = atomId;
      setDragStartAtom(atomId);
    } else if (mode === "erase") {
      if (isEntityFixed(atomId)) return;
      setSelectedEntityIds([atomId]);
      updateState(
        atoms.filter((a) => a.id !== atomId),
        bonds.filter((b) => b.atom1Id !== atomId && b.atom2Id !== atomId),
      );
      if (selectedEntityIds.includes(atomId))
        setSelectedEntityIds(selectedEntityIds.filter((id) => id !== atomId));
    } else if (mode === "lone-pair") {
      if (isEntityFixed(atomId)) return;
      setSelectedEntityIds([atomId]);
      updateState(
        atoms.map((a) =>
          a.id === atomId ? { ...a, lonePairs: (a.lonePairs + 1) % 5 } : a,
        ),
        bonds,
      );
    } else if (mode === "single-electron") {
      if (isEntityFixed(atomId)) return;
      setSelectedEntityIds([atomId]);
      updateState(
        atoms.map((a) =>
          a.id === atomId
            ? { ...a, singleElectrons: ((a.singleElectrons || 0) + 1) % 5 }
            : a,
        ),
        bonds,
      );
    } else if (mode === "charge") {
      if (isEntityFixed(atomId)) return;
      setSelectedEntityIds([atomId]);
      updateState(
        atoms.map((a) => {
          if (a.id !== atomId) return a;
          let newCharge = a.charge === 0 ? 1 : a.charge === 1 ? -1 : 0;
          return { ...a, charge: newCharge };
        }),
        bonds,
      );
    }
  };

  const handleBondPointerDown = (e: React.PointerEvent, bondId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReadOnly || testReadOnlyMode) return;

    if (mode === "erase") {
      if (isEntityFixed(bondId)) return;
      updateState(
        atoms,
        bonds.filter((b) => b.id !== bondId),
        texts,
        arrows,
      );
      if (selectedEntityIds.includes(bondId))
        setSelectedEntityIds(selectedEntityIds.filter((id) => id !== bondId));
    } else {
      if (isEntityFixed(bondId)) {
        // Just select it but don't toggle order
        setSelectedEntityIds([bondId]);
        return;
      }
      setSelectedEntityIds([bondId]);

      const targetBond = bonds.find((b) => b.id === bondId);
      if (targetBond) {
        if (targetBond.order === 4 || targetBond.order === 5) {
          updateState(
            atoms,
            bonds.map((b) =>
              b.id === bondId
                ? {
                    ...b,
                    atom1Id: b.atom2Id,
                    atom2Id: b.atom1Id,
                  }
                : b,
            ),
            texts,
            arrows,
          );
          return;
        }

        const a1 = atoms.find((a) => a.id === targetBond.atom1Id);
        const a2 = atoms.find((a) => a.id === targetBond.atom2Id);
        const hasH = a1?.symbol === "H" || a2?.symbol === "H";

        if (hasH) {
          setShowValencyWarnings(true);
          return;
        }
      }

      updateState(
        atoms,
        bonds.map((b) =>
          b.id === bondId
            ? {
                ...b,
                order:
                  b.order === 1 ? 2 : b.order === 2 ? 3 : b.order === 3 ? 1 : 1,
              }
            : b,
        ),
        texts,
        arrows,
      );
    }
  };

  const handleArrowPointerDown = (e: React.PointerEvent, arrowId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReadOnly || testReadOnlyMode) return;

    if (mode === "erase") {
      if (isEntityFixed(arrowId)) return;
      updateState(
        atoms,
        bonds,
        texts,
        arrows.filter((a) => a.id !== arrowId),
      );
      if (selectedEntityIds.includes(arrowId))
        setSelectedEntityIds(selectedEntityIds.filter((id) => id !== arrowId));
    } else {
      // Allow dragging arrows no matter what mode we are in
      let idsToDrag = [arrowId];
      const isMulti =
        e.shiftKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.pointerType === "touch" ||
        e.pointerType === "pen";
      if (selectedEntityIds.includes(arrowId)) {
        idsToDrag = selectedEntityIds;
      } else {
        if (!isMulti) {
          setSelectedEntityIds([arrowId]);
        } else {
          setSelectedEntityIds([...selectedEntityIds, arrowId]);
          idsToDrag = [...selectedEntityIds, arrowId];
        }
      }
      setDraggingAtomIds(idsToDrag.filter((id) => !isEntityFixed(id)));
      dragInitialMouseRef.current = getSvgCoords(e);
      dragInitialAtomsRef.current = atoms.filter((a) =>
        idsToDrag.includes(a.id),
      );
      dragInitialTextsRef.current = texts.filter((t) =>
        idsToDrag.includes(t.id),
      );
      dragInitialArrowsRef.current = arrows.filter((a) =>
        idsToDrag.includes(a.id),
      );
      dragHasMovedRef.current = false;
      pointerDownClickInfoRef.current = {
        id: arrowId,
        wasSelected: selectedEntityIds.includes(arrowId),
        isMulti,
      };
      if (mode !== "select") setMode("select");
    }
  };

  const handleTextPointerDown = (e: React.PointerEvent, textId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReadOnly || testReadOnlyMode) return;

    if (mode === "erase") {
      if (isEntityFixed(textId)) return;
      updateState(
        atoms,
        bonds,
        texts.filter((t) => t.id !== textId),
        arrows,
      );
      if (selectedEntityIds.includes(textId))
        setSelectedEntityIds(selectedEntityIds.filter((id) => id !== textId));
    } else if (mode === "text") {
      const txt = texts.find((t) => t.id === textId);
      if (txt) {
        setTextPrompt({
          id: textId,
          initialValue: txt.text,
          initialSize: txt.size || 1,
        });
      }
    } else {
      let idsToDrag = [textId];
      const isMulti =
        e.shiftKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.pointerType === "touch" ||
        e.pointerType === "pen";
      if (selectedEntityIds.includes(textId)) {
        idsToDrag = selectedEntityIds;
      } else {
        if (!isMulti) {
          setSelectedEntityIds([textId]);
        } else {
          setSelectedEntityIds([...selectedEntityIds, textId]);
          idsToDrag = [...selectedEntityIds, textId];
        }
      }
      setDraggingAtomIds(idsToDrag.filter((id) => !isEntityFixed(id)));
      dragInitialMouseRef.current = getSvgCoords(e);
      dragInitialAtomsRef.current = atoms.filter((a) =>
        idsToDrag.includes(a.id),
      );
      dragInitialTextsRef.current = texts.filter((t) =>
        idsToDrag.includes(t.id),
      );
      dragInitialArrowsRef.current = arrows.filter((a) =>
        idsToDrag.includes(a.id),
      );
      dragHasMovedRef.current = false;
      pointerDownClickInfoRef.current = {
        id: textId,
        wasSelected: selectedEntityIds.includes(textId),
        isMulti,
      };
      if (mode !== "select") setMode("select");
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

        const newAtoms = stateRef.current.atoms.map((a) => {
          if (draggingAtomIds.includes(a.id)) {
            const initAtom = dragInitialAtomsRef.current.find(
              (ia) => ia.id === a.id,
            );
            if (initAtom) {
              return { ...a, x: initAtom.x + dx, y: initAtom.y + dy };
            }
          }
          return a;
        });

        const newTexts =
          stateRef.current.texts?.map((t) => {
            if (draggingAtomIds.includes(t.id)) {
              const initText = dragInitialTextsRef.current.find(
                (ia) => ia.id === t.id,
              );
              if (initText) {
                return { ...t, x: initText.x + dx, y: initText.y + dy };
              }
            }
            return t;
          }) ?? [];

        const newArrows =
          stateRef.current.arrows?.map((ar) => {
            if (draggingAtomIds.includes(ar.id)) {
              const initArrow = dragInitialArrowsRef.current.find(
                (ia) => ia.id === ar.id,
              );
              if (initArrow) {
                return {
                  ...ar,
                  startX: initArrow.startX + dx,
                  startY: initArrow.startY + dy,
                  endX: initArrow.endX + dx,
                  endY: initArrow.endY + dy,
                };
              }
            }
            return ar;
          }) ?? [];

        updateDraft(newAtoms, stateRef.current.bonds, newTexts, newArrows);
      } else if (selectionBoxStartRef.current) {
        setSelectionBoxCurrent(coords);
      }
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      const coords = getSvgCoords(e);

      if (draggingAtomIds.length > 0) {
        if (dragHasMovedRef.current && draftStateRef.current) {
          updateState(
            draftStateRef.current.atoms,
            draftStateRef.current.bonds,
            draftStateRef.current.texts,
            draftStateRef.current.arrows,
          );
        } else if (
          !dragHasMovedRef.current &&
          pointerDownClickInfoRef.current
        ) {
          const { id, wasSelected, isMulti } = pointerDownClickInfoRef.current;
          if (wasSelected) {
            if (isMulti) {
              setSelectedEntityIds((prev) => prev.filter((x) => x !== id));
            } else {
              setSelectedEntityIds([id]);
            }
          }
        }
        setDraggingAtomIds([]);
        pointerDownClickInfoRef.current = null;
      }

      if (selectionBoxStartRef.current) {
        const start = selectionBoxStartRef.current;
        const minX = Math.min(start.x, coords.x);
        const maxX = Math.max(start.x, coords.x);
        const minY = Math.min(start.y, coords.y);
        const maxY = Math.max(start.y, coords.y);

        const width = maxX - minX;
        const height = maxY - minY;
        const isTap = width < 5 && height < 5;

        const selectedAtoms = stateRef.current.atoms
          .filter(
            (a) => a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY,
          )
          .map((a) => a.id);

        const selectedBonds = stateRef.current.bonds
          .filter((b) => {
            const a1 = stateRef.current.atoms.find((a) => a.id === b.atom1Id);
            const a2 = stateRef.current.atoms.find((a) => a.id === b.atom2Id);
            if (!a1 || !a2) return false;
            return (
              a1.x >= minX &&
              a1.x <= maxX &&
              a1.y >= minY &&
              a1.y <= maxY &&
              a2.x >= minX &&
              a2.x <= maxX &&
              a2.y >= minY &&
              a2.y <= maxY
            );
          })
          .map((b) => b.id);

        const selectedTexts = (stateRef.current.texts || [])
          .filter(
            (t) => t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY,
          )
          .map((t) => t.id);

        const selectedArrows = (stateRef.current.arrows || [])
          .filter(
            (a) =>
              a.startX >= minX &&
              a.startX <= maxX &&
              a.startY >= minY &&
              a.startY <= maxY &&
              a.endX >= minX &&
              a.endX <= maxX &&
              a.endY >= minY &&
              a.endY <= maxY,
          )
          .map((a) => a.id);

        const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;

        if (isTap && (e.pointerType === "touch" || e.pointerType === "pen")) {
          // touch tap on empty space clears selection!
          setSelectedEntityIds([]);
        } else if (isMulti) {
          setSelectedEntityIds((prev) =>
            Array.from(
              new Set([
                ...prev,
                ...selectedAtoms,
                ...selectedBonds,
                ...selectedTexts,
                ...selectedArrows,
              ]),
            ),
          );
        } else {
          setSelectedEntityIds([
            ...selectedAtoms,
            ...selectedBonds,
            ...selectedTexts,
            ...selectedArrows,
          ]);
        }

        selectionBoxStartRef.current = null;
        setSelectionBoxStart(null);
        setSelectionBoxCurrent(null);
      }

      if (dragStartArrowRef.current) {
        const start = dragStartArrowRef.current;
        const dist = Math.hypot(coords.x - start.x, coords.y - start.y);
        if (dist > 15) {
          const newArrow: CanvasArrow = {
            id: crypto.randomUUID(),
            startX: start.x,
            startY: start.y,
            endX: coords.x,
            endY: coords.y,
          };
          updateState(
            stateRef.current.atoms,
            stateRef.current.bonds,
            stateRef.current.texts,
            [...stateRef.current.arrows, newArrow],
          );
        }
        dragStartArrowRef.current = null;
        setDragStartArrow(null);
      }

      if (dragStartAtomRef.current) {
        // Find if we released over an existing atom (for touch support)
        const targetAtom = stateRef.current.atoms.find((a) => {
          const d = Math.hypot(coords.x - a.x, coords.y - a.y);
          return (
            d < getAtomRadius(a.symbol) + 15 &&
            a.id !== dragStartAtomRef.current
          );
        });

        if (targetAtom) {
          if (targetAtom.isFixed) {
            dragStartAtomRef.current = null;
            setDragStartAtom(null);
            return;
          }
          // Create bond between start and target
          const startId = dragStartAtomRef.current;
          const targetId = targetAtom.id;

          const startAtomObj = stateRef.current.atoms.find(
            (a) => a.id === startId,
          );
          const hasH =
            startAtomObj?.symbol === "H" || targetAtom.symbol === "H";

          const existingBondIndex = stateRef.current.bonds.findIndex(
            (b) =>
              (b.atom1Id === startId && b.atom2Id === targetId) ||
              (b.atom1Id === targetId && b.atom2Id === startId),
          );

          if (existingBondIndex >= 0) {
            if (hasH) {
              setShowValencyWarnings(true);
            } else {
              const newBonds = [...stateRef.current.bonds];
              const curOrder = newBonds[existingBondIndex].order;
              if (curOrder === 4 || curOrder === 5) {
                newBonds[existingBondIndex] = {
                  ...newBonds[existingBondIndex],
                  atom1Id: newBonds[existingBondIndex].atom2Id,
                  atom2Id: newBonds[existingBondIndex].atom1Id,
                };
              } else {
                newBonds[existingBondIndex] = {
                  ...newBonds[existingBondIndex],
                  order:
                    curOrder === 1
                      ? 2
                      : curOrder === 2
                        ? 3
                        : curOrder === 3
                          ? 1
                          : 1,
                };
              }

              // Remove excess hydrogens if valency exceeded
              const cleaned = removeExcessHydrogens(
                stateRef.current.atoms,
                newBonds,
              );

              updateState(cleaned.atoms, cleaned.bonds);
              setSelectedEntityIds([newBonds[existingBondIndex].id]);
            }
          } else {
            if (hasH && selectedBondOrderRef.current > 1) {
              setShowValencyWarnings(true);
            }
            const newBond: Bond = {
              id: crypto.randomUUID(),
              atom1Id: startId,
              atom2Id: targetId,
              order: hasH
                ? 1
                : selectedBondOrderRef.current === 0
                  ? 1
                  : selectedBondOrderRef.current,
            };
            updateState(stateRef.current.atoms, [
              ...stateRef.current.bonds,
              newBond,
            ]);
            setSelectedEntityIds([newBond.id]);
          }
        } else if (modeRef.current === "chain") {
          const startAtom = stateRef.current.atoms.find(
            (a) => a.id === dragStartAtomRef.current,
          );
          if (startAtom) {
            const dx = coords.x - startAtom.x;
            const dy = coords.y - startAtom.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 20) {
              const B = 35;
              const projectedLength = B * Math.cos(Math.PI / 6);
              const numBonds = Math.max(1, Math.round(dist / projectedLength));
              const axisAngle = Math.atan2(dy, dx);

              let currentPt = { x: startAtom.x, y: startAtom.y };
              let goingUp = true;

              let newAtoms: Atom[] = [];
              let newBonds: Bond[] = [];

              let lastAtomId = startAtom.id;

              for (let i = 0; i < numBonds; i++) {
                const bondAngle =
                  axisAngle + (goingUp ? Math.PI / 6 : -Math.PI / 6);
                const nextX = currentPt.x + B * Math.cos(bondAngle);
                const nextY = currentPt.y + B * Math.sin(bondAngle);

                const newAtomId = crypto.randomUUID();
                newAtoms.push({
                  id: newAtomId,
                  symbol: selectedElementRef.current,
                  x: nextX,
                  y: nextY,
                  charge: 0,
                  lonePairs: 0,
                });
                newBonds.push({
                  id: crypto.randomUUID(),
                  atom1Id: lastAtomId,
                  atom2Id: newAtomId,
                  order: selectedBondOrderRef.current,
                });

                lastAtomId = newAtomId;
                currentPt = { x: nextX, y: nextY };
                goingUp = !goingUp;
              }

              if (chainTypeRef.current === "fatty-acid") {
                const incomingAngle =
                  axisAngle + (!goingUp ? Math.PI / 6 : -Math.PI / 6);

                // Usually a carboxyl is drawn in a fork.
                // We tilt them up and down by about 60 degrees ( PI/3 ) from the incoming bond direction.
                // Wait, the incoming bond came AT the last atom from the reversed angle. The direction strictly forward is `incomingAngle`.
                // So the new bonds should go forward. Let's make them fork from incomingAngle by +/- PI/3.

                // Double bonded O
                const angleO = incomingAngle - Math.PI / 3;
                const oBaseX = currentPt.x + B * Math.cos(angleO);
                const oBaseY = currentPt.y + B * Math.sin(angleO);

                const idO1 = crypto.randomUUID();
                newAtoms.push({
                  id: idO1,
                  symbol: "O",
                  x: oBaseX,
                  y: oBaseY,
                  charge: 0,
                  lonePairs: 2,
                });
                newBonds.push({
                  id: crypto.randomUUID(),
                  atom1Id: lastAtomId,
                  atom2Id: idO1,
                  order: 2,
                });

                // Single bonded OH. In our system, usually we just add O and user adds H, or we just put OH text.
                // Now updated to add explicit H bonded to the O.
                const angleOH = incomingAngle + Math.PI / 3;
                const oBaseX2 = currentPt.x + B * Math.cos(angleOH);
                const oBaseY2 = currentPt.y + B * Math.sin(angleOH);

                const idO2 = crypto.randomUUID();
                newAtoms.push({
                  id: idO2,
                  symbol: "O",
                  x: oBaseX2,
                  y: oBaseY2,
                  charge: 0,
                  lonePairs: 2,
                });
                newBonds.push({
                  id: crypto.randomUUID(),
                  atom1Id: lastAtomId,
                  atom2Id: idO2,
                  order: 1,
                });

                const idH = crypto.randomUUID();
                const hBaseX = oBaseX2 + B * Math.cos(angleOH);
                const hBaseY = oBaseY2 + B * Math.sin(angleOH);
                newAtoms.push({
                  id: idH,
                  symbol: "H",
                  x: hBaseX,
                  y: hBaseY,
                  charge: 0,
                  lonePairs: 0,
                });
                newBonds.push({
                  id: crypto.randomUUID(),
                  atom1Id: idO2,
                  atom2Id: idH,
                  order: 1,
                });
              }

              updateState(
                [...stateRef.current.atoms, ...newAtoms],
                [...stateRef.current.bonds, ...newBonds],
              );
              setSelectedEntityIds([
                startAtom.id,
                ...newAtoms.map((a) => a.id),
                ...newBonds.map((b) => b.id),
              ]);
            } else {
              updateState(
                stateRef.current.atoms.map((a) =>
                  a.id === dragStartAtomRef.current
                    ? { ...a, symbol: selectedElementRef.current }
                    : a,
                ),
                stateRef.current.bonds,
              );
            }
          }
        } else if (modeRef.current === "atom" || modeRef.current === "bond") {
          // Create new atom and bond, or change symbol if clicked
          const startAtom = stateRef.current.atoms.find(
            (a) => a.id === dragStartAtomRef.current,
          );
          if (startAtom) {
            const dist = Math.hypot(
              coords.x - startAtom.x,
              coords.y - startAtom.y,
            );
            if (dist > 35) {
              const hasH =
                startAtom.symbol === "H" || selectedElementRef.current === "H";
              if (hasH && selectedBondOrderRef.current > 1) {
                setShowValencyWarnings(true);
              }
              const newAtom: Atom = {
                id: crypto.randomUUID(),
                symbol: selectedElementRef.current,
                x: coords.x,
                y: coords.y,
                lonePairs: 0,
                charge: 0,
                color: customColorsRef.current[selectedElementRef.current],
              };
              const newBond: Bond = {
                id: crypto.randomUUID(),
                atom1Id: dragStartAtomRef.current,
                atom2Id: newAtom.id,
                order: hasH
                  ? 1
                  : selectedBondOrderRef.current === 0
                    ? 1
                    : selectedBondOrderRef.current,
              };
              updateState(
                [...stateRef.current.atoms, newAtom],
                [...stateRef.current.bonds, newBond],
              );
              setSelectedEntityIds([newBond.id]);
            } else if (modeRef.current === "atom") {
              const selectedEl = selectedElementRef.current;

              if (selectedEl === "H") {
                const currentAtoms = stateRef.current.atoms;
                const currentBonds = stateRef.current.bonds;

                const connectedBonds = currentBonds.filter(
                  (b) =>
                    b.atom1Id === startAtom.id || b.atom2Id === startAtom.id,
                );
                const nonHBondAngles: number[] = [];
                const explicitHAtoms: Atom[] = [];

                connectedBonds.forEach((b) => {
                  const otherId =
                    b.atom1Id === startAtom.id ? b.atom2Id : b.atom1Id;
                  const other = currentAtoms.find((a) => a.id === otherId);
                  if (other) {
                    if (other.symbol === "H") {
                      explicitHAtoms.push(other);
                    } else {
                      nonHBondAngles.push(
                        Math.atan2(
                          other.y - startAtom.y,
                          other.x - startAtom.x,
                        ),
                      );
                    }
                  }
                });

                let angles: number[] = [];
                const hCount = explicitHAtoms.length + 1;

                if (nonHBondAngles.length === 0) {
                  if (hCount === 1) angles = [0];
                  else if (hCount === 2) angles = [0, Math.PI];
                  else if (hCount === 3)
                    angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
                  else if (hCount === 4)
                    angles = [
                      Math.PI / 4,
                      (3 * Math.PI) / 4,
                      (-3 * Math.PI) / 4,
                      -Math.PI / 4,
                    ];
                  else {
                    for (let i = 0; i < hCount; i++)
                      angles.push((i * 2 * Math.PI) / hCount);
                  }
                } else if (nonHBondAngles.length === 1) {
                  const a = nonHBondAngles[0];
                  if (hCount === 1) angles = [a + Math.PI];
                  else if (hCount === 2)
                    angles = [
                      a + Math.PI - Math.PI / 3,
                      a + Math.PI + Math.PI / 3,
                    ];
                  else if (hCount === 3)
                    angles = [
                      a + Math.PI,
                      a + Math.PI - (70 * Math.PI) / 180,
                      a + Math.PI + (70 * Math.PI) / 180,
                    ];
                  else {
                    const spread = Math.PI;
                    for (let i = 0; i < hCount; i++)
                      angles.push(
                        a + Math.PI - spread / 2 + (i / (hCount - 1)) * spread,
                      );
                  }
                } else {
                  const sorted = [...nonHBondAngles].sort((a, b) => a - b);
                  let maxGap = -1;
                  let bisector = 0;
                  for (let i = 0; i < sorted.length; i++) {
                    const next = sorted[(i + 1) % sorted.length];
                    let diff = next - sorted[i];
                    if (diff <= 0) diff += 2 * Math.PI;
                    if (diff > maxGap) {
                      maxGap = diff;
                      bisector = sorted[i] + diff / 2;
                    }
                  }
                  if (hCount === 1) angles = [bisector];
                  else if (hCount === 2) {
                    const sep = (55 * Math.PI) / 180;
                    angles = [bisector - sep / 2, bisector + sep / 2];
                  } else {
                    const spread = Math.min(maxGap * 0.8, Math.PI);
                    for (let i = 0; i < hCount; i++)
                      angles.push(
                        bisector - spread / 2 + (i / (hCount - 1)) * spread,
                      );
                  }
                }

                const dist = 35;
                const newAtom: Atom = {
                  id: crypto.randomUUID(),
                  symbol: "H",
                  x: startAtom.x + Math.cos(angles[hCount - 1]) * dist,
                  y: startAtom.y + Math.sin(angles[hCount - 1]) * dist,
                  lonePairs: 0,
                  charge: 0,
                  color: customColorsRef.current["H"],
                };

                const newBond: Bond = {
                  id: crypto.randomUUID(),
                  atom1Id: startAtom.id,
                  atom2Id: newAtom.id,
                  order: 1,
                };

                const updatedAtoms = currentAtoms.map((a) => {
                  const idx = explicitHAtoms.findIndex((eh) => eh.id === a.id);
                  if (idx !== -1) {
                    return {
                      ...a,
                      x: startAtom.x + Math.cos(angles[idx]) * dist,
                      y: startAtom.y + Math.sin(angles[idx]) * dist,
                    };
                  }
                  return a;
                });

                updateState(
                  [...updatedAtoms, newAtom],
                  [...currentBonds, newBond],
                );
              } else {
                // Clicked on the same atom, update its symbol
                updateState(
                  stateRef.current.atoms.map((a) =>
                    a.id === dragStartAtomRef.current && !a.isFixed
                      ? {
                          ...a,
                          symbol: selectedElementRef.current,
                          color:
                            customColorsRef.current[selectedElementRef.current],
                        }
                      : a,
                  ),
                  stateRef.current.bonds,
                );
              }
            }
          }
        }
      }

      dragStartAtomRef.current = null;
      setDragStartAtom(null);
    };

    window.addEventListener("pointermove", handleGlobalPointerMove);
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointermove", handleGlobalPointerMove);
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [draggingAtomIds]);

  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      // Prevent default if in our app, unless modifying an input
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedEntityIds.length > 0
      ) {
        const deletedAtomIds = atoms
          .filter((a) => selectedEntityIds.includes(a.id) && !a.isFixed)
          .map((a) => a.id);
        const newAtoms = atoms.filter((a) => !deletedAtomIds.includes(a.id));
        const newBonds = bonds.filter(
          (b) =>
            (!selectedEntityIds.includes(b.id) || b.isFixed) &&
            !deletedAtomIds.includes(b.atom1Id) &&
            !deletedAtomIds.includes(b.atom2Id),
        );
        const newTexts = texts.filter(
          (t) => !selectedEntityIds.includes(t.id) || t.isFixed,
        );
        const newArrows = arrows.filter(
          (a) => !selectedEntityIds.includes(a.id) || a.isFixed,
        );
        updateState(newAtoms, newBonds, newTexts, newArrows);
        setSelectedEntityIds([]);
      }

      const isMac = navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;
      const isShortcut = isMac ? e.metaKey : e.ctrlKey;
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [atoms, bonds, selectedEntityIds]);

  const isEntityFixed = (id: string) => {
    return (
      atoms.find((a) => a.id === id)?.isFixed ||
      bonds.find((b) => b.id === id)?.isFixed ||
      texts.find((t) => t.id === id)?.isFixed ||
      arrows.find((a) => a.id === id)?.isFixed ||
      false
    );
  };

  const handleMenuCopy = () => {
    const {
      atoms: currentAtoms,
      bonds: currentBonds,
      texts: currentTexts,
      arrows: currentArrows,
    } = stateRef.current;
    const selected = selectedEntityIdsRef.current;

    let atomsToCopy = currentAtoms;
    let bondsToCopy = currentBonds;
    let textsToCopy = currentTexts;
    let arrowsToCopy = currentArrows;

    if (selected.length > 0) {
      const selectedAtomIds = new Set<string>();
      const selectedBondIds = new Set<string>();
      const selectedTextIds = new Set<string>();
      const selectedArrowIds = new Set<string>();

      selected.forEach((id) => {
        if (currentAtoms.some((a) => a.id === id)) selectedAtomIds.add(id);
        else if (currentBonds.some((b) => b.id === id)) selectedBondIds.add(id);
        else if (currentTexts.some((t) => t.id === id)) selectedTextIds.add(id);
        else if (currentArrows.some((a) => a.id === id))
          selectedArrowIds.add(id);
      });

      selectedBondIds.forEach((bondId) => {
        const bond = currentBonds.find((b) => b.id === bondId);
        if (bond) {
          selectedAtomIds.add(bond.atom1Id);
          selectedAtomIds.add(bond.atom2Id);
        }
      });

      atomsToCopy = currentAtoms.filter((a) => selectedAtomIds.has(a.id));
      bondsToCopy = currentBonds.filter(
        (b) => selectedAtomIds.has(b.atom1Id) && selectedAtomIds.has(b.atom2Id),
      );
      textsToCopy = currentTexts.filter((t) => selectedTextIds.has(t.id));
      arrowsToCopy = currentArrows.filter((a) => selectedArrowIds.has(a.id));
    }

    const copyPayload = JSON.stringify({
      visual: {
        atoms: atomsToCopy,
        bonds: bondsToCopy,
        texts: textsToCopy,
        arrows: arrowsToCopy,
      },
    });

    if (navigator.clipboard) {
      navigator.clipboard.writeText(copyPayload).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleMenuPaste = async () => {
    if (!navigator.clipboard) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (parsed && parsed.visual) {
        const {
          atoms: currentAtoms,
          bonds: currentBonds,
          texts: currentTexts,
          arrows: currentArrows,
        } = stateRef.current;
        const pasteAtoms: Atom[] = parsed.visual.atoms || [];
        const pasteBonds: Bond[] = parsed.visual.bonds || [];
        const pasteTexts: CanvasText[] = parsed.visual.texts || [];
        const pasteArrows: CanvasArrow[] = parsed.visual.arrows || [];

        let cx = 0,
          cy = 0;
        if (pasteAtoms.length > 0) {
          cx = pasteAtoms.reduce((sum, a) => sum + a.x, 0) / pasteAtoms.length;
          cy = pasteAtoms.reduce((sum, a) => sum + a.y, 0) / pasteAtoms.length;
        } else if (pasteTexts.length > 0) {
          cx = pasteTexts.reduce((sum, t) => sum + t.x, 0) / pasteTexts.length;
          cy = pasteTexts.reduce((sum, t) => sum + t.y, 0) / pasteTexts.length;
        }

        const svgArea = svgRef.current?.getBoundingClientRect();
        const targetX = svgArea ? svgArea.width / 2 : 400;
        const targetY = svgArea ? svgArea.height / 2 : 300;

        const dx = targetX - cx;
        const dy = targetY - cy;

        const idMap = new Map<string, string>();
        const newAtoms = pasteAtoms.map((a) => {
          const newId = crypto.randomUUID();
          idMap.set(a.id, newId);
          return { ...a, id: newId, x: a.x + dx, y: a.y + dy, isFixed: false };
        });
        const newBonds = pasteBonds.map((b) => {
          const newId = crypto.randomUUID();
          idMap.set(b.id, newId);
          return {
            ...b,
            id: newId,
            atom1Id: idMap.get(b.atom1Id) || b.atom1Id,
            atom2Id: idMap.get(b.atom2Id) || b.atom2Id,
            isFixed: false,
          };
        });
        const newTexts = pasteTexts.map((t) => {
          const newId = crypto.randomUUID();
          idMap.set(t.id, newId);
          return { ...t, id: newId, x: t.x + dx, y: t.y + dy, isFixed: false };
        });
        const newArrows = pasteArrows.map((a) => {
          const newId = crypto.randomUUID();
          idMap.set(a.id, newId);
          return {
            ...a,
            id: newId,
            startX: a.startX + dx,
            startY: a.startY + dy,
            endX: a.endX + dx,
            endY: a.endY + dy,
            isFixed: false,
          };
        });

        updateState(
          [...currentAtoms, ...newAtoms],
          [...currentBonds, ...newBonds],
          [...(currentTexts || []), ...newTexts],
          [...(currentArrows || []), ...newArrows],
        );

        setSelectedEntityIds([
          ...newAtoms.map((a) => a.id),
          ...newBonds.map((b) => b.id),
          ...newTexts.map((t) => t.id),
          ...newArrows.map((a) => a.id),
        ]);
      }
    } catch (err) {
      console.warn("Failed to paste", err);
    }
  };

  const exportData = useMemo(() => {
    const filteredAtoms = atoms.filter((a) => !a.isFixed);
    const atomIds = filteredAtoms.map((a) => a.id);
    const filteredBonds = bonds.filter(
      (b) =>
        !b.isFixed &&
        atomIds.includes(b.atom1Id) &&
        atomIds.includes(b.atom2Id),
    );
    const filteredTexts = texts.filter((t) => !t.isFixed);
    const filteredArrows = arrows.filter((a) => !a.isFixed);
    return shrinkMolecule({
      atoms: filteredAtoms,
      bonds: filteredBonds,
      texts: filteredTexts,
      arrows: filteredArrows,
    });
  }, [atoms, bonds, texts, arrows]);

  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: "molecule-update", data: exportData },
        "*",
      );
    }
  }, [exportData]);

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      )
        return;

      const {
        atoms: currentAtoms,
        bonds: currentBonds,
        texts: currentTexts,
        arrows: currentArrows,
      } = stateRef.current;
      const selected = selectedEntityIdsRef.current;

      let atomsToCopy = currentAtoms;
      let bondsToCopy = currentBonds;
      let textsToCopy = currentTexts;
      let arrowsToCopy = currentArrows;

      if (selected.length > 0) {
        const selectedAtomIds = new Set<string>();
        const selectedBondIds = new Set<string>();
        const selectedTextIds = new Set<string>();
        const selectedArrowIds = new Set<string>();

        selected.forEach((id) => {
          if (currentAtoms.some((a) => a.id === id)) selectedAtomIds.add(id);
          else if (currentBonds.some((b) => b.id === id))
            selectedBondIds.add(id);
          else if (currentTexts.some((t) => t.id === id))
            selectedTextIds.add(id);
          else if (currentArrows.some((a) => a.id === id))
            selectedArrowIds.add(id);
        });

        selectedBondIds.forEach((bondId) => {
          const bond = currentBonds.find((b) => b.id === bondId);
          if (bond) {
            selectedAtomIds.add(bond.atom1Id);
            selectedAtomIds.add(bond.atom2Id);
          }
        });

        atomsToCopy = currentAtoms.filter((a) => selectedAtomIds.has(a.id));
        bondsToCopy = currentBonds.filter(
          (b) =>
            selectedAtomIds.has(b.atom1Id) && selectedAtomIds.has(b.atom2Id),
        );
        textsToCopy = currentTexts.filter((t) => selectedTextIds.has(t.id));
        arrowsToCopy = currentArrows.filter((a) => selectedArrowIds.has(a.id));
      }

      const copyPayload = JSON.stringify({
        visual: {
          atoms: atomsToCopy,
          bonds: bondsToCopy,
          texts: textsToCopy,
          arrows: arrowsToCopy,
        },
      });

      e.clipboardData?.setData("text/plain", copyPayload);
      e.preventDefault();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept if user is typing in an input
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      )
        return;
      try {
        const text = e.clipboardData?.getData("text/plain");
        if (!text) return;

        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          // If not standard JSON, try parsing as Teacher Answer (which might be raw or URL encoded)
          parsed = null;
        }

        // Try standard visual clipboard first
        if (
          parsed &&
          parsed.visual &&
          (parsed.visual.atoms || parsed.visual.texts || parsed.visual.arrows)
        ) {
          e.preventDefault();
          const {
            atoms: currentAtoms,
            bonds: currentBonds,
            texts: currentTexts,
            arrows: currentArrows,
          } = stateRef.current;
          const pasteAtoms: Atom[] = parsed.visual.atoms || [];
          const pasteBonds: Bond[] = parsed.visual.bonds || [];
          const pasteTexts: CanvasText[] = parsed.visual.texts || [];
          const pasteArrows: CanvasArrow[] = parsed.visual.arrows || [];
          const mouse = mousePosRef.current;

          if (
            pasteAtoms.length > 0 ||
            pasteTexts.length > 0 ||
            pasteArrows.length > 0
          ) {
            let cx = 0,
              cy = 0;
            if (pasteAtoms.length > 0) {
              cx =
                pasteAtoms.reduce((sum, a) => sum + a.x, 0) / pasteAtoms.length;
              cy =
                pasteAtoms.reduce((sum, a) => sum + a.y, 0) / pasteAtoms.length;
            } else if (pasteTexts.length > 0) {
              cx =
                pasteTexts.reduce((sum, t) => sum + t.x, 0) / pasteTexts.length;
              cy =
                pasteTexts.reduce((sum, t) => sum + t.y, 0) / pasteTexts.length;
            } else {
              cx = pasteArrows[0].startX;
              cy = pasteArrows[0].startY;
            }

            const dx = mouse.x - cx;
            const dy = mouse.y - cy;

            const idMap = new Map<string, string>();

            const newAtoms = pasteAtoms.map((a) => {
              const newId = crypto.randomUUID();
              idMap.set(a.id, newId);
              return {
                ...a,
                id: newId,
                x: a.x + dx,
                y: a.y + dy,
                isFixed: false,
              };
            });

            const newBonds = pasteBonds
              .filter((b) => idMap.has(b.atom1Id) && idMap.has(b.atom2Id))
              .map((b) => ({
                ...b,
                id: crypto.randomUUID(),
                atom1Id: idMap.get(b.atom1Id) as string,
                atom2Id: idMap.get(b.atom2Id) as string,
                isFixed: false,
              }));

            const newTexts = pasteTexts.map((t) => {
              const newId = crypto.randomUUID();
              return {
                ...t,
                id: newId,
                x: t.x + dx,
                y: t.y + dy,
                isFixed: false,
              };
            });

            const newArrows = pasteArrows.map((a) => {
              const newId = crypto.randomUUID();
              return {
                ...a,
                id: newId,
                startX: a.startX + dx,
                startY: a.startY + dy,
                endX: a.endX + dx,
                endY: a.endY + dy,
                isFixed: false,
              };
            });

            updateState(
              [...currentAtoms, ...newAtoms],
              [...currentBonds, ...newBonds],
              [...currentTexts, ...newTexts],
              [...(currentArrows || []), ...newArrows],
            );

            const newEntityIds = [
              ...newAtoms.map((a) => a.id),
              ...newBonds.map((b) => b.id),
              ...newTexts.map((t) => t.id),
              ...newArrows.map((a) => a.id),
            ];
            setSelectedEntityIds(newEntityIds);
          }
        } else {
          // If not a visual clipboard payload, treat it as a TA/exported string
          const taMol = parseTeacherAnswer(text);
          if (taMol && taMol.atoms && taMol.bonds) {
            e.preventDefault();
            const {
              atoms: currentAtoms,
              bonds: currentBonds,
              texts: currentTexts,
              arrows: currentArrows,
            } = stateRef.current;
            const pasteAtoms: Atom[] = taMol.atoms || [];
            const pasteBonds: Bond[] = taMol.bonds || [];
            const pasteTexts: CanvasText[] = taMol.texts || [];
            const pasteArrows: CanvasArrow[] = taMol.arrows || [];
            const mouse = mousePosRef.current;

            if (
              pasteAtoms.length > 0 ||
              pasteTexts.length > 0 ||
              pasteArrows.length > 0
            ) {
              let cx = 0,
                cy = 0;
              if (pasteAtoms.length > 0) {
                cx =
                  pasteAtoms.reduce((sum, a) => sum + a.x, 0) /
                  pasteAtoms.length;
                cy =
                  pasteAtoms.reduce((sum, a) => sum + a.y, 0) /
                  pasteAtoms.length;
              } else if (pasteTexts.length > 0) {
                cx =
                  pasteTexts.reduce((sum, t) => sum + t.x, 0) /
                  pasteTexts.length;
                cy =
                  pasteTexts.reduce((sum, t) => sum + t.y, 0) /
                  pasteTexts.length;
              } else if (pasteArrows.length > 0) {
                cx = pasteArrows[0].startX;
                cy = pasteArrows[0].startY;
              }

              let targetX = mouse.x;
              let targetY = mouse.y;

              // Center in the SVG if mouse is uninitialized
              if (targetX === 0 && targetY === 0) {
                const svgArea = svgRef.current?.getBoundingClientRect();
                targetX = svgArea ? svgArea.width / 2 : 400;
                targetY = svgArea ? svgArea.height / 2 : 300;
              }

              const dx = targetX - cx;
              const dy = targetY - cy;

              const idMap = new Map<string, string>();

              const newAtoms = pasteAtoms.map((a) => {
                const newId = crypto.randomUUID();
                idMap.set(a.id, newId);
                return { ...a, id: newId, x: a.x + dx, y: a.y + dy };
              });

              const newBonds = pasteBonds
                .filter((b) => idMap.has(b.atom1Id) && idMap.has(b.atom2Id))
                .map((b) => ({
                  ...b,
                  id: crypto.randomUUID(),
                  atom1Id: idMap.get(b.atom1Id) as string,
                  atom2Id: idMap.get(b.atom2Id) as string,
                }));

              const newTexts = pasteTexts.map((t) => {
                const newId = crypto.randomUUID();
                return { ...t, id: newId, x: t.x + dx, y: t.y + dy };
              });

              const newArrows = pasteArrows.map((a) => {
                const newId = crypto.randomUUID();
                return {
                  ...a,
                  id: newId,
                  startX: a.startX + dx,
                  startY: a.startY + dy,
                  endX: a.endX + dx,
                  endY: a.endY + dy,
                };
              });

              updateState(
                [...currentAtoms, ...newAtoms],
                [...currentBonds, ...newBonds],
                [...currentTexts, ...newTexts],
                [...(currentArrows || []), ...newArrows],
              );
              setSelectedEntityIds([
                ...newAtoms.map((a) => a.id),
                ...newBonds.map((b) => b.id),
                ...newTexts.map((t) => t.id),
                ...newArrows.map((a) => a.id),
              ]);
            }
          }
        }
      } catch (err) {
        console.warn("Clipboard read error:", err);
      }
    };

    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste);
    };
  }, []);

  const getAtomValency = (atomId: string) => {
    return bonds
      .filter((b) => b.atom1Id === atomId || b.atom2Id === atomId)
      .reduce(
        (sum, b) =>
          sum +
          (Number(b.order) === 4 || Number(b.order) === 5
            ? 1
            : Number(b.order)),
        0,
      );
  };

  const getExpectedValency = (symbol: ElementType) => {
    const valencies: Record<string, number> = {
      C: 4,
      N: 3,
      O: 2,
      H: 1,
      F: 1,
      Cl: 1,
      Br: 1,
      I: 1,
      P: 3,
      S: 2,
      B: 3,
    };
    return valencies[symbol] || 0;
  };

  const getChainPreview = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) => {
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.hypot(dx, dy);
    if (dist <= 20) return [];

    const B = 35;
    const projectedLength = B * Math.cos(Math.PI / 6);
    const numBonds = Math.max(1, Math.round(dist / projectedLength));

    const axisAngle = Math.atan2(dy, dx);
    const pts = [{ x: startX, y: startY }];

    let currentPt = { x: startX, y: startY };
    let goingUp = true;
    for (let i = 0; i < numBonds; i++) {
      const bondAngle = axisAngle + (goingUp ? Math.PI / 6 : -Math.PI / 6);
      currentPt = {
        x: currentPt.x + B * Math.cos(bondAngle),
        y: currentPt.y + B * Math.sin(bondAngle),
      };
      pts.push(currentPt);
      goingUp = !goingUp;
    }
    return pts;
  };

  const saveMolecule = () => {
    if (atoms.length === 0) return;
    setSaveName(`Structure ${savedMolecules.length + 1}`);
    setShowSavePrompt(true);
  };

  useEffect(() => {
    if (isReadOnly || testReadOnlyMode) return;

    let inactivityTimer: any;
    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        setMode((prev) => {
          if (prev !== "select" && prev !== "erase" && prev !== "text")
            return "select";
          return prev;
        });
      }, 10000);
    };

    window.addEventListener("pointerdown", resetTimer);
    window.addEventListener("pointerup", resetTimer);
    window.addEventListener("keydown", resetTimer);
    resetTimer();

    return () => {
      clearTimeout(inactivityTimer);
      window.removeEventListener("pointerdown", resetTimer);
      window.removeEventListener("pointerup", resetTimer);
      window.removeEventListener("keydown", resetTimer);
    };
  }, [isReadOnly, testReadOnlyMode]);

  const importFromPubChem = async () => {
    if (!pubChemQuery.trim()) return;
    setPubChemLoading(true);
    setPubChemError("");
    try {
      const res = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(pubChemQuery.trim())}/SDF?record_type=2d`,
      );
      if (!res.ok) throw new Error("Failed to fetch from PubChem.");
      const text = await res.text();

      if (text.includes("PUGREST.ServerBusy")) {
        throw new Error("PubChem server is busy. Please try again later.");
      }

      const lines = text.split(/\r?\n/);
      if (lines.length < 4) throw new Error("Not a valid SDF format.");

      const countsLine = lines[3];
      const numAtoms = parseInt(countsLine.substring(0, 3).trim(), 10);
      const numBonds = parseInt(countsLine.substring(3, 6).trim(), 10);

      const newAtoms: Atom[] = [];
      const newBonds: Bond[] = [];
      const aidToId = new Map<number, string>();

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;

      for (let i = 0; i < numAtoms; i++) {
        const line = lines[4 + i];
        const cx = parseFloat(line.substring(0, 10).trim()) * 35 || 0;
        const cy = -(parseFloat(line.substring(10, 20).trim()) * 35 || 0);
        const symbol = line.substring(31, 34).trim();

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const id = crypto.randomUUID();
        aidToId.set(i + 1, id);

        newAtoms.push({
          id,
          symbol,
          x: cx,
          y: cy,
          charge: 0,
          lonePairs: 0,
        });
      }

      // Check for M  CHG lines
      let currentLine = 4 + numAtoms + numBonds;
      while (currentLine < lines.length) {
        const line = lines[currentLine];
        if (line.startsWith("M  CHG")) {
          const parts = line.trim().split(/\s+/);
          const entries = parseInt(parts[2], 10);
          for (let j = 0; j < entries; j++) {
            const atomIndex = parseInt(parts[3 + j * 2], 10);
            const charge = parseInt(parts[4 + j * 2], 10);
            const id = aidToId.get(atomIndex);
            const atom = newAtoms.find((a) => a.id === id);
            if (atom) atom.charge = charge;
          }
        }
        if (line.startsWith("M  END")) break;
        currentLine++;
      }

      const svgArea = svgRef.current?.getBoundingClientRect();
      const centerX = svgArea ? svgArea.width / 2 : 400;
      const centerY = svgArea ? svgArea.height / 2 : 300;
      const molWidth = maxX === -Infinity ? 0 : maxX - minX;
      const molHeight = maxY === -Infinity ? 0 : maxY - minY;
      const offsetX = centerX - minX - molWidth / 2 + (Math.random() * 60 - 30);
      const offsetY =
        centerY - minY - molHeight / 2 + (Math.random() * 60 - 30);

      newAtoms.forEach((a) => {
        a.x += offsetX;
        a.y += offsetY;
      });

      for (let i = 0; i < numBonds; i++) {
        const line = lines[4 + numAtoms + i];
        const a1 = parseInt(line.substring(0, 3).trim(), 10);
        const a2 = parseInt(line.substring(3, 6).trim(), 10);
        const bondType = parseInt(line.substring(6, 9).trim(), 10);
        const stereoType = parseInt(line.substring(9, 12).trim(), 10);

        let order: 1 | 2 | 3 | 4 | 5 = 1;

        if (bondType === 1) {
          if (stereoType === 1)
            order = 4; // Wedge
          else if (stereoType === 6)
            order = 5; // Dash
          else order = 1;
        } else if (bondType === 2) {
          order = 2; // Double
        } else if (bondType === 3) {
          order = 3; // Triple
        }

        newBonds.push({
          id: crypto.randomUUID(),
          atom1Id: aidToId.get(a1)!,
          atom2Id: aidToId.get(a2)!,
          order,
        });
      }

      updateState([...atoms, ...newAtoms], [...bonds, ...newBonds]);
      setShowPubChemPrompt(false);
      setPubChemQuery("");
    } catch (err: any) {
      setPubChemError(err.message || "Failed to fetch from PubChem.");
    } finally {
      setPubChemLoading(false);
    }
  };

  const executeSaveMolecule = () => {
    const name = saveName || `Structure ${savedMolecules.length + 1}`;
    setSavedMolecules([
      ...savedMolecules,
      {
        id: crypto.randomUUID(),
        name,
        data: { atoms, bonds },
      },
    ]);
    setShowSavePrompt(false);
  };

  const isHydrogenOnCarbon = (atomId: string) => {
    const atom = atoms.find((a) => a.id === atomId);
    if (atom?.symbol !== "H") return false;
    return bonds.some((b) => {
      if (b.atom1Id === atomId)
        return atoms.find((a) => a.id === b.atom2Id)?.symbol === "C";
      if (b.atom2Id === atomId)
        return atoms.find((a) => a.id === b.atom1Id)?.symbol === "C";
      return false;
    });
  };

  const visibleAtoms = atoms.filter((a) => {
    if (hideCHydrogens || skeletalMode) {
      if (isHydrogenOnCarbon(a.id)) return false;
    }
    return true;
  });

  const visibleBonds = bonds.filter((b) => {
    if (hideCHydrogens || skeletalMode) {
      if (isHydrogenOnCarbon(b.atom1Id) || isHydrogenOnCarbon(b.atom2Id))
        return false;
    }
    return true;
  });

  const exportImage = (format: "png" | "jpg" | "svg" = "png") => {
    if (!svgRef.current) return;

    // Choose what to export: selected entities, or all if none selected
    let targetAtoms = visibleAtoms;
    let targetBonds = visibleBonds;
    let targetTexts = texts;
    let targetArrows = arrows;

    if (selectedEntityIds.length > 0) {
      const selectedAtomIds = new Set<string>();
      selectedEntityIds.forEach((id) => {
        if (visibleAtoms.some((a) => a.id === id)) selectedAtomIds.add(id);
        const bond = visibleBonds.find((b) => b.id === id);
        if (bond) {
          selectedAtomIds.add(bond.atom1Id);
          selectedAtomIds.add(bond.atom2Id);
        }
      });
      targetAtoms = visibleAtoms.filter((a) => selectedAtomIds.has(a.id));
      targetBonds = visibleBonds.filter(
        (b) => selectedAtomIds.has(b.atom1Id) && selectedAtomIds.has(b.atom2Id),
      );
      targetTexts = texts.filter((t) => selectedEntityIds.includes(t.id));
      targetArrows = arrows.filter((a) => selectedEntityIds.includes(a.id));
    }

    if (
      targetAtoms.length === 0 &&
      targetTexts.length === 0 &&
      targetArrows.length === 0
    )
      return;

    // Calculate bounding box
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    targetAtoms.forEach((a) => {
      minX = Math.min(minX, a.x - 30);
      minY = Math.min(minY, a.y - 30);
      maxX = Math.max(maxX, a.x + 30);
      maxY = Math.max(maxY, a.y + 30);
    });
    targetTexts.forEach((t) => {
      minX = Math.min(minX, t.x - 50);
      minY = Math.min(minY, t.y - 50);
      maxX = Math.max(maxX, t.x + 50);
      maxY = Math.max(maxY, t.y + 50);
    });
    targetArrows.forEach((a) => {
      minX = Math.min(minX, Math.min(a.startX, a.endX) - 20);
      minY = Math.min(minY, Math.min(a.startY, a.endY) - 20);
      maxX = Math.max(maxX, Math.max(a.startX, a.endX) + 20);
      maxY = Math.max(maxY, Math.max(a.startY, a.endY) + 20);
    });

    const paddingTop = 60;
    const paddingBottom = 60;
    const paddingLeft = 60;
    const paddingRight = 60;
    const paddedMinX = minX - paddingLeft;
    const paddedMinY = minY - paddingTop;
    const width = maxX - minX + paddingLeft + paddingRight;
    const height = maxY - minY + paddingTop + paddingBottom;

    // Create a standalone SVG string
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="${paddedMinX} ${paddedMinY} ${width} ${height}" width="${width}" height="${height}">
        <g>
          ${targetBonds
            .map((b) => {
              const a1 = targetAtoms.find((a) => a.id === b.atom1Id);
              const a2 = targetAtoms.find((a) => a.id === b.atom2Id);
              if (!a1 || !a2) return "";
              const dx = a2.x - a1.x;
              const dy = a2.y - a1.y;
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
              const length = Math.sqrt(dx * dx + dy * dy);

              const getOffset = (atom: Pick<Atom, "symbol">) => {
                let base = 0;
                if (skeletalMode && atom.symbol === "C") base = 0;
                else if (!filledMode) base = 8;
                else base = getAtomRadius(atom.symbol) + 1;

                if (Number(b.order) === 0 && atom.symbol !== "H") {
                  base += 4;
                }
                return base;
              };

              const offset1 = getOffset(a1);
              const offset2 = getOffset(a2);
              const bondLength = Math.max(0, length - offset1 - offset2);

              let lines = "";
              const color = "#64748B";
              const strokeWidth = 2;
              const spacing = 7.5;

              const order = Number(b.order);
              if (order === 0) {
                lines = `<line x1="0" y1="0" x2="${bondLength}" y2="0" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="4 4" stroke-linecap="round" />`;
              } else if (order === 1) {
                lines = `<line x1="0" y1="0" x2="${bondLength}" y2="0" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
              } else if (order === 2) {
                lines = `<line x1="0" y1="${-spacing / 2}" x2="${bondLength}" y2="${-spacing / 2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />
                        <line x1="0" y1="${spacing / 2}" x2="${bondLength}" y2="${spacing / 2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
              } else if (order === 3) {
                lines = `<line x1="0" y1="${-spacing}" x2="${bondLength}" y2="${-spacing}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />
                        <line x1="0" y1="0" x2="${bondLength}" y2="0" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />
                        <line x1="0" y1="${spacing}" x2="${bondLength}" y2="${spacing}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
              } else if (order === 4) {
                lines = `<polygon points="0,0 ${bondLength},${-spacing * 0.45} ${bondLength},${spacing * 0.45}" fill="${color}" />`;
              } else if (order === 5) {
                const numDashes = 12;
                let dashes = "";
                for (let i = 1; i <= numDashes; i++) {
                  const x = (bondLength / numDashes) * i;
                  const h = spacing * 0.45 * (i / numDashes);
                  dashes += `<line x1="${x}" y1="${-h}" x2="${x}" y2="${h}" stroke="${color}" stroke-width="1.2" stroke-linecap="round" />`;
                }
                lines = dashes;
              }

              return `<g transform="translate(${a1.x}, ${a1.y}) rotate(${angle}) translate(${offset1}, 0)">${lines}</g>`;
            })
            .join("")}
          ${targetAtoms
            .map((a) => {
              const isSkeletalC = skeletalMode && a.symbol === "C";
              if (isSkeletalC) return "";

              const color = a.color || getAtomColor(a.symbol);
              const baseTextColor = getAtomTextColor(a.symbol);

              const shouldDrawFill = filledMode && !isSkeletalC;
              const circleFill = shouldDrawFill ? color : "transparent";

              let unfilledTextColor = color;
              if (a.symbol === "H") unfilledTextColor = "#64748b";
              else if (a.symbol === "C") unfilledTextColor = "#1e293b";

              const textColor = shouldDrawFill
                ? baseTextColor
                : unfilledTextColor;

              const currentV = bonds
                .filter((b) => b.atom1Id === a.id || b.atom2Id === a.id)
                .reduce(
                  (sum, b) =>
                    sum +
                    (Number(b.order) === 4 || Number(b.order) === 5
                      ? 1
                      : Number(b.order)),
                  0,
                );
              const expectedV = getExpectedValency(a.symbol);
              const implicitH = Math.max(0, expectedV - currentV);
              const shouldHideImplicitH =
                hideImplicitHydrogens ||
                ((hideCHydrogens || skeletalMode) && a.symbol === "C");

              let implicitHText = "";
              if (a.symbol !== "H" && implicitH > 0 && !shouldHideImplicitH) {
                const hTextColor = shouldDrawFill
                  ? color === "#ffffff"
                    ? "#64748b"
                    : color
                  : textColor;
                const hX = a.x + getAtomRadius(a.symbol) * 0.7;
                const hY = a.y + getAtomRadius(a.symbol) * 0.7;
                implicitHText = `<text x="${hX}" y="${hY}" fill="${hTextColor}" font-size="14" font-weight="bold" font-family="sans-serif">H${implicitH > 1 ? implicitH : ""}</text>`;
              }

              // Lone pairs logic
              let lonePairsHtml = "";
              if (a.lonePairs > 0) {
                const connectedBonds = bonds.filter(
                  (b) => b.atom1Id === a.id || b.atom2Id === a.id,
                );
                const hBonds = connectedBonds.filter((b) => b.order === 0);
                const covBonds = connectedBonds.filter((b) => b.order > 0);

                const getAngle = (b: Bond) => {
                  const otherId = b.atom1Id === a.id ? b.atom2Id : b.atom1Id;
                  const other =
                    targetAtoms.find((t) => t.id === otherId) ||
                    atoms.find((t) => t.id === otherId);
                  if (!other) return null;
                  return Math.atan2(other.y - a.y, other.x - a.x);
                };

                const hBondAngles = hBonds
                  .map(getAngle)
                  .filter((a): a is number => a !== null);
                const covBondAngles = covBonds
                  .map(getAngle)
                  .filter((a): a is number => a !== null);

                let availableAngles: number[] = [...hBondAngles];
                const getMinDist = (targetAngle: number) => {
                  if (covBondAngles.length === 0) return Infinity;
                  return Math.min(
                    ...covBondAngles.map((ang: number) => {
                      let dA = Math.abs(ang - targetAngle) % (2 * Math.PI);
                      return dA > Math.PI ? 2 * Math.PI - dA : dA;
                    }),
                  );
                };

                if (a.lonePairs === 1) {
                  const topDist = getMinDist(-Math.PI / 2);
                  const botDist = getMinDist(Math.PI / 2);
                  if (topDist >= botDist) availableAngles.unshift(-Math.PI / 2);
                  else availableAngles.unshift(Math.PI / 2);
                } else if (covBondAngles.length === 0) {
                  if (a.lonePairs === 2) {
                    availableAngles.push((-Math.PI * 3) / 4, -Math.PI / 4);
                  } else {
                    availableAngles.push(
                      ...[-Math.PI / 2, 0, Math.PI / 2, Math.PI],
                    );
                  }
                } else if (covBondAngles.length === 1) {
                  const angle = covBondAngles[0];
                  availableAngles.push(
                    ...[
                      angle + Math.PI,
                      angle + Math.PI / 2,
                      angle - Math.PI / 2,
                      angle + (Math.PI * 3) / 4,
                    ],
                  );
                } else {
                  const sorted = [...covBondAngles].sort((x, y) => x - y);
                  const gaps = [];
                  for (let i = 0; i < sorted.length; i++) {
                    const next = sorted[(i + 1) % sorted.length];
                    let diff = next - sorted[i];
                    if (diff < 0) diff += 2 * Math.PI;
                    gaps.push({ start: sorted[i], diff });
                  }
                  gaps.sort((x, y) => y.diff - x.diff);
                  if (gaps[0].diff > Math.PI) {
                    const mid = gaps[0].start + gaps[0].diff / 2;
                    const spread = (135 * Math.PI) / 180;
                    availableAngles.push(mid - spread / 2);
                    availableAngles.push(mid + spread / 2);
                    if (gaps.length > 1)
                      availableAngles.push(gaps[1].start + gaps[1].diff / 2);
                    availableAngles.push(mid);
                  } else {
                    gaps.forEach((g) =>
                      availableAngles.push(g.start + g.diff / 2),
                    );
                  }
                }

                const getBaseR = () => {
                  if (isSkeletalC) return 0;
                  if (!filledMode) return 9;
                  return getAtomRadius(a.symbol);
                };
                const baseR = getBaseR();
                const radius = baseR + 2;
                const dotSize = 2.0;
                const pairSpread = 8.0;

                for (let i = 0; i < a.lonePairs; i++) {
                  let angle = availableAngles[i % availableAngles.length] || 0;
                  let bx = Math.cos(angle) * radius;
                  let by = Math.sin(angle) * radius;
                  let px = Math.cos(angle + Math.PI / 2) * (pairSpread / 2);
                  let py = Math.sin(angle + Math.PI / 2) * (pairSpread / 2);

                  lonePairsHtml += `
                  <g>
                    <circle cx="${a.x + bx + px}" cy="${a.y + by + py}" r="${dotSize}" fill="#6366F1" />
                    <circle cx="${a.x + bx - px}" cy="${a.y + by - py}" r="${dotSize}" fill="#6366F1" />
                  </g>
                `;
                }
                for (let i = 0; i < (a.singleElectrons || 0); i++) {
                  let angle =
                    availableAngles[
                      (a.lonePairs + i) % availableAngles.length
                    ] || 0;
                  let bx = Math.cos(angle) * radius;
                  let by = Math.sin(angle) * radius;

                  lonePairsHtml += `
                  <g>
                    <circle cx="${a.x + bx}" cy="${a.y + by}" r="${dotSize}" fill="#6366F1" />
                  </g>
                `;
                }
              }

              const strokeCol = shouldDrawFill ? "white" : "transparent";
              return `<g>
              <g transform="translate(${a.x}, ${a.y})">
                <circle r="${getAtomRadius(a.symbol)}" fill="${circleFill}" stroke="${strokeCol}" stroke-width="2" />
                <text text-anchor="middle" dominant-baseline="central" fill="${textColor}" font-size="20" font-weight="900" font-family="sans-serif" letter-spacing="-0.05em">${a.symbol}</text>
              </g>
              ${implicitHText}
              ${lonePairsHtml}
            </g>`;
            })
            .join("")}
          ${connectedComponents
            .map((comp) => {
              if (comp.totalCharge === 0) return "";

              let cMinX = Infinity,
                cMinY = Infinity,
                cMaxX = -Infinity,
                cMaxY = -Infinity;
              comp.atoms.forEach((a) => {
                const r = getAtomRadius(a.symbol);
                const v = bonds
                  .filter((b) => b.atom1Id === a.id || b.atom2Id === a.id)
                  .reduce(
                    (sum, b) =>
                      sum +
                      (Number(b.order) === 4 || Number(b.order) === 5
                        ? 1
                        : Number(b.order)),
                    0,
                  );
                const implicitH = Math.max(0, getExpectedValency(a.symbol) - v);
                const shouldHideImplicitH =
                  hideImplicitHydrogens ||
                  ((hideCHydrogens || skeletalMode) && a.symbol === "C");

                let extraX = 0;
                if (a.symbol !== "H" && implicitH > 0 && !shouldHideImplicitH) {
                  extraX = 14;
                }
                if (a.x - r < cMinX) cMinX = a.x - r;
                if (a.y - r < cMinY) cMinY = a.y - r;
                if (a.x + r + extraX > cMaxX) cMaxX = a.x + r + extraX;
                if (a.y + r > cMaxY) cMaxY = a.y + r;
              });

              const bracketWidth = 10;
              const marginX = 12;
              const marginY = 12;

              const leftX = cMinX - marginX;
              const rightX = cMaxX + marginX;
              const topY = cMinY - marginY;
              const botY = cMaxY + marginY;

              const chargeTextVal =
                Math.abs(comp.totalCharge) > 1
                  ? `${Math.abs(comp.totalCharge)}${comp.totalCharge > 0 ? "+" : "-"}`
                  : comp.totalCharge > 0
                    ? "+"
                    : "-";
              const compColor =
                comp.atoms[0]?.color ||
                getAtomColor(comp.atoms[0]?.symbol) ||
                "#475569";

              return `
              <g>
                <g stroke="${compColor}" stroke-width="1.5" fill="none" opacity="0.8">
                  <path d="M ${leftX + bracketWidth} ${topY} L ${leftX} ${topY} L ${leftX} ${botY} L ${leftX + bracketWidth} ${botY}" />
                  <path d="M ${rightX - bracketWidth} ${topY} L ${rightX} ${topY} L ${rightX} ${botY} L ${rightX - bracketWidth} ${botY}" />
                </g>
                <g transform="translate(${rightX + 16}, ${topY + 8})">
                  <text dy="0.35em" text-anchor="middle" fill="#475569" font-size="16" font-weight="bold" font-family="sans-serif">${chargeTextVal}</text>
                </g>
              </g>
            `;
            })
            .join("")}
          ${targetArrows
            .map((arrow) => {
              const dx = arrow.endX - arrow.startX;
              const dy = arrow.endY - arrow.startY;
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
              const color = arrow.color || "#1e293b";
              return `<g>
                <line x1="${arrow.startX}" y1="${arrow.startY}" x2="${arrow.endX}" y2="${arrow.endY}" stroke="${color}" stroke-width="2" stroke-linecap="round" />
                <polygon points="0,-4 8,0 0,4" fill="${color}" transform="translate(${arrow.endX}, ${arrow.endY}) rotate(${angle})" />
              </g>`;
            })
            .join("")}
          ${targetTexts
            .map((text) => {
              const scaleVal = text.size || 1;
              const textColor = text.color || "#1e293b";
              const escapeHtml = (unsafe: string) =>
                unsafe
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/"/g, "&quot;")
                  .replace(/'/g, "&#039;");
              const html = katex.renderToString(text.text, {
                throwOnError: false,
                output: "html",
              });
              return `<g transform="translate(${text.x}, ${text.y}) rotate(${text.rotation || 0}) scale(${scaleVal})">
                <foreignObject x="-1000" y="-1000" width="2000" height="2000">
                  <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:${textColor};font-size:20px;font-family:sans-serif;">
                    ${html}
                  </div>
                </foreignObject>
              </g>`;
            })
            .join("")}
        </g>
      </svg>
    `;

    if (format === "svg") {
      const blob = new Blob([svgContent], {
        type: "image/svg+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.download = `molecule.${format}`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const blob = new Blob([svgContent], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scaleFactor = 4;
      const canvas = document.createElement("canvas");
      canvas.width = width * scaleFactor;
      canvas.height = height * scaleFactor;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (format === "jpg") {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.scale(scaleFactor, scaleFactor);
        ctx.drawImage(img, 0, 0);
        const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
        const dataUrl = canvas.toDataURL(mimeType, 1.0);
        const a = document.createElement("a");
        a.download = `molecule.${format}`;
        a.href = dataUrl;
        a.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const removeExcessHydrogens = (
    currentAtoms: Atom[],
    currentBonds: Bond[],
  ) => {
    let newAtoms = [...currentAtoms];
    let newBonds = [...currentBonds];

    currentAtoms.forEach((atom) => {
      if (atom.symbol === "H") return;
      const expectedV = getExpectedValency(atom.symbol);
      const connectedBonds = newBonds.filter(
        (b) => b.atom1Id === atom.id || b.atom2Id === atom.id,
      );
      const valency = connectedBonds.reduce(
        (sum, b) =>
          sum +
          (Number(b.order) === 4 || Number(b.order) === 5
            ? 1
            : Number(b.order)),
        0,
      );
      let excess = valency - expectedV;
      if (excess > 0) {
        const attachedH = connectedBonds.filter((b) => {
          if (b.isFixed) return false;
          const otherId = b.atom1Id === atom.id ? b.atom2Id : b.atom1Id;
          const other = newAtoms.find((a) => a.id === otherId);
          return other && other.symbol === "H" && Number(b.order) === 1 && !other.isFixed;
        });

        for (let i = 0; i < excess && i < attachedH.length; i++) {
          const b = attachedH[i];
          const otherId = b.atom1Id === atom.id ? b.atom2Id : b.atom1Id;
          newBonds = newBonds.filter((nb) => nb.id !== b.id);
          newAtoms = newAtoms.filter((na) => na.id !== otherId);
        }
      }
    });

    return { atoms: newAtoms, bonds: newBonds };
  };

  const addHydrogens = () => {
    let targetAtomIds = selectedEntityIds.filter((id) =>
      atoms.some((a) => a.id === id),
    );
    // If no atoms selected, apply to all atoms
    if (targetAtomIds.length === 0) {
      targetAtomIds = atoms.map((a) => a.id);
    }
    
    // Filter out fixed atoms
    targetAtomIds = targetAtomIds.filter(id => !isEntityFixed(id));
    
    if (targetAtomIds.length === 0) return;

    const newAtoms = [...atoms];
    const newBonds = [...bonds];
    let changed = false;

    targetAtomIds.forEach((atomId) => {
      const atom = newAtoms.find((a) => a.id === atomId);
      if (!atom || atom.symbol === "H") return;
      const v = newBonds
        .filter((b) => b.atom1Id === atom.id || b.atom2Id === atom.id)
        .reduce(
          (sum, b) =>
            sum +
            (Number(b.order) === 4 || Number(b.order) === 5
              ? 1
              : Number(b.order)),
          0,
        );
      const expectedV = getExpectedValency(atom.symbol);
      const hTokensNeeded = Math.max(0, expectedV - v);

      if (hTokensNeeded > 0) {
        changed = true;
        const d = 50; // spawn distance

        // Try to respect existing angles
        const existingBonds = newBonds.filter(
          (b) => b.atom1Id === atom.id || b.atom2Id === atom.id,
        );

        let existingAngles: number[] = [];
        existingBonds.forEach((b) => {
          const otherAtomId = b.atom1Id === atom.id ? b.atom2Id : b.atom1Id;
          const other = newAtoms.find((a) => a.id === otherAtomId);
          if (other) {
            existingAngles.push(Math.atan2(other.y - atom.y, other.x - atom.x));
          }
        });
        existingAngles.sort((a, b) => a - b);

        let angles: number[] = [];
        if (existingAngles.length === 1) {
          const a0 = existingAngles[0];
          if (atom.symbol === "O" && hTokensNeeded === 1) {
            angles.push(a0 + (104.5 * Math.PI) / 180);
          } else if (atom.symbol === "N" && hTokensNeeded === 2) {
            angles.push(a0 + (120 * Math.PI) / 180);
            angles.push(a0 - (120 * Math.PI) / 180);
          } else if (hTokensNeeded === 1) {
            angles.push(a0 + (120 * Math.PI) / 180);
          } else if (hTokensNeeded === 2) {
            angles.push(a0 + (120 * Math.PI) / 180);
            angles.push(a0 - (120 * Math.PI) / 180);
          } else if (hTokensNeeded === 3) {
            angles.push(a0 + Math.PI);
            angles.push(a0 + Math.PI + (70 * Math.PI) / 180);
            angles.push(a0 + Math.PI - (70 * Math.PI) / 180);
          } else {
            for (let i = 0; i < hTokensNeeded; i++) {
              angles.push(
                a0 + Math.PI + ((i - (hTokensNeeded - 1) / 2) * Math.PI) / 3,
              );
            }
          }
        } else if (existingAngles.length === 2) {
          let gap = existingAngles[1] - existingAngles[0];
          if (gap < 0) gap += Math.PI * 2;
          let bisector = 0;
          if (gap > Math.PI) {
            bisector = existingAngles[0] + gap / 2;
          } else {
            bisector = existingAngles[1] + (Math.PI * 2 - gap) / 2;
          }
          if (hTokensNeeded === 1) {
            angles.push(bisector);
          } else if (hTokensNeeded === 2) {
            angles.push(bisector + (30 * Math.PI) / 180);
            angles.push(bisector - (30 * Math.PI) / 180);
          } else {
            for (let i = 0; i < hTokensNeeded; i++) {
              angles.push(
                bisector + ((i - (hTokensNeeded - 1) / 2) * Math.PI) / 4,
              );
            }
          }
        } else if (existingAngles.length > 2) {
          let maxGap = 0;
          let bestBisector = 0;
          for (let i = 0; i < existingAngles.length; i++) {
            let a1 = existingAngles[i];
            let a2 = existingAngles[(i + 1) % existingAngles.length];
            let gap = a2 - a1;
            if (gap <= 0) gap += Math.PI * 2;
            if (gap > maxGap) {
              maxGap = gap;
              bestBisector = a1 + gap / 2;
            }
          }
          for (let i = 0; i < hTokensNeeded; i++) {
            angles.push(
              bestBisector + ((i - (hTokensNeeded - 1) / 2) * Math.PI) / 6,
            );
          }
        } else {
          for (let i = 0; i < hTokensNeeded; i++) {
            angles.push((i * Math.PI * 2) / hTokensNeeded);
          }
        }

        for (let i = 0; i < hTokensNeeded; i++) {
          const angle = angles[i];
          const hx = atom.x + Math.cos(angle) * d;
          const hy = atom.y + Math.sin(angle) * d;
          const hid = `atom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          newAtoms.push({
            id: hid,
            x: hx,
            y: hy,
            symbol: "H",
            color: getAtomColor("H"),
            lonePairs: 0,
            charge: 0,
          });
          const bid = `bond-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          newBonds.push({
            id: bid,
            atom1Id: atom.id,
            atom2Id: hid,
            order: 1,
          });
        }
      }
    });

    if (changed) {
      updateState(ensureInBounds(newAtoms), newBonds);
    }
  };

  const cleanStructure = async () => {
    if (atoms.length === 0) return;
    if (isCleaningRef.current) return;
    isCleaningRef.current = true;

    try {
      const selectedAtomIds = selectedEntityIds.filter((id) =>
        atoms.some((a) => a.id === id),
      );
      const targetAtomIds = new Set<string>(
        (selectedAtomIds.length > 1
          ? selectedAtomIds
          : atoms.map((a) => a.id)
        ).filter((id) => !isEntityFixed(id)),
      );

      let currentAtoms = atoms.map((a) => ({ ...a, vx: 0, vy: 0 }));

      const dt = 0.5;
      const defaultBondLengthMultiplier = 0.875;
      const repulsionStrength = 3000;
      const springStrength = 0.5;
      const angleStrength = 0.3;
      const targetAngle = 120 * (Math.PI / 180);

      const adjacentMap = new Map<string, string[]>();
      currentAtoms.forEach((a) => adjacentMap.set(a.id, []));
      bonds.forEach((b) => {
        adjacentMap.get(b.atom1Id)?.push(b.atom2Id);
        adjacentMap.get(b.atom2Id)?.push(b.atom1Id);
      });

      const startTime = Date.now();
      let maxMovement = Infinity;
      let iterationCount = 0;

      // Run without yielding to event loop
      while (
        Date.now() - startTime < 1000 &&
        maxMovement > 0.05 &&
        iterationCount < 400
      ) {
        iterationCount++;
        maxMovement = 0;

        for (let chunk = 0; chunk < 30; chunk++) {
          const forces = new Map<string, { x: number; y: number }>();
          currentAtoms.forEach((a) => forces.set(a.id, { x: 0, y: 0 }));

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
          bonds.forEach((b) => {
            const a1 = currentAtoms.find((a) => a.id === b.atom1Id);
            const a2 = currentAtoms.find((a) => a.id === b.atom2Id);
            if (a1 && a2) {
              const dx = a2.x - a1.x;
              const dy = a2.y - a1.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > 0) {
                const r1 = getAtomRadius(a1.symbol);
                const r2 = getAtomRadius(a2.symbol);
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
          currentAtoms.forEach((a) => {
            const adj = adjacentMap.get(a.id)!;
            if (adj.length >= 2) {
              if (a.symbol === "O") {
                // For Oxygen, we want specific angles between specific types of bonds,
                // regardless of their current angular sorting (to avoid topological traps).
                for (let j = 0; j < adj.length; j++) {
                  for (let k = j + 1; k < adj.length; k++) {
                    const n1 = currentAtoms.find((na) => na.id === adj[j])!;
                    const n2 = currentAtoms.find((na) => na.id === adj[k])!;

                    const v1x = n1.x - a.x;
                    const v1y = n1.y - a.y;
                    const v2x = n2.x - a.x;
                    const v2y = n2.y - a.y;

                    const d1 = Math.sqrt(v1x * v1x + v1y * v1y);
                    const d2 = Math.sqrt(v2x * v2x + v2y * v2y);

                    if (d1 > 0 && d2 > 0) {
                      const dot = (v1x * v2x + v1y * v2y) / (d1 * d2);
                      let currentAngle = Math.acos(
                        Math.max(-1, Math.min(1, dot)),
                      );

                      const b1 = bonds.find(
                        (b) =>
                          (b.atom1Id === a.id && b.atom2Id === adj[j]) ||
                          (b.atom2Id === a.id && b.atom1Id === adj[j]),
                      );
                      const b2 = bonds.find(
                        (b) =>
                          (b.atom1Id === a.id && b.atom2Id === adj[k]) ||
                          (b.atom2Id === a.id && b.atom1Id === adj[k]),
                      );
                      const isN1Cov = b1 && b1.order > 0;
                      const isN2Cov = b2 && b2.order > 0;

                      let tAngle = -1; // -1 means don't apply force
                      if (isN1Cov && isN2Cov) {
                        tAngle = (104.5 * Math.PI) / 180;
                      } else if (!isN1Cov && !isN2Cov) {
                        tAngle = (140 * Math.PI) / 180;
                      } else if (adj.length === 2 && isN1Cov !== isN2Cov) {
                        tAngle = (120 * Math.PI) / 180;
                      }

                      if (tAngle > 0) {
                        const diff = currentAngle - tAngle;
                        if (Math.abs(diff) > 0.05) {
                          const sign = v1x * v2y - v1y * v2x > 0 ? 1 : -1;
                          const force = diff * angleStrength * sign;

                          const f1x = (-v1y / d1) * force * d1; // rotate v1
                          const f1y = (v1x / d1) * force * d1;

                          const f2x = (v2y / d2) * force * d2; // rotate v2 opposite
                          const f2y = (-v2x / d2) * force * d2;

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
                const n1 = currentAtoms.find((na) => na.id === n1Id)!;
                const n2 = currentAtoms.find((na) => na.id === n2Id)!;

                const v1x = n1.x - a.x;
                const v1y = n1.y - a.y;
                const v2x = n2.x - a.x;
                const v2y = n2.y - a.y;

                const d1 = Math.sqrt(v1x * v1x + v1y * v1y);
                const d2 = Math.sqrt(v2x * v2x + v2y * v2y);

                if (d1 > 0 && d2 > 0) {
                  const dot = (v1x * v2x + v1y * v2y) / (d1 * d2);
                  let currentAngle = Math.acos(Math.max(-1, Math.min(1, dot)));

                  let tAngle = targetAngle;
                  if (
                    bonds.some(
                      (b) =>
                        (b.atom1Id === n1.id && b.atom2Id === n2.id) ||
                        (b.atom1Id === n2.id && b.atom2Id === n1.id),
                    )
                  ) {
                    tAngle = Math.PI / 3;
                  } else if (a.symbol === "H") {
                    tAngle = Math.PI;
                  } else {
                    const totalOrder = bonds
                      .filter((b) => b.atom1Id === a.id || b.atom2Id === a.id)
                      .reduce(
                        (sum, b) =>
                          sum +
                          (Number(b.order) === 4 || Number(b.order) === 5
                            ? 1
                            : Number(b.order)),
                        0,
                      );
                    if (totalOrder === 4)
                      tAngle = Math.PI; // sp hybridized
                    else tAngle = targetAngle;
                  }

                  const diff = currentAngle - tAngle;
                  if (Math.abs(diff) > 0.05) {
                    const sign = v1x * v2y - v1y * v2x > 0 ? 1 : -1;
                    const force = diff * angleStrength * sign;

                    const f1x = (-v1y / d1) * force * d1; // rotate v1
                    const f1y = (v1x / d1) * force * d1;

                    const f2x = (v2y / d2) * force * d2; // rotate v2 opposite
                    const f2y = (-v2x / d2) * force * d2;

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
                adj.forEach((nId) => {
                  const n = currentAtoms.find((na) => na.id === nId)!;
                  anglesMap.set(nId, Math.atan2(n.y - a.y, n.x - a.x));
                });
                const sortedAdj = [...adj].sort(
                  (n1, n2) => anglesMap.get(n1)! - anglesMap.get(n2)!,
                );

                const pairsToProcess =
                  sortedAdj.length === 2 ? 1 : sortedAdj.length;

                for (let j = 0; j < pairsToProcess; j++) {
                  const k = (j + 1) % sortedAdj.length;
                  const n1Id = sortedAdj[j];
                  const n2Id = sortedAdj[k];

                  const n1 = currentAtoms.find((na) => na.id === n1Id)!;
                  const n2 = currentAtoms.find((na) => na.id === n2Id)!;

                  const v1x = n1.x - a.x;
                  const v1y = n1.y - a.y;
                  const v2x = n2.x - a.x;
                  const v2y = n2.y - a.y;

                  const d1 = Math.sqrt(v1x * v1x + v1y * v1y);
                  const d2 = Math.sqrt(v2x * v2x + v2y * v2y);

                  if (d1 > 0 && d2 > 0) {
                    const dot = (v1x * v2x + v1y * v2y) / (d1 * d2);
                    let currentAngle = Math.acos(
                      Math.max(-1, Math.min(1, dot)),
                    );

                    let tAngle = targetAngle;

                    if (a.symbol === "H" && adj.length >= 2) {
                      tAngle = Math.PI;
                    } else {
                      if (adj.length === 4) tAngle = Math.PI / 2;
                      else if (adj.length === 3) tAngle = (Math.PI * 2) / 3;
                    }

                    const diff = currentAngle - tAngle;

                    if (Math.abs(diff) > 0.05) {
                      // Pushing neighbors to adjust angle
                      const sign = v1x * v2y - v1y * v2x > 0 ? 1 : -1;
                      const force = diff * angleStrength * sign;

                      const f1x = (-v1y / d1) * force * d1; // rotate v1
                      const f1y = (v1x / d1) * force * d1;

                      const f2x = (v2y / d2) * force * d2; // rotate v2 opposite
                      const f2y = (-v2x / d2) * force * d2;

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

          // 4. Strong 1-4 Repulsion to enforce zigzag (trans) conformation in chains
          currentAtoms.forEach((a) => {
            const adj = adjacentMap.get(a.id)!;
            adj.forEach((bId) => {
              const bAdj = adjacentMap.get(bId)!;
              bAdj.forEach((cId) => {
                if (cId === a.id) return;
                const cAdj = adjacentMap.get(cId)!;
                cAdj.forEach((dId) => {
                  if (dId === bId || dId === a.id) return;

                  if (a.id < dId) {
                    // Only process each 1-4 pair once
                    const dAtom = currentAtoms.find((atom) => atom.id === dId)!;
                    const dx = a.x - dAtom.x;
                    const dy = a.y - dAtom.y;
                    const distSq = dx * dx + dy * dy;
                    // apply extra repulsion at short to medium range to prevent cis wrapping
                    if (distSq > 0 && distSq < 500000) {
                      const dist = Math.sqrt(distSq);
                      const force = 3500 / distSq;
                      const fx = (dx / dist) * force;
                      const fy = (dy / dist) * force;

                      if (targetAtomIds.has(a.id)) {
                        forces.get(a.id)!.x += fx;
                        forces.get(a.id)!.y += fy;
                      }
                      if (targetAtomIds.has(dId)) {
                        forces.get(dId)!.x -= fx;
                        forces.get(dId)!.y -= fy;
                      }
                    }
                  }
                });
              });
            });
          });

          // Apply forces to target atoms
          currentAtoms.forEach((a) => {
            if (targetAtomIds.has(a.id)) {
              const f = forces.get(a.id)!;
              a.vx = (a.vx + f.x * dt) * 0.7; // Damping
              a.vy = (a.vy + f.y * dt) * 0.7;

              const dx = a.vx * dt;
              const dy = a.vy * dt;
              a.x += dx;
              a.y += dy;

              const movement = Math.sqrt(dx * dx + dy * dy);
              if (movement > maxMovement) {
                maxMovement = movement;
              }
            }
          });
        } // <- ends the 30-chunk loop
      }

      // Save to state
      const newAtoms = currentAtoms.map((a) => {
        const { vx, vy, ...rest } = a;
        return rest;
      });

      if (targetAtomIds.size === atoms.length) {
        const svgArea = svgRef.current?.getBoundingClientRect();
        if (svgArea) {
          const padding = 40;
          const availableW = svgArea.width / scale - padding * 2;
          const availableH = svgArea.height / scale - padding * 2;

          let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;
          newAtoms.forEach((a) => {
            minX = Math.min(minX, a.x);
            maxX = Math.max(maxX, a.x);
            minY = Math.min(minY, a.y);
            maxY = Math.max(maxY, a.y);
          });

          const w = maxX - minX;
          const h = maxY - minY;

          let shrinkScale = 1.0;
          if (w > availableW && availableW > 0)
            shrinkScale = Math.min(shrinkScale, availableW / w);
          if (h > availableH && availableH > 0)
            shrinkScale = Math.min(shrinkScale, availableH / h);

          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;

          const targetCx = svgArea.width / scale / 2;
          const targetCy = svgArea.height / scale / 2;

          newAtoms.forEach((a) => {
            let nx = cx + (a.x - cx) * shrinkScale;
            let ny = cy + (a.y - cy) * shrinkScale;
            nx += targetCx - cx;
            ny += targetCy - cy;
            a.x = nx;
            a.y = ny;
          });
        }
      }

      const hasFixed =
        atoms.some((a) => a.isFixed) ||
        bonds.some((b) => b.isFixed) ||
        texts.some((t) => t.isFixed) ||
        arrows.some((a) => a.isFixed);

      updateState(hasFixed ? newAtoms : ensureInBounds(newAtoms), bonds);
    } finally {
      isCleaningRef.current = false;
    }
  };

  const centerStructureToCanvas = () => {
    if (atoms.length === 0 && texts.length === 0 && arrows.length === 0) return;

    const svgArea = svgRef.current?.getBoundingClientRect();
    if (!svgArea) return;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    atoms.forEach((a) => {
      minX = Math.min(minX, a.x);
      maxX = Math.max(maxX, a.x);
      minY = Math.min(minY, a.y);
      maxY = Math.max(maxY, a.y);
    });
    texts.forEach((t) => {
      minX = Math.min(minX, t.x);
      maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y);
      maxY = Math.max(maxY, t.y);
    });
    arrows.forEach((a) => {
      minX = Math.min(minX, a.startX, a.endX);
      maxX = Math.max(maxX, a.startX, a.endX);
      minY = Math.min(minY, a.startY, a.endY);
      maxY = Math.max(maxY, a.startY, a.endY);
    });

    if (minX === Infinity) return;

    const availableW = svgArea.width / scale;
    const availableH = svgArea.height / scale;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const targetCx = availableW / 2;
    const targetCy = availableH / 2;

    const dx = targetCx - cx;
    const dy = targetCy - cy;

    const newAtoms = atoms.map((a) => ({ ...a, x: a.x + dx, y: a.y + dy }));
    const newTexts = texts.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    const newArrows = arrows.map((a) => ({
      ...a,
      startX: a.startX + dx,
      endX: a.endX + dx,
      startY: a.startY + dy,
      endY: a.endY + dy,
    }));

    updateState(newAtoms, bonds, newTexts, newArrows);
  };

  const loadMolecule = (mol: Molecule) => {
    updateState(mol.atoms, mol.bonds);
    setSelectedEntityIds([]);
  };

  const copyToClipboard = () => {
    setTaValue(exportData);
    const parsed = parseTeacherAnswer(exportData);
    if (parsed) {
      setTeacherAnswer(parsed);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    if (window.parent !== window) {
      window.parent.postMessage(
        { type: "molecule-update", data: exportData },
        "*",
      );
    }
  };

  const downloadStandaloneHtml = async (
    e: React.MouseEvent<HTMLAnchorElement>,
  ) => {
    e.preventDefault();
    try {
      // Use full URL to bypass any path resolution issues inside iframes
      const url = window.location.origin + "/molecule-editor.html";
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }
      const blob = await response.blob();

      // If the file is too small (e.g., standard 10kB error/login pages), warn and try direct download as fallback
      if (blob.size < 50000) {
        console.warn(
          "Downloaded file is unusually small (" +
            blob.size +
            " bytes), falling back to direct location.",
        );
        window.location.href = url;
        return;
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "molecule-editor.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Fetch download failed:", error);
      // Fallback
      window.location.href = window.location.origin + "/molecule-editor.html";
    }
  };

  const selectedAtoms = atoms.filter((a) => selectedEntityIds.includes(a.id));
  const selectedAtom = selectedAtoms.length === 1 ? selectedAtoms[0] : null;
  const selectedBonds = bonds.filter((b) => selectedEntityIds.includes(b.id));
  const selectedBond = selectedBonds.length === 1 ? selectedBonds[0] : null;
  const selectedTexts = texts.filter((t) => selectedEntityIds.includes(t.id));
  const selectedText = selectedTexts.length === 1 ? selectedTexts[0] : null;
  const selectedArrows = arrows.filter((a) => selectedEntityIds.includes(a.id));
  const selectedArrow = selectedArrows.length === 1 ? selectedArrows[0] : null;

  const connectedComponents = useMemo(() => {
    const components: { atoms: Atom[]; bonds: Bond[]; totalCharge: number }[] =
      [];
    const visitedAtoms = new Set<string>();

    for (const atom of atoms) {
      if (visitedAtoms.has(atom.id)) continue;

      const compAtoms: Atom[] = [];
      const compBonds: Bond[] = [];
      const queue = [atom.id];
      visitedAtoms.add(atom.id);

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentAtom = atoms.find((a) => a.id === currentId);
        if (currentAtom) compAtoms.push(currentAtom);

        const connected = bonds.filter(
          (b) => b.atom1Id === currentId || b.atom2Id === currentId,
        );
        for (const b of connected) {
          if (!compBonds.some((cb) => cb.id === b.id)) {
            compBonds.push(b);
          }
          const nextId = b.atom1Id === currentId ? b.atom2Id : b.atom1Id;
          if (!visitedAtoms.has(nextId)) {
            visitedAtoms.add(nextId);
            queue.push(nextId);
          }
        }
      }

      const totalCharge = compAtoms.reduce(
        (sum, a) => sum + (a.charge || 0),
        0,
      );
      components.push({ atoms: compAtoms, bonds: compBonds, totalCharge });
    }
    return components;
  }, [atoms, bonds]);

  const elementComparison = useMemo(() => {
    if (!teacherAnswer) return null;
    const drawnCounts: Record<string, number> = {};
    const expectedCounts: Record<string, number> = {};

    atoms.forEach((a) => {
      drawnCounts[a.symbol] = (drawnCounts[a.symbol] || 0) + 1;
    });

    teacherAnswer.atoms.forEach((a) => {
      expectedCounts[a.symbol] = (expectedCounts[a.symbol] || 0) + 1;
    });

    const allElements = Array.from(
      new Set([...Object.keys(drawnCounts), ...Object.keys(expectedCounts)]),
    );

    return allElements.map((el) => ({
      symbol: el,
      drawn: drawnCounts[el] || 0,
      expected: expectedCounts[el] || 0,
      matched: (drawnCounts[el] || 0) === (expectedCounts[el] || 0),
    }));
  }, [atoms, teacherAnswer]);

  const isStudentMode = isStackEnvironment && !isInstructor;
  const isRTL = language === "Heb" || language === "Ara";

  return (
    <div
      className="flex flex-col h-screen overflow-hidden bg-white font-sans text-slate-900"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* Header Navigation */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-20 overflow-visible">
        <div className="flex items-center space-x-4 flex-1 min-w-0">
          <div className="flex items-center space-x-2 shrink-0">
            <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 ring-1 ring-indigo-200 shadow-sm overflow-hidden">
              <svg
                width="24"
                height="24"
                viewBox="0 0 100 100"
                xmlns="http://www.w3.org/2000/svg"
              >
                <polygon
                  points="50,10 85,30 85,70 50,90 15,70 15,30"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeLinejoin="round"
                />
                <line
                  x1="28"
                  y1="38"
                  x2="28"
                  y2="62"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <line
                  x1="48"
                  y1="24"
                  x2="72"
                  y2="38"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <line
                  x1="48"
                  y1="76"
                  x2="72"
                  y2="62"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
          <nav className="flex justify-between w-full ml-2 sm:ml-4 h-full items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pr-2 flex-1 gap-2">
            <div className="flex items-center space-x-1 shrink-0">
              <button
                onClick={undo}
                disabled={
                  historyState.index === 0 || testReadOnlyMode || isReadOnly
                }
                className="flex items-center px-1.5 py-1 text-sm font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("undo")}
              >
                <RotateCcw className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">{t("undo")}</span>
              </button>
              <button
                onClick={redo}
                disabled={
                  historyState.index === historyState.history.length - 1 ||
                  testReadOnlyMode ||
                  isReadOnly
                }
                className="flex items-center px-1.5 py-1 text-sm font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("redo")}
              >
                <RotateCcw className="w-4 h-4 mr-1 transform scale-x-[-1]" />{" "}
                <span className="hidden sm:inline">{t("redo")}</span>
              </button>
            </div>

            <div className="w-px h-5 bg-slate-200 shrink-0 hidden md:block"></div>

            <div className="flex items-center space-x-1 shrink-0">
              <button
                onClick={cleanStructure}
                disabled={testReadOnlyMode || isReadOnly}
                className="group flex items-center px-1.5 py-1 text-sm font-semibold rounded text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("cleanStructure")}
              >
                <Wand2 className="w-4 h-4 mr-1 group-hover:animate-pulse" />{" "}
                <span className="hidden md:inline">{t("cleanStructure")}</span>
              </button>

              <button
                onClick={centerStructureToCanvas}
                disabled={testReadOnlyMode || atoms.length === 0}
                className="group flex items-center px-1.5 py-1 text-sm font-semibold rounded text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("centerStructure")}
              >
                <Focus className="w-4 h-4 mr-1 group-hover:animate-pulse" />{" "}
                <span className="hidden md:inline">{t("centerStructure")}</span>
              </button>
            </div>

            <div className="w-px h-5 bg-slate-200 shrink-0 hidden md:block"></div>

            <div className="flex items-center space-x-1 shrink-0">
              <button
                onClick={handleMenuCopy}
                disabled={
                  testReadOnlyMode || isReadOnly || selectedEntityIds.length === 0
                }
                className="group flex items-center px-1.5 py-1 text-sm font-semibold rounded text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("copyBtn")}
              >
                <Copy className="w-4 h-4 mr-1 shrink-0" /> <span className="hidden sm:inline">{t("copyBtn")}</span>
              </button>

              <button
                onClick={handleMenuPaste}
                disabled={testReadOnlyMode || isReadOnly}
                className="group flex items-center px-1.5 py-1 text-sm font-semibold rounded text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("pasteBtn")}
              >
                <ClipboardPaste className="w-4 h-4 mr-1 shrink-0" />{" "}
                <span className="hidden sm:inline">{t("pasteBtn")}</span>
              </button>

              {!isStudentMode && (
                <button
                  onClick={addHydrogens}
                  disabled={testReadOnlyMode || isReadOnly}
                  className="group flex items-center px-1.5 py-1 text-sm font-semibold rounded text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t("addH")}
                >
                  <div className="font-mono font-black italic mr-1">+H</div>{" "}
                  <span className="hidden md:inline">{t("addH")}</span>
                </button>
              )}
            </div>

            <div className="w-px h-5 bg-slate-200 shrink-0 hidden lg:block"></div>
            
            <div className="flex bg-slate-100/70 rounded-md p-1 border border-slate-200/50 shrink-0 space-x-0.5">
              <button
                onClick={() => setFilledMode(!filledMode)}
                className={cn("flex items-center px-2 py-1 text-sm font-semibold rounded-sm transition-colors", filledMode ? "bg-white text-indigo-700 shadow-sm border-slate-200" : "text-slate-600 hover:bg-slate-200/50")}
                title={t("filled")}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="sm:mr-1.5"><circle cx="8" cy="8" r="6" /></svg>
                <span className="hidden lg:inline">{t("filled")}</span>
              </button>
              <button
                onClick={() => setSkeletalMode(!skeletalMode)}
                className={cn("flex items-center px-2 py-1 text-sm font-semibold rounded-sm transition-colors", skeletalMode ? "bg-white text-indigo-700 shadow-sm border-slate-200" : "text-slate-600 hover:bg-slate-200/50")}
                title={t("skeletal")}
              >
                <Share2 className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden lg:inline">{t("skeletal")}</span>
              </button>
              <button
                onClick={() => setHideCHydrogens(!hideCHydrogens)}
                className={cn("flex items-center px-2 py-1 text-sm font-semibold rounded-sm transition-colors", hideCHydrogens ? "bg-white text-indigo-700 shadow-sm border-slate-200" : "text-slate-600 hover:bg-slate-200/50")}
                title={t("hideCH")}
              >
                <EyeOff className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden lg:inline">{t("hideCH")}</span>
              </button>
              <button
                onClick={() => setShowValencyWarnings(!showValencyWarnings)}
                className={cn("flex items-center px-2 py-1 text-sm font-semibold rounded-sm transition-colors", showValencyWarnings ? "bg-white text-indigo-700 shadow-sm border-slate-200" : "text-slate-600 hover:bg-slate-200/50")}
                title={t("valencyWarnings")}
              >
                <ShieldAlert className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden lg:inline">{t("valencyWarnings")}</span>
              </button>
            </div>

            {isInstructor && (
              <span className="px-2 py-1 text-xs font-black uppercase text-amber-700 bg-amber-50 border border-amber-200 rounded-md ml-2 tracking-wider flex items-center gap-1 shrink-0 select-none">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                {t("instructorMode")}
              </span>
            )}
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
                "px-3 py-1.5 rounded text-sm font-bold transition-all shadow-sm border uppercase tracking-wider",
                testReadOnlyMode
                  ? "bg-rose-600 text-white border-rose-700 hover:bg-rose-700 font-black animate-pulse"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300",
              )}
            >
              {testReadOnlyMode
                ? `🛑 ${t("stopTesting")}`
                : `🔬 ${t("testSubmitted")}`}
            </button>
          )}

          {/* Removed STACK connected badges */}
          <div className="flex flex-col items-end justify-center select-none mr-2">
            <div className="flex items-center gap-1">
              <svg
                width="32"
                height="32"
                viewBox="0 0 100 100"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M 50,15 C 30,15 20,25 15,40 C 13,50 15,65 20,75 C 25,85 35,90 50,90 Z"
                  fill="#eb485c"
                />
                <circle cx="20" cy="40" r="8" fill="#eb485c" />
                <circle cx="16" cy="55" r="9" fill="#eb485c" />
                <circle cx="22" cy="70" r="8" fill="#eb485c" />
                <circle cx="35" cy="85" r="8" fill="#eb485c" />
                <circle cx="35" cy="22" r="8" fill="#eb485c" />

                <path
                  d="M 50,15 C 70,15 80,25 85,40 C 87,50 85,65 80,75 C 75,85 65,90 50,90 Z"
                  fill="#fde6e8"
                />
                <circle cx="80" cy="40" r="8" fill="#fde6e8" />
                <circle cx="84" cy="55" r="9" fill="#fde6e8" />
                <circle cx="78" cy="70" r="8" fill="#fde6e8" />
                <circle cx="65" cy="85" r="8" fill="#fde6e8" />
                <circle cx="65" cy="22" r="8" fill="#fde6e8" />

                <path
                  d="M 50,30 Q 65,25 75,35 Q 85,45 65,55"
                  fill="none"
                  stroke="#62bc5d"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M 50,50 Q 60,60 70,55 Q 80,50 75,65 Q 70,75 55,75"
                  fill="none"
                  stroke="#62bc5d"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M 50,70 Q 60,85 70,80"
                  fill="none"
                  stroke="#62bc5d"
                  strokeWidth="4"
                  strokeLinecap="round"
                />

                <path
                  d="M 50,15 L 50,90"
                  fill="none"
                  stroke="#eb485c"
                  strokeWidth="2"
                />

                <path
                  d="M 50,15 C 40,0 20,-5 10,5 C 20,15 35,25 50,15 Z"
                  fill="#62bc5d"
                />
              </svg>
              <span
                className="font-extrabold text-[#62bc5d] tracking-tighter"
                style={{ fontSize: "28px", fontFamily: "Arial, sans-serif" }}
              >
                PeTeL
              </span>
            </div>
            <span className="text-[11px] font-black text-[#5ba157] uppercase tracking-widest mt-0.5">
              CHEMISTRY
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar - Sidebar Palette */}
        {!isReadOnly && !testReadOnlyMode ? (
          <aside className="w-28 bg-white border-r border-slate-200 flex flex-col items-center py-4 space-y-4 shadow-[1px_0_4px_rgba(0,0,0,0.02)] z-10 shrink-0 overflow-y-auto overflow-x-hidden">
            <div className="grid grid-cols-2 gap-2 px-2 w-full place-items-center">
              <ToolPaletteButton
                active={mode === "select"}
                onClick={() => setMode("select")}
                icon={<MousePointer2 className="w-6 h-6" />}
                label={t("select")}
              />
              <ToolPaletteButton
                active={mode === "erase"}
                onClick={() => {
                  if (selectedEntityIds.length > 0) {
                    const deletedAtomIds = atoms
                      .filter(
                        (a) => selectedEntityIds.includes(a.id) && !a.isFixed,
                      )
                      .map((a) => a.id);
                    const newAtoms = atoms.filter(
                      (a) => !deletedAtomIds.includes(a.id),
                    );
                    const newBonds = bonds.filter(
                      (b) =>
                        (!selectedEntityIds.includes(b.id) || b.isFixed) &&
                        !deletedAtomIds.includes(b.atom1Id) &&
                        !deletedAtomIds.includes(b.atom2Id),
                    );
                    const newTexts = texts.filter(
                      (t) => !selectedEntityIds.includes(t.id) || t.isFixed,
                    );
                    const newArrows = arrows.filter(
                      (a) => !selectedEntityIds.includes(a.id) || a.isFixed,
                    );
                    updateState(newAtoms, newBonds, newTexts, newArrows);
                    setSelectedEntityIds(
                      selectedEntityIds.filter((id) => isEntityFixed(id)),
                    );
                  } else {
                    setMode("erase");
                  }
                }}
                icon={<Trash2 className="w-6 h-6" />}
                label={t("erase")}
                variant="danger"
              />
            </div>

            <div className="w-16 h-px bg-slate-100 my-1" />

            <div className="grid grid-cols-2 gap-2 px-2 w-full place-items-center">
              <ToolPaletteButton
                active={mode === "atom"}
                onClick={() => {
                  setMode("atom");
                }}
                icon={<Plus className="w-6 h-6" />}
                label={t("atom")}
              />
              <ToolPaletteButton
                active={mode === "chain"}
                onClick={() => setMode("chain")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-6 h-6"
                  >
                    <path d="M 3 17 L 9 7 L 15 17 L 21 7" />
                  </svg>
                }
                label={t("chain")}
              />
              <ToolPaletteButton
                active={mode === "lone-pair"}
                onClick={() => setMode("lone-pair")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-6 h-6"
                  >
                    <circle
                      cx="8"
                      cy="12"
                      r="2.5"
                      fill="currentColor"
                      stroke="none"
                    />
                    <circle
                      cx="16"
                      cy="12"
                      r="2.5"
                      fill="currentColor"
                      stroke="none"
                    />
                  </svg>
                }
                label=""
              />
              <ToolPaletteButton
                active={mode === "single-electron"}
                onClick={() => setMode("single-electron")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-6 h-6"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="2.5"
                      fill="currentColor"
                      stroke="none"
                    />
                  </svg>
                }
                label=""
              />
              <ToolPaletteButton
                active={mode === "text"}
                onClick={() => setMode("text")}
                icon={<Type className="w-6 h-6" />}
                label="Text"
              />
              <ToolPaletteButton
                active={mode === "arrow"}
                onClick={() => setMode("arrow")}
                icon={<ArrowRight className="w-6 h-6" />}
                label="Arrow"
              />
            </div>

            <div className="w-16 h-px bg-slate-100 my-1 shrink-0" />

            {/* Elements Quick Access */}
            <div className="grid grid-cols-2 gap-1 w-full px-2">
              {quickElements.map((el) => (
                <button
                  key={el}
                  onClick={() => {
                    setSelectedElement(el as ElementType);
                    setMode("atom");
                  }}
                  className={cn(
                    "w-full h-8 flex items-center justify-center rounded font-bold text-sm transition-all",
                    selectedElement === el && mode === "atom"
                      ? "bg-indigo-600 text-white shadow-lg mx-0"
                      : "bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 w-auto",
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
                  "col-span-2 w-full h-8 flex items-center justify-center rounded font-bold text-sm transition-all mt-1",
                  !quickElements.includes(selectedElement) && mode === "atom"
                    ? "bg-indigo-600 text-white shadow-lg mx-0"
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 w-auto",
                )}
              >
                {quickElements.includes(selectedElement)
                  ? "..."
                  : selectedElement}
              </button>
            </div>

            <div className="w-16 h-px bg-slate-100 my-1" />

            <button
              onClick={() => {
                if (window.confirm("Clear the entire drawing?")) {
                  const fixedAtoms = atoms.filter((a) => a.isFixed);
                  const fixedBonds = bonds.filter((b) => b.isFixed);
                  const fixedTexts = texts.filter((t) => t.isFixed);
                  const fixedArrows = arrows.filter((a) => a.isFixed);
                  updateState(fixedAtoms, fixedBonds, fixedTexts, fixedArrows);
                  setSelectedEntityIds(
                    selectedEntityIds.filter((id) => isEntityFixed(id)),
                  );
                }
              }}
              className="w-20 h-10 bg-rose-50 hover:bg-rose-100 border border-rose-150 text-rose-500 rounded-xl font-bold text-xs uppercase tracking-tighter shadow-sm transition-all flex items-center justify-center gap-1 shrink-0 mt-2"
              title="Clear entire canvas drawing"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t("clear")}
            </button>
          </aside>
        ) : (
          /* Locked Read Only display: simple static reference column */
          <aside className="w-20 bg-slate-50 border-r border-slate-200 flex flex-col items-center py-6 space-y-4 shadow-[1px_0_4px_rgba(0,0,0,0.01)] z-10 shrink-0 select-none">
            <span className="text-base uppercase font-black tracking-widest text-slate-400 rotate-270 whitespace-nowrap mt-4 inline-block font-mono">
              LOCKED
            </span>
          </aside>
        )}

        {/* Main Canvas Area */}
        <main className="flex-1 bg-white relative overflow-hidden flex flex-col shadow-inner">
          {/* Chain Type Toolbar */}
          {!isReadOnly && !testReadOnlyMode && mode === "chain" && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg border border-slate-200 p-1 flex gap-1 z-30">
              <button
                onClick={() => setChainType("normal")}
                className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-bold transition-colors",
                  chainType === "normal"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:bg-slate-50",
                )}
              >
                {t("normalChain") || "Normal Chain"}
              </button>
              <button
                onClick={() => setChainType("fatty-acid")}
                className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-bold transition-colors",
                  chainType === "fatty-acid"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:bg-slate-50",
                )}
              >
                {t("fattyAcid") || "Fatty Acid"}
              </button>
            </div>
          )}

          <div className="flex-1 relative canvas-grid overflow-hidden">
            <svg
              ref={svgRef}
              className="w-full h-full touch-none"
              onPointerDown={handleSvgPointerDown}
              onPointerUp={handleSvgPointerUp}
            >
              <g ref={gRef} transform={`scale(${scale})`}>
                {selectionBoxStart &&
                  selectionBoxCurrent &&
                  mode === "select" && (
                    <rect
                      x={Math.min(selectionBoxStart.x, selectionBoxCurrent.x)}
                      y={Math.min(selectionBoxStart.y, selectionBoxCurrent.y)}
                      width={Math.abs(
                        selectionBoxCurrent.x - selectionBoxStart.x,
                      )}
                      height={Math.abs(
                        selectionBoxCurrent.y - selectionBoxStart.y,
                      )}
                      fill="rgba(99, 102, 241, 0.1)"
                      stroke="rgba(99, 102, 241, 0.5)"
                      strokeWidth="1"
                      className="pointer-events-none"
                    />
                  )}

                {/* Render Bonds */}
                {visibleBonds.map((bond) => {
                  const atom1 = atoms.find((a) => a.id === bond.atom1Id);
                  const atom2 = atoms.find((a) => a.id === bond.atom2Id);
                  if (!atom1 || !atom2) return null;
                  return (
                    <BondRenderer
                      key={bond.id}
                      bond={bond}
                      atom1={atom1}
                      atom2={atom2}
                      onPointerDown={(e) => handleBondPointerDown(e, bond.id)}
                      isEraser={mode === "erase"}
                      isSelected={selectedEntityIds.includes(bond.id)}
                      skeletalMode={skeletalMode}
                      filledMode={filledMode}
                    />
                  );
                })}

                {/* Dragging Preview */}
                {dragStartAtom && mode !== "chain" && (
                  <line
                    x1={atoms.find((a) => a.id === dragStartAtom)?.x}
                    y1={atoms.find((a) => a.id === dragStartAtom)?.y}
                    x2={mousePos.x}
                    y2={mousePos.y}
                    className="stroke-indigo-300 stroke-[3] opacity-60 pointer-events-none"
                    strokeDasharray="6 4"
                  />
                )}
                {dragStartAtom && mode === "chain" && (
                  <g className="pointer-events-none">
                    {(() => {
                      const startA = atoms.find((a) => a.id === dragStartAtom);
                      if (!startA) return null;
                      const pts = getChainPreview(
                        startA.x,
                        startA.y,
                        mousePos.x,
                        mousePos.y,
                      );
                      if (pts.length < 2) return null;
                      return (
                        <>
                          {pts.slice(0, -1).map((pt, i) => (
                            <line
                              key={`chain-${i}`}
                              x1={pt.x}
                              y1={pt.y}
                              x2={pts[i + 1].x}
                              y2={pts[i + 1].y}
                              className="stroke-indigo-400 stroke-[3] opacity-70"
                              strokeDasharray="6 4"
                            />
                          ))}
                          <rect
                            x={pts[pts.length - 1].x + 10}
                            y={pts[pts.length - 1].y + 10}
                            width="24"
                            height="24"
                            rx="4"
                            fill="white"
                            className="stroke-slate-200"
                            strokeWidth="1"
                          />
                          <text
                            x={pts[pts.length - 1].x + 22}
                            y={pts[pts.length - 1].y + 27}
                            fontSize="14"
                            fontWeight="bold"
                            fill="#4f46e5"
                            textAnchor="middle"
                          >
                            {pts.length}
                          </text>
                        </>
                      );
                    })()}
                  </g>
                )}

                {/* Render Atoms */}
                {visibleAtoms.map((atom) => (
                  <AtomRenderer
                    key={atom.id}
                    atom={atom}
                    onPointerDown={(e) => handleAtomPointerDown(e, atom.id)}
                    isEraser={mode === "erase"}
                    isSelected={selectedEntityIds.includes(atom.id)}
                    currentValency={getAtomValency(atom.id)}
                    expectedValency={getExpectedValency(atom.symbol)}
                    allAtoms={atoms}
                    connectedBonds={bonds.filter(
                      (b) => b.atom1Id === atom.id || b.atom2Id === atom.id,
                    )}
                    hideCHydrogens={hideCHydrogens}
                    skeletalMode={skeletalMode}
                    hideImplicitHydrogens={hideImplicitHydrogens}
                    filledMode={filledMode}
                    showValencyWarnings={showValencyWarnings}
                  />
                ))}

                {/* Molecule-Level Brackets and Charges */}
                {connectedComponents.map((comp, i) => {
                  if (comp.totalCharge === 0) return null;

                  let minX = Infinity,
                    minY = Infinity,
                    maxX = -Infinity,
                    maxY = -Infinity;
                  comp.atoms.forEach((a) => {
                    const r = getAtomRadius(a.symbol);

                    const v = bonds
                      .filter((b) => b.atom1Id === a.id || b.atom2Id === a.id)
                      .reduce(
                        (sum, b) =>
                          sum +
                          (Number(b.order) === 4 || Number(b.order) === 5
                            ? 1
                            : Number(b.order)),
                        0,
                      );
                    const implicitH = Math.max(
                      0,
                      getExpectedValency(a.symbol) - v,
                    );
                    const shouldHideImplicitH =
                      hideImplicitHydrogens ||
                      ((hideCHydrogens || skeletalMode) && a.symbol === "C");

                    let extraX = 0;
                    if (
                      a.symbol !== "H" &&
                      implicitH > 0 &&
                      !shouldHideImplicitH
                    ) {
                      extraX = 14;
                    }
                    if (a.x - r < minX) minX = a.x - r;
                    if (a.y - r < minY) minY = a.y - r;
                    if (a.x + r + extraX > maxX) maxX = a.x + r + extraX;
                    if (a.y + r > maxY) maxY = a.y + r;
                  });

                  const bracketWidth = 10;
                  const marginX = 12;
                  const marginY = 12;

                  const leftX = minX - marginX;
                  const rightX = maxX + marginX;
                  const topY = minY - marginY;
                  const botY = maxY + marginY;

                  return (
                    <g key={`comp-charge-${i}`} className="pointer-events-none">
                      <g
                        stroke={
                          comp.atoms[0]?.color ||
                          getAtomColor(comp.atoms[0]?.symbol) ||
                          "#475569"
                        }
                        strokeWidth="1.5"
                        fill="none"
                        opacity="0.8"
                      >
                        <path
                          d={`M ${leftX + bracketWidth} ${topY} L ${leftX} ${topY} L ${leftX} ${botY} L ${leftX + bracketWidth} ${botY}`}
                        />
                        <path
                          d={`M ${rightX - bracketWidth} ${topY} L ${rightX} ${topY} L ${rightX} ${botY} L ${rightX - bracketWidth} ${botY}`}
                        />
                      </g>
                      <g transform={`translate(${rightX + 16}, ${topY + 8})`}>
                        <text
                          dy="0.35em"
                          textAnchor="middle"
                          fill="#475569"
                          className="font-black text-[16px] opacity-90 uppercase tracking-tighter"
                        >
                          {Math.abs(comp.totalCharge) > 1
                            ? `${Math.abs(comp.totalCharge)}${comp.totalCharge > 0 ? "+" : "-"}`
                            : comp.totalCharge > 0
                              ? "+"
                              : "-"}
                        </text>
                      </g>
                    </g>
                  );
                })}

                {/* Render Arrows */}
                {arrows.map((arrow) => {
                  const dx = arrow.endX - arrow.startX;
                  const dy = arrow.endY - arrow.startY;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                  const isSelected = selectedEntityIds.includes(arrow.id);
                  const color =
                    mode === "erase" && isSelected
                      ? "#ef4444"
                      : arrow.color || "#1e293b";
                  return (
                    <g
                      key={arrow.id}
                      onPointerDown={(e) => handleArrowPointerDown(e, arrow.id)}
                      className={cn(
                        "cursor-pointer",
                        mode === "erase" && "hover:opacity-50",
                      )}
                    >
                      {/* Interaction target */}
                      <line
                        x1={arrow.startX}
                        y1={arrow.startY}
                        x2={arrow.endX}
                        y2={arrow.endY}
                        stroke="transparent"
                        strokeWidth="15"
                      />
                      {isSelected && (
                        <line
                          x1={arrow.startX}
                          y1={arrow.startY}
                          x2={arrow.endX}
                          y2={arrow.endY}
                          stroke="#6366f1"
                          strokeWidth="6"
                          strokeLinecap="round"
                          opacity="0.4"
                        />
                      )}
                      <line
                        x1={arrow.startX}
                        y1={arrow.startY}
                        x2={arrow.endX}
                        y2={arrow.endY}
                        stroke={color}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <polygon
                        points="0,-4 8,0 0,4"
                        fill={color}
                        transform={`translate(${arrow.endX}, ${arrow.endY}) rotate(${angle})`}
                      />
                    </g>
                  );
                })}

                {/* Render Preview Arrow */}
                {dragStartArrow && mode === "arrow" && mousePos && (
                  <g className="pointer-events-none opacity-50">
                    <line
                      x1={dragStartArrow.x}
                      y1={dragStartArrow.y}
                      x2={mousePos.x}
                      y2={mousePos.y}
                      stroke="#1e293b"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray="4"
                    />
                    <polygon
                      points="0,-4 8,0 0,4"
                      fill="#1e293b"
                      transform={`translate(${mousePos.x}, ${mousePos.y}) rotate(${(Math.atan2(mousePos.y - dragStartArrow.y, mousePos.x - dragStartArrow.x) * 180) / Math.PI})`}
                    />
                  </g>
                )}

                {/* Render Texts */}
                {texts.map((text) => {
                  const isSelected = selectedEntityIds.includes(text.id);
                  const scaleVal = text.size || 1;
                  const textColor =
                    mode === "erase" && isSelected
                      ? "#e11d48"
                      : text.color || "#1e293b";
                  return (
                    <foreignObject
                      key={text.id}
                      x={text.x - 400}
                      y={text.y - 150}
                      width="800"
                      height="300"
                      className="overflow-visible pointer-events-none"
                    >
                      <div className="flex items-center justify-center w-full h-full">
                        <span
                          dir="ltr"
                          onPointerDown={(e) =>
                            handleTextPointerDown(e, text.id)
                          }
                          className={cn(
                            "px-2 py-1 bg-transparent rounded text-sm max-w-full text-center inline-block whitespace-pre font-sans font-bold",
                            mode !== "select" &&
                              mode !== "erase" &&
                              mode !== "text"
                              ? "pointer-events-none"
                              : "pointer-events-auto cursor-pointer",
                            isSelected &&
                              "ring-2 ring-indigo-400 bg-indigo-50/50",
                            mode === "erase" &&
                              isSelected &&
                              "ring-rose-400 bg-rose-50/50 text-rose-600",
                            mode === "erase" && "hover:opacity-50",
                          )}
                          style={{
                            color: textColor,
                            transform: `scale(${scaleVal}) rotate(${text.rotation || 0}deg)`,
                            transformOrigin: "center center",
                          }}
                          dangerouslySetInnerHTML={{
                            __html: katex.renderToString(text.text, {
                              throwOnError: false,
                              output: "html",
                            }),
                          }}
                        />
                      </div>
                    </foreignObject>
                  );
                })}

                {/* Status for individual molecules if grading is active */}
                {(isReadOnly || testReadOnlyMode) &&
                  componentMatchResults.map((res, i) => {
                    const isPurelyFixed =
                      res.molecule.atoms.length > 0 &&
                      res.molecule.atoms.every((a) => a.isFixed);
                    if (isPurelyFixed || res.molecule.atoms.length === 0)
                      return null;
                    return (
                      <g
                        key={`status-${i}`}
                        transform={`translate(${res.cx}, ${res.cy})`}
                        className="pointer-events-none"
                      >
                        <circle
                          r="16"
                          fill={res.isMatch ? "#10b981" : "#ef4444"}
                          className="drop-shadow-md"
                        />
                        {res.isMatch ? (
                          <path
                            d="M -6 0 L -2 4 L 6 -4"
                            fill="none"
                            stroke="white"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ) : (
                          <>
                            <path
                              d="M -4 -4 L 4 4 M -4 4 L 4 -4"
                              fill="none"
                              stroke="white"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            {res.errorKey && (
                              <text
                                y="28"
                                textAnchor="middle"
                                className="text-[10px] font-bold fill-rose-600"
                                style={{
                                  textShadow:
                                    "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff",
                                }}
                              >
                                {t(res.errorKey)}
                              </text>
                            )}
                          </>
                        )}
                      </g>
                    );
                  })}
              </g>
            </svg>

            {/* If Student Review OR Test Mode, render the floating report */}
            {(isReadOnly || testReadOnlyMode) && (
              <div
                id="grading-report"
                style={{
                  transform: `translate(${gradePanelOffset.x}px, ${gradePanelOffset.y}px)`,
                }}
                onPointerDown={(e) => {
                  isDraggingGradeRef.current = true;
                  dragGradeStartRef.current = { x: e.clientX, y: e.clientY };
                  dragGradeInitialOffsetRef.current = { ...gradePanelOffset };
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(
                    e.pointerId,
                  );
                }}
                className="absolute top-4 right-4 w-64 bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl rounded-2xl p-4 z-30 flex flex-col pointer-events-auto select-none cursor-move"
              >
                {teacherAnswer ? (
                  <div className="flex flex-col gap-2">
                    <div
                      className={cn(
                        "flex items-center space-x-2 p-2 rounded-lg",
                        score === 1
                          ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                          : score && score > 0
                            ? "border-amber-100 bg-amber-50 text-amber-800"
                            : "border-rose-100 bg-rose-50 text-rose-800",
                      )}
                    >
                      {score === 1 ? (
                        <>
                          <Check className="w-6 h-6 text-emerald-600 font-bold" />
                          <div className="flex-1">
                            <h4 className="font-sans font-black text-sm tracking-wider uppercase">
                              {t("submissionCorrect")}
                            </h4>
                          </div>
                          <span className="px-2 py-0.5 bg-emerald-600 text-white rounded font-mono font-black text-sm">
                            100%
                          </span>
                        </>
                      ) : (
                        <>
                          {(score === null || score === 0) && (
                            <X className="w-6 h-6 text-rose-600 font-bold shrink-0" />
                          )}
                          <div className="flex-1">
                            <h4 className="font-sans font-black text-sm tracking-wider uppercase">
                              {t("submissionIncorrect")}
                            </h4>
                          </div>
                          <span
                            className={cn(
                              "px-2 py-0.5 text-white rounded font-mono font-black text-sm",
                              score && score > 0
                                ? "bg-amber-500"
                                : "bg-rose-600",
                            )}
                          >
                            {Math.round((score || 0) * 100)}%
                          </span>
                        </>
                      )}
                    </div>
                    {score !== 1 &&
                      componentMatchResults.length !==
                        teacherMoleculesCount && (
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 space-y-1">
                          {componentMatchResults.length <
                            teacherMoleculesCount && (
                            <span className="block font-bold text-rose-500">
                              {t("errMissingMol")}
                            </span>
                          )}
                          {componentMatchResults.length >
                            teacherMoleculesCount && (
                            <span className="block font-bold text-amber-500">
                              {t("errExtraMol")}
                            </span>
                          )}
                        </div>
                      )}
                  </div>
                ) : (
                  <div className="p-2 text-sm text-amber-800 flex flex-col items-center gap-2">
                    <AlertCircle className="w-10 h-10 text-amber-500 animate-bounce" />
                    <p className="font-bold text-center">{t("noAnswerKey")}</p>
                    <p className="text-base text-amber-600 text-center leading-normal">
                      {t("noAnswerSubtext")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Status Bar */}
          <footer className="h-10 bg-slate-50 border-t border-slate-200 flex items-center px-4 justify-between shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.02)]">
            <div className="flex items-center space-x-2">
              <div className="bg-white px-2 py-1 border border-slate-200 rounded text-[11px] font-mono shadow-sm text-slate-500 font-bold uppercase tracking-wider">
                X: {Math.round(mousePos.x)} Y: {Math.round(mousePos.y)}
              </div>
              <div className="bg-white px-2 py-1 border border-slate-200 rounded shadow-sm text-slate-500 font-bold uppercase flex items-center gap-1.5 pointer-events-auto">
                <button
                  onPointerDown={() => setScale((s) => Math.max(0.1, s - 0.1))}
                  className="hover:text-indigo-600 transition-colors bg-slate-50 rounded h-5 w-5 flex items-center justify-center border border-slate-200"
                >
                  -
                </button>
                <span className="text-[11px] min-w-[50px] text-center font-mono">
                  {t("scale")}: {scale.toFixed(1)}x
                </span>
                <button
                  onPointerDown={() => setScale((s) => Math.min(5, s + 0.1))}
                  className="hover:text-indigo-600 transition-colors bg-slate-50 rounded h-5 w-5 flex items-center justify-center border border-slate-200"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex space-x-4 items-center overflow-hidden">
              <span className="text-[11px] sm:text-xs font-extrabold text-slate-400 uppercase tracking-tighter shrink-0 flex items-center gap-1">
                <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-slate-300 rounded-full" />{" "}
                {t("atoms")}:{" "}
                {selectedAtoms && selectedAtoms.length > 0
                  ? `${selectedAtoms.length} / ${atoms.length}`
                  : atoms.length}
              </span>
              <span className="text-[11px] sm:text-xs font-extrabold text-slate-400 uppercase tracking-tighter shrink-0 flex items-center gap-1">
                <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-slate-300 rounded-full" />{" "}
                {t("bonds")}:{" "}
                {selectedBonds && selectedBonds.length > 0
                  ? `${selectedBonds.length} / ${bonds.length}`
                  : bonds.length}
              </span>
            </div>
          </footer>
        </main>

        {/* Inspector Sidebar */}
        {!testReadOnlyMode && (
          <aside className="w-56 bg-slate-50 border-l border-slate-200 flex flex-col overflow-hidden shadow-inner shrink-0">
            {!isStudentMode && (
              <div className="p-3 border-b border-indigo-200 bg-indigo-50/50 space-y-3">
                {/* Language Selection */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
                    Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as Language)}
                    className="w-full bg-white border border-slate-200 rounded text-xs font-bold text-slate-700 p-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                  >
                    <option value="Eng">English</option>
                    <option value="Heb">עברית</option>
                    <option value="Ara">العربية</option>
                  </select>
                </div>

                {/* Publish Answer Key */}
                <button
                  onClick={copyToClipboard}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] py-2.5 rounded-lg text-white text-xs font-bold tracking-widest uppercase transition-all shadow-md mt-2"
                >
                  {copied ? t("syncedToQuestion") : t("publishAnswerKey")}
                </button>

                {/* TA Variable Output */}
                {taValue && (
                  <div className="pt-2 border-t border-indigo-200/50">
                    <label className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest block mb-1">
                      STACK 'ta' Output
                    </label>
                    <textarea
                      value={`ta:"${taValue}";`}
                      readOnly
                      onClick={() => {
                        navigator.clipboard.writeText(`ta:"${taValue}";`);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className={cn(
                        "w-full h-24 bg-white border border-indigo-200 rounded py-1 px-2 text-[10px] font-mono text-slate-700 resize-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors",
                        copied &&
                          "bg-indigo-100 border-indigo-400 text-indigo-900",
                      )}
                      title="Click to copy"
                    />
                    {copied && (
                      <p className="text-[10px] font-bold text-indigo-600 text-center mt-1">
                        Copied to clipboard!
                      </p>
                    )}
                    <p className="text-[10px] text-slate-500 mt-2 font-semibold">
                      {t("answerKeySupplied")}
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-4 border-b border-slate-200 bg-white">
                <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-4">
                  {t("entityProperties")}
                </h3>

                {selectedEntityIds.length > 0 ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-sm font-bold text-slate-700">
                        {selectedEntityIds.length > 1
                          ? `${selectedEntityIds.length} ${t("entitiesSelected")}`
                          : selectedAtom
                            ? `${t("elementLabel")}: ${selectedAtom.symbol}`
                            : selectedBond
                              ? `${t("bondLabel")}: ${selectedBond.order === 0 ? "H-Bond" : selectedBond.order === 1 ? "Single" : selectedBond.order === 2 ? "Double" : selectedBond.order === 3 ? "Triple" : selectedBond.order === 4 ? "Wedge" : "Dash"}`
                              : selectedText
                                ? "Text"
                                : selectedArrow
                                  ? "Arrow"
                                  : "Unknown"}
                      </span>
                      <span className="text-base px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full font-mono font-bold flex items-center justify-center">
                        {selectedAtom
                          ? selectedAtom.symbol
                          : selectedBond
                            ? selectedBond.order === 0
                              ? "H"
                              : selectedBond.order === 1
                                ? <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2"><line x1="2" y1="8" x2="14" y2="8" /></svg>
                                : selectedBond.order === 2
                                  ? <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2"><line x1="2" y1="5" x2="14" y2="5" /><line x1="2" y1="11" x2="14" y2="11" /></svg>
                                  : selectedBond.order === 3
                                    ? <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5"><line x1="2" y1="4" x2="14" y2="4" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="12" x2="14" y2="12" /></svg>
                                    : selectedBond.order === 4
                                      ? <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><polygon points="8,2 14,14 2,14" /></svg>
                                      : <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3"><line x1="2" y1="8" x2="14" y2="8" /></svg>
                            : selectedText
                              ? "TXT"
                              : selectedArrow
                                ? "→"
                                : "MULT"}
                      </span>
                    </div>

                    {selectedEntityIds.some((id) => isEntityFixed(id)) ? (
                      <div className="mt-4 text-sm font-bold text-amber-600 bg-amber-50 p-2 text-center rounded border border-amber-200">
                        Read-only property
                      </div>
                    ) : (
                      <>
                        <div className="mb-4 space-y-1">
                          <div className="flex gap-1 flex-wrap items-center">
                            <button
                              onClick={() => reflectSelection("horizontal")}
                              className="px-2 py-1 text-sm font-bold rounded border bg-white text-slate-500 border-slate-200 hover:border-slate-300 transition-all flex-1"
                            >
                              {t("reflectH")}
                            </button>
                            <button
                              onClick={() => reflectSelection("vertical")}
                              className="px-2 py-1 text-sm font-bold rounded border bg-white text-slate-500 border-slate-200 hover:border-slate-300 transition-all flex-1"
                            >
                              {t("reflectV")}
                            </button>
                            {selectedEntityIds.length >= 2 && (
                              <button
                                onClick={() => alignSelectionHorizontal()}
                                className="px-2 py-1 text-sm font-bold rounded border bg-white text-slate-500 border-slate-200 hover:border-slate-300 transition-all w-full mt-1 whitespace-nowrap"
                              >
                                Straighten
                              </button>
                            )}
                          </div>
                          <div className="mt-3 space-y-3">
                            <div>
                              <label className="text-sm text-slate-400 uppercase font-black tracking-tight mb-1 block">
                                {t("rotateFreely")}
                              </label>
                              <input
                                type="range"
                                min="-180"
                                max="180"
                                defaultValue="0"
                                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-ew-resize accent-indigo-500"
                                onPointerDown={(e) => {
                                  rotationLastValRef.current = 0;
                                  (e.target as HTMLInputElement).value = "0";
                                  setDraftState({
                                    atoms,
                                    bonds,
                                    texts,
                                    arrows,
                                  });
                                }}
                                onInput={(e) => {
                                  const val = parseFloat(
                                    (e.target as HTMLInputElement).value,
                                  );
                                  const delta =
                                    val - rotationLastValRef.current;
                                  rotationLastValRef.current = val;
                                  rotateSelection(delta);
                                }}
                                onPointerUp={(e) => {
                                  (e.target as HTMLInputElement).value = "0";
                                  rotationLastValRef.current = 0;
                                  if (draftState) {
                                    updateState(
                                      draftState.atoms,
                                      draftState.bonds,
                                      draftState.texts,
                                      draftState.arrows,
                                    );
                                    setDraftState(null);
                                  }
                                }}
                                onPointerLeave={(e) => {
                                  if (draftState) {
                                    (e.target as HTMLInputElement).value = "0";
                                    rotationLastValRef.current = 0;
                                    updateState(
                                      draftState.atoms,
                                      draftState.bonds,
                                      draftState.texts,
                                      draftState.arrows,
                                    );
                                    setDraftState(null);
                                  }
                                }}
                              />
                            </div>
                            <div>
                              <label className="text-sm text-slate-400 uppercase font-black tracking-tight mb-1 block">
                                Scale
                              </label>
                              <input
                                type="range"
                                min="50"
                                max="200"
                                defaultValue="100"
                                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-ew-resize accent-indigo-500"
                                onPointerDown={(e) => {
                                  scaleLastValRef.current = 100;
                                  (e.target as HTMLInputElement).value = "100";
                                  setDraftState({
                                    atoms,
                                    bonds,
                                    texts,
                                    arrows,
                                  });
                                }}
                                onInput={(e) => {
                                  const val = parseFloat(
                                    (e.target as HTMLInputElement).value,
                                  );
                                  const factor = val / scaleLastValRef.current;
                                  scaleLastValRef.current = val;
                                  scaleSelection(factor);
                                }}
                                onPointerUp={(e) => {
                                  (e.target as HTMLInputElement).value = "100";
                                  scaleLastValRef.current = 100;
                                  if (draftState) {
                                    updateState(
                                      draftState.atoms,
                                      draftState.bonds,
                                      draftState.texts,
                                      draftState.arrows,
                                    );
                                    setDraftState(null);
                                  }
                                }}
                                onPointerLeave={(e) => {
                                  if (draftState) {
                                    (e.target as HTMLInputElement).value =
                                      "100";
                                    scaleLastValRef.current = 100;
                                    updateState(
                                      draftState.atoms,
                                      draftState.bonds,
                                      draftState.texts,
                                      draftState.arrows,
                                    );
                                    setDraftState(null);
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {(selectedTexts.length > 0 ||
                          selectedArrows.length > 0) && (
                          <div className="mb-4 space-y-3 p-3 bg-white border border-slate-200 rounded shadow-sm">
                            <div>
                              <label className="text-sm text-slate-400 uppercase font-black tracking-tight mb-1 block">
                                Color
                              </label>
                              <input
                                type="color"
                                value={
                                  selectedTexts[0]?.color ||
                                  selectedArrows[0]?.color ||
                                  "#1e293b"
                                }
                                onChange={(e) => {
                                  const newColor = e.target.value;
                                  const newTexts = texts.map((t) =>
                                    selectedEntityIds.includes(t.id)
                                      ? { ...t, color: newColor }
                                      : t,
                                  );
                                  const newArrows = arrows.map((a) =>
                                    selectedEntityIds.includes(a.id)
                                      ? { ...a, color: newColor }
                                      : a,
                                  );
                                  updateState(
                                    atoms,
                                    bonds,
                                    newTexts,
                                    newArrows,
                                  );
                                }}
                                className="w-full h-10 border-0 cursor-pointer rounded overflow-hidden"
                              />
                            </div>
                          </div>
                        )}

                        {selectedAtoms.length > 0 && (
                          <div className="flex flex-col gap-3">
                            {selectedAtoms.length === 1 && selectedAtom && (
                              <div className="space-y-1">
                                <label className="text-sm text-slate-400 uppercase font-black tracking-tight">
                                  {t("swapElement")}
                                </label>
                                <div className="flex flex-wrap gap-1">
                                  {quickElements.map((el) => (
                                    <button
                                      key={el}
                                      onClick={() =>
                                        updateState(
                                          atoms.map((a) =>
                                            selectedEntityIds.includes(a.id)
                                              ? { ...a, symbol: el }
                                              : a,
                                          ),
                                          bonds,
                                        )
                                      }
                                      className={cn(
                                        "px-2 py-1 text-base font-bold rounded border transition-all flex-1 text-center min-w-[32px]",
                                        selectedAtom.symbol === el
                                          ? "bg-indigo-600 text-white border-indigo-700 shadow-sm"
                                          : "bg-white text-slate-500 border-slate-200 hover:border-slate-300",
                                      )}
                                    >
                                      {el}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="space-y-1">
                              <label className="text-sm text-slate-400 uppercase font-black tracking-tight">
                                {t("charge")}
                              </label>
                              <div className="flex items-center gap-2 h-8">
                                <button
                                  onClick={() => {
                                    if (selectedAtoms.length === 0) return;
                                    const firstId = selectedAtoms[0].id;
                                    updateState(
                                      atoms.map((a) =>
                                        a.id === firstId
                                          ? {
                                              ...a,
                                              charge: (a.charge || 0) - 1,
                                            }
                                          : a,
                                      ),
                                      bonds,
                                    );
                                  }}
                                  className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 rounded font-black shadow-sm"
                                >
                                  -
                                </button>
                                <div className="flex-1 text-center font-black text-slate-700 bg-slate-50 border border-slate-200 rounded h-8 flex items-center justify-center shadow-inner">
                                  {selectedAtoms.reduce(
                                    (sum, a) => sum + (a.charge || 0),
                                    0,
                                  )}
                                </div>
                                <button
                                  onClick={() => {
                                    if (selectedAtoms.length === 0) return;
                                    const firstId = selectedAtoms[0].id;
                                    updateState(
                                      atoms.map((a) =>
                                        a.id === firstId
                                          ? {
                                              ...a,
                                              charge: (a.charge || 0) + 1,
                                            }
                                          : a,
                                      ),
                                      bonds,
                                    );
                                  }}
                                  className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 rounded font-black shadow-sm"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            {selectedAtoms.length === 1 && (
                              <div className="space-y-1">
                                <label className="text-sm text-slate-400 uppercase font-black tracking-tight">
                                  Color
                                </label>
                                <div className="flex items-center gap-2 h-8 w-full overflow-hidden">
                                  <input
                                    type="color"
                                    value={
                                      selectedAtom?.color ||
                                      getAtomColor(selectedAtom?.symbol || "")
                                    }
                                    onChange={(e) => {
                                      const newColor = e.target.value;
                                      customColorsRef.current[
                                        selectedAtom!.symbol
                                      ] = newColor;
                                      updateState(
                                        atoms.map((a) =>
                                          selectedEntityIds.includes(a.id)
                                            ? { ...a, color: newColor }
                                            : a,
                                        ),
                                        bonds,
                                      );
                                    }}
                                    className="w-8 h-8 rounded border border-slate-200 cursor-pointer p-0 bg-transparent shrink-0"
                                  />
                                  <div className="flex-1 text-center font-black text-slate-600 bg-slate-50 border border-slate-200 rounded h-8 flex items-center justify-center shadow-inner text-xs uppercase min-w-0 px-1 truncate">
                                    {selectedAtom?.color
                                      ? selectedAtom.color
                                      : "Default"}
                                  </div>
                                  {selectedAtom?.color && (
                                    <button
                                      onClick={() => {
                                        delete customColorsRef.current[
                                          selectedAtom!.symbol
                                        ];
                                        updateState(
                                          atoms.map((a) =>
                                            selectedEntityIds.includes(a.id)
                                              ? { ...a, color: undefined }
                                              : a,
                                          ),
                                          bonds,
                                        );
                                      }}
                                      className="w-8 h-8 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-600 shrink-0 flex items-center justify-center font-bold"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {selectedBonds.length > 0 && (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <label className="text-sm text-slate-400 uppercase font-black tracking-tight">
                                {t("order")}
                              </label>
                              <div className="flex gap-1.5 h-10">
                                {[0, 1, 2, 3, 4, 5].map((o) => (
                                  <button
                                    key={o}
                                    onClick={() => {
                                      const newBonds = bonds.map((b) =>
                                        selectedEntityIds.includes(b.id)
                                          ? { ...b, order: o }
                                          : b,
                                      );
                                      const cleaned = removeExcessHydrogens(
                                        atoms,
                                        newBonds,
                                      );
                                      updateState(cleaned.atoms, cleaned.bonds);
                                    }}
                                    className={cn(
                                      "flex-1 py-1 text-sm font-black rounded border transition-all flex items-center justify-center",
                                      selectedBonds.every((b) => b.order === o)
                                        ? "bg-indigo-600 text-white border-indigo-700 shadow-inner"
                                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                                    )}
                                    title={
                                      o === 0
                                        ? "Hydrogen Bond"
                                        : o === 1
                                          ? "Single"
                                          : o === 2
                                            ? "Double"
                                            : o === 3
                                              ? "Triple"
                                              : o === 4
                                                ? "Wedge"
                                                : "Dash"
                                    }
                                  >
                                    {o === 0 ? (
                                      "H"
                                    ) : o === 1 ? (
                                      <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                                        <line x1="2" y1="8" x2="14" y2="8" />
                                      </svg>
                                    ) : o === 2 ? (
                                      <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                                        <line x1="2" y1="5" x2="14" y2="5" />
                                        <line x1="2" y1="11" x2="14" y2="11" />
                                      </svg>
                                    ) : o === 3 ? (
                                      <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5">
                                        <line x1="2" y1="4" x2="14" y2="4" />
                                        <line x1="2" y1="8" x2="14" y2="8" />
                                        <line x1="2" y1="12" x2="14" y2="12" />
                                      </svg>
                                    ) : o === 4 ? (
                                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <polygon points="8,2 14,14 2,14" />
                                      </svg>
                                    ) : (
                                      <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3">
                                        <line x1="2" y1="8" x2="14" y2="8" />
                                      </svg>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {selectedBonds.length === 1 &&
                              selectedBonds[0].order === 2 && (
                                <div className="space-y-1 mt-3">
                                  <button
                                    onClick={toggleCisTrans}
                                    className="w-full py-2 text-sm font-bold rounded border transition-all text-slate-600 border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300"
                                  >
                                    {t("toggleCisTrans") || "Toggle Cis/Trans"}
                                  </button>
                                </div>
                              )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-6 bg-slate-50/50 border border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center text-center">
                    <MousePointer2 className="w-10 h-10 text-slate-200 mb-2" />
                    <p className="text-base font-bold uppercase text-slate-300 tracking-widest">
                      {t("selectToInspect")}
                    </p>
                  </div>
                )}
              </div>

              {/* Collapsible Student Help Guide */}
              <div
                className={cn(
                  "p-4 border-t border-slate-200 bg-slate-50/40 shrink-0",
                  language !== "Eng" ? "rtl text-right" : "ltr text-left",
                )}
              >
                <button
                  onClick={() => setShowStudentGuide(!showStudentGuide)}
                  className="w-full flex items-center justify-between text-indigo-700 font-extrabold text-xs uppercase tracking-wider hover:text-indigo-800 transition-colors"
                >
                  <span className="flex items-center gap-1.5 font-sans">
                    <span>📖</span> {t("studentGuideTitle")}
                  </span>
                  <span className="text-xs transition-transform duration-200 font-mono">
                    {showStudentGuide ? "▲" : "▼"}
                  </span>
                </button>

                {showStudentGuide && (
                  <div className="mt-3 space-y-3 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
                    <div className="p-2.5 bg-white border border-slate-150 rounded-lg shadow-sm">
                      <h4 className="font-bold text-xs text-slate-800 mb-1 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-black font-sans">
                          1
                        </span>
                        {t("addAtomsLabel")}
                      </h4>
                      <p className="text-xs text-slate-500 leading-relaxed font-semibold">
                        {t("addAtomsDesc")}
                      </p>
                    </div>

                    <div className="p-2.5 bg-white border border-slate-150 rounded-lg shadow-sm">
                      <h4 className="font-bold text-xs text-slate-800 mb-1 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-black font-sans">
                          2
                        </span>
                        {t("addBondsLabel")}
                      </h4>
                      <p className="text-xs text-slate-500 leading-relaxed font-semibold">
                        {t("addBondsDesc")}
                      </p>
                    </div>

                    <div className="p-2.5 bg-white border border-slate-150 rounded-lg shadow-sm">
                      <h4 className="font-bold text-xs text-slate-800 mb-1 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-black font-sans">
                          3
                        </span>
                        {t("addLonePairsLabel")}
                      </h4>
                      <p className="text-xs text-slate-500 leading-relaxed font-semibold">
                        {t("addLonePairsDesc")}
                      </p>
                    </div>

                    <div className="p-2.5 bg-white border border-slate-150 rounded-lg shadow-sm">
                      <h4 className="font-bold text-xs text-slate-800 mb-1 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-black font-sans">
                          4
                        </span>
                        {t("eraseEditLabel")}
                      </h4>
                      <p className="text-xs text-slate-500 leading-relaxed font-semibold">
                        {t("eraseEditDesc")}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {!isStudentMode && (
                <div className="p-4 border-t border-slate-200 bg-white">
                  <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-2">
                    {t("savedGallery")}
                  </h3>

                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="checkbox"
                      id="strictMatch"
                      checked={strictMatching}
                      onChange={(e) => setStrictMatching(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-6 h-6"
                    />
                    <label
                      htmlFor="strictMatch"
                      className="text-base font-bold text-slate-500 cursor-pointer"
                    >
                      {t("strictMatch")}
                    </label>
                  </div>

                  <div className="space-y-1.5 mb-4 max-h-40 overflow-y-auto custom-scrollbar">
                    {savedMolecules.length === 0 && (
                      <p className="text-sm text-slate-300 italic text-center">
                        {t("noSavedStructures")}
                      </p>
                    )}
                    {savedMolecules.map((m) => (
                      <div key={m.id} className="flex gap-1">
                        <button
                          onClick={() => loadMolecule(m.data)}
                          className="flex-1 text-left p-1.5 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors flex justify-between items-center min-w-0"
                        >
                          <span className="truncate">{m.name}</span>
                          <span className="text-slate-400 font-mono italic text-xs ml-2 shrink-0">
                            {m.data.atoms.length} {t("atoms")}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            const result = areMoleculesEqual(
                              { atoms, bonds },
                              m.data,
                              strictMatching,
                            );
                            alert(result.message);
                          }}
                          className="px-2 bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100 rounded text-xs font-bold transition-all whitespace-nowrap shrink-0"
                          title={t("compare")}
                        >
                          {t("compare")}
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-2 mb-4">
                    <button
                      onClick={saveMolecule}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white px-3 py-1.5 rounded font-bold text-sm uppercase tracking-widest shadow-sm transition-all"
                    >
                      {t("saveStructureBtn")}
                    </button>
                  </div>
                  <button
                    onClick={() => setShowPubChemPrompt(true)}
                    className="w-full bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white px-3 py-1.5 rounded font-bold text-sm uppercase tracking-widest shadow-sm transition-all mb-4"
                  >
                    {t("importPubChem")}
                  </button>
                  <div className="mb-4">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center mb-1">
                      {t("exportImage")}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => exportImage("svg")}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white px-2 py-1.5 rounded font-bold text-xs uppercase tracking-widest shadow-sm transition-all"
                      >
                        {t("exportSvg")}
                      </button>
                      <button
                        onClick={() => exportImage("png")}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white px-2 py-1.5 rounded font-bold text-xs uppercase tracking-widest shadow-sm transition-all"
                      >
                        {t("exportPng")}
                      </button>
                      <button
                        onClick={() => exportImage("jpg")}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white px-2 py-1.5 rounded font-bold text-xs uppercase tracking-widest shadow-sm transition-all"
                      >
                        {t("exportJpg")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {!isStudentMode &&
                window.parent !== window &&
                !isStackEnvironment && (
                  <div className="p-4 border-t border-slate-200 bg-white">
                    <a
                      href={window.location.origin + "/molecule-editor.html"}
                      onClick={downloadStandaloneHtml}
                      download="molecule-editor.html"
                      className="w-full flex items-center justify-center bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded font-bold text-sm uppercase tracking-widest shadow-sm transition-all mb-2"
                    >
                      📥 {t("downloadHtml")}
                    </a>
                  </div>
                )}
            </div>
          </aside>
        )}
      </div>

      {/* PubChem import modal */}
      {showPubChemPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-96 max-w-full">
            <h3 className="font-bold text-slate-800 text-lg mb-2">
              {t("importPubChem")}
            </h3>
            <p className="text-slate-500 text-sm mb-4">
              Search by compound name (e.g. Benzene, Caffeine, Aspirin) to
              import a 2D structure.
            </p>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Caffeine"
              value={pubChemQuery}
              onChange={(e) => setPubChemQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") importFromPubChem();
                if (e.key === "Escape") setShowPubChemPrompt(false);
              }}
              className="w-full border-2 border-slate-200 rounded p-2 text-center font-bold text-lg text-slate-800 uppercase focus:border-indigo-400 focus:ring-0 outline-none mb-2"
            />
            {pubChemError && (
              <p className="text-red-500 text-xs font-bold mb-4">
                {pubChemError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowPubChemPrompt(false);
                  setPubChemQuery("");
                  setPubChemError("");
                }}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded font-bold"
              >
                {t("cancelBtn")}
              </button>
              <button
                disabled={pubChemLoading}
                onClick={importFromPubChem}
                className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded font-bold flex justify-center items-center"
              >
                {pubChemLoading ? (
                  <span className="animate-pulse">...</span>
                ) : (
                  t("importPubChem")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save molecule overlay modal */}
      {showSavePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-80 max-w-full">
            <h3 className="font-bold text-slate-800 text-sm mb-4">
              {t("saveTitle")}
            </h3>
            <input
              autoFocus
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") executeSaveMolecule();
                if (e.key === "Escape") setShowSavePrompt(false);
              }}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
              placeholder={t("saveTitle")}
            />
            <div className="flex justify-end gap-2 text-sm font-bold font-sans">
              <button
                onClick={() => setShowSavePrompt(false)}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded"
              >
                {t("cancelBtn")}
              </button>
              <button
                onClick={executeSaveMolecule}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded"
              >
                {t("saveBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom element overlay modal */}
      {showElementPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-80 max-w-full">
            <h3 className="font-bold text-slate-800 text-sm mb-4">
              {t("otherElementTitle")}
            </h3>
            <input
              autoFocus
              type="text"
              value={customElement}
              onChange={(e) => setCustomElement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customElement) {
                  setSelectedElement(customElement as ElementType);
                  setMode("atom");
                  setShowElementPrompt(false);
                  setCustomElement("");
                }
                if (e.key === "Escape") {
                  setShowElementPrompt(false);
                  setCustomElement("");
                }
              }}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
              placeholder="e.g. Fe, Na, Ag"
            />
            <div className="flex justify-end gap-2 text-sm font-bold font-sans">
              <button
                onClick={() => {
                  setShowElementPrompt(false);
                  setCustomElement("");
                }}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded"
              >
                {t("cancelBtn")}
              </button>
              <button
                onClick={() => {
                  if (customElement) {
                    setSelectedElement(customElement as ElementType);
                    setMode("atom");
                    setShowElementPrompt(false);
                    setCustomElement("");
                  }
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded"
              >
                {t("selectBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {textPrompt && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-sm w-full animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Edit Text</h3>
            <p className="text-xs text-slate-500 mb-4 tracking-wide font-mono">
              LaTeX supported (e.g., \Delta G, H_2O, \alpha)
            </p>
            <input
              autoFocus
              type="text"
              value={textPrompt.initialValue}
              onChange={(e) =>
                setTextPrompt({ ...textPrompt, initialValue: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = textPrompt.initialValue;
                  if (textPrompt.id) {
                    if (val.trim() === "") {
                      updateState(
                        atoms,
                        bonds,
                        texts.filter((t) => t.id !== textPrompt.id),
                        arrows,
                      );
                    } else {
                      updateState(
                        atoms,
                        bonds,
                        texts.map((t) =>
                          t.id === textPrompt.id
                            ? {
                                ...t,
                                text: val.trim(),
                                size: textPrompt.initialSize,
                              }
                            : t,
                        ),
                        arrows,
                      );
                    }
                  } else {
                    if (val.trim() !== "") {
                      const newText: CanvasText = {
                        id: crypto.randomUUID(),
                        x: textPrompt.x!,
                        y: textPrompt.y!,
                        text: val.trim(),
                        size: textPrompt.initialSize,
                      };
                      updateState(atoms, bonds, [...texts, newText], arrows);
                    }
                  }
                  setTextPrompt(null);
                  setMode("select");
                }
                if (e.key === "Escape") {
                  setTextPrompt(null);
                  setMode("select");
                }
              }}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4 font-mono select-auto"
              placeholder="Enter text..."
            />

            <div className="flex items-center gap-2 mb-4">
              <label className="text-sm font-bold text-slate-700">Size:</label>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={textPrompt.initialSize}
                onChange={(e) =>
                  setTextPrompt({
                    ...textPrompt,
                    initialSize: parseFloat(e.target.value),
                  })
                }
                className="flex-1"
              />
              <span className="text-xs font-mono text-slate-500 w-8">
                {textPrompt.initialSize}x
              </span>
            </div>

            <div className="flex justify-end gap-2 text-sm font-bold font-sans">
              <button
                onClick={() => {
                  setTextPrompt(null);
                  setMode("select");
                }}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  const val = textPrompt.initialValue;
                  if (textPrompt.id) {
                    if (val.trim() === "") {
                      updateState(
                        atoms,
                        bonds,
                        texts.filter((t) => t.id !== textPrompt.id),
                        arrows,
                      );
                    } else {
                      updateState(
                        atoms,
                        bonds,
                        texts.map((t) =>
                          t.id === textPrompt.id
                            ? {
                                ...t,
                                text: val.trim(),
                                size: textPrompt.initialSize,
                              }
                            : t,
                        ),
                        arrows,
                      );
                    }
                  } else {
                    if (val.trim() !== "") {
                      const newText: CanvasText = {
                        id: crypto.randomUUID(),
                        x: textPrompt.x!,
                        y: textPrompt.y!,
                        text: val.trim(),
                        size: textPrompt.initialSize,
                      };
                      updateState(atoms, bonds, [...texts, newText], arrows);
                    }
                  }
                  setTextPrompt(null);
                  setMode("select");
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded"
              >
                Save
              </button>
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
  variant = "primary",
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  variant?: "primary" | "danger";
}) {
  return (
    <div className="flex flex-col items-center space-y-1 w-full max-w-[54px]">
      <button
        onPointerDown={onClick}
        title={label}
        className={cn(
          "w-11 h-11 flex items-center justify-center rounded-xl border transition-all relative overflow-hidden group touch-action-none",
          active
            ? variant === "danger"
              ? "border-red-200 bg-red-100 text-red-600 shadow-sm"
              : "border-indigo-200 bg-indigo-50 text-indigo-600 shadow-sm"
            : "border-slate-100 bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-600",
        )}
      >
        <div
          className={cn(
            "transition-transform group-active:scale-90",
            active && "scale-105",
          )}
        >
          {icon}
        </div>
        {active && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 h-0.5",
              variant === "danger" ? "bg-red-500" : "bg-indigo-500",
            )}
          />
        )}
      </button>
      {label && (
        <p
          className={cn(
            "text-xs whitespace-nowrap overflow-hidden w-full text-center font-bold tracking-tight transition-colors uppercase",
            active
              ? variant === "danger"
                ? "text-red-600"
                : "text-indigo-700"
              : "text-slate-400",
          )}
        >
          {label === "Lone Pr" ? "L-Pairs" : label}
        </p>
      )}
    </div>
  );
}

function AtomRenderer({
  atom,
  onPointerDown,
  isEraser,
  isSelected,
  currentValency,
  expectedValency,
  allAtoms,
  connectedBonds,
  hideCHydrogens,
  skeletalMode,
  hideImplicitHydrogens,
  filledMode = true,
  showValencyWarnings = true,
}: {
  atom: Atom;
  onPointerDown: (e: React.PointerEvent) => void;
  isEraser: boolean;
  isSelected: boolean;
  currentValency: number;
  expectedValency: number;
  allAtoms: Atom[];
  connectedBonds: Bond[];
  hideCHydrogens?: boolean;
  skeletalMode?: boolean;
  hideImplicitHydrogens?: boolean;
  filledMode?: boolean;
  showValencyWarnings?: boolean;
  key?: string;
}) {
  const color = atom.color || getAtomColor(atom.symbol); // slate-800 callback
  const baseTextColor = getAtomTextColor(atom.symbol); // white callback
  const isOverValency =
    (showValencyWarnings && currentValency > expectedValency) ||
    (atom.symbol === "H" && currentValency > 1);
  const implicitH = Math.max(0, expectedValency - currentValency);

  const isSkeletalC = skeletalMode && atom.symbol === "C";
  const shouldHideImplicitH =
    hideImplicitHydrogens ||
    ((hideCHydrogens || skeletalMode) && atom.symbol === "C");

  const shouldDrawFill = filledMode && !isSkeletalC;
  const circleFill = shouldDrawFill ? color : "transparent";

  // If filled, use standard text color. If an unfilled C, we want slate-800. For others, use their element color
  // Exception: Hydrogen is #ffffff in ATOM_COLORS, so if unfilled, let's use #64748b (slate-500)
  let unfilledTextColor = color;
  if (atom.symbol === "H") unfilledTextColor = "#64748b";
  else if (atom.symbol === "C") unfilledTextColor = "#1e293b"; // slate-800

  const textColor = shouldDrawFill ? baseTextColor : unfilledTextColor;

  const renderLonePairs = () => {
    const hBonds = connectedBonds.filter((b) => b.order === 0);
    const covBonds = connectedBonds.filter((b) => b.order > 0);

    const hBondAngles = hBonds
      .map((b) => {
        const otherId = b.atom1Id === atom.id ? b.atom2Id : b.atom1Id;
        const other = allAtoms.find((a) => a.id === otherId);
        if (!other) return null;
        return Math.atan2(other.y - atom.y, other.x - atom.x);
      })
      .filter((a): a is number => a !== null);

    const covBondAngles = covBonds
      .map((b) => {
        const otherId = b.atom1Id === atom.id ? b.atom2Id : b.atom1Id;
        const other = allAtoms.find((a) => a.id === otherId);
        if (!other) return null;
        return Math.atan2(other.y - atom.y, other.x - atom.x);
      })
      .filter((a): a is number => a !== null);

    let availableAngles: number[] = [...hBondAngles];
    const getMinDist = (targetAngle: number) => {
      if (covBondAngles.length === 0) return Infinity;
      return Math.min(
        ...covBondAngles.map((ang: number) => {
          let dA = Math.abs(ang - targetAngle) % (2 * Math.PI);
          return dA > Math.PI ? 2 * Math.PI - dA : dA;
        }),
      );
    };

    if (atom.lonePairs === 1) {
      const topDist = getMinDist(-Math.PI / 2);
      const botDist = getMinDist(Math.PI / 2);
      if (topDist >= botDist) availableAngles.unshift(-Math.PI / 2);
      else availableAngles.unshift(Math.PI / 2);
    } else if (covBondAngles.length === 0) {
      if (atom.lonePairs === 2) {
        availableAngles.push((-Math.PI * 3) / 4, -Math.PI / 4);
      } else {
        availableAngles.push(...[-Math.PI / 2, 0, Math.PI / 2, Math.PI]);
      }
    } else if (covBondAngles.length === 1) {
      const a = covBondAngles[0];
      availableAngles.push(
        ...[
          a + Math.PI,
          a + Math.PI / 2,
          a - Math.PI / 2,
          a + (Math.PI * 3) / 4,
        ],
      );
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
        const spread = (135 * Math.PI) / 180; // place them 135 degrees apart
        availableAngles.push(mid - spread / 2);
        availableAngles.push(mid + spread / 2);
        if (gaps.length > 1)
          availableAngles.push(gaps[1].start + gaps[1].diff / 2);
        availableAngles.push(mid);
      } else {
        gaps.forEach((g) => availableAngles.push(g.start + g.diff / 2));
      }
    }

    const pairs = [];
    const getBaseR = () => {
      if (isSkeletalC) return 0;
      if (!filledMode) return 9;
      return getAtomRadius(atom.symbol);
    };
    const baseR = getBaseR();
    const radius = baseR + 2;
    const dotSize = 2.0;
    const pairSpread = 8.0;

    for (let i = 0; i < atom.lonePairs; i++) {
      let angle = availableAngles[i % availableAngles.length] || 0;

      const px = (Math.cos(angle + Math.PI / 2) * pairSpread) / 2;
      const py = (Math.sin(angle + Math.PI / 2) * pairSpread) / 2;

      const bx = Math.cos(angle) * radius;
      const by = Math.sin(angle) * radius;

      pairs.push(
        <g key={i}>
          <circle
            cx={atom.x + bx + px}
            cy={atom.y + by + py}
            r={dotSize}
            fill="#6366F1"
          />
          <circle
            cx={atom.x + bx - px}
            cy={atom.y + by - py}
            r={dotSize}
            fill="#6366F1"
          />
        </g>,
      );
    }
    for (let i = 0; i < (atom.singleElectrons || 0); i++) {
      let angle =
        availableAngles[(atom.lonePairs + i) % availableAngles.length] || 0;

      const bx = Math.cos(angle) * radius;
      const by = Math.sin(angle) * radius;

      pairs.push(
        <g key={`se-${i}`}>
          <circle
            cx={atom.x + bx}
            cy={atom.y + by}
            r={dotSize}
            fill="#6366F1"
          />
        </g>,
      );
    }
    return pairs;
  };

  return (
    <g
      className="select-none cursor-pointer group"
      onPointerDown={onPointerDown}
    >
      <circle
        cx={atom.x}
        cy={atom.y}
        r={
          isEraser
            ? getAtomRadius(atom.symbol) + 2
            : isOverValency || isSelected
              ? getAtomRadius(atom.symbol) + 1
              : getAtomRadius(atom.symbol)
        }
        fill={circleFill}
        className={cn(
          "stroke-2",
          isEraser
            ? "group-hover:stroke-red-500"
            : isOverValency
              ? "stroke-red-500"
              : isSelected
                ? "stroke-indigo-400"
                : "stroke-transparent group-hover:stroke-indigo-200",
        )}
        style={{
          transition: "stroke 0.3s, fill 0.3s, r 0.3s",
          filter: shouldDrawFill
            ? "drop-shadow(0 4px 10px rgba(0,0,0,0.1))"
            : "none",
        }}
      />
      {!isSkeletalC && (
        <text
          x={atom.x}
          y={atom.y}
          dy="0.32em"
          textAnchor="middle"
          fill={textColor}
          className="font-black text-lg pointer-events-none tracking-tighter"
          style={{ fontFamily: "var(--font-sans)", letterSpacing: "-0.05em" }}
        >
          {atom.symbol}
        </text>
      )}

      {/* Implicit Hydrogens */}
      {atom.symbol !== "H" && implicitH > 0 && !shouldHideImplicitH && (
        <text
          x={atom.x + getAtomRadius(atom.symbol) * 0.7}
          y={atom.y + getAtomRadius(atom.symbol) * 0.7}
          fill={
            shouldDrawFill
              ? color === "#ffffff"
                ? "#64748b"
                : color
              : textColor
          }
          className="font-bold text-sm pointer-events-none"
          style={{
            filter: shouldDrawFill
              ? "drop-shadow(0 1px 2px rgba(0,0,0,0.2))"
              : "none",
          }}
        >
          H{implicitH > 1 ? implicitH : ""}
        </text>
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
  filledMode = true,
}: {
  bond: Bond;
  atom1: Atom;
  atom2: Atom;
  onPointerDown: (e: React.PointerEvent) => void;
  isEraser: boolean;
  isSelected: boolean;
  skeletalMode?: boolean;
  filledMode?: boolean;
  key?: string;
}) {
  const dx = atom2.x - atom1.x;
  const dy = atom2.y - atom1.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  const getOffset = (atom: Atom) => {
    let base = 0;
    if (skeletalMode && atom.symbol === "C") base = 0;
    else if (!filledMode) base = 8;
    else base = getAtomRadius(atom.symbol) + 1;

    if (bond.order === 0 && atom.symbol !== "H") {
      base += 4;
    }
    return base;
  };

  const offset1 = getOffset(atom1);
  const offset2 = getOffset(atom2);
  const bondLength = Math.max(0, length - offset1 - offset2);

  const renderLines = () => {
    const spacing = 7.5;
    const strokeWidth = 2;
    const color = "#64748B"; // darker slate-500 instead of #CBD5E1
    const activeColor = "#818CF8";

    switch (bond.order) {
      case 0:
        return (
          <line
            x1={0}
            y1={0}
            x2={bondLength}
            y2={0}
            stroke={isSelected ? activeColor : color}
            strokeWidth={strokeWidth}
            strokeDasharray="4 4"
            strokeLinecap="round"
          />
        );
      case 1:
        return (
          <line
            x1={0}
            y1={0}
            x2={bondLength}
            y2={0}
            stroke={isSelected ? activeColor : color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        );
      case 2:
        return (
          <>
            <line
              x1={0}
              y1={-spacing / 2}
              x2={bondLength}
              y2={-spacing / 2}
              stroke={isSelected ? activeColor : color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            <line
              x1={0}
              y1={spacing / 2}
              x2={bondLength}
              y2={spacing / 2}
              stroke={isSelected ? activeColor : color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          </>
        );
      case 3:
        return (
          <>
            <line
              x1={0}
              y1={-spacing}
              x2={bondLength}
              y2={-spacing}
              stroke={isSelected ? activeColor : color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            <line
              x1={0}
              y1={0}
              x2={bondLength}
              y2={0}
              stroke={isSelected ? activeColor : color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            <line
              x1={0}
              y1={spacing}
              x2={bondLength}
              y2={spacing}
              stroke={isSelected ? activeColor : color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          </>
        );
      case 4:
        return (
          <polygon
            points={`0,0 ${bondLength},${-spacing * 0.45} ${bondLength},${spacing * 0.45}`}
            fill={isSelected ? activeColor : color}
          />
        );
      case 5: {
        const dashes = [];
        const numDashes = 12;
        for (let i = 1; i <= numDashes; i++) {
          const x = (bondLength / numDashes) * i;
          const h = spacing * 0.45 * (i / numDashes);
          dashes.push(
            <line
              key={i}
              x1={x}
              y1={-h}
              x2={x}
              y2={h}
              stroke={isSelected ? activeColor : color}
              strokeWidth={1.2}
              strokeLinecap="round"
            />,
          );
        }
        return <>{dashes}</>;
      }
    }
  };

  return (
    <g
      transform={`translate(${atom1.x}, ${atom1.y}) rotate(${angle}) translate(${offset1}, 0)`}
      onPointerDown={onPointerDown}
      className="cursor-pointer group"
    >
      <line
        x1={0}
        y1={0}
        x2={bondLength}
        y2={0}
        className="stroke-transparent stroke-[16px]"
      />
      <g
        className={cn(
          "transition-all",
          isEraser
            ? "group-hover:[&>line]:stroke-red-500 group-hover:[&>polygon]:fill-red-500"
            : isSelected
              ? ""
              : "group-hover:[&>line]:stroke-indigo-300 group-hover:[&>polygon]:fill-indigo-300 opacity-90 group-hover:opacity-100",
        )}
      >
        {renderLines()}
      </g>
    </g>
  );
}
