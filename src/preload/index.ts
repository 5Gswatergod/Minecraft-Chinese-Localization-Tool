import { contextBridge, ipcRenderer } from "electron";
import {
  CreateProjectRequest,
  ExportPatchRequest,
  GlossaryTerm,
  IpcResult,
  TargetLocale,
  TranslateRequest,
  TranslationEntry
} from "../shared/types";

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

const api = {
  selectInput: () => invoke<string | undefined>("dialog:selectInput"),
  selectProject: () => invoke<string | undefined>("dialog:selectProject"),
  selectExportTable: (locale: TargetLocale) => invoke<string | undefined>("dialog:selectExportTable", locale),
  selectImportTable: () => invoke<string | undefined>("dialog:selectImportTable"),
  createProject: (request: CreateProjectRequest) => invoke("project:create", request),
  loadProject: (projectPath: string) => invoke("project:load", projectPath),
  saveEntries: (projectPath: string, entries: TranslationEntry[]) => invoke("project:saveEntries", projectPath, entries),
  saveGlossary: (projectPath: string, glossary: GlossaryTerm[]) => invoke("project:saveGlossary", projectPath, glossary),
  scanProject: (projectPath: string) => invoke("project:scan", projectPath),
  detectLauncherInstances: () => invoke("launcher:detect"),
  listThirdPartyTools: () => invoke("thirdParty:list"),
  openPath: (target: string) => invoke("shell:openPath", target),
  openExternal: (target: string) => invoke("shell:openExternal", target),
  runTranslation: (request: TranslateRequest) => invoke("translation:run", request),
  exportPatch: (request: ExportPatchRequest) => invoke("patch:export", request),
  exportTranslationsTable: (projectPath: string, locale: TargetLocale, targetPath: string) =>
    invoke("table:export", projectPath, locale, targetPath),
  importTranslationsTable: (projectPath: string, locale: TargetLocale, tablePath: string) =>
    invoke("table:import", projectPath, locale, tablePath),
  onTranslationProgress: (callback: (progress: { completed: number; total: number; message: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { completed: number; total: number; message: string }) =>
      callback(progress);
    ipcRenderer.on("translation:progress", listener);
    return () => ipcRenderer.off("translation:progress", listener);
  }
};

contextBridge.exposeInMainWorld("mclocalizer", api);

export type McLocalizerApi = typeof api;
