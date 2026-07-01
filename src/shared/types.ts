export type TargetLocale = "zh_cn" | "zh_tw";

export type InputKind = "directory" | "archive";

export type SourceType =
  | "mod"
  | "resourcepack"
  | "ftbquests"
  | "betterquesting"
  | "hqm"
  | "kubejs"
  | "patchouli"
  | "advancement"
  | "shader"
  | "generic";

export type EntryStatus = "new" | "ai" | "reviewed" | "ignored";

export type TranslationBackendKind = "manual" | "openai-compatible" | "ollama";

export interface LauncherInstance {
  id: string;
  launcher: "PCL2" | "Prism" | "CurseForge" | "Modrinth" | "Minecraft" | "Unknown";
  name: string;
  path: string;
  minecraftVersion?: string;
  loader?: string;
}

export interface ScanSummary {
  scannedAt: string;
  totalEntries: number;
  bySourceType: Record<string, number>;
  scannedFiles: number;
  skippedFiles: number;
  warnings: string[];
}

export interface ProjectConfig {
  id: string;
  name: string;
  inputPath: string;
  inputKind: InputKind;
  workspacePath: string;
  sourcePath: string;
  targetLocales: TargetLocale[];
  minecraftVersion?: string;
  loader?: string;
  createdAt: string;
  updatedAt: string;
  scanSummary?: ScanSummary;
  translationBackend?: TranslationBackendConfig;
}

export interface TranslationContext {
  namespace?: string;
  fileFormat?: "json" | "lang" | "text" | "snbt" | "script";
  jsonPath?: Array<string | number>;
  extraction?: "lang-json" | "lang-properties" | "json-text" | "literal" | "patchouli-json";
  outputPathTemplate?: string;
}

export interface TranslationEntry {
  id: string;
  sourceType: SourceType;
  originPath: string;
  archivePath?: string;
  key: string;
  original: string;
  aiTranslations: Partial<Record<TargetLocale, string>>;
  manualTranslations: Partial<Record<TargetLocale, string>>;
  status: EntryStatus;
  note?: string;
  context?: TranslationContext;
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryTerm {
  id: string;
  source: string;
  zh_cn?: string;
  zh_tw?: string;
  note?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TranslationBackendConfig {
  kind: TranslationBackendKind;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
}

export interface ProjectSnapshot {
  project: ProjectConfig;
  entries: TranslationEntry[];
  glossary: GlossaryTerm[];
}

export interface CreateProjectRequest {
  inputPath: string;
  targetLocales: TargetLocale[];
  name?: string;
  minecraftVersion?: string;
  loader?: string;
}

export interface TranslateRequest {
  projectPath: string;
  locale: TargetLocale;
  backend: TranslationBackendConfig;
  entryIds?: string[];
}

export interface TranslationProgress {
  total: number;
  completed: number;
  message: string;
}

export interface ExportPatchRequest {
  projectPath: string;
  locales: TargetLocale[];
}

export interface ExportPatchResult {
  outputDirectory: string;
  zipPath: string;
  resourcePackPaths: string[];
  copiedFiles: number;
  translatedEntries: number;
  warnings: string[];
}

export interface ImportTranslationsResult {
  updatedEntries: number;
  ignoredRows: number;
}

export interface ThirdPartyTool {
  name: string;
  purpose: string;
  url: string;
  license: string;
  notes: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
