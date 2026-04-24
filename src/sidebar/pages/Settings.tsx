import { useState, useEffect } from "react";
import type { MemoryEntry } from "../../shared/types";
import {
  applyTheme,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../theme";

interface BannerTerm {
  code: string;
  description: string;
}

export default function Settings() {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);

  const [profile, setProfile] = useState<string | null>(null);
  const [profileDate, setProfileDate] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [auditText, setAuditText] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  // Course catalog state
  const [terms, setTerms] = useState<BannerTerm[]>([]);
  const [selectedTerm, setSelectedTerm] = useState<string>("");
  const [catalogTerm, setCatalogTerm] = useState<string | null>(null);
  const [catalogCourseCount, setCatalogCourseCount] = useState<number>(0);
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState<number | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogProgress, setCatalogProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Long-term memory state. Provisional entries still accumulate internally
  // (the curator uses them for promotion tracking) but are deliberately not
  // exposed in the UI — they're developer-only implementation detail.
  const [memories, setMemories] = useState<MemoryEntry[]>([]);

  // Auto-save toggle: when ON (default), the Haiku curator runs after each
  // chat turn and saves durable facts automatically. When OFF, memories only
  // land via onboarding or explicit "remember X" save_memory calls.
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  // Per-entry inline edit state. Only one entry is editable at a time.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraftDescription, setEditDraftDescription] = useState("");
  const [editDraftContent, setEditDraftContent] = useState("");

  // Theme preference: light / dark / system (default).
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    loadThemePreference().then(setTheme);
  }, []);

  useEffect(() => {
    // One round trip instead of three — fewer IPC hops, fewer race windows.
    chrome.storage.local.get(
      ["anthropicApiKey", "auditText", "studentProfile", "profileGeneratedAt"],
      (r) => {
        const key = r.anthropicApiKey as string | undefined;
        if (key) setMaskedKey(`sk-ant-...${key.slice(-6)}`);
        if (r.auditText) setAuditText(r.auditText as string);
        if (r.studentProfile) setProfile(r.studentProfile as string);
        if (r.profileGeneratedAt) {
          const d = new Date(r.profileGeneratedAt as number);
          setProfileDate(
            d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          );
        }
      }
    );

    // Load cached catalog status
    chrome.runtime.sendMessage({ type: "GET_CATALOG_STATUS" }, (r) => {
      if (!r) return;
      setCatalogTerm(r.term ?? null);
      setCatalogCourseCount(r.courseCount ?? 0);
      setCatalogUpdatedAt(r.updatedAt ?? null);
      if (r.term) setSelectedTerm(r.term);
    });

    // Fetch available terms from Banner
    chrome.runtime.sendMessage({ type: "GET_CATALOG_TERMS" }, (r) => {
      if (!r || !r.terms) return;
      setTerms(r.terms as BannerTerm[]);
      setSelectedTerm((prev) => prev || (r.terms[0]?.code ?? ""));
    });

    // Load long-term memory list + auto-save toggle state
    chrome.runtime.sendMessage({ type: "GET_MEMORIES" }, (r) => {
      if (Array.isArray(r?.memories)) setMemories(r.memories);
    });
    chrome.runtime.sendMessage({ type: "GET_AUTO_SAVE" }, (r) => {
      if (typeof r?.enabled === "boolean") setAutoSaveEnabled(r.enabled);
    });
  }, []);

  // Listen for profile + catalog updates from the service worker
  useEffect(() => {
    const listener = (msg: any) => {
      if (msg.type === "PROFILE_READY") {
        setProfile(msg.profile);
        setProfileDate(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
        setRefreshing(false);
      } else if (msg.type === "PROFILE_ERROR") {
        setRefreshing(false);
      } else if (msg.type === "CATALOG_PROGRESS") {
        setCatalogProgress({ done: msg.done, total: msg.total, label: msg.label });
      } else if (msg.type === "CATALOG_READY") {
        setCatalogRefreshing(false);
        setCatalogProgress(null);
        setCatalogTerm(msg.term);
        setCatalogCourseCount(msg.courseCount);
        setCatalogUpdatedAt(msg.updatedAt);
        setCatalogError(null);
      } else if (msg.type === "CATALOG_ERROR") {
        setCatalogRefreshing(false);
        setCatalogProgress(null);
        setCatalogError(msg.error ?? "Unknown error");
      } else if (msg.type === "MEMORY_UPDATED") {
        if (Array.isArray(msg.memories)) setMemories(msg.memories);
      } else if (msg.type === "AUTO_SAVE_UPDATED") {
        if (typeof msg.enabled === "boolean") setAutoSaveEnabled(msg.enabled);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  function saveKey() {
    if (!apiKey.trim()) return;
    chrome.storage.local.set({ anthropicApiKey: apiKey.trim() }, () => {
      setMaskedKey(`sk-ant-...${apiKey.trim().slice(-6)}`);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  }

  function clearKey() {
    chrome.storage.local.remove("anthropicApiKey", () => setMaskedKey(null));
  }

  function refreshProfile() {
    setRefreshing(true);
    chrome.runtime.sendMessage({ type: "REFRESH_PROFILE" });
  }

  function startEdit() {
    setEditValue(profile ?? "");
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setProfile(trimmed);
    setEditing(false);
    // Worker owns the write — it updates storage, cachedProfile, and
    // rebroadcasts PROFILE_READY so the chat sidebar picks up the edit.
    chrome.runtime.sendMessage({ type: "SET_PROFILE", profile: trimmed });
  }

  function cancelEdit() {
    setEditing(false);
    setEditValue("");
  }

  function deleteMemoryEntry(id: number) {
    // Worker owns the write, rebroadcasts MEMORY_UPDATED, listener above
    // re-renders. Optimistic local update keeps the UI responsive.
    setMemories((prev) => prev.filter((m) => m.id !== id));
    chrome.runtime.sendMessage({ type: "DELETE_MEMORY", id });
  }

  function clearAllMemories() {
    if (!confirm("Delete ALL long-term memories? This cannot be undone.")) return;
    setMemories([]);
    chrome.runtime.sendMessage({ type: "CLEAR_MEMORIES" });
  }

  function toggleAutoSave() {
    const next = !autoSaveEnabled;
    setAutoSaveEnabled(next);
    chrome.runtime.sendMessage({ type: "SET_AUTO_SAVE", enabled: next });
  }

  function selectTheme(next: ThemePreference) {
    setTheme(next);
    applyTheme(next);
    saveThemePreference(next);
  }

  function startMemoryEdit(m: MemoryEntry) {
    setEditingId(m.id);
    setEditDraftDescription(m.description);
    setEditDraftContent(m.content);
  }

  function cancelMemoryEdit() {
    setEditingId(null);
    setEditDraftDescription("");
    setEditDraftContent("");
  }

  function saveMemoryEdit() {
    if (editingId === null) return;
    const description = editDraftDescription.trim();
    const content = editDraftContent.trim();
    if (!description || !content) return;
    // Optimistic local update; the worker will rebroadcast MEMORY_UPDATED.
    setMemories((prev) =>
      prev.map((m) => (m.id === editingId ? { ...m, description, content } : m))
    );
    chrome.runtime.sendMessage({
      type: "EDIT_MEMORY",
      input: { id: editingId, description, content },
    });
    cancelMemoryEdit();
  }

  function rerunOnboarding() {
    if (
      !confirm(
        "Re-run onboarding? This will DELETE all your current memories and restart the intake conversation. Your audit, API key, and catalog stay intact."
      )
    ) {
      return;
    }
    // Wipe memories + provisional + session chat, then clear the completion
    // flag so the welcome card shows on the Advisor tab. The service worker
    // rebroadcasts MEMORY_UPDATED + ONBOARDING_RESET; AuditChat listens for
    // the latter and flips back to the welcome card in place, so no
    // close/reopen is needed.
    setMemories([]);
    chrome.runtime.sendMessage({ type: "CLEAR_MEMORIES" });
    chrome.runtime.sendMessage({ type: "CLEAR_PROVISIONAL" });
    chrome.runtime.sendMessage({ type: "RESET_ONBOARDING" });
    chrome.storage.session.clear();
    alert("Onboarding reset. Head to the Advisor tab — the welcome card is back.");
  }

  function refreshCatalog() {
    if (!selectedTerm) return;
    setCatalogRefreshing(true);
    setCatalogError(null);
    setCatalogProgress({ done: 0, total: 1, label: "starting" });
    chrome.runtime.sendMessage({ type: "REFRESH_CATALOG", term: selectedTerm });
  }

  function formatCatalogDate(ts: number | null): string {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="p-4 space-y-6 overflow-y-auto h-full">

      {/* API Key */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Anthropic API Key</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Stored locally in your browser, never sent anywhere except Anthropic.
          Get one at{" "}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="underline text-fordham-maroon">
            console.anthropic.com
          </a>.
        </p>

        {maskedKey && (
          <div className="flex items-center justify-between mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
            <span className="text-xs text-green-800 font-mono">{maskedKey}</span>
            <button onClick={clearKey} className="text-xs text-red-600 hover:text-red-800 font-medium">Remove</button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKey()}
            placeholder={maskedKey ? "Enter new key to replace..." : "sk-ant-..."}
            className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-mono focus:outline-none focus:border-fordham-maroon"
          />
          <button
            onClick={saveKey}
            disabled={!apiKey.trim()}
            className="px-4 py-2 bg-fordham-maroon text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-opacity-90"
          >
            {saved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Student Profile */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Student Profile</h2>
          <div className="flex items-center gap-3">
            {!editing && profile && (
              <button onClick={startEdit} className="text-xs text-fordham-maroon hover:underline">
                Edit
              </button>
            )}
            <button
              onClick={refreshProfile}
              disabled={refreshing || editing}
              className="text-xs text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-40"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Auto-extracted from your DegreeWorks audit. Injected into every chat session as memory.
          {profileDate && <span className="ml-1 text-gray-400 dark:text-gray-500">Last updated {profileDate}.</span>}
        </p>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={10}
              className="w-full text-xs text-gray-700 dark:text-gray-300 bg-white border border-fordham-maroon rounded-lg p-3 font-mono leading-relaxed focus:outline-none resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelEdit}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!editValue.trim()}
                className="px-3 py-1.5 text-xs bg-fordham-maroon text-white rounded-lg disabled:opacity-40 hover:bg-opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        ) : profile ? (
          <pre className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed">
            {profile}
          </pre>
        ) : (
          <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            No profile yet. Visit your DegreeWorks page to generate one automatically.
          </div>
        )}
      </div>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Long-Term Memory */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Long-Term Memory</h2>
          {memories.length > 0 && (
            <button
              onClick={clearAllMemories}
              className="text-xs text-red-600 hover:text-red-800 font-medium"
            >
              Clear all
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Durable facts the advisor has learned about you. Injected as a routing
          index into every chat so recommendations fit your situation.
        </p>

        {/* Auto-save toggle */}
        <label className="flex items-center justify-between gap-3 px-3 py-2 mb-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:bg-gray-800">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
              Auto-save memories from chat
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              When ON, the advisor learns durable facts from normal conversation.
              When OFF, memories only save via onboarding or explicit "remember" requests.
            </div>
          </div>
          <button
            onClick={toggleAutoSave}
            role="switch"
            aria-checked={autoSaveEnabled}
            className={`shrink-0 relative inline-flex h-5 w-9 rounded-full transition-colors ${
              autoSaveEnabled ? "bg-fordham-maroon" : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                autoSaveEnabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>

        {memories.length === 0 ? (
          <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            No memories yet. They'll appear here as you chat — or start by
            completing onboarding in the Advisor tab.
          </div>
        ) : (
          <div className="space-y-2">
            {memories.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-fordham-maroon bg-fordham-maroon/10 px-1.5 py-0.5 rounded">
                      {m.type}
                    </span>
                    {editingId === m.id ? null : (
                      <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                        {m.description}
                      </span>
                    )}
                  </div>
                  {editingId === m.id ? (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={editDraftDescription}
                        onChange={(e) => setEditDraftDescription(e.target.value)}
                        placeholder="Description (≤10 words)"
                        className="w-full text-xs px-2 py-1 border border-fordham-maroon rounded focus:outline-none"
                      />
                      <textarea
                        value={editDraftContent}
                        onChange={(e) => setEditDraftContent(e.target.value)}
                        placeholder="Content (1–3 sentences)"
                        rows={3}
                        className="w-full text-[11px] px-2 py-1 border border-fordham-maroon rounded resize-none focus:outline-none leading-snug"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={cancelMemoryEdit}
                          className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveMemoryEdit}
                          disabled={!editDraftDescription.trim() || !editDraftContent.trim()}
                          className="text-[10px] px-2 py-0.5 bg-fordham-maroon text-white rounded disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-snug">{m.content}</p>
                      {m.sourceQuote && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 italic leading-snug mt-1">
                          you said: "{m.sourceQuote}"
                        </p>
                      )}
                    </>
                  )}
                </div>
                {editingId === m.id ? null : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startMemoryEdit(m)}
                      className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-fordham-maroon"
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => deleteMemoryEntry(m.id)}
                      className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-600"
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={rerunOnboarding}
            className="text-xs text-fordham-maroon hover:underline font-medium"
          >
            ↻ Re-run onboarding (wipes memories)
          </button>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">
            Clears everything the advisor has learned about you and restarts the
            intake conversation on the Advisor tab. Your audit, API key, and
            catalog stay intact.
          </p>
        </div>
      </div>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Course Catalog */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Course Catalog</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Pulls real Fordham sections from Banner — CRNs, meeting times, seats. Claude searches this when recommending courses.
          {catalogTerm && catalogCourseCount > 0 && (
            <span className="ml-1 text-gray-400 dark:text-gray-500">
              {catalogCourseCount} courses loaded for {
                terms.find((t) => t.code === catalogTerm)?.description ?? catalogTerm
              }
              {catalogUpdatedAt && ` · ${formatCatalogDate(catalogUpdatedAt)}`}
            </span>
          )}
        </p>

        <div className="flex gap-2 mb-3">
          <select
            value={selectedTerm}
            onChange={(e) => setSelectedTerm(e.target.value)}
            disabled={catalogRefreshing || terms.length === 0}
            className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white focus:outline-none focus:border-fordham-maroon disabled:opacity-40"
          >
            {terms.length === 0 && <option value="">Loading terms…</option>}
            {terms.map((t) => (
              <option key={t.code} value={t.code}>
                {t.description}
              </option>
            ))}
          </select>
          <button
            onClick={refreshCatalog}
            disabled={catalogRefreshing || !selectedTerm}
            className="px-4 py-2 bg-fordham-maroon text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-opacity-90"
          >
            {catalogRefreshing ? "Loading…" : "Refresh"}
          </button>
        </div>

        {catalogRefreshing && catalogProgress && (
          <div className="mb-2">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>Fetching {catalogProgress.label}</span>
              <span>
                {catalogProgress.done} / {catalogProgress.total}
              </span>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-fordham-maroon transition-all duration-200"
                style={{
                  width: `${
                    catalogProgress.total > 0
                      ? Math.round((catalogProgress.done / catalogProgress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {catalogError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {catalogError}
          </div>
        )}

        {!catalogRefreshing && !catalogError && catalogCourseCount === 0 && (
          <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            No catalog loaded yet. Pick a term and hit Refresh — takes ~30–60 seconds.
          </div>
        )}
      </div>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Raw Audit Text */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Raw Audit Data</h2>
          {auditText && (
            <button
              onClick={() => setShowAudit((v) => !v)}
              className="text-xs text-fordham-maroon hover:underline"
            >
              {showAudit ? "Hide" : "Show"}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          The exact text Claude reads from your DegreeWorks page each session.
          {auditText && (
            <span className="ml-1 text-gray-400 dark:text-gray-500">
              {Math.round(auditText.length / 1000)}k chars · ~{Math.round(auditText.length / 4)} tokens
            </span>
          )}
        </p>

        {!auditText ? (
          <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            No audit captured yet. Visit your DegreeWorks page.
          </div>
        ) : showAudit ? (
          <pre className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
            {auditText}
          </pre>
        ) : (
          <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            {auditText.substring(0, 120).trim()}…
          </div>
        )}
      </div>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Appearance */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Appearance</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          System default follows your operating-system dark-mode setting.
        </p>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
        >
          {(["light", "system", "dark"] as const).map((option) => (
            <button
              key={option}
              role="radio"
              aria-checked={theme === option}
              onClick={() => selectTheme(option)}
              className={`flex-1 text-xs font-medium py-2 transition-colors capitalize ${
                theme === option
                  ? "bg-fordham-maroon text-white"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* About */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">About</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Fordham Registration Agent reads your DegreeWorks audit and uses Claude AI (Sonnet for chat, Haiku for profile extraction) to help you plan your courses. All data is stored locally in your browser.
        </p>
      </div>

    </div>
  );
}
