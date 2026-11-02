import type { Graph, GraphEdge, GraphNode, NodeType } from "../../../shared/types.ts";
import { GraphError, planGraph } from "../langgraph/compiler.ts";
import { definitionFor, isNodeType } from "../nodes/index.ts";
import { MAX_NODES, defaultConfig } from "./catalog.ts";

/**
 * Ops are deltas, not a regenerated graph: the model only describes what changes,
 * so untouched nodes keep their ids, positions, labels and config.
 */
export type BuilderOp =
  | {
      op: "add_node";
      type: NodeType;
      id?: string;
      label?: string;
      config?: Record<string, unknown>;
      connectFrom?: string;
      handle?: string;
    }
  | { op: "update_node"; id: string; label?: string; config?: Record<string, unknown> }
  | { op: "delete_node"; id: string }
  | { op: "connect"; from: string; to: string; handle?: string }
  | { op: "disconnect"; from: string; to: string; handle?: string };

export class BuilderOpError extends Error {
  override name = "BuilderOpError";
}

const CHILD_GAP_X = 300;
const CHILD_GAP_Y = 130;

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findNode(graph: Graph, id: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new BuilderOpError(`There is no node with id "${id}".`);
  return node;
}

function uniqueId(graph: Graph, base: string): string {
  const taken = new Set(graph.nodes.map((node) => node.id));
  if (!taken.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new BuilderOpError(`Cannot find a free id for "${base}".`);
}

function edgeId(graph: Graph, from: string, to: string, handle?: string): string {
  const base = `edge-${slug(from)}-${slug(to)}${handle ? `-${slug(handle)}` : ""}`;
  const taken = new Set(graph.edges.map((edge) => edge.id));
  if (!taken.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new BuilderOpError(`Cannot find a free edge id for "${from}" → "${to}".`);
}

function handleIds(node: GraphNode): string[] {
  const definition = definitionFor(node.type);
  return (definition?.meta.outputs ?? []).map((port) => port.id);
}

/** New nodes appear to the right of their parent, stacked when a parent branches. */
function placeNode(graph: Graph, parent: GraphNode | undefined): { x: number; y: number } {
  if (!parent) {
    const index = graph.nodes.length;
    return { x: 60 + (index % 3) * 320, y: 90 + Math.floor(index / 3) * 170 };
  }
  const siblings = graph.edges.filter((edge) => edge.source === parent.id).length;
  return { x: parent.position.x + CHILD_GAP_X, y: parent.position.y + siblings * CHILD_GAP_Y };
}

function addEdge(
  graph: Graph,
  from: string,
  to: string,
  handle: string | undefined,
  warnings: string[],
): void {
  const source = findNode(graph, from);
  const target = findNode(graph, to);
  if (source.id === target.id) throw new BuilderOpError(`A node cannot connect to itself ("${from}").`);

  const handles = handleIds(source);
  if (handles.length > 0) {
    if (!handle) {
      throw new BuilderOpError(
        `Node "${from}" branches; the edge to "${to}" needs a handle (one of: ${handles.join(", ")}).`,
      );
    }
    if (!handles.includes(handle)) {
      throw new BuilderOpError(
        `Node "${from}" has no handle "${handle}". Use one of: ${handles.join(", ")}.`,
      );
    }
  } else if (handle) {
    throw new BuilderOpError(`Node "${from}" does not branch; remove the handle "${handle}".`);
  }

  const duplicate = graph.edges.some(
    (edge) => edge.source === from && edge.target === to && (edge.sourceHandle ?? null) === (handle ?? null),
  );
  if (duplicate) {
    warnings.push(`Edge ${from} → ${to}${handle ? ` (${handle})` : ""} already exists; skipped.`);
    return;
  }

  const edge: GraphEdge = {
    id: edgeId(graph, from, to, handle),
    source: from,
    target: to,
    ...(handle ? { sourceHandle: handle } : {}),
  };
  // Position first: `placeNode` counts the parent's existing children, and the new
  // edge would otherwise count itself.
  target.position = placeNode(graph, source);
  graph.edges.push(edge);
}

export interface ApplyResult {
  graph: Graph;
  warnings: string[];
}

export interface ApplyOptions {
  /** Keep going when an edge references a missing node, collecting a warning. */
  lenient?: boolean;
}

export function applyOps(graph: Graph, ops: unknown[], options: ApplyOptions = {}): ApplyResult {
  const next: Graph = structuredClone(graph);
  const warnings: string[] = [];
  // Edge ops are deferred: models often list `connect` before the `add_node` it
  // refers to, and a sequential pass would reject a perfectly valid answer.
  const deferred: Record<string, unknown>[] = [];

  for (const [index, raw] of ops.entries()) {
    if (!raw || typeof raw !== "object") {
      throw new BuilderOpError(`Op ${index + 1} is not an object.`);
    }
    const op = raw as Record<string, unknown>;
    if (op["op"] === "connect" || op["op"] === "disconnect") {
      deferred.push(op);
      continue;
    }

    switch (op["op"]) {
      case "add_node": {
        const type = String(op["type"] ?? "");
        if (!isNodeType(type)) {
          throw new BuilderOpError(`Op ${index + 1}: unknown node type "${type}".`);
        }
        if (type === "code") {
          warnings.push("Skipped a Code node: the builder never adds unsandboxed code.");
          break;
        }
        if (next.nodes.length >= MAX_NODES) {
          throw new BuilderOpError(`The graph already has ${MAX_NODES} nodes, the builder limit.`);
        }

        const definition = definitionFor(type);
        if (!definition) throw new BuilderOpError(`Op ${index + 1}: unknown node type "${type}".`);

        const requested = typeof op["id"] === "string" ? slug(op["id"]) : "";
        // An explicit id must be free: silently renaming it would strand later
        // `connect` ops that still refer to the old name.
        if (requested && next.nodes.some((node) => node.id === requested)) {
          throw new BuilderOpError(`Node id "${requested}" already exists; choose another id.`);
        }
        const id = requested || uniqueId(next, slug(type.split(".").at(-1) ?? type) || "node");
        const parentId = typeof op["connectFrom"] === "string" ? op["connectFrom"] : undefined;
        const parent = parentId ? findNode(next, parentId) : undefined;
        const supplied = op["config"] && typeof op["config"] === "object" ? op["config"] : {};

        const node: GraphNode = {
          id,
          type,
          position: placeNode(next, parent),
          data: {
            label: typeof op["label"] === "string" && op["label"].trim() ? op["label"].trim() : definition.meta.label,
            config: { ...defaultConfig(definition.meta), ...(supplied as Record<string, unknown>) },
          },
        };
        next.nodes.push(node);

        if (parentId) {
          addEdge(next, parentId, id, typeof op["handle"] === "string" ? op["handle"] : undefined, warnings);
        }
        break;
      }

      case "update_node": {
        const id = String(op["id"] ?? "");
        const node = findNode(next, id);
        if (typeof op["label"] === "string" && op["label"].trim()) node.data.label = op["label"].trim();
        if (op["config"] && typeof op["config"] === "object") {
          node.data.config = { ...node.data.config, ...(op["config"] as Record<string, unknown>) };
        }
        break;
      }

      case "delete_node": {
        const id = String(op["id"] ?? "");
        findNode(next, id);
        next.nodes = next.nodes.filter((node) => node.id !== id);
        next.edges = next.edges.filter((edge) => edge.source !== id && edge.target !== id);
        break;
      }

      default:
        throw new BuilderOpError(`Op ${index + 1}: unknown op "${String(op["op"])}".`);
    }
  }

  for (const op of deferred) {
    try {
      const from = String(op["from"] ?? "");
      const to = String(op["to"] ?? "");
      if (op["op"] === "connect") {
        addEdge(next, from, to, typeof op["handle"] === "string" ? op["handle"] : undefined, warnings);
      } else {
        const before = next.edges.length;
        next.edges = next.edges.filter((edge) => !(edge.source === from && edge.target === to));
        if (next.edges.length === before) warnings.push(`No edge ${from} → ${to} to remove.`);
      }
    } catch (error) {
      if (!options.lenient || !(error instanceof BuilderOpError)) throw error;
      warnings.push(`Dropped a connection: ${error.message}`);
    }
  }

  return { graph: next, warnings };
}

/** Structural problems that would make the graph unrunnable. */
export function validateGraph(graph: Graph): string[] {
  const issues: string[] = [];
  if (graph.nodes.length === 0) issues.push("The graph has no nodes.");
  try {
    planGraph(graph);
  } catch (error) {
    if (error instanceof GraphError) issues.push(error.message);
    else throw error;
  }

  for (const edge of graph.edges) {
    const source = graph.nodes.find((node) => node.id === edge.source);
    if (!source) continue;
    const handles = handleIds(source);
    if (edge.sourceHandle && !handles.includes(edge.sourceHandle)) {
      issues.push(
        `Edge ${edge.source} → ${edge.target} uses handle "${edge.sourceHandle}", but ${source.type} has: ${handles.join(", ") || "none"}.`,
      );
    }
  }

  return issues;
}

/** Config keys the node will ignore (they are free-form, so typos fail silently). */
export function lintGraph(graph: Graph): string[] {
  const warnings: string[] = [];
  for (const node of graph.nodes) {
    const definition = definitionFor(node.type);
    if (!definition) continue;
    const known = new Set(definition.meta.fields.map((field) => field.key));
    const unknown = Object.keys(node.data.config).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      warnings.push(`${node.id}: unknown config key(s) ${unknown.join(", ")} — the node ignores them.`);
    }
  }
  return warnings;
}
