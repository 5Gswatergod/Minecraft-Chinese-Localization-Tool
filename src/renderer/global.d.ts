import type {
  CreateProjectRequest,
  ExportPatchRequest,
  ExportPatchResult,
  GlossaryTerm,
  ImportTranslationsResult,
  LauncherInstance,
  ProjectConfig,
  ProjectSnapshot,
  TargetLocale,
  ThirdPartyTool,
  TranslateRequest,
  TranslationEntry
} from "../shared/types";

declare global {
  interface Window {
    mclocalizer: {
      selectInput(): Promise<string | undefined>;
      selectProject(): Promise<string | undefined>;
      selectExportTable(locale: TargetLocale): Promise<string | undefined>;
      selectImportTable(): Promise<string | undefined>;
      createProject(request: CreateProjectRequest): Promise<ProjectConfig>;
      loadProject(projectPath: string): Promise<ProjectSnapshot>;
      saveEntries(projectPath: string, entries: TranslationEntry[]): Promise<void>;
      saveGlossary(projectPath: string, glossary: GlossaryTerm[]): Promise<void>;
      scanProject(projectPath: string): Promise<ProjectSnapshot>;
      detectLauncherInstances(): Promise<LauncherInstance[]>;
      listThirdPartyTools(): Promise<ThirdPartyTool[]>;
      openPath(target: string): Promise<string>;
      openExternal(target: string): Promise<void>;
      runTranslation(request: TranslateRequest): Promise<TranslationEntry[]>;
      exportPatch(request: ExportPatchRequest): Promise<ExportPatchResult>;
      exportTranslationsTable(projectPath: string, locale: TargetLocale, targetPath: string): Promise<string>;
      importTranslationsTable(projectPath: string, locale: TargetLocale, tablePath: string): Promise<ImportTranslationsResult>;
      onTranslationProgress(callback: (progress: { completed: number; total: number; message: string }) => void): () => void;
    };
  }
}

export {};
