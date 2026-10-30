import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import type { NodeType, NodeTypeMeta, RunStatus, StoredRunEvent } from "../../shared/types.ts";
import { api } from "./api.ts";
import Canvas from "./components/Canvas.tsx";
import { Inspector, type NodeRuntime } from "./components/Inspector.tsx";
import { NodePalette } from "./components/NodePalette.tsx";
import { RunPanel } from "./components/RunPanel.tsx";
import { MetaContext } from "./metaContext.ts";
import {
  toFlowEdges,
  toFlowNodes,
  toGraph,
  type FlowEdge,
  type FlowGraphNode,
  type NodeStatus,
  type NodeTypeMap,
  type Workflow,
  type WorkflowSummary,
} from "./types.ts";

const DEFAULT_CONFIG = (meta: NodeTypeMeta): Record<string, unknown> =>
  Object.fromEntries(
    meta.fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue]),
  );

export default function App() {
  const [meta, setMeta] = useState<NodeTypeMap>({ byType: {}, all: [] });
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [name, setName] = useState("Untitled workflow");
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowGraphNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const [runtime, setRuntime] = useState<Record<string, NodeRuntime>>({});
  const [events, setEvents] = useState<StoredRunEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showRun, setShowRun] = useState(false);

  const workflowIdRef = useRef<string | null>(null);
  workflowIdRef.current = workflowId;

  const flash = useCallback((kind: "error" | "ok", text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 4000);
  }, []);

  /* --------------------------------- load --------------------------------- */

  useEffect(() => {
    void (async () => {
      try {
        const [metas, list] = await Promise.all([api.nodeTypes(), api.workflows()]);
        const map: NodeTypeMap = {
          all: metas,
          byType: Object.fromEntries(metas.map((item) => [item.type, item])),
        };
        setMeta(map);
        setWorkflows(list);
        if (list[0]) await loadWorkflow(list[0].id, map);
      } catch (error) {
        flash("error", error instanceof Error ? error.message : String(error));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadWorkflow = useCallback(
    async (id: string, map?: NodeTypeMap) => {
      const metaMap = map ?? meta;
      const workflow: Workflow = await api.workflow(id);
      setWorkflowId(workflow.id);
      setName(workflow.name);
      setNodes(toFlowNodes(workflow.graph, metaMap));
      setEdges(toFlowEdges(workflow.graph));
      setSelectedId(null);
      setDirty(false);
      setRuntime({});
      setEvents([]);
      setRunId(null);
      setRunStatus(null);
      setRunError(null);
      setShowRun(false);
    },
    [meta, setNodes, setEdges],
  );

  const refreshWorkflows = useCallback(async () => {
    setWorkflows(await api.workflows());
  }, []);

  /* -------------------------------- editing ------------------------------- */

  const handleNodesChange: OnNodesChange<FlowGraphNode> = useCallback(
    (changes) => {
      onNodesChange(changes);
      if (changes.some((change) => change.type !== "select" && change.type !== "dimensions")) {
        setDirty(true);
      }
    },
    [onNodesChange],
  );

  const handleEdgesChange: OnEdgesChange<FlowEdge> = useCallback(
    (changes) => {
      onEdgesChange(changes);
      if (changes.some((change) => change.type !== "select")) setDirty(true);
    },
    [onEdgesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge({ ...connection, id: `edge-${crypto.randomUUID().slice(0, 8)}` }, current),
      );
      setDirty(true);
    },
    [setEdges],
  );

  const addNode = useCallback(
    (type: NodeType, position?: { x: number; y: number }) => {
      const nodeMeta = meta.byType[type];
      if (!nodeMeta) return;
      const id = `${type.replace(/[^a-zA-Z0-9]/g, "-")}-${crypto.randomUUID().slice(0, 6)}`;
      const offset = nodes.length % 6;
      const node: FlowGraphNode = {
        id,
        type: "flowNode",
        position: position ?? { x: 140 + offset * 36, y: 120 + offset * 64 },
        data: {
          label: nodeMeta.label,
          nodeType: type,
          config: DEFAULT_CONFIG(nodeMeta),
          status: "idle",
        },
      };
      setNodes((current) => [...current, node]);
      setSelectedId(id);
      setDirty(true);
    },
    [meta, nodes.length, setNodes],
  );

  const patchNode = useCallback(
    (id: string, patch: { label?: string; config?: Record<string, unknown> }) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...(patch.label !== undefined ? { label: patch.label } : {}),
                  ...(patch.config !== undefined ? { config: patch.config } : {}),
                },
              }
            : node,
        ),
      );
      setDirty(true);
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
      setSelectedId(null);
      setDirty(true);
    },
    [setNodes, setEdges],
  );

  /* ---------------------------------- save -------------------------------- */

  const save = useCallback(async (): Promise<string | null> => {
    if (nodes.length === 0) {
      flash("error", "Add at least one node before saving.");
      return null;
    }
    setBusy(true);
    try {
      const graph = toGraph(nodes, edges);
      let id = workflowId;
      if (id) {
        await api.updateWorkflow(id, { name, graph });
      } else {
        const created = await api.createWorkflow(name, graph);
        id = created.id;
        setWorkflowId(created.id);
      }
      setDirty(false);
      await refreshWorkflows();
      return id;
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  }, [nodes, edges, workflowId, name, refreshWorkflows, flash]);

  /* ---------------------------------- run --------------------------------- */

  const startRun = useCallback(async () => {
    let id = workflowId;
    if (!id || dirty) id = await save();
    if (!id) return;

    try {
      const { runId: started } = await api.run(id);
      setRuntime({});
      setEvents([]);
      setRunError(null);
      setRunStatus("running");
      setRunId(started);
      setShowRun(true);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    }
  }, [workflowId, dirty, save, flash]);

  const cancelRun = useCallback(async () => {
    if (!runId) return;
    try {
      await api.cancelRun(runId);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    }
  }, [runId, flash]);

  const applyEvent = useCallback((stored: StoredRunEvent) => {
    setEvents((current) => [...current, stored]);
    const event = stored.event;
    const mark = (nodeId: string, state: NodeRuntime) =>
      setRuntime((current) => ({ ...current, [nodeId]: state }));

    switch (event.type) {
      case "node.started":
        mark(event.nodeId, { status: "running" });
        break;
      case "node.succeeded":
        mark(event.nodeId, { status: "succeeded", output: event.output, durationMs: event.durationMs });
        break;
      case "node.failed":
        mark(event.nodeId, { status: "failed", error: event.error, durationMs: event.durationMs });
        break;
      case "node.skipped":
        mark(event.nodeId, { status: "skipped" });
        break;
      case "run.succeeded":
        setRunStatus("succeeded");
        break;
      case "run.failed":
        setRunStatus("failed");
        setRunError(event.error);
        break;
      case "run.canceled":
        setRunStatus("canceled");
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/runs/${runId}/events`);

    source.addEventListener("message", (message) => {
      try {
        applyEvent(JSON.parse(message.data) as StoredRunEvent);
      } catch {
        // ignore malformed frame
      }
    });

    source.addEventListener("end", () => {
      source.close();
      void api
        .runDetail(runId)
        .then((detail) => {
          setRunStatus(detail.status);
          setRunError(detail.error);
        })
        .catch(() => undefined);
    });

    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) source.close();
    });

    return () => source.close();
  }, [runId, applyEvent]);

  /* -------------------------------- shortcuts ------------------------------ */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void startRun();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, startRun]);

  /* ------------------------------- workflows ------------------------------- */

  const newWorkflow = useCallback(() => {
    setWorkflowId(null);
    setName("Untitled workflow");
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setDirty(true);
    setRuntime({});
    setEvents([]);
    setRunId(null);
    setRunStatus(null);
    setShowRun(false);
  }, [setNodes, setEdges]);

  const removeWorkflow = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this workflow?")) return;
      await api.deleteWorkflow(id);
      const list = await api.workflows();
      setWorkflows(list);
      if (id === workflowId) {
        if (list[0]) await loadWorkflow(list[0].id);
        else newWorkflow();
      }
    },
    [workflowId, loadWorkflow, newWorkflow],
  );

  /* -------------------------------- render -------------------------------- */

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        const state = runtime[node.id];
        return {
          ...node,
          data: {
            ...node.data,
            status: (state?.status ?? "idle") as NodeStatus,
            durationMs: state?.durationMs,
          },
        };
      }),
    [nodes, runtime],
  );

  const selected = displayNodes.find((node) => node.id === selectedId) ?? null;

  return (
    <MetaContext.Provider value={meta}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" />
            agent_maker
          </div>

          <input
            className="input name-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
            aria-label="Workflow name"
          />
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}

          <div className="spacer" />

          {notice && <span className={`notice ${notice.kind}`}>{notice.text}</span>}

          <button type="button" className="btn ghost" onClick={() => void save()} disabled={busy}>
            Save
          </button>
          {runStatus === "running" ? (
            <button type="button" className="btn danger" onClick={() => void cancelRun()}>
              Cancel run
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => void startRun()} disabled={busy}>
              ▶ Run
            </button>
          )}
        </header>

        <aside className="sidebar">
          <section className="palette-section">
            <div className="section-head">
              <h3 className="section-title">Workflows</h3>
              <button type="button" className="btn tiny" onClick={newWorkflow}>
                + New
              </button>
            </div>
            <div className="workflow-list">
              {workflows.map((item) => (
                <div key={item.id} className={`workflow-item${item.id === workflowId ? " active" : ""}`}>
                  <button
                    type="button"
                    className="workflow-link"
                    onClick={() => void loadWorkflow(item.id)}
                  >
                    <span className="workflow-name">{item.name}</span>
                    <span className="muted small">{item.nodeCount} nodes</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Delete workflow"
                    onClick={() => void removeWorkflow(item.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {workflows.length === 0 && <div className="muted small">No saved workflows.</div>}
            </div>
          </section>

          <NodePalette metas={meta.all} onAdd={(type) => addNode(type)} />
        </aside>

        <main className="canvas-wrap">
          <Canvas
            nodes={displayNodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onSelect={setSelectedId}
            onAddNode={(type, position) => addNode(type, position)}
            fitSignal={showRun && runStatus ? 1 : 0}
          />

          {showRun && runStatus && (
            <RunPanel
              status={runStatus}
              events={events}
              runtime={runtime}
              nodes={displayNodes}
              error={runError}
              onCancel={() => void cancelRun()}
              onClose={() => setShowRun(false)}
              onSelectNode={setSelectedId}
            />
          )}
        </main>

        <Inspector
          node={selected}
          meta={selected ? meta.byType[selected.data.nodeType] : undefined}
          runtime={selected ? runtime[selected.id] : undefined}
          onChange={(patch) => selected && patchNode(selected.id, patch)}
          onDelete={() => selected && deleteNode(selected.id)}
        />
      </div>
    </MetaContext.Provider>
  );
}
