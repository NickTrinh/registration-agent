import { useState, useEffect } from "react";
import type { MemoryEntry } from "../../shared/types";
import Notice from "../components/Notice";
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

// A catalog refresh fails in two ways that want different recoveries, so the
// UI keeps them apart rather than flattening both to a string (ADR 0029).
// `expired` ⇒ `message` is the worker's one fixed sentence and `recoveryUrl`
// is present; otherwise `message` is raw provider text and there is no action
// worth offering. Re-running the fetch against a dead Banner session just
// reproduces the failure — the only real recovery is a Banner tab.
interface CatalogFailure {
  message: string;
  expired: boolean;
  recoveryUrl?: string;
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
  const [catalogError, setCatalogError] = useState<CatalogFailure | null>(null);

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

  // Two-step confirms for the destructive actions. `confirm()` and `alert()`
  // are blocking OS chrome: unthemeable, out of place in a side panel, and
  // they render light in dark mode no matter what `color-scheme` says.
  const [pendingClearAll, setPendingClearAll] = useState(false);
  const [pendingRerun, setPendingRerun] = useState(false);
  const [rerunDone, setRerunDone] = useState(false);

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
        setCatalogError({
          message: msg.error ?? "Unknown error",
          expired: msg.expired === true,
          recoveryUrl: typeof msg.recoveryUrl === "string" ? msg.recoveryUrl : undefined,
        });
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
    setPendingClearAll(false);
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
    setPendingRerun(false);
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
    setRerunDone(true);
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
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noreferrer"
            className="focus-ring rounded underline text-fordham-maroon dark:text-fordham-maroon-ink"
          >
            console.anthropic.com
          </a>.
        </p>

        {maskedKey && (
          <div className="flex items-center justify-between mb-3 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <span className="text-xs text-gray-800 dark:text-gray-100 font-mono">{maskedKey}</span>
            <button
              onClick={clearKey}
              className="focus-ring rounded px-1 text-xs text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
            >
              Remove
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKey()}
            placeholder={maskedKey ? "Enter new key to replace..." : "sk-ant-..."}
            aria-label="Anthropic API key"
            className="focus-ring flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent text-sm font-mono"
          />
          <button
            onClick={saveKey}
            disabled={!apiKey.trim()}
            className="focus-ring px-4 py-2 bg-fordham-maroon text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-opacity-90"
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
              <button onClick={startEdit} className="focus-ring rounded px-1 text-xs text-fordham-maroon dark:text-fordham-maroon-ink hover:underline">
                Edit
              </button>
            )}
            <button
              onClick={refreshProfile}
              disabled={refreshing || editing}
              className="focus-ring rounded px-1 text-xs text-gray-600 dark:text-gray-400 hover:underline disabled:opacity-40"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Auto-extracted from your DegreeWorks audit. Injected into every chat session as memory.
          {profileDate && <span className="ml-1 text-gray-600 dark:text-gray-400">Last updated {profileDate}.</span>}
        </p>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={10}
              aria-label="Student profile"
              className="focus-ring w-full text-xs text-gray-800 dark:text-gray-100 bg-transparent border border-fordham-maroon dark:border-fordham-maroon-ink rounded-lg p-3 font-mono leading-relaxed resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelEdit}
                className="focus-ring px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!editValue.trim()}
                className="focus-ring px-3 py-1.5 text-xs bg-fordham-maroon text-white rounded-lg disabled:opacity-40 hover:bg-opacity-90"
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
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            No profile yet. Visit your DegreeWorks page to generate one automatically.
          </div>
        )}
      </div>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Long-Term Memory */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Long-Term Memory</h2>
          {memories.length > 0 &&
            (pendingClearAll ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 dark:text-gray-400">Delete all?</span>
                <button
                  onClick={clearAllMemories}
                  className="focus-ring rounded px-2 py-0.5 text-xs font-medium bg-red-600 text-white hover:bg-red-700"
                >
                  Delete
                </button>
                <button
                  onClick={() => setPendingClearAll(false)}
                  className="focus-ring rounded px-1 text-xs text-gray-600 dark:text-gray-400 hover:underline"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setPendingClearAll(true)}
                className="focus-ring rounded px-1 text-xs text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
              >
                Clear all
              </button>
            ))}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Durable facts the advisor has learned about you. Injected as a routing
          index into every chat so recommendations fit your situation.
        </p>

        {/* Auto-save toggle */}
        <label className="flex items-center justify-between gap-3 px-3 py-2 mb-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
              Auto-save memories from chat
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
              When ON, the advisor learns durable facts from normal conversation.
              When OFF, memories only save via onboarding or explicit "remember" requests.
            </div>
          </div>
          <button
            onClick={toggleAutoSave}
            role="switch"
            aria-checked={autoSaveEnabled}
            aria-label="Auto-save memories from chat"
            className={`focus-ring shrink-0 relative inline-flex h-5 w-9 rounded-full transition-colors ${
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
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
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
                    <span className="text-[11px] uppercase tracking-wide font-semibold text-fordham-maroon dark:text-fordham-maroon-ink bg-fordham-maroon/10 dark:bg-fordham-maroon-ink/10 px-1.5 py-0.5 rounded">
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
                        aria-label="Memory description"
                        className="focus-ring w-full text-xs px-2 py-1 bg-transparent border border-fordham-maroon dark:border-fordham-maroon-ink rounded"
                      />
                      <textarea
                        value={editDraftContent}
                        onChange={(e) => setEditDraftContent(e.target.value)}
                        placeholder="Content (1–3 sentences)"
                        rows={3}
                        aria-label="Memory content"
                        className="focus-ring w-full text-xs px-2 py-1 bg-transparent border border-fordham-maroon dark:border-fordham-maroon-ink rounded resize-none leading-snug"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={cancelMemoryEdit}
                          className="focus-ring rounded px-1 text-xs text-gray-600 dark:text-gray-400 hover:underline"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveMemoryEdit}
                          disabled={!editDraftDescription.trim() || !editDraftContent.trim()}
                          className="focus-ring text-xs px-2 py-0.5 bg-fordham-maroon text-white rounded disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug">{m.content}</p>
                      {/* ADR 0015: this quote exists so the student can VERIFY
                          the memory against what they remember saying. It is
                          evidence, so it is set like evidence — not shrunk to
                          10px grey italic like a disclaimer nobody reads. */}
                      {m.sourceQuote && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug mt-1.5 pl-2 border-l-2 border-gray-300 dark:border-gray-600">
                          you said: “{m.sourceQuote}”
                        </p>
                      )}
                    </>
                  )}
                </div>
                {editingId === m.id ? null : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startMemoryEdit(m)}
                      className="focus-ring rounded px-1 text-xs text-gray-600 dark:text-gray-400 hover:text-fordham-maroon dark:hover:text-fordham-maroon-ink"
                      aria-label={`Edit memory: ${m.description}`}
                      title="Edit"
                    >
                      <span aria-hidden>✎</span>
                    </button>
                    <button
                      onClick={() => deleteMemoryEntry(m.id)}
                      className="focus-ring rounded px-1 text-xs text-gray-600 dark:text-gray-400 hover:text-red-700 dark:hover:text-red-400"
                      aria-label={`Delete memory: ${m.description}`}
                      title="Delete"
                    >
                      <span aria-hidden>×</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          {rerunDone ? (
            <Notice
              severity="info"
              title="Onboarding reset"
              body="Head to the Advisor tab — the welcome card is back."
              onDismiss={() => setRerunDone(false)}
            />
          ) : pendingRerun ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-800 dark:text-gray-100 leading-snug">
                This deletes everything the advisor has learned about you and
                restarts the intake. Your audit, API key, and catalog stay intact.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={rerunOnboarding}
                  className="focus-ring rounded px-2 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-700"
                >
                  Delete memories and re-run
                </button>
                <button
                  onClick={() => setPendingRerun(false)}
                  className="focus-ring rounded px-2 py-1 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => setPendingRerun(true)}
                className="focus-ring rounded px-1 text-xs text-fordham-maroon dark:text-fordham-maroon-ink hover:underline font-medium"
              >
                ↻ Re-run onboarding (wipes memories)
              </button>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-snug">
                Clears everything the advisor has learned about you and restarts the
                intake conversation on the Advisor tab. Your audit, API key, and
                catalog stay intact.
              </p>
            </>
          )}
        </div>
      </div>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Course Catalog */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Course Catalog</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Pulls real Fordham sections from Banner — CRNs, meeting times, seats. Claude searches this when recommending courses.
          {catalogTerm && catalogCourseCount > 0 && (
            <span className="ml-1 text-gray-600 dark:text-gray-400">
              {catalogCourseCount} courses loaded for {
                terms.find((t) => t.code === catalogTerm)?.description ?? catalogTerm
              }
              {catalogUpdatedAt && ` · ${formatCatalogDate(catalogUpdatedAt)}`}
            </span>
          )}
        </p>

        <div className="flex gap-2 mb-3">
          {/* No custom dropdown. `color-scheme` (styles.css + applyTheme) is
              what makes the native <select> AND its popup follow the theme. */}
          <select
            value={selectedTerm}
            onChange={(e) => setSelectedTerm(e.target.value)}
            disabled={catalogRefreshing || terms.length === 0}
            aria-label="Catalog term"
            className="focus-ring flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-transparent disabled:opacity-40"
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
            className="focus-ring px-4 py-2 bg-fordham-maroon text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-opacity-90"
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

        {/* An expired session is recoverable and says where; an opaque failure
            is not, and says that instead of offering a button that re-fails.
            The second step ("now hit Refresh") needs no slot — that control is
            three inches up this same screen. */}
        {catalogError?.expired && catalogError.recoveryUrl ? (
          <Notice
            severity="warn"
            title="Fordham registration session expired"
            body={catalogError.message}
            action={{ label: "Open Browse Classes", href: catalogError.recoveryUrl }}
            onDismiss={() => setCatalogError(null)}
          />
        ) : catalogError ? (
          <Notice
            severity="error"
            title="Catalog refresh failed"
            body={catalogError.message}
            onDismiss={() => setCatalogError(null)}
          />
        ) : null}

        {!catalogRefreshing && !catalogError && catalogCourseCount === 0 && (
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
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
              className="focus-ring rounded px-1 text-xs text-fordham-maroon dark:text-fordham-maroon-ink hover:underline"
            >
              {showAudit ? "Hide" : "Show"}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          The exact text Claude reads from your DegreeWorks page each session.
          {auditText && (
            <span className="ml-1 text-gray-600 dark:text-gray-400">
              {Math.round(auditText.length / 1000)}k chars · ~{Math.round(auditText.length / 4)} tokens
            </span>
          )}
        </p>

        {!auditText ? (
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            No audit captured yet. Visit your DegreeWorks page.
          </div>
        ) : showAudit ? (
          <pre className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
            {auditText}
          </pre>
        ) : (
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
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
              className={`focus-ring flex-1 text-xs font-medium py-2 transition-colors capitalize ${
                theme === option
                  ? "bg-fordham-maroon text-white"
                  : "bg-transparent text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
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
          RamPlan reads your DegreeWorks audit and uses Claude AI (Sonnet for chat, Haiku for profile extraction) to help you plan your courses. All data is stored locally in your browser.
        </p>
      </div>

    </div>
  );
}
