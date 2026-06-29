// ============================================================
// TREE-LOGIC REASONING ENGINE
// Implements: AND/OR/NOT/IMPLY/XOR logic trees + inference
// with symbolic backward chaining and forward evaluation
// ============================================================

export type LogicValue = true | false | "unknown";
export type NodeType = "AND" | "OR" | "NOT" | "IMPLY" | "XOR" | "LEAF" | "FORALL" | "EXISTS";

export interface LogicNode {
  id: string;
  type: NodeType;
  label: string;
  value?: LogicValue;
  children: LogicNode[];
  confidence: number; // 0..1
  meta?: Record<string, unknown>;
}

export interface InferenceResult {
  conclusion: LogicValue;
  confidence: number;
  trace: string[];
  depth: number;
}

// ── Evaluate a logic tree forward ──
export function evaluate(node: LogicNode, bindings: Map<string, LogicValue> = new Map()): InferenceResult {
  const trace: string[] = [];
  const result = evalNode(node, bindings, trace, 0);
  return result;
}

function evalNode(node: LogicNode, bindings: Map<string, LogicValue>, trace: string[], depth: number): InferenceResult {
  const indent = "  ".repeat(depth);

  if (node.type === "LEAF") {
    const val = bindings.get(node.id) ?? node.value ?? "unknown";
    trace.push(`${indent}LEAF [${node.label}] → ${val} (conf=${node.confidence.toFixed(2)})`);
    return { conclusion: val, confidence: node.confidence, trace, depth };
  }

  const childResults = node.children.map(c => evalNode(c, bindings, trace, depth + 1));

  let conclusion: LogicValue = "unknown";
  let confidence = 1.0;

  switch (node.type) {
    case "AND": {
      if (childResults.some(r => r.conclusion === false)) {
        conclusion = false;
        confidence = Math.max(...childResults.filter(r => r.conclusion === false).map(r => r.confidence));
      } else if (childResults.every(r => r.conclusion === true)) {
        conclusion = true;
        confidence = childResults.reduce((acc, r) => acc * r.confidence, 1.0);
      } else {
        conclusion = "unknown";
        confidence = 0.5;
      }
      break;
    }
    case "OR": {
      if (childResults.some(r => r.conclusion === true)) {
        conclusion = true;
        confidence = Math.max(...childResults.filter(r => r.conclusion === true).map(r => r.confidence));
      } else if (childResults.every(r => r.conclusion === false)) {
        conclusion = false;
        confidence = childResults.reduce((acc, r) => acc * r.confidence, 1.0);
      } else {
        conclusion = "unknown";
        confidence = 0.5;
      }
      break;
    }
    case "NOT": {
      const r = childResults[0];
      conclusion = r.conclusion === true ? false : r.conclusion === false ? true : "unknown";
      confidence = r.confidence;
      break;
    }
    case "IMPLY": {
      // P → Q: false only if P=true and Q=false
      const [p, q] = childResults;
      if (p.conclusion === false) { conclusion = true; confidence = p.confidence; }
      else if (p.conclusion === true && q.conclusion === true) { conclusion = true; confidence = Math.min(p.confidence, q.confidence); }
      else if (p.conclusion === true && q.conclusion === false) { conclusion = false; confidence = Math.min(p.confidence, q.confidence); }
      else { conclusion = "unknown"; confidence = 0.5; }
      break;
    }
    case "XOR": {
      const [a, b] = childResults;
      if (a.conclusion !== "unknown" && b.conclusion !== "unknown") {
        conclusion = (a.conclusion !== b.conclusion);
        confidence = Math.min(a.confidence, b.confidence);
      } else { conclusion = "unknown"; confidence = 0.5; }
      break;
    }
    case "FORALL": {
      conclusion = childResults.every(r => r.conclusion === true) ? true
        : childResults.some(r => r.conclusion === false) ? false : "unknown";
      confidence = childResults.reduce((acc, r) => acc * r.confidence, 1.0);
      break;
    }
    case "EXISTS": {
      conclusion = childResults.some(r => r.conclusion === true) ? true
        : childResults.every(r => r.conclusion === false) ? false : "unknown";
      confidence = Math.max(...childResults.map(r => r.confidence));
      break;
    }
  }

  trace.push(`${indent}${node.type} [${node.label}] → ${conclusion} (conf=${confidence.toFixed(2)})`);
  return { conclusion, confidence, trace, depth };
}

// ── Backward chaining: what must be true to satisfy goal? ──
export function backwardChain(goal: LogicNode, knownFacts: Map<string, LogicValue>): string[] {
  const agenda: string[] = [];
  chainNode(goal, knownFacts, agenda, 0);
  return agenda;
}

function chainNode(node: LogicNode, facts: Map<string, LogicValue>, agenda: string[], depth: number) {
  const indent = "  ".repeat(depth);
  const known = facts.get(node.id);
  if (known !== undefined) {
    agenda.push(`${indent}[KNOWN] ${node.label} = ${known}`);
    return;
  }
  if (node.type === "LEAF") {
    agenda.push(`${indent}[QUERY] Need fact: ${node.label} (id=${node.id})`);
    return;
  }
  agenda.push(`${indent}[RULE] ${node.type}(${node.label}) requires:`);
  for (const child of node.children) {
    chainNode(child, facts, agenda, depth + 1);
  }
}

// ── Build example reasoning trees ──
export function buildExampleTree(name: string): LogicNode {
  switch (name) {
    case "modus_ponens":
      return {
        id: "root", type: "AND", label: "Conclusion", confidence: 1.0,
        children: [
          {
            id: "p1", type: "LEAF", label: "Premise: All men are mortal", value: true,
            confidence: 0.99, children: []
          },
          {
            id: "p2", type: "LEAF", label: "Premise: Socrates is a man", value: true,
            confidence: 0.99, children: []
          },
          {
            id: "p3", type: "IMPLY", label: "Socrates is mortal", confidence: 1.0,
            children: [
              { id: "p3a", type: "LEAF", label: "Socrates is a man", value: true, confidence: 0.99, children: [] },
              { id: "p3b", type: "LEAF", label: "All men are mortal", value: true, confidence: 0.99, children: [] },
            ]
          }
        ]
      };
    case "neural_valid":
      return {
        id: "root", type: "AND", label: "Network is Valid", confidence: 1.0,
        children: [
          {
            id: "n1", type: "OR", label: "Has sufficient data", confidence: 0.9,
            children: [
              { id: "n1a", type: "LEAF", label: "Dataset size > 1000", value: true, confidence: 0.9, children: [] },
              { id: "n1b", type: "LEAF", label: "Augmentation enabled", value: false, confidence: 0.7, children: [] },
            ]
          },
          {
            id: "n2", type: "AND", label: "Architecture is sound", confidence: 0.95,
            children: [
              { id: "n2a", type: "LEAF", label: "Gradient flow OK", value: true, confidence: 0.95, children: [] },
              { id: "n2b", type: "NOT", label: "No vanishing gradient", confidence: 0.9,
                children: [{ id: "n2b1", type: "LEAF", label: "Vanishing gradient detected", value: false, confidence: 0.9, children: [] }]
              },
            ]
          },
          {
            id: "n3", type: "IMPLY", label: "Convergence will occur", confidence: 0.85,
            children: [
              { id: "n3a", type: "LEAF", label: "Loss decreasing", value: true, confidence: 0.85, children: [] },
              { id: "n3b", type: "LEAF", label: "Optimizer stable", value: true, confidence: 0.9, children: [] },
            ]
          }
        ]
      };
    case "xor_decision":
      return {
        id: "root", type: "XOR", label: "Exclusive Decision", confidence: 1.0,
        children: [
          { id: "x1", type: "LEAF", label: "Path A: gradient descent", value: true, confidence: 0.8, children: [] },
          { id: "x2", type: "LEAF", label: "Path B: evolutionary search", value: false, confidence: 0.6, children: [] },
        ]
      };
    default:
      return {
        id: "root", type: "OR", label: "Default Decision", confidence: 1.0,
        children: [
          { id: "d1", type: "LEAF", label: "Condition A", value: true, confidence: 0.7, children: [] },
          { id: "d2", type: "LEAF", label: "Condition B", value: "unknown", confidence: 0.5, children: [] },
        ]
      };
  }
}

// ── Pretty-print a logic tree ──
export function printTree(node: LogicNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  const val = node.value !== undefined ? ` = ${node.value}` : "";
  let line = `${indent}[${node.type}] ${node.label}${val} (conf=${node.confidence.toFixed(2)})\n`;
  for (const child of node.children) line += printTree(child, depth + 1);
  return line;
}
