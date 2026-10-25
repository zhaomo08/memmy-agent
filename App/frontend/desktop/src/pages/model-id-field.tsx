/** Model ID input that can pull the provider's model list and pick from it. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import type { ModelListResult } from "@memmy/local-api-contracts";
import { useTranslation } from "../i18n/use-translation.js";
import { isComposingKeyboardEvent } from "../utils/keyboard.js";

/** Contract for model id field props. */
export interface ModelIdFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Absent when the config client cannot list models; the field is then a plain input. */
  onFetch?: () => Promise<ModelListResult>;
}

/** Text input for a model ID plus a searchable, keyboard-navigable list of the fetched models. */
export function ModelIdField(props: ModelIdFieldProps) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  // null = the user has not typed since opening, so the whole list shows instead of only the current value.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const needle = query?.trim().toLowerCase() ?? "";
  const filtered = (models ?? []).filter((model) => model.toLowerCase().includes(needle));

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openMenu() {
    if (!models) return;
    setQuery(null);
    setActive(Math.max(0, models.indexOf(props.value)));
    setOpen(true);
  }

  function pick(model: string) {
    props.onChange(model);
    setOpen(false);
  }

  async function fetchModels() {
    if (!props.onFetch || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await props.onFetch();
      if (!result.ok) {
        setError(result.message || t("apiKey.fetchModelsFailed"));
        return;
      }
      setModels(result.models);
      setQuery(null);
      setActive(Math.max(0, result.models.indexOf(props.value)));
      setOpen(true);
    } catch {
      setError(t("apiKey.fetchModelsFailed"));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!models || isComposingKeyboardEvent(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (filtered.length === 0 ? 0 : (current + step + filtered.length) % filtered.length));
    } else if (event.key === "Enter" && open && filtered[active]) {
      event.preventDefault();
      pick(filtered[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div>
      <label className="block text-xs text-text-ink/65 mb-1.5 font-normal">{props.label}</label>
      <div className="relative">
        <input
          type="text"
          role={models ? "combobox" : undefined}
          aria-expanded={models ? open : undefined}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
            setQuery(event.target.value);
            setActive(0);
            if (models) setOpen(true);
          }}
          onFocus={openMenu}
          onClick={() => !open && openMenu()}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          placeholder={props.placeholder}
          style={{ paddingRight: 128 }}
          className="w-full px-4 py-2.5 border border-border-stone rounded-input text-sm bg-background-paper focus:outline-none placeholder:text-text-ink/35"
        />
        <div className="absolute flex items-center gap-1" style={{ right: 8, top: "50%", transform: "translateY(-50%)" }}>
          {models && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={t("apiKey.showModels")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (open ? setOpen(false) : openMenu())}
              className="p-1 text-text-ink/55 cursor-pointer"
            >
              <ChevronDown size={16} />
            </button>
          )}
          {props.onFetch && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void fetchModels()}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1 text-xs text-action-sky rounded cursor-pointer"
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {models ? models.length : t("apiKey.fetchModels")}
            </button>
          )}
        </div>
        {open && models && (
          <div ref={menuRef} role="listbox" className="select-control__menu">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-ink/55">{t("apiKey.noMatchingModels")}</div>
            ) : (
              filtered.map((model, index) => (
                <button
                  key={model}
                  type="button"
                  role="option"
                  data-index={index}
                  aria-selected={model === props.value}
                  className={`select-control__option ${model === props.value ? "select-control__option--selected" : ""} ${
                    index === active ? "select-control__option--active" : ""
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(model)}
                >
                  <span className="select-control__option-content">
                    <span className="select-control__option-label">{model}</span>
                  </span>
                  {model === props.value && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-status-error">{error}</p>}
    </div>
  );
}
