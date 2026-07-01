import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Box,
  Check,
  Database,
  Download,
  ExternalLink,
  FileInput,
  FolderOpen,
  Globe2,
  Languages,
  Loader2,
  PackageCheck,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Table,
  Wand2
} from "lucide-react";
import {
  EntryStatus,
  GlossaryTerm,
  LauncherInstance,
  ProjectSnapshot,
  SourceType,
  TargetLocale,
  ThirdPartyTool,
  TranslationBackendConfig,
  TranslationEntry
} from "../shared/types";

const localeLabels: Record<TargetLocale, string> = {
  zh_cn: "简中 zh_cn",
  zh_tw: "繁中 zh_tw"
};

const sourceLabels: Record<SourceType, string> = {
  mod: "模組",
  resourcepack: "資源包",
  ftbquests: "FTB 任務",
  betterquesting: "BetterQuesting",
  hqm: "HQM",
  kubejs: "KubeJS",
  patchouli: "Patchouli",
  advancement: "進度",
  shader: "光影",
  generic: "一般"
};

const statusLabels: Record<EntryStatus, string> = {
  new: "待處理",
  ai: "AI 預翻",
  reviewed: "已審稿",
  ignored: "忽略"
};

export default function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [instances, setInstances] = useState<LauncherInstance[]>([]);
  const [thirdParty, setThirdParty] = useState<ThirdPartyTool[]>([]);
  const [selectedLocale, setSelectedLocale] = useState<TargetLocale>("zh_tw");
  const [targetLocales, setTargetLocales] = useState<TargetLocale[]>(["zh_cn", "zh_tw"]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SourceType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | EntryStatus>("all");
  const [backend, setBackend] = useState<TranslationBackendConfig>({
    kind: "manual",
    endpoint: "http://127.0.0.1:11434",
    model: "rinex20/translategemma3:12b",
    temperature: 0.1,
    speedMode: "fast"
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [progress, setProgress] = useState<{ completed: number; total: number; message: string } | null>(null);

  useEffect(() => {
    const unsubscribe = window.mclocalizer.onTranslationProgress(setProgress);
    void refreshLaunchers();
    void window.mclocalizer.listThirdPartyTools().then(setThirdParty).catch(showError);
    return unsubscribe;
  }, []);

  const entries = snapshot?.entries ?? [];
  const glossary = snapshot?.glossary ?? [];

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (sourceFilter !== "all" && entry.sourceType !== sourceFilter) {
        return false;
      }
      if (statusFilter !== "all" && entry.status !== statusFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [entry.key, entry.original, entry.aiTranslations[selectedLocale], entry.manualTranslations[selectedLocale], entry.note]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [entries, query, selectedLocale, sourceFilter, statusFilter]);

  const stats = useMemo(() => {
    const reviewed = entries.filter((entry) => entry.status === "reviewed").length;
    const ai = entries.filter((entry) => entry.status === "ai").length;
    const ignored = entries.filter((entry) => entry.status === "ignored").length;
    return { total: entries.length, reviewed, ai, ignored, pending: entries.length - reviewed - ai - ignored };
  }, [entries]);

  async function runBusy<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const result = await task();
      return result;
    } catch (caught) {
      showError(caught);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  function showError(caught: unknown): void {
    setError(caught instanceof Error ? caught.message : String(caught));
  }

  async function refreshLaunchers(): Promise<void> {
    const detected = await runBusy("偵測啟動器", () => window.mclocalizer.detectLauncherInstances());
    if (detected) {
      setInstances(detected);
    }
  }

  async function createFromManualInput(): Promise<void> {
    const inputPath = await window.mclocalizer.selectInput();
    if (!inputPath) {
      return;
    }
    await createProject(inputPath);
  }

  async function createProject(inputPath: string, instance?: LauncherInstance): Promise<void> {
    const project = await runBusy("建立專案", () =>
      window.mclocalizer.createProject({
        inputPath,
        targetLocales,
        name: instance?.name,
        minecraftVersion: instance?.minecraftVersion,
        loader: instance?.loader
      })
    );
    if (project) {
      const loaded = await runBusy("載入專案", () => window.mclocalizer.loadProject(project.workspacePath));
      if (loaded) {
        setSnapshot(loaded);
        setMessage("專案已建立，可以開始掃描。");
      }
    }
  }

  async function openProject(): Promise<void> {
    const projectPath = await window.mclocalizer.selectProject();
    if (!projectPath) {
      return;
    }
    const loaded = await runBusy("載入專案", () => window.mclocalizer.loadProject(projectPath));
    if (loaded) {
      setSnapshot(loaded);
      setMessage("專案已載入。");
    }
  }

  async function scanCurrentProject(): Promise<void> {
    if (!snapshot) return;
    const scanned = await runBusy("掃描整合包", () => window.mclocalizer.scanProject(snapshot.project.workspacePath));
    if (scanned) {
      setSnapshot(scanned);
      setMessage(`掃描完成，找到 ${scanned.entries.length} 筆可翻譯內容。`);
    }
  }

  async function saveCurrentEntries(nextEntries = entries): Promise<void> {
    if (!snapshot) return;
    await runBusy("儲存翻譯", () => window.mclocalizer.saveEntries(snapshot.project.workspacePath, nextEntries));
    setSnapshot({ ...snapshot, entries: nextEntries });
    setMessage("翻譯表已儲存。");
  }

  async function saveCurrentGlossary(nextGlossary = glossary): Promise<void> {
    if (!snapshot) return;
    await runBusy("儲存詞彙庫", () => window.mclocalizer.saveGlossary(snapshot.project.workspacePath, nextGlossary));
    setSnapshot({ ...snapshot, glossary: nextGlossary });
    setMessage("詞彙庫已儲存。");
  }

  async function runTranslation(): Promise<void> {
    if (!snapshot) return;
    setProgress(null);
    const translated = await runBusy("執行預翻", () =>
      window.mclocalizer.runTranslation({
        projectPath: snapshot.project.workspacePath,
        locale: selectedLocale,
        backend
      })
    );
    if (translated) {
      setSnapshot({ ...snapshot, entries: translated });
      setMessage("預翻完成，請進行人工審稿。");
    }
  }

  async function exportTable(): Promise<void> {
    if (!snapshot) return;
    const target = await window.mclocalizer.selectExportTable(selectedLocale);
    if (!target) return;
    await runBusy("匯出翻譯表", () =>
      window.mclocalizer.exportTranslationsTable(snapshot.project.workspacePath, selectedLocale, target)
    );
    setMessage(`已匯出翻譯表：${target}`);
  }

  async function importTable(): Promise<void> {
    if (!snapshot) return;
    const source = await window.mclocalizer.selectImportTable();
    if (!source) return;
    const result = await runBusy("匯入翻譯表", () =>
      window.mclocalizer.importTranslationsTable(snapshot.project.workspacePath, selectedLocale, source)
    );
    if (result) {
      const loaded = await window.mclocalizer.loadProject(snapshot.project.workspacePath);
      setSnapshot(loaded);
      setMessage(`匯入完成：更新 ${result.updatedEntries} 筆，略過 ${result.ignoredRows} 筆。`);
    }
  }

  async function exportPatch(): Promise<void> {
    if (!snapshot) return;
    const result = await runBusy("產生補丁包", () =>
      window.mclocalizer.exportPatch({
        projectPath: snapshot.project.workspacePath,
        locales: snapshot.project.targetLocales
      })
    );
    if (result) {
      setMessage(`補丁包已產生：${result.zipPath}`);
      await window.mclocalizer.openPath(result.outputDirectory);
    }
  }

  function updateEntry(id: string, updater: (entry: TranslationEntry) => TranslationEntry): void {
    if (!snapshot) return;
    const nextEntries = entries.map((entry) => (entry.id === id ? updater(entry) : entry));
    setSnapshot({ ...snapshot, entries: nextEntries });
  }

  function updateGlossary(id: string, updater: (term: GlossaryTerm) => GlossaryTerm): void {
    if (!snapshot) return;
    const nextGlossary = glossary.map((term) => (term.id === id ? updater(term) : term));
    setSnapshot({ ...snapshot, glossary: nextGlossary });
  }

  function addGlossaryTerm(): void {
    if (!snapshot) return;
    const now = new Date().toISOString();
    const term: GlossaryTerm = {
      id: crypto.randomUUID(),
      source: "",
      zh_cn: "",
      zh_tw: "",
      note: "",
      tags: [],
      createdAt: now,
      updatedAt: now
    };
    setSnapshot({ ...snapshot, glossary: [term, ...glossary] });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Languages size={22} />
          </div>
          <div>
            <h1>MCLocalizer</h1>
            <p>整合包漢化工作台</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-title">
            <FolderOpen size={16} />
            <span>專案</span>
          </div>
          <div className="locale-toggle">
            {(["zh_cn", "zh_tw"] as TargetLocale[]).map((locale) => (
              <label key={locale} className="check-row">
                <input
                  type="checkbox"
                  checked={targetLocales.includes(locale)}
                  onChange={(event) => {
                    setTargetLocales((current) =>
                      event.target.checked ? [...new Set([...current, locale])] : current.filter((item) => item !== locale)
                    );
                  }}
                />
                {localeLabels[locale]}
              </label>
            ))}
          </div>
          <button className="primary-button" onClick={createFromManualInput} disabled={Boolean(busy) || targetLocales.length === 0}>
            <FileInput size={16} />
            匯入資料夾 / zip
          </button>
          <button className="secondary-button" onClick={openProject} disabled={Boolean(busy)}>
            <FolderOpen size={16} />
            開啟既有專案
          </button>
          {snapshot && (
            <div className="project-meta">
              <strong>{snapshot.project.name}</strong>
              <span>{snapshot.project.sourcePath}</span>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">
            <Box size={16} />
            <span>啟動器實例</span>
            <button className="icon-button" onClick={refreshLaunchers} title="重新偵測" disabled={Boolean(busy)}>
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="instance-list">
            {instances.slice(0, 8).map((instance) => (
              <button key={instance.id} className="instance-item" onClick={() => createProject(instance.path, instance)}>
                <span>{instance.name}</span>
                <small>
                  {instance.launcher}
                  {instance.minecraftVersion ? ` · ${instance.minecraftVersion}` : ""}
                </small>
              </button>
            ))}
            {instances.length === 0 && <p className="muted">尚未偵測到實例，可手動匯入。</p>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <ExternalLink size={16} />
            <span>第三方支援</span>
          </div>
          <div className="third-party-list">
            {thirdParty.map((tool) => (
              <button key={tool.url} className="third-party-item" onClick={() => window.mclocalizer.openExternal(tool.url)}>
                <span>{tool.name}</span>
                <small>{tool.license}</small>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Workbench</p>
            <h2>{snapshot ? snapshot.project.name : "建立或開啟一個漢化專案"}</h2>
          </div>
          <div className="toolbar">
            <select value={selectedLocale} onChange={(event) => setSelectedLocale(event.target.value as TargetLocale)}>
              <option value="zh_tw">繁中 zh_tw</option>
              <option value="zh_cn">简中 zh_cn</option>
            </select>
            <button className="secondary-button" onClick={scanCurrentProject} disabled={!snapshot || Boolean(busy)}>
              <Search size={16} />
              掃描
            </button>
            <button className="secondary-button" onClick={() => saveCurrentEntries()} disabled={!snapshot || Boolean(busy)}>
              <Save size={16} />
              儲存
            </button>
            <button className="primary-button" onClick={exportPatch} disabled={!snapshot || Boolean(busy)}>
              <PackageCheck size={16} />
              產生補丁
            </button>
          </div>
        </header>

        {(busy || message || error || progress) && (
          <div className={`status-bar ${error ? "error" : ""}`}>
            {busy && <Loader2 className="spin" size={16} />}
            <span>{error || progress?.message || message || busy}</span>
            {progress && progress.total > 0 && <progress value={progress.completed} max={progress.total} />}
          </div>
        )}

        <section className="metrics">
          <Metric icon={<Database size={18} />} label="字串" value={stats.total} />
          <Metric icon={<Sparkles size={18} />} label="AI 預翻" value={stats.ai} />
          <Metric icon={<Check size={18} />} label="已審稿" value={stats.reviewed} />
          <Metric icon={<BookOpen size={18} />} label="詞彙" value={glossary.length} />
        </section>

        <div className="content-grid">
          <section className="work-panel translation-panel">
            <div className="section-head">
              <div>
                <h3>手動翻譯入口</h3>
                <p>AI 預翻後在這裡審稿，也可以直接人工翻譯。</p>
              </div>
              <div className="table-actions">
                <button className="secondary-button" onClick={exportTable} disabled={!snapshot || Boolean(busy)}>
                  <Download size={15} />
                  匯出表格
                </button>
                <button className="secondary-button" onClick={importTable} disabled={!snapshot || Boolean(busy)}>
                  <Table size={15} />
                  匯入表格
                </button>
              </div>
            </div>

            <div className="filters">
              <label className="search-box">
                <Search size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋 key / 原文 / 譯文 / 備註" />
              </label>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as "all" | SourceType)}>
                <option value="all">全部來源</option>
                {Object.entries(sourceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | EntryStatus)}>
                <option value="all">全部狀態</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="translation-table">
              <div className="translation-row table-header">
                <span>來源</span>
                <span>Key / 原文</span>
                <span>AI / 人工譯文</span>
                <span>狀態</span>
              </div>
              {filteredEntries.slice(0, 500).map((entry) => (
                <div className="translation-row" key={entry.id}>
                  <span className="source-pill">{sourceLabels[entry.sourceType]}</span>
                  <div className="source-text">
                    <strong title={entry.key}>{entry.key}</strong>
                    <p>{entry.original}</p>
                  </div>
                  <div className="translation-edit">
                    {entry.aiTranslations[selectedLocale] && <small>AI: {entry.aiTranslations[selectedLocale]}</small>}
                    <textarea
                      value={entry.manualTranslations[selectedLocale] ?? ""}
                      placeholder="輸入人工譯文，留空則使用 AI 譯文"
                      onChange={(event) =>
                        updateEntry(entry.id, (current) => ({
                          ...current,
                          manualTranslations: { ...current.manualTranslations, [selectedLocale]: event.target.value },
                          status: event.target.value.trim() ? "reviewed" : current.status,
                          updatedAt: new Date().toISOString()
                        }))
                      }
                    />
                    <input
                      value={entry.note ?? ""}
                      placeholder="備註"
                      onChange={(event) =>
                        updateEntry(entry.id, (current) => ({ ...current, note: event.target.value, updatedAt: new Date().toISOString() }))
                      }
                    />
                  </div>
                  <select
                    value={entry.status}
                    onChange={(event) =>
                      updateEntry(entry.id, (current) => ({
                        ...current,
                        status: event.target.value as EntryStatus,
                        updatedAt: new Date().toISOString()
                      }))
                    }
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {filteredEntries.length === 0 && <div className="empty-state">尚無可顯示的字串。先建立專案並掃描整合包。</div>}
            </div>
            {filteredEntries.length > 500 && <p className="muted">目前顯示前 500 筆，請使用搜尋或篩選縮小範圍。</p>}
          </section>

          <aside className="right-rail">
            <section className="work-panel">
              <div className="section-head compact">
                <div>
                  <h3>翻譯後端</h3>
                  <p>預翻完成後仍以人工審稿為準。</p>
                </div>
              </div>
              <label className="field">
                <span>模式</span>
                <select value={backend.kind} onChange={(event) => setBackend({ ...backend, kind: event.target.value as TranslationBackendConfig["kind"] })}>
                  <option value="manual">Manual</option>
                  <option value="ollama">Ollama / 本地模型</option>
                  <option value="openai-compatible">OpenAI-compatible API</option>
                </select>
              </label>
              {backend.kind !== "manual" && (
                <>
                  <label className="field">
                    <span>Endpoint</span>
                    <input value={backend.endpoint ?? ""} onChange={(event) => setBackend({ ...backend, endpoint: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Model</span>
                    <input value={backend.model ?? ""} onChange={(event) => setBackend({ ...backend, model: event.target.value })} />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={(backend.speedMode ?? "balanced") === "fast"}
                      onChange={(event) => setBackend({ ...backend, speedMode: event.target.checked ? "fast" : "balanced" })}
                    />
                    快速模式
                  </label>
                  {backend.kind === "openai-compatible" && (
                    <label className="field">
                      <span>API Key</span>
                      <input
                        type="password"
                        value={backend.apiKey ?? ""}
                        onChange={(event) => setBackend({ ...backend, apiKey: event.target.value })}
                      />
                    </label>
                  )}
                </>
              )}
              <button className="primary-button full" onClick={runTranslation} disabled={!snapshot || Boolean(busy) || backend.kind === "manual"}>
                <Wand2 size={16} />
                執行預翻
              </button>
            </section>

            <section className="work-panel">
              <div className="section-head compact">
                <div>
                  <h3>詞彙庫</h3>
                  <p>專有名詞會送入翻譯 prompt。</p>
                </div>
                <button className="icon-button" onClick={addGlossaryTerm} title="新增詞彙" disabled={!snapshot}>
                  <Settings2 size={15} />
                </button>
              </div>
              <div className="glossary-list">
                {glossary.slice(0, 8).map((term) => (
                  <div className="glossary-item" key={term.id}>
                    <input
                      placeholder="原文"
                      value={term.source}
                      onChange={(event) => updateGlossary(term.id, (current) => ({ ...current, source: event.target.value }))}
                    />
                    <input
                      placeholder="简中"
                      value={term.zh_cn ?? ""}
                      onChange={(event) => updateGlossary(term.id, (current) => ({ ...current, zh_cn: event.target.value }))}
                    />
                    <input
                      placeholder="繁中"
                      value={term.zh_tw ?? ""}
                      onChange={(event) => updateGlossary(term.id, (current) => ({ ...current, zh_tw: event.target.value }))}
                    />
                  </div>
                ))}
                {glossary.length === 0 && <p className="muted">可加入物品、模組、地名、任務術語。</p>}
              </div>
              <button className="secondary-button full" onClick={() => saveCurrentGlossary()} disabled={!snapshot || Boolean(busy)}>
                <Save size={16} />
                儲存詞彙
              </button>
            </section>

            <section className="work-panel">
              <div className="section-head compact">
                <div>
                  <h3>掃描摘要</h3>
                  <p>來源分佈與匯出前檢查。</p>
                </div>
              </div>
              <div className="summary-list">
                {Object.entries(snapshot?.project.scanSummary?.bySourceType ?? {}).map(([source, count]) => (
                  <div key={source}>
                    <span>{sourceLabels[source as SourceType] ?? source}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
                {!snapshot?.project.scanSummary && <p className="muted">尚未掃描。</p>}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: JSX.Element; label: string; value: number }): JSX.Element {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}
