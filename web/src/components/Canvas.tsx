import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useReactFlow,
  type Connection,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import FlowNodeCard from "./FlowNodeCard.tsx";
import { useMeta } from "../metaContext.ts";
import type { FlowEdge, FlowGraphNode, NodeType } from "../types.ts";

interface Props {
  nodes: FlowGraphNode[];
  edges: FlowEdge[];
  onNodesChange: OnNodesChange<FlowGraphNode>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  onConnect: OnConnect;
  onSelect: (nodeId: string | null) => void;
  onAddNode: (type: NodeType, position: { x: number; y: number }) => void;
  /** Changes whenever the canvas area resizes (e.g. run panel opens). */
  fitSignal?: number;
}

function CanvasInner({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onSelect, onAddNode, fitSignal }: Props) {
  const { byType } = useMeta();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(() => ({ flowNode: FlowNodeCard }), []);

  useEffect(() => {
    // Wait for React Flow's ResizeObserver to pick up the new container size.
    const timer = setTimeout(() => {
      void fitView({ padding: 0.16, duration: 180 });
    }, 160);
    return () => clearTimeout(timer);
  }, [fitSignal, fitView]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/agent-maker-node") as NodeType;
      if (!type || !byType[type]) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onAddNode(type, { x: position.x - 100, y: position.y - 30 });
    },
    [byType, onAddNode, screenToFlowPosition],
  );

  const miniMapColor = useCallback(
    (node: FlowGraphNode) => byType[node.data.nodeType]?.color ?? "#64748b",
    [byType],
  );

  return (
    <div className="canvas" ref={wrapper} onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
      <ReactFlow<FlowGraphNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep", animated: false }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#1e293b" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={miniMapColor}
          maskColor="rgba(2,6,23,0.75)"
          style={{ width: 140, height: 92 }}
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="canvas-empty">
          <h2>Empty canvas</h2>
          <p>Drag a node from the left to start, or add a Manual Trigger.</p>
        </div>
      )}
    </div>
  );
}

export default function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
