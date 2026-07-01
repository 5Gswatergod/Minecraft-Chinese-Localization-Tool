import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ProjectConfig } from "../../shared/types";
import { ensureDir, nowIso, writeJsonLines } from "./fileSystem";
import { scanProject } from "./scanner";

describe("scanProject", () => {
  it("extracts mod lang, FTB quest, Patchouli, and KubeJS strings", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mclocalizer-"));
    await ensureDir(path.join(root, "mods"));
    await ensureDir(path.join(root, "config", "ftbquests"));
    await ensureDir(path.join(root, "kubejs", "server_scripts"));
    await ensureDir(path.join(root, ".mclocalizer"));

    const zip = new JSZip();
    zip.file("assets/example/lang/en_us.json", JSON.stringify({ "item.example.gear": "Copper Gear" }));
    zip.file(
      "assets/example/patchouli_books/manual/en_us/entries/start.json",
      JSON.stringify({ name: "Getting Started", pages: [{ text: "Collect copper first." }] })
    );
    await fs.writeFile(path.join(root, "mods", "example.jar"), await zip.generateAsync({ type: "nodebuffer" }));
    await fs.writeFile(path.join(root, "config", "ftbquests", "chapter.snbt"), 'title: "First Steps"\n');
    await fs.writeFile(path.join(root, "kubejs", "server_scripts", "recipes.js"), 'event.shaped("Magic Plate", [])');

    const now = nowIso();
    const project: ProjectConfig = {
      id: "test",
      name: "Test Pack",
      inputPath: root,
      inputKind: "directory",
      workspacePath: root,
      sourcePath: root,
      targetLocales: ["zh_cn", "zh_tw"],
      createdAt: now,
      updatedAt: now
    };
    await fs.writeFile(path.join(root, ".mclocalizer", "project.json"), JSON.stringify(project), "utf8");
    await writeJsonLines(path.join(root, ".mclocalizer", "strings.jsonl"), []);

    const result = await scanProject(project);
    expect(result.entries.map((entry) => entry.original).sort()).toEqual(
      ["Collect copper first.", "Copper Gear", "First Steps", "Getting Started", "Magic Plate"].sort()
    );
    expect(result.summary.bySourceType.mod).toBe(1);
    expect(result.summary.bySourceType.patchouli).toBe(2);
    expect(result.summary.bySourceType.ftbquests).toBe(1);
    expect(result.summary.bySourceType.kubejs).toBe(1);
  });
});
