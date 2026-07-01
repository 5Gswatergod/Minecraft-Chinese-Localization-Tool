import fs from "node:fs/promises";
import path from "node:path";
import {
  CreateProjectRequest,
  GlossaryTerm,
  ProjectConfig,
  ProjectSnapshot,
  TranslationEntry
} from "../../shared/types";
import {
  ensureDir,
  nowIso,
  pathExists,
  readJsonFile,
  readJsonLines,
  safeFileName,
  stableId,
  unzipToDirectory,
  writeJsonFile,
  writeJsonLines
} from "./fileSystem";

export function metaDirectory(projectPath: string): string {
  return path.join(projectPath, ".mclocalizer");
}

export function projectFile(projectPath: string): string {
  return path.join(metaDirectory(projectPath), "project.json");
}

export function stringsFile(projectPath: string): string {
  return path.join(metaDirectory(projectPath), "strings.jsonl");
}

export function glossaryFile(projectPath: string): string {
  return path.join(metaDirectory(projectPath), "glossary.json");
}

export async function createProject(request: CreateProjectRequest): Promise<ProjectConfig> {
  const stat = await fs.stat(request.inputPath);
  const inputKind = stat.isDirectory() ? "directory" : "archive";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = request.name || safeFileName(path.basename(request.inputPath, path.extname(request.inputPath)));
  const id = stableId([request.inputPath, timestamp]);
  let workspacePath = request.inputPath;
  let sourcePath = request.inputPath;

  if (inputKind === "archive") {
    const { app } = await import("electron");
    const projectsRoot = path.join(app.getPath("documents"), "Minecraft Chinese Localization Tool", "Projects");
    workspacePath = path.join(projectsRoot, `${safeFileName(name)}-${timestamp}`);
    sourcePath = path.join(workspacePath, "source");
    await unzipToDirectory(request.inputPath, sourcePath);
  }

  const now = nowIso();
  const project: ProjectConfig = {
    id,
    name,
    inputPath: request.inputPath,
    inputKind,
    workspacePath,
    sourcePath,
    targetLocales: request.targetLocales,
    minecraftVersion: request.minecraftVersion,
    loader: request.loader,
    createdAt: now,
    updatedAt: now,
    translationBackend: { kind: "manual" }
  };

  await saveProject(project);
  await saveEntries(workspacePath, []);
  await saveGlossary(workspacePath, []);
  return project;
}

export async function loadProject(projectPath: string): Promise<ProjectConfig> {
  return readJsonFile<ProjectConfig>(projectFile(projectPath));
}

export async function saveProject(project: ProjectConfig): Promise<void> {
  project.updatedAt = nowIso();
  await writeJsonFile(projectFile(project.workspacePath), project);
}

export async function loadEntries(projectPath: string): Promise<TranslationEntry[]> {
  return readJsonLines<TranslationEntry>(stringsFile(projectPath));
}

export async function saveEntries(projectPath: string, entries: TranslationEntry[]): Promise<void> {
  await writeJsonLines(stringsFile(projectPath), entries);
}

export async function loadGlossary(projectPath: string): Promise<GlossaryTerm[]> {
  const file = glossaryFile(projectPath);
  if (!(await pathExists(file))) {
    return [];
  }
  return readJsonFile<GlossaryTerm[]>(file);
}

export async function saveGlossary(projectPath: string, glossary: GlossaryTerm[]): Promise<void> {
  await writeJsonFile(glossaryFile(projectPath), glossary);
}

export async function loadSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  return {
    project: await loadProject(projectPath),
    entries: await loadEntries(projectPath),
    glossary: await loadGlossary(projectPath)
  };
}

export async function ensureProjectMeta(projectPath: string): Promise<void> {
  await ensureDir(metaDirectory(projectPath));
}
