import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  CreateProjectRequest,
  ExportPatchRequest,
  GlossaryTerm,
  IpcResult,
  TargetLocale,
  TranslateRequest,
  TranslationEntry
} from "../shared/types";
import { createProject, loadSnapshot, saveEntries, saveGlossary } from "./core/project";
import { scanProject } from "./core/scanner";
import { detectLauncherInstances } from "./core/launcherDetection";
import { translateEntries } from "./core/translator";
import { exportPatch } from "./core/exporter";
import { exportTranslationsTable, importTranslationsTable } from "./core/tableExchange";
import { thirdPartyTools } from "./core/thirdParty";

let mainWindow: BrowserWindow | undefined;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: "Minecraft Chinese Localization Tool",
    backgroundColor: "#f6f4ef",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpc(): void {
  handle("dialog:selectInput", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "選擇整合包資料夾或 zip/mrpack",
      properties: ["openFile", "openDirectory"],
      filters: [
        { name: "Minecraft pack archives", extensions: ["zip", "mrpack"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });

  handle("dialog:selectProject", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "選擇含 .mclocalizer 的專案資料夾",
      properties: ["openDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });

  handle("dialog:selectExportTable", async (_event, locale: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "匯出翻譯表",
      defaultPath: `translations-${locale}.xlsx`,
      filters: [
        { name: "Excel workbook", extensions: ["xlsx"] },
        { name: "CSV", extensions: ["csv"] }
      ]
    });
    return result.canceled ? undefined : result.filePath;
  });

  handle("dialog:selectImportTable", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "匯入翻譯表",
      properties: ["openFile"],
      filters: [
        { name: "Translation table", extensions: ["xlsx", "csv"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });

  handle("project:create", async (_event, request: CreateProjectRequest) => createProject(request));
  handle("project:load", async (_event, projectPath: string) => loadSnapshot(projectPath));
  handle("project:saveEntries", async (_event, projectPath: string, entries: TranslationEntry[]) => saveEntries(projectPath, entries));
  handle("project:saveGlossary", async (_event, projectPath: string, glossary: GlossaryTerm[]) => saveGlossary(projectPath, glossary));
  handle("project:scan", async (_event, projectPath: string) => {
    const snapshot = await loadSnapshot(projectPath);
    await scanProject(snapshot.project);
    return loadSnapshot(projectPath);
  });
  handle("launcher:detect", async () => detectLauncherInstances());
  handle("thirdParty:list", async () => thirdPartyTools);
  handle("shell:openPath", async (_event, target: string) => shell.openPath(target));
  handle("shell:openExternal", async (_event, target: string) => shell.openExternal(target));
  handle("translation:run", async (_event, request: TranslateRequest) => {
    const entries = await translateEntries(request.projectPath, request.locale, request.backend, request.entryIds, (completed, total, message) => {
      mainWindow?.webContents.send("translation:progress", { completed, total, message });
    });
    return entries;
  });
  handle("patch:export", async (_event, request: ExportPatchRequest) => exportPatch(request));
  handle("table:export", async (_event, projectPath: string, locale: TargetLocale, targetPath: string) =>
    exportTranslationsTable(projectPath, locale, targetPath)
  );
  handle("table:import", async (_event, projectPath: string, locale: TargetLocale, tablePath: string) =>
    importTranslationsTable(projectPath, locale, tablePath)
  );
}

function handle<TArgs extends unknown[], TResult>(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult>
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs): Promise<IpcResult<TResult>> => {
    try {
      return { ok: true, data: await listener(event, ...args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
