import { useMemo, useState } from "react";
import type { NodeTypeMeta } from "../../../shared/types.ts";

interface Props {
  metas: NodeTypeMeta[];
  onAdd: (type: NodeTypeMeta["type"]) => void;
}

const CATEGORY_ORDER: NodeTypeMeta["category"][] = ["trigger", "ai", "data", "flow", "output"];

export function NodePalette({ metas, onAdd }: Props) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = metas.filter(
      (meta) =>
        !needle ||
        meta.label.toLowerCase().includes(needle) ||
        meta.description.toLowerCase().includes(needle),
    );
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: visible.filter((meta) => meta.category === category),
    })).filter((group) => group.items.length > 0);
  }, [metas, query]);

  return (
    <section className="palette-section">
      <h3 className="section-title">Nodes</h3>
      <input
        className="input search"
        placeholder="Search nodes…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {grouped.map((group) => (
        <div key={group.category} className="palette-group">
          <div className="palette-group-title">{group.category}</div>
          {group.items.map((meta) => (
            <button
              key={meta.type}
              type="button"
              className="palette-item"
              style={{ ["--accent" as string]: meta.color }}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/agent-maker-node", meta.type);
                event.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onAdd(meta.type)}
              title={meta.description}
            >
              <span className="dot" />
              <span className="palette-item-label">{meta.label}</span>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
