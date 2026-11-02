import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { PROVIDER_OPTIONS, providerOption } from "../providers.ts";

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
}

/* --------------------------------- shell ---------------------------------- */

function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ /provider --------------------------------- */

interface ProviderProps {
  open: boolean;
  provider: string;
  configs: Record<string, ProviderConfig>;
  onClose: () => void;
  onSave: (provider: string, config: ProviderConfig) => void;
}

/**
 * Two steps on purpose: pick a provider first, then configure only that one, so a
 * half-typed key for another provider is never what gets sent.
 */
export function ProviderDialog({ open, provider, configs, onClose, onSave }: ProviderProps) {
  const [step, setStep] = useState<"pick" | "config">("pick");
  const [chosen, setChosen] = useState(provider);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setChosen(provider);
    setError(null);
  }, [open, provider]);

  if (!open) return null;

  const option = providerOption(chosen);
  const current = configs[chosen] ?? { apiKey: "", baseURL: "" };

  const pick = (id: string) => {
    setChosen(id);
    setApiKey(configs[id]?.apiKey ?? "");
    setBaseURL(configs[id]?.baseURL ?? "");
    setError(null);
    setStep("config");
  };

  const save = () => {
    const trimmed = baseURL.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setError("Base URL must start with http:// or https://.");
      return;
    }
    onSave(chosen, { apiKey: apiKey.trim(), baseURL: trimmed });
  };

  return (
    <Modal label="Choose a provider" onClose={onClose}>
      {step === "pick" ? (
        <>
          <div className="dialog-head">
            <h3>Provider</h3>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <p className="muted small dialog-intro">
            Pick the API that should build your graph. You can change this at any time.
          </p>
          <div className="provider-list">
            {PROVIDER_OPTIONS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`provider-option${candidate.id === provider ? " current" : ""}`}
                onClick={() => pick(candidate.id)}
              >
                <span className="provider-name">
                  {candidate.label}
                  {candidate.id === provider && <span className="provider-tag">current</span>}
                  {candidate.needsKey && !configs[candidate.id]?.apiKey && (
                    <span className="provider-tag muted-tag">no key</span>
                  )}
                </span>
                <span className="provider-hint">{candidate.hint}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="dialog-head">
            <button type="button" className="link-btn" onClick={() => setStep("pick")}>
              ← Providers
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <h3 className="dialog-title">{option.label}</h3>

          {option.needsKey ? (
            <>
              <label className="field-label" htmlFor="provider-key">
                API key
              </label>
              <input
                id="provider-key"
                className="input"
                type="password"
                autoComplete="off"
                autoFocus
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={current.apiKey ? "key saved — leave to keep" : "paste your key"}
              />
              <p className="muted small dialog-help">
                Kept in this browser and in server memory for this process. Never written to the
                workflow or the database. Leave empty to use the server&apos;s <code>.env</code>.
              </p>
            </>
          ) : (
            <p className="muted small dialog-help">
              Mock runs offline and needs no key. It builds a trigger → agent → output pipeline.
            </p>
          )}

          {option.baseUrl && (
            <>
              <label className="field-label" htmlFor="provider-base-url">
                Base URL <span className="muted">(optional)</span>
              </label>
              <input
                id="provider-base-url"
                className="input"
                value={baseURL}
                onChange={(event) => setBaseURL(event.target.value)}
                placeholder="https://api.openai.com/v1"
              />
              <p className="muted small dialog-help">
                For OpenAI-compatible servers (Ollama, LM Studio, Azure, a proxy). Local servers
                usually ignore the key, but one is still required — any value works.
              </p>
            </>
          )}

          {error && <div className="error-box">{error}</div>}

          <div className="dialog-foot">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={save}>
              Use {option.label}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* -------------------------------- /model ---------------------------------- */

interface ModelProps {
  open: boolean;
  provider: string;
  config: ProviderConfig;
  current: string;
  onClose: () => void;
  onPick: (model: string) => void;
}

/** Lists what the key can actually call; falls back to manual entry on failure. */
export function ModelDialog({ open, provider, config, current, onClose, onPick }: ModelProps) {
  const [models, setModels] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setFilter("");
    // A failed fetch must not leave the previous provider's list on screen.
    setModels([]);
    api
      .builderModels({
        provider,
        apiKey: config.apiKey.trim() || undefined,
        baseURL: config.baseURL.trim() || undefined,
      })
      .then((result) => {
        if (alive) setModels(result.models);
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, provider, config.apiKey, config.baseURL, attempt]);

  useEffect(() => {
    if (loading) return;
    filterRef.current?.focus();
  }, [loading]);

  if (!open) return null;

  const needle = filter.trim().toLowerCase();
  const shown = needle ? models.filter((model) => model.toLowerCase().includes(needle)) : models;

  return (
    <Modal label="Choose a model" onClose={onClose}>
      <div className="dialog-head">
        <h3>Model · {providerOption(provider).label}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="model-tools">
        <input
          ref={filterRef}
          className="input"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && needle) {
              event.preventDefault();
              onPick(filter.trim());
            }
          }}
          placeholder={loading ? "Loading models…" : "Filter, or type a model id"}
          aria-label="Filter models"
        />
        <button
          type="button"
          className="btn ghost"
          onClick={() => setAttempt((value) => value + 1)}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {loading && <p className="muted small dialog-help">Asking {provider} which models this key can use…</p>}
      {error && <div className="error-box">{error}</div>}

      {!loading && (
        <div className="model-list" role="listbox" aria-label="Available models">
          {shown.map((model) => (
            <button
              key={model}
              type="button"
              role="option"
              aria-selected={model === current}
              className={`model-option${model === current ? " current" : ""}`}
              onClick={() => onPick(model)}
            >
              <span className="model-id">{model}</span>
              {model === current && <span className="provider-tag">current</span>}
            </button>
          ))}
          {shown.length === 0 && !error && (
            <p className="muted small dialog-help">
              {models.length === 0 ? "This key returned no usable models." : "No model matches that filter."}
            </p>
          )}
        </div>
      )}

      {needle && !shown.includes(filter.trim()) && (
        <div className="dialog-foot">
          <button type="button" className="btn primary" onClick={() => onPick(filter.trim())}>
            Use &quot;{filter.trim()}&quot;
          </button>
        </div>
      )}
    </Modal>
  );
}
