import type { Edge, Node } from "@xyflow/react";
import type {
  Graph,
  GraphEdge,
  NodeType,
  NodeTypeMeta,
  Run,
  StoredRunEvent,
  Workflow,
  WorkflowSummary,
} from "../../shared/types.ts";

export type NodeStatus = "idle" | "running" | "succeeded" | "failed" | "skipped";

export type FlowNodeData = {
  label: string;
  nodeType: NodeType;
  config: Record<string, unknown>;
  status: NodeStatus;
  durationMs?: number;
};

export type FlowGraphNode = Node<FlowNodeData, "flowNode">;
export type FlowEdge = Edge;

export interface NodeTypeMap {
  byType: Record<string, NodeTypeMeta>;
  all: NodeTypeMeta[];
}

export const toFlowNodes = (graph: Graph, metas: NodeTypeMap): FlowGraphNode[] =>
  graph.nodes.map((node) => ({
    id: node.id,
    type: "flowNode" as const,
    position: node.position,
    data: {
      label: node.data.label ?? metas.byType[node.type]?.label ?? node.type,
      nodeType: node.type,
      config: node.data.config ?? {},
      status: "idle" as NodeStatus,
    },
  }));

export const toFlowEdges = (graph: Graph): FlowEdge[] =>
  graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  }));

export const toGraph = (nodes: FlowGraphNode[], edges: FlowEdge[]): Graph => ({
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    data: { label: node.data.label, config: node.data.config },
  })),
  edges: edges.map(
    (edge): GraphEdge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    }),
  ),
});

export type { Graph, GraphEdge, NodeType, NodeTypeMeta, Run, StoredRunEvent, Workflow, WorkflowSummary };
