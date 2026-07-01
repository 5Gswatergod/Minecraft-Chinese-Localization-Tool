import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { ExportPatchRequest, ExportPatchResult, ProjectConfig, TargetLocale, TranslationEntry } from "../../shared/types";
import { ensureDir, normalizeSlashes, nowIso, safeFileName, zipDirectory } from "./fileSystem";
import { parseLangProperties, parseMaybeJson, setJsonPath } from "./parsers";
import { loadEntries, loadProject } from "./project";

type LocaleEntry = TranslationEntry & { finalText: string };

export async function exportPatch(request: ExportPatchRequest): Promise<ExportPatchResult> {
  const project = await loadProject(request.projectPath);
  const entries = await loadEntries(request.projectPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDirectory = path.join(project.workspacePath, ".mclocalizer", "output", `${safeFileName(project.name)}-${timestamp}`);
  const patchRoot = path.join(outputDirectory, "patch");
  await ensureDir(patchRoot);

  const warnings: string[] = [];
  const resourcePackPaths: string[] = [];
  let copiedFiles = 0;
  let translatedEntries = 0;

  for (const locale of request.locales) {
    const localeEntries = entries
      .map((entry) => ({ ...entry, finalText: finalTranslation(entry, locale) }))
      .filter((entry): entry is LocaleEntry => Boolean(entry.finalText) && entry.status !== "ignored");

    translatedEntries += localeEntries.length;
    const resourcePackDir = path.join(patchRoot, "resourcepacks", `MCLocalizer-${locale}`);
    const languageEntries = localeEntries.filter((entry) => isLanguageResourceEntry(entry));
    const patchouliEntries = localeEntries.filter((entry) => entry.sourceType === "patchouli" && entry.archivePath);
    await writeResourcePack(project, resourcePackDir, locale, languageEntries, patchouliEntries, warnings);

    const resourcePackZip = path.join(patchRoot, "resourcepacks", `MCLocalizer-${locale}.zip`);
    await zipDirectory(resourcePackDir, resourcePackZip);
    await fs.rm(resourcePackDir, { recursive: true, force: true });
    resourcePackPaths.push(resourcePackZip);

    const transformed = await writeTransformedFiles(project, patchRoot, locale, localeEntries, warnings);
    copiedFiles += transformed;
  }

  await writePatchReadme(project, patchRoot, request.locales);
  const zipPath = path.join(outputDirectory, `${safeFileName(project.name)}-localization-patch.zip`);
  await zipDirectory(patchRoot, zipPath);

  return {
    outputDirectory,
    zipPath,
    resourcePackPaths,
    copiedFiles,
    translatedEntries,
    warnings
  };
}

function finalTranslation(entry: TranslationEntry, locale: TargetLocale): string {
  return (entry.manualTranslations[locale] || entry.aiTranslations[locale] || "").trim();
}

function isLanguageResourceEntry(entry: TranslationEntry): boolean {
  return Boolean(
    (entry.sourceType === "mod" || entry.sourceType === "resourcepack" || entry.sourceType === "shader") &&
      (entry.context?.extraction === "lang-json" || entry.context?.extraction === "lang-properties") &&
      entry.context?.namespace
  );
}

async function writeResourcePack(
  project: ProjectConfig,
  resourcePackDir: string,
  locale: TargetLocale,
  languageEntries: LocaleEntry[],
  patchouliEntries: LocaleEntry[],
  warnings: string[]
): Promise<void> {
  await ensureDir(resourcePackDir);
  await fs.writeFile(
    path.join(resourcePackDir, "pack.mcmeta"),
    JSON.stringify(
      {
        pack: {
          pack_format: inferPackFormat(project.minecraftVersion),
          description: `MCLocalizer ${locale} patch for ${project.name}`
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const jsonGroups = new Map<string, Record<string, string>>();
  const langGroups = new Map<string, Array<{ key: string; value: string }>>();

  for (const entry of languageEntries) {
    const namespace = entry.context?.namespace ?? "mclocalizer";
    const format = entry.context?.fileFormat === "lang" ? "lang" : "json";
    const target = path.join(resourcePackDir, "assets", namespace, "lang", `${locale}.${format}`);
    if (format === "lang") {
      const rows = langGroups.get(target) ?? [];
      rows.push({ key: entry.key, value: entry.finalText });
      langGroups.set(target, rows);
    } else {
      const rows = jsonGroups.get(target) ?? {};
      rows[entry.key] = entry.finalText;
      jsonGroups.set(target, rows);
    }
  }

  for (const [target, rows] of jsonGroups) {
    await ensureDir(path.dirname(target));
    await fs.writeFile(target, `${JSON.stringify(sortObject(rows), null, 2)}\n`, "utf8");
  }

  for (const [target, rows] of langGroups) {
    await ensureDir(path.dirname(target));
    await fs.writeFile(target, `${rows.map((row) => `${row.key}=${row.value}`).join("\n")}\n`, "utf8");
  }

  await writePatchouliFiles(resourcePackDir, locale, patchouliEntries, warnings);
}

async function writePatchouliFiles(
  resourcePackDir: string,
  locale: TargetLocale,
  patchouliEntries: LocaleEntry[],
  warnings: string[]
): Promise<void> {
  const byArchiveFile = groupBy(patchouliEntries, (entry) => `${entry.originPath}\u001f${entry.archivePath}`);
  for (const group of byArchiveFile.values()) {
    const first = group[0];
    if (!first.archivePath) {
      continue;
    }
    try {
      const zip = await JSZip.loadAsync(await fs.readFile(first.originPath));
      const archiveEntry = zip.file(first.archivePath);
      if (!archiveEntry) {
        warnings.push(`Patchouli 來源不存在：${first.archivePath}`);
        continue;
      }
      const parsed = parseMaybeJson(await archiveEntry.async("string"));
      if (!parsed) {
        warnings.push(`Patchouli JSON 解析失敗：${first.archivePath}`);
        continue;
      }
      for (const entry of group) {
        if (entry.context?.jsonPath) {
          setJsonPath(parsed, entry.context.jsonPath, entry.finalText);
        }
      }
      const template = first.context?.outputPathTemplate ?? first.archivePath;
      const relative = template.replace("{locale}", locale);
      const target = path.join(resourcePackDir, relative);
      await ensureDir(path.dirname(target));
      await fs.writeFile(target, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    } catch (error) {
      warnings.push(`Patchouli 匯出失敗：${first.archivePath} (${String(error)})`);
    }
  }
}

async function writeTransformedFiles(
  project: ProjectConfig,
  patchRoot: string,
  locale: TargetLocale,
  entries: LocaleEntry[],
  warnings: string[]
): Promise<number> {
  const candidates = entries.filter((entry) => {
    if (entry.archivePath || isLanguageResourceEntry(entry) || entry.sourceType === "patchouli") {
      return false;
    }
    return ["ftbquests", "betterquesting", "hqm", "kubejs", "advancement", "generic", "shader"].includes(entry.sourceType);
  });
  const byFile = groupBy(candidates, (entry) => entry.originPath);
  let written = 0;

  for (const [file, group] of byFile) {
    try {
      const original = await fs.readFile(file, "utf8");
      const parsed = parseMaybeJson(original);
      let output: string;

      if (parsed && group.every((entry) => entry.context?.jsonPath)) {
        for (const entry of group) {
          setJsonPath(parsed, entry.context!.jsonPath!, entry.finalText);
        }
        output = `${JSON.stringify(parsed, null, 2)}\n`;
      } else if (file.toLowerCase().endsWith(".lang")) {
        output = mergeLangText(original, group);
      } else {
        output = replaceQuotedLiterals(original, group);
      }

      const relative = normalizeSlashes(path.relative(project.sourcePath, file));
      if (relative.startsWith("..")) {
        warnings.push(`略過來源根目錄外的檔案：${file}`);
        continue;
      }
      const target = path.join(patchRoot, relative);
      await ensureDir(path.dirname(target));
      await fs.writeFile(target, output, "utf8");
      written += 1;
    } catch (error) {
      warnings.push(`文字檔匯出失敗：${file} (${String(error)})`);
    }
  }

  return written;
}

function mergeLangText(original: string, entries: LocaleEntry[]): string {
  const current = new Map(parseLangProperties(original).map((pair) => [pair.key, pair.value]));
  for (const entry of entries) {
    current.set(entry.key, entry.finalText);
  }
  return `${[...current.entries()].map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function replaceQuotedLiterals(original: string, entries: LocaleEntry[]): string {
  let output = original;
  const ordered = [...entries].sort((a, b) => b.original.length - a.original.length);
  for (const entry of ordered) {
    output = output.split(JSON.stringify(entry.original)).join(JSON.stringify(entry.finalText));
    output = output.split(singleQuote(entry.original)).join(singleQuote(entry.finalText));
  }
  return output;
}

function singleQuote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function writePatchReadme(project: ProjectConfig, patchRoot: string, locales: TargetLocale[]): Promise<void> {
  const content = `# ${project.name} Localization Patch

Generated by Minecraft Chinese Localization Tool on ${nowIso()}.

## Locales

${locales.map((locale) => `- ${locale}`).join("\n")}

## Install

Copy the folders in this patch into the target Minecraft instance. The original modpack is not modified by this tool.

Resource packs should be enabled below broad automatic localization packs so this patch can override missing or corrected strings.
`;
  await fs.writeFile(path.join(patchRoot, "README.md"), content, "utf8");
}

function inferPackFormat(version?: string): number {
  if (!version) {
    return 15;
  }
  const match = version.match(/1\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return 15;
  }
  const minor = Number(match[1]);
  const patch = Number(match[2] ?? 0);
  if (minor <= 8) return 1;
  if (minor <= 10) return 2;
  if (minor <= 12) return 3;
  if (minor <= 14) return 4;
  if (minor === 15) return 5;
  if (minor === 16) return patch >= 2 ? 6 : 5;
  if (minor === 17) return 7;
  if (minor === 18) return 8;
  if (minor === 19) return patch >= 3 ? 12 : 9;
  if (minor === 20) return patch >= 2 ? 18 : 15;
  if (minor === 21) return 34;
  return 34;
}

function sortObject(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const rows = groups.get(key) ?? [];
    rows.push(item);
    groups.set(key, rows);
  }
  return groups;
}
