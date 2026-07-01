import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LauncherInstance } from "../../shared/types";
import { pathExists, stableId } from "./fileSystem";

export async function detectLauncherInstances(): Promise<LauncherInstance[]> {
  const roots = candidateRoots();
  const found: LauncherInstance[] = [];

  for (const candidate of roots) {
    if (!(await pathExists(candidate.root))) {
      continue;
    }
    const instances = await findInstances(candidate.root, candidate.launcher);
    found.push(...instances);
  }

  const unique = new Map(found.map((instance) => [instance.path.toLowerCase(), instance]));
  return [...unique.values()].sort((a, b) => a.launcher.localeCompare(b.launcher) || a.name.localeCompare(b.name));
}

function candidateRoots(): Array<{ launcher: LauncherInstance["launcher"]; root: string }> {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const home = os.homedir();
  return [
    { launcher: "Minecraft", root: path.join(appData, ".minecraft") },
    { launcher: "Prism", root: path.join(appData, "PrismLauncher", "instances") },
    { launcher: "Prism", root: path.join(appData, "PolyMC", "instances") },
    { launcher: "CurseForge", root: path.join(home, "curseforge", "minecraft", "Instances") },
    { launcher: "CurseForge", root: path.join(home, "Documents", "CurseForge", "Minecraft", "Instances") },
    { launcher: "Modrinth", root: path.join(appData, "com.modrinth.theseus", "profiles") },
    { launcher: "Modrinth", root: path.join(localAppData, "ModrinthApp", "profiles") },
    { launcher: "PCL2", root: path.join(appData, ".minecraft") }
  ];
}

async function findInstances(root: string, launcher: LauncherInstance["launcher"]): Promise<LauncherInstance[]> {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    return [];
  }

  if (await looksLikeInstance(root)) {
    return [await createInstance(root, launcher)];
  }

  const children = await fs.readdir(root, { withFileTypes: true });
  const results: LauncherInstance[] = [];
  for (const child of children) {
    if (!child.isDirectory()) {
      continue;
    }
    const childPath = path.join(root, child.name);
    if (await looksLikeInstance(childPath)) {
      results.push(await createInstance(childPath, launcher));
      continue;
    }
    const nestedMinecraft = path.join(childPath, ".minecraft");
    if (await looksLikeInstance(nestedMinecraft)) {
      results.push(await createInstance(nestedMinecraft, launcher, child.name));
    }
  }
  return results;
}

async function looksLikeInstance(root: string): Promise<boolean> {
  const markers = [
    path.join(root, "mods"),
    path.join(root, "minecraftinstance.json"),
    path.join(root, "manifest.json"),
    path.join(root, "instance.cfg"),
    path.join(root, "mmc-pack.json"),
    path.join(root, ".minecraft", "mods")
  ];
  for (const marker of markers) {
    if (await pathExists(marker)) {
      return true;
    }
  }
  return false;
}

async function createInstance(root: string, launcher: LauncherInstance["launcher"], name?: string): Promise<LauncherInstance> {
  const metadata = await readInstanceMetadata(root);
  return {
    id: stableId([launcher, root]),
    launcher,
    name: name || metadata.name || path.basename(root),
    path: root,
    minecraftVersion: metadata.minecraftVersion,
    loader: metadata.loader
  };
}

async function readInstanceMetadata(root: string): Promise<{ name?: string; minecraftVersion?: string; loader?: string }> {
  const jsonFiles = ["minecraftinstance.json", "manifest.json", "mmc-pack.json"];
  for (const file of jsonFiles) {
    const target = path.join(root, file);
    if (!(await pathExists(target))) {
      continue;
    }
    try {
      const parsed = JSON.parse(await fs.readFile(target, "utf8")) as Record<string, unknown>;
      return {
        name: stringField(parsed, "name") || stringField(parsed, "title"),
        minecraftVersion:
          stringField(parsed, "minecraftVersion") ||
          stringField(parsed, "version") ||
          readNestedVersion(parsed),
        loader: readLoader(parsed)
      };
    } catch {
      // Ignore broken launcher metadata and fall back to the folder name.
    }
  }
  return {};
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? (value[key] as string) : undefined;
}

function readNestedVersion(value: Record<string, unknown>): string | undefined {
  const minecraft = value.minecraft;
  if (minecraft && typeof minecraft === "object") {
    const version = (minecraft as Record<string, unknown>).version;
    if (typeof version === "string") {
      return version;
    }
  }
  const components = value.components;
  if (Array.isArray(components)) {
    const component = components.find((item) => typeof item === "object" && (item as Record<string, unknown>).uid === "net.minecraft");
    const version = component && (component as Record<string, unknown>).version;
    if (typeof version === "string") {
      return version;
    }
  }
  return undefined;
}

function readLoader(value: Record<string, unknown>): string | undefined {
  const loaders = value.modLoaders;
  if (Array.isArray(loaders)) {
    const loader = loaders.find((item) => typeof item === "object") as Record<string, unknown> | undefined;
    const id = loader?.id;
    if (typeof id === "string") {
      return id;
    }
  }
  const components = value.components;
  if (Array.isArray(components)) {
    const loader = components
      .map((item) => (typeof item === "object" ? String((item as Record<string, unknown>).uid ?? "") : ""))
      .find((uid) => /forge|fabric|quilt|neoforge/i.test(uid));
    if (loader) {
      return loader;
    }
  }
  return undefined;
}
