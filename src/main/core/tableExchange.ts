import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { ImportTranslationsResult, TargetLocale, TranslationEntry } from "../../shared/types";
import { nowIso } from "./fileSystem";
import { loadEntries, saveEntries } from "./project";

const headers = ["id", "sourceType", "key", "original", "aiTranslation", "manualTranslation", "status", "note", "originPath"];

export async function exportTranslationsTable(projectPath: string, locale: TargetLocale, targetPath: string): Promise<string> {
  const entries = await loadEntries(projectPath);
  const rows: Array<Record<string, unknown>> = entries.map((entry) => ({
    id: entry.id,
    sourceType: entry.sourceType,
    key: entry.key,
    original: entry.original,
    aiTranslation: entry.aiTranslations[locale] ?? "",
    manualTranslation: entry.manualTranslations[locale] ?? "",
    status: entry.status,
    note: entry.note ?? "",
    originPath: entry.originPath
  }));

  if (targetPath.toLowerCase().endsWith(".csv")) {
    await fs.writeFile(targetPath, toCsv(rows), "utf8");
  } else {
    await fs.writeFile(targetPath, await createXlsx(rows));
  }

  return targetPath;
}

export async function importTranslationsTable(projectPath: string, locale: TargetLocale, tablePath: string): Promise<ImportTranslationsResult> {
  const entries = await loadEntries(projectPath);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const rows = await readRows(tablePath);
  let updatedEntries = 0;
  let ignoredRows = 0;

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const entry = byId.get(id);
    if (!entry) {
      ignoredRows += 1;
      continue;
    }
    const manual = String(row.manualTranslation ?? "").trim();
    const note = String(row.note ?? "").trim();
    const status = String(row.status ?? "").trim();
    if (manual) {
      entry.manualTranslations[locale] = manual;
      entry.status = status === "ignored" ? "ignored" : "reviewed";
      entry.updatedAt = nowIso();
      updatedEntries += 1;
    }
    if (note) {
      entry.note = note;
    }
  }

  await saveEntries(projectPath, entries);
  return { updatedEntries, ignoredRows };
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function readRows(tablePath: string): Promise<Array<Record<string, unknown>>> {
  if (path.extname(tablePath).toLowerCase() === ".csv") {
    return parseCsv(await fs.readFile(tablePath, "utf8"));
  }
  return parseXlsx(await fs.readFile(tablePath));
}

async function createXlsx(rows: Array<Record<string, unknown>>): Promise<Buffer> {
  const zip = new JSZip();
  const sheetRows = [headers, ...rows.map((row) => headers.map((header) => String(row[header] ?? "")))];
  zip.file("[Content_Types].xml", xml`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.file("_rels/.rels", xml`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file("xl/workbook.xml", xml`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="translations" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", xml`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", createWorksheetXml(sheetRows));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function createWorksheetXml(rows: string[][]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return xml`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${body}</sheetData>
</worksheet>`;
}

async function parseXlsx(buffer: Buffer): Promise<Array<Record<string, unknown>>> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStrings = await readSharedStrings(zip);
  const sheetFile = zip.file("xl/worksheets/sheet1.xml") ?? zip.file(/xl\/worksheets\/sheet\d+\.xml/)[0];
  if (!sheetFile) {
    return [];
  }
  const sheet = await sheetFile.async("string");
  const parsedRows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const columnIndex = ref ? columnIndexFromName(ref) - 1 : row.length;
      row[columnIndex] = readCellValue(attrs, body, sharedStrings);
    }
    parsedRows.push(row.map((value) => value ?? ""));
  }
  return rowsToRecords(parsedRows);
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) {
    return [];
  }
  const raw = await file.async("string");
  return [...raw.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => textFromXml(match[1]));
}

function readCellValue(attrs: string, body: string, sharedStrings: string[]): string {
  if (/\bt="s"/.test(attrs)) {
    const index = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? -1);
    return sharedStrings[index] ?? "";
  }
  if (/\bt="inlineStr"/.test(attrs)) {
    return textFromXml(body);
  }
  return unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
}

function rowsToRecords(rows: string[][]): Array<Record<string, unknown>> {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return [];
  }
  return dataRows
    .filter((row) => row.some((value) => value.trim()))
    .map((values) => Object.fromEntries(headerRow.map((header, index) => [header, values[index] ?? ""])));
}

function parseCsv(content: string): Array<Record<string, unknown>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rowsToRecords(rows);
}

function columnName(index: number): string {
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function columnIndexFromName(name: string): number {
  return name.split("").reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0);
}

function textFromXml(value: string): string {
  return unescapeXml([...value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

function xml(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((result, string, index) => `${result}${string}${String(values[index] ?? "")}`, "").trim();
}
