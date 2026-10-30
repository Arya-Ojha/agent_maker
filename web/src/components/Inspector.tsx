import { useState } from "react";
import type { NodeField, NodeTypeMeta } from "../../../shared/types.ts";
import type { FlowGraphNode, NodeStatus } from "../types.ts";

export interface NodeRuntime {
  status: NodeStatus;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

interface Props {
  node: FlowGraphNode | null;
  meta: NodeTypeMeta | undefined;
  runtime: NodeRuntime | undefined;
  onChange: (patch: { label?: string; config?: Record<string, unknown> }) => void;
  onDelete: () => void;
}

export function Inspector({ node, meta, runtime, onChange, onDelete }: Props) {
  if (!node) {
    return (
      <aside className="inspector">
        <div className="empty-state">
          <p>Select a node to edit it.</p>
          <p className="muted">Drag nodes from the left, connect handles, then hit Run.</p>
        </div>
      </aside>
    );
  }

  const config = node.data.config;
  const setConfig = (key: string, value: unknown) => {
    onChange({ config: { ...config, [key]: value } });
  };

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="dot" style={{ ["--accent" as string]: meta?.color ?? "#64748b" }} />
        <div>
          <input
            className="input title-input"
            value={node.data.label}
            onChange={(event) => onChange({ label: event.target.value || meta?.label || node.data.nodeType })}
          />
          <div className="muted small">{meta?.label ?? node.data.nodeType}</div>
        </div>
      </div>

      {meta && <p className="hint">{meta.description}</p>}

      <div className="fields">
        {meta?.fields
          .filter((field) => isVisible(field, config))
          .map((field) => (
            <label key={field.key} className="field">
              <span className="field-label">{field.label}</span>
              <FieldInput
                key={`${node.id}:${field.key}`}
                field={field}
                value={config[field.key] ?? field.defaultValue}
                onChange={(value) => setConfig(field.key, value)}
              />
              {field.help && <span className="field-help">{field.help}</span>}
            </label>
          ))}
      </div>

      {runtime && runtime.status !== "idle" && (
        <div className="runtime-block">
          <div className="section-title">Last run</div>
          <div className="runtime-row">
            <StatusPill status={runtime.status} />
            {runtime.durationMs !== undefined && <span className="muted small">{runtime.durationMs}ms</span>}
          </div>
          {runtime.error && <pre className="output error-box">{runtime.error}</pre>}
          {runtime.output !== undefined && (
            <pre className="output">{JSON.stringify(runtime.output, null, 2)}</pre>
          )}
        </div>
      )}

      <details className="advanced">
        <summary>Node id</summary>
        <code>{node.id}</code>
      </details>

      <button type="button" className="btn danger full" onClick={onDelete}>
        Delete node
      </button>
    </aside>
  );
}

function StatusPill({ status }: { status: NodeStatus }) {
  const label: Record<NodeStatus, string> = {
    idle: "idle",
    running: "running",
    succeeded: "succeeded",
    failed: "failed",
    skipped: "skipped",
  };
  return <span className={`pill ${status}`}>{label[status]}</span>;
}

const isVisible = (field: NodeField, config: Record<string, unknown>): boolean => {
  if (!field.showWhen) return true;
  const current = String(config[field.showWhen.key] ?? "");
  return field.showWhen.equals.includes(current);
};

interface FieldInputProps {
  field: NodeField;
  value: unknown;
  onChange: (value: unknown) => void;
}

function FieldInput({ field, value, onChange }: FieldInputProps) {
  switch (field.type) {
    case "textarea":
      return (
        <textarea
          className="input textarea"
          rows={field.key === "prompt" || field.key === "value" ? 5 : 4}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "number":
      return (
        <input
          className="input"
          type="number"
          step="any"
          value={typeof value === "number" ? value : value === "" || value === undefined ? "" : Number(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      );
    case "select":
      return (
        <select className="input" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case "json":
      return <JsonField value={value} onChange={onChange} />;
    case "secret":
      return (
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    default:
      return (
        <input
          className="input"
          type="text"
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function JsonField({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const [draft, setDraft] = useState(() => (value === undefined ? "{}" : JSON.stringify(value, null, 2)));
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <textarea
        className={`input textarea mono${error ? " invalid" : ""}`}
        rows={5}
        value={draft}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (!text.trim()) {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(text));
            setError(null);
          } catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : "Invalid JSON");
          }
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </>
  );
}
