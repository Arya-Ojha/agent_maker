import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import type { Graph } from "../../../shared/types.ts";
import { ModelDialog, ProviderDialog, type ProviderConfig } from "./ProviderDialogs.tsx";
import { PROVIDER_OPTIONS, defaultModelFor, providerOption } from "../providers.ts";

interface Props {
  graph: Graph;
  onApply: (graph: Graph) => void;
  onClose: () => void;
}

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
  warnings?: string[];
}

interface Settings {
  provider: string;
  model: string;
  /** Keys and base URLs per provider, so switching providers keeps each one's setup. */
  providers: Record<string, ProviderConfig>;
}

const STORAGE_KEY = "agent_maker.builder";

const DEFAULTS: Settings = {
  provider: "google",
  model: "gemini-2.5-flash",
  providers: Object.fromEntries(
    PROVIDER_OPTIONS.map((option) => [option.id, { apiKey: "", baseURL: "" }]),
  ),
};

const SUGGESTIONS = [
  "Summarize a URL and log the bullets",
  "Classify an email as urgent or normal, then reply",
  "Draft a tweet from a topic, then shorten it",
];

function loadSettings(): Settings {
  const blank = (): Record<string, ProviderConfig> =>
    Object.fromEntries(PROVIDER_OPTIONS.map((option) => [option.id, { apiKey: "", baseURL: "" }]));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, providers: blank() };
    const parsed = JSON.parse(raw) as {
      provider?: string;
      model?: string;
      apiKey?: string;
      providers?: Record<string, Partial<ProviderConfig>>;
    };
    const providers = blank();
    for (const [id, config] of Object.entries(parsed.providers ?? {})) {
      providers[id] = { apiKey: config.apiKey ?? "", baseURL: config.baseURL ?? "" };
    }
    // v1 kept one key for the active provider; move it into the per-provider map.
    const legacy = parsed.apiKey?.trim();
    if (legacy) {
      const id = parsed.provider ?? DEFAULTS.provider;
      providers[id] = { ...(providers[id] ?? { apiKey: "", baseURL: "" }), apiKey: legacy };
    }
    return {
      provider: parsed.provider ?? DEFAULTS.provider,
      model: parsed.model ?? DEFAULTS.model,
      providers,
    };
  } catch {
    return { ...DEFAULTS, providers: blank() };
  }
}

export function BuilderPanel({ graph, onApply, onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Graph | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const config = settings.providers[settings.provider] ?? { apiKey: "", baseURL: "" };
  const option = providerOption(settings.provider);

  const saveProvider = (id: string, next: ProviderConfig) => {
    setSettings((current) => ({
      ...current,
      provider: id,
      // A different provider means its default model: ids are not portable.
      model: current.provider === id ? current.model : defaultModelFor(id),
      providers: { ...current.providers, [id]: next },
    }));
    setProviderOpen(false);
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    const before = graph;
    const history = messages.map(({ role, content }) => ({ role, content }));

    try {
      const result = await api.builderChat({
        message,
        graph,
        history,
        provider: settings.provider,
        model: settings.model,
        apiKey: config.apiKey.trim() || undefined,
        baseURL: config.baseURL.trim() || undefined,
      });
      onApply(result.graph);
      setUndo(before);
      setMessages((current) => [
        ...current,
        { role: "user", content: message },
        { role: "assistant", content: result.reply, warnings: result.warnings },
      ]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  /** Slash commands never reach the model: they open local settings dialogs. */
  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (text === "/provider") {
      setDraft("");
      setProviderOpen(true);
      return;
    }
    if (text === "/model") {
      setDraft("");
      setModelOpen(true);
      return;
    }
    if (text.startsWith("/")) {
      setError(`Unknown command "${text.split(/\s+/)[0]}". Try /provider or /model.`);
      return;
    }
    void send();
  };

  return (
    <aside className="builder-panel">
      <div className="builder-head">
        <h3 className="section-title">Build with AI</h3>
        <button type="button" className="icon-btn" onClick={onClose} title="Close AI panel">
          ×
        </button>
      </div>

      <div className="builder-config">
        <button
          type="button"
          className="config-pill"
          onClick={() => setProviderOpen(true)}
          title="Provider, key and base URL (/provider)"
        >
          {option.label}
          {option.needsKey && (
            <span className={config.apiKey ? "config-ok" : "config-missing"}>
              {config.apiKey ? "key set" : "no key"}
            </span>
          )}
        </button>
        <button
          type="button"
          className="config-pill"
          onClick={() => setModelOpen(true)}
          title="List models for this key (/model)"
        >
          {settings.model || "pick a model"}
        </button>
      </div>

      <div className="builder-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="builder-empty">
            <p className="muted">Describe the workflow or the change you want.</p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="chip"
                onClick={() => setDraft(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className={`builder-msg ${message.role}`}>
            <div className="builder-msg-body">{message.content}</div>
            {message.warnings?.map((warning) => (
              <div key={warning} className="builder-warning">
                {warning}
              </div>
            ))}
          </div>
        ))}

        {busy && <div className="builder-msg assistant pending">thinking…</div>}
        {error && <div className="error-box">{error}</div>}
      </div>

      {undo && (
        <button
          type="button"
          className="btn ghost builder-undo"
          onClick={() => {
            onApply(undo);
            setUndo(null);
          }}
        >
          Undo last AI change
        </button>
      )}

      <div className="builder-composer">
        <textarea
          className="input"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Describe a change, or type /provider or /model"
          aria-label="Describe a workflow"
        />
        <button
          type="button"
          className="btn primary"
          onClick={submit}
          disabled={busy || draft.trim().length === 0}
        >
          {busy ? "Working…" : "Send"}
        </button>
      </div>
      <div className="builder-commands">
        <button type="button" className="link-btn" onClick={() => setProviderOpen(true)}>
          /provider
        </button>
        <button type="button" className="link-btn" onClick={() => setModelOpen(true)}>
          /model
        </button>
        <span className="muted small">
          {graph.nodes.length} nodes · {graph.edges.length} edges · saved only on Save
        </span>
      </div>

      <ProviderDialog
        open={providerOpen}
        provider={settings.provider}
        configs={settings.providers}
        onClose={() => setProviderOpen(false)}
        onSave={saveProvider}
      />
      <ModelDialog
        open={modelOpen}
        provider={settings.provider}
        config={config}
        current={settings.model}
        onClose={() => setModelOpen(false)}
        onPick={(model) => {
          setSettings((current) => ({ ...current, model }));
          setModelOpen(false);
        }}
      />
    </aside>
  );
}
