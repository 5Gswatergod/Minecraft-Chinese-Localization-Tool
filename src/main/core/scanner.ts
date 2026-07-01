import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  ProjectConfig,
  ScanSummary,
  SourceType,
  TranslationEntry,
  TranslationContext
} from "../../shared/types";
import {
  listFilesRecursive,
  normalizeSlashes,
  nowIso,
  readMaybeTextFile,
  stableId
} from "./fileSystem";
import {
  collectJsonTextValues,
  extractStringLiterals,
  parseLangJson,
  parseLangProperties,
  parseMaybeJson,
  pathKey
} from "./parsers";
import { loadEntries, saveEntries, saveProject } from "./project";

interface ScanState {
  project: ProjectConfig;
  entries: TranslationEntry[];
  seen: Set<string>;
  scannedFiles: number;
  skippedFiles: number;
  warnings: string[];
}

export async function scanProject(project: ProjectConfig): Promise<{ entries: TranslationEntry[]; summary: ScanSummary }> {
  const previousEntries = await loadEntries(project.workspacePath);
  const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
  const state: ScanState = {
    project,
    entries: [],
    seen: new Set(),
    scannedFiles: 0,
    skippedFiles: 0,
    warnings: []
  };

  await scanMods(state);
  await scanResourcePacks(state);
  await scanConfigDirectory(state, "ftbquests", "ftbquests");
  await scanConfigDirectory(state, "betterquesting", "betterquesting");
  await scanConfigDirectory(state, "hqm", "hqm");
  await scanKubeJs(state);
  await scanAdvancements(state);
  await scanShaderPacks(state);

  const merged = state.entries.map((entry) => {
    const previous = previousById.get(entry.id);
    if (!previous) {
      return entry;
    }
    return {
      ...entry,
      aiTranslations: previous.aiTranslations,
      manualTranslations: previous.manualTranslations,
      status: previous.status,
      note: previous.note,
      createdAt: previous.createdAt,
      updatedAt: previous.updatedAt
    };
  });

  const summary: ScanSummary = {
    scannedAt: nowIso(),
    totalEntries: merged.length,
    bySourceType: countBySourceType(merged),
    scannedFiles: state.scannedFiles,
    skippedFiles: state.skippedFiles,
    warnings: state.warnings
  };

  project.scanSummary = summary;
  await saveEntries(project.workspacePath, merged);
  await saveProject(project);
  return { entries: merged, summary };
}

async function scanMods(state: ScanState): Promise<void> {
  const modsDir = path.join(state.project.sourcePath, "mods");
  if (!(await directoryExists(modsDir))) {
    return;
  }
  const files = await fs.readdir(modsDir);
  for (const file of files.filter((name) => name.toLowerCase().endsWith(".jar"))) {
    await scanZipLike(state, path.join(modsDir, file), "mod");
  }
}

async function scanResourcePacks(state: ScanState): Promise<void> {
  const root = path.join(state.project.sourcePath, "resourcepacks");
  if (!(await directoryExists(root))) {
    return;
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && /\.(zip|jar)$/i.test(entry.name)) {
      await scanZipLike(state, fullPath, "resourcepack");
    } else if (entry.isDirectory()) {
      await scanLanguageFilesInDirectory(state, fullPath, "resourcepack");
    }
  }
}

async function scanKubeJs(state: ScanState): Promise<void> {
  const root = path.join(state.project.sourcePath, "kubejs");
  if (!(await directoryExists(root))) {
    return;
  }
  await scanTextFiles(state, root, "kubejs");
}

async function scanAdvancements(state: ScanState): Promise<void> {
  const roots = [
    path.join(state.project.sourcePath, "datapacks"),
    path.join(state.project.sourcePath, "kubejs", "data"),
    path.join(state.project.sourcePath, "config", "openloader", "data")
  ];

  for (const root of roots) {
    if (!(await directoryExists(root))) {
      continue;
    }
    const files = await listFilesRecursive(root, { extensions: [".json"], maxBytes: 2_000_000 });
    for (const file of files.filter((target) => normalizeSlashes(target).includes("/advancements/"))) {
      await scanJsonTextFile(state, file, "advancement", root);
    }
  }
}

async function scanShaderPacks(state: ScanState): Promise<void> {
  const root = path.join(state.project.sourcePath, "shaderpacks");
  if (!(await directoryExists(root))) {
    return;
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) {
      await scanZipLike(state, fullPath, "shader");
    } else if (entry.isDirectory()) {
      await scanTextFiles(state, fullPath, "shader");
    }
  }
}

async function scanConfigDirectory(state: ScanState, directoryName: string, sourceType: SourceType): Promise<void> {
  const root = path.join(state.project.sourcePath, "config", directoryName);
  if (!(await directoryExists(root))) {
    return;
  }
  await scanTextFiles(state, root, sourceType);
}

async function scanLanguageFilesInDirectory(state: ScanState, root: string, sourceType: SourceType): Promise<void> {
  const files = await listFilesRecursive(root, { extensions: [".json", ".lang"], maxBytes: 2_000_000 });
  for (const file of files) {
    const normalized = normalizeSlashes(path.relative(root, file));
    if (/assets\/[^/]+\/lang\/en_us\.(json|lang)$/i.test(normalized)) {
      const namespace = normalized.match(/assets\/([^/]+)\/lang\/en_us\.(json|lang)$/i)?.[1];
      await scanLangFileFromText(state, file, undefined, await fs.readFile(file, "utf8"), sourceType, namespace);
    }
  }
}

async function scanTextFiles(state: ScanState, root: string, sourceType: SourceType): Promise<void> {
  const files = await listFilesRecursive(root, {
    extensions: [".json", ".snbt", ".txt", ".lang", ".js", ".ts"],
    maxBytes: 2_000_000
  });
  for (const file of files) {
    if (file.toLowerCase().endsWith(".lang")) {
      await scanLangFileFromText(state, file, undefined, await fs.readFile(file, "utf8"), sourceType);
    } else if (file.toLowerCase().endsWith(".json")) {
      await scanJsonTextFile(state, file, sourceType, root);
    } else {
      await scanLiteralTextFile(state, file, sourceType, root);
    }
  }
}

async function scanJsonTextFile(state: ScanState, file: string, sourceType: SourceType, root?: string): Promise<void> {
  state.scannedFiles += 1;
  const content = await readMaybeTextFile(file);
  if (!content) {
    state.skippedFiles += 1;
    return;
  }
  const parsed = parseMaybeJson(content);
  if (!parsed) {
    await scanLiteralTextContent(state, file, undefined, content, sourceType, root);
    return;
  }
  for (const item of collectJsonTextValues(parsed)) {
    addEntry(state, {
      sourceType,
      originPath: file,
      key: pathKey(item.path),
      original: item.value,
      context: {
        fileFormat: "json",
        jsonPath: item.path,
        extraction: "json-text",
        outputPathTemplate: root ? normalizeSlashes(path.relative(root, file)) : undefined
      }
    });
  }
}

async function scanLiteralTextFile(state: ScanState, file: string, sourceType: SourceType, root?: string): Promise<void> {
  state.scannedFiles += 1;
  const content = await readMaybeTextFile(file);
  if (!content) {
    state.skippedFiles += 1;
    return;
  }
  await scanLiteralTextContent(state, file, undefined, content, sourceType, root);
}

async function scanLiteralTextContent(
  state: ScanState,
  originPath: string,
  archivePath: string | undefined,
  content: string,
  sourceType: SourceType,
  root?: string
): Promise<void> {
  for (const value of extractStringLiterals(content)) {
    addEntry(state, {
      sourceType,
      originPath,
      archivePath,
      key: `literal:${stableId([value])}`,
      original: value,
      context: {
        fileFormat: sourceType === "kubejs" ? "script" : "text",
        extraction: "literal",
        outputPathTemplate: root ? normalizeSlashes(path.relative(root, originPath)) : archivePath
      }
    });
  }
}

async function scanZipLike(state: ScanState, zipPath: string, sourceType: SourceType): Promise<void> {
  state.scannedFiles += 1;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  } catch (error) {
    state.skippedFiles += 1;
    state.warnings.push(`無法讀取壓縮檔：${zipPath} (${String(error)})`);
    return;
  }

  const tasks: Array<Promise<void>> = [];
  zip.forEach((innerPath, entry) => {
    if (entry.dir) {
      return;
    }
    const normalized = normalizeSlashes(innerPath);
    const langMatch = normalized.match(/^assets\/([^/]+)\/lang\/en_us\.(json|lang)$/i);
    if (langMatch) {
      tasks.push(
        entry.async("string").then((content) => scanLangFileFromText(state, zipPath, normalized, content, sourceType, langMatch[1]))
      );
      return;
    }

    const patchouliMatch = normalized.match(/^assets\/([^/]+)\/patchouli_books\/.+\/en_us\/.+\.json$/i);
    if (patchouliMatch) {
      tasks.push(entry.async("string").then((content) => scanPatchouliJson(state, zipPath, normalized, content, patchouliMatch[1])));
      return;
    }

    if (/^data\/.+\/advancements\/.+\.json$/i.test(normalized)) {
      tasks.push(entry.async("string").then((content) => scanArchiveJsonText(state, zipPath, normalized, content, "advancement")));
      return;
    }

    if (sourceType === "shader" && /\.(lang|json|txt)$/i.test(normalized)) {
      tasks.push(entry.async("string").then((content) => scanArchiveText(state, zipPath, normalized, content, "shader")));
    }
  });

  await Promise.all(tasks);
}

async function scanLangFileFromText(
  state: ScanState,
  originPath: string,
  archivePath: string | undefined,
  content: string,
  sourceType: SourceType,
  namespace?: string
): Promise<void> {
  const isJson = (archivePath ?? originPath).toLowerCase().endsWith(".json");
  let pairs = [];
  try {
    pairs = isJson ? parseLangJson(content) : parseLangProperties(content);
  } catch (error) {
    state.warnings.push(`語言檔解析失敗：${archivePath ?? originPath} (${String(error)})`);
    return;
  }
  for (const pair of pairs) {
    addEntry(state, {
      sourceType,
      originPath,
      archivePath,
      key: pair.key,
      original: pair.value,
      context: {
        namespace,
        fileFormat: isJson ? "json" : "lang",
        extraction: isJson ? "lang-json" : "lang-properties",
        outputPathTemplate: namespace ? `assets/${namespace}/lang/{locale}.${isJson ? "json" : "lang"}` : undefined
      }
    });
  }
}

async function scanPatchouliJson(state: ScanState, originPath: string, archivePath: string, content: string, namespace: string): Promise<void> {
  await scanArchiveJsonText(state, originPath, archivePath, content, "patchouli", {
    namespace,
    extraction: "patchouli-json",
    outputPathTemplate: archivePath.replace(/\/en_us\//i, "/{locale}/")
  });
}

async function scanArchiveJsonText(
  state: ScanState,
  originPath: string,
  archivePath: string,
  content: string,
  sourceType: SourceType,
  extraContext?: Partial<TranslationContext>
): Promise<void> {
  const parsed = parseMaybeJson(content);
  if (!parsed) {
    await scanArchiveText(state, originPath, archivePath, content, sourceType);
    return;
  }
  for (const item of collectJsonTextValues(parsed)) {
    addEntry(state, {
      sourceType,
      originPath,
      archivePath,
      key: pathKey(item.path),
      original: item.value,
      context: {
        fileFormat: "json",
        jsonPath: item.path,
        extraction: "json-text",
        outputPathTemplate: archivePath,
        ...extraContext
      }
    });
  }
}

async function scanArchiveText(
  state: ScanState,
  originPath: string,
  archivePath: string,
  content: string,
  sourceType: SourceType
): Promise<void> {
  await scanLiteralTextContent(state, originPath, archivePath, content, sourceType);
}

function addEntry(
  state: ScanState,
  input: Omit<TranslationEntry, "id" | "aiTranslations" | "manualTranslations" | "status" | "createdAt" | "updatedAt">
): void {
  const relativeOrigin = normalizeSlashes(path.relative(state.project.sourcePath, input.originPath));
  const id = stableId([
    input.sourceType,
    relativeOrigin,
    input.archivePath,
    input.key,
    input.context?.jsonPath?.join("."),
    input.context?.extraction === "literal" ? input.original : undefined
  ]);
  if (state.seen.has(id)) {
    return;
  }
  state.seen.add(id);
  const now = nowIso();
  state.entries.push({
    ...input,
    id,
    aiTranslations: {},
    manualTranslations: {},
    status: "new",
    createdAt: now,
    updatedAt: now
  });
}

function countBySourceType(entries: TranslationEntry[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.sourceType] = (acc[entry.sourceType] ?? 0) + 1;
    return acc;
  }, {});
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
