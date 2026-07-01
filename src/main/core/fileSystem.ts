import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function readJsonFile<T>(target: string): Promise<T> {
  const raw = await fs.readFile(target, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(target: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJsonLines<T>(target: string): Promise<T[]> {
  if (!(await pathExists(target))) {
    return [];
  }
  const raw = await fs.readFile(target, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonLines<T>(target: string, rows: T[]): Promise<void> {
  await ensureDir(path.dirname(target));
  const raw = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(target, raw ? `${raw}\n` : "", "utf8");
}

export function stableId(parts: Array<string | number | undefined>): string {
  const hash = crypto.createHash("sha1");
  hash.update(parts.filter((part) => part !== undefined).join("\u001f"));
  return hash.digest("hex").slice(0, 16);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

export function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim() || "project";
}

export async function listFilesRecursive(root: string, options?: { extensions?: string[]; maxBytes?: number }): Promise<string[]> {
  const files: string[] = [];
  const extensionSet = options?.extensions ? new Set(options.extensions.map((ext) => ext.toLowerCase())) : undefined;

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if ([".git", ".mclocalizer", "node_modules", "logs", "saves", "screenshots"].includes(entry.name)) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (extensionSet && !extensionSet.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        if (options?.maxBytes) {
          const stat = await fs.stat(fullPath);
          if (stat.size > options.maxBytes) {
            continue;
          }
        }
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}

export async function copyFilePreservingPath(source: string, sourceRoot: string, targetRoot: string): Promise<string> {
  const relative = path.relative(sourceRoot, source);
  const target = path.join(targetRoot, relative);
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
  return target;
}

export async function unzipToDirectory(zipPath: string, targetDirectory: string): Promise<void> {
  await ensureDir(targetDirectory);
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const writes: Array<Promise<void>> = [];

  zip.forEach((relativePath, entry) => {
    if (entry.dir) {
      return;
    }
    const normalized = normalizeSlashes(relativePath);
    if (normalized.includes("..")) {
      return;
    }
    const outputPath = path.join(targetDirectory, normalized);
    writes.push(
      entry.async("nodebuffer").then(async (buffer) => {
        await ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, buffer);
      })
    );
  });

  await Promise.all(writes);
}

export async function zipDirectory(sourceDirectory: string, zipPath: string): Promise<void> {
  const zip = new JSZip();
  const files = await listFilesRecursive(sourceDirectory);

  for (const file of files) {
    const relative = normalizeSlashes(path.relative(sourceDirectory, file));
    zip.file(relative, await fs.readFile(file));
  }

  await ensureDir(path.dirname(zipPath));
  const stream = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE" });
  await new Promise<void>((resolve, reject) => {
    stream.pipe(createWriteStream(zipPath)).on("finish", resolve).on("error", reject);
  });
}

export async function readMaybeTextFile(target: string, maxBytes = 2_000_000): Promise<string | undefined> {
  const stat = await fs.stat(target);
  if (stat.size > maxBytes) {
    return undefined;
  }
  const buffer = await fs.readFile(target);
  if (buffer.includes(0)) {
    return undefined;
  }
  return buffer.toString("utf8");
}

export async function streamCopy(source: string, target: string): Promise<void> {
  await ensureDir(path.dirname(target));
  await new Promise<void>((resolve, reject) => {
    createReadStream(source).pipe(createWriteStream(target)).on("finish", resolve).on("error", reject);
  });
}
