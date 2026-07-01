import { GlossaryTerm, TargetLocale, TranslationBackendConfig, TranslationEntry } from "../../shared/types";
import { nowIso } from "./fileSystem";
import { loadEntries, loadGlossary, saveEntries } from "./project";

const localeNames: Record<TargetLocale, string> = {
  zh_cn: "Simplified Chinese (zh_cn)",
  zh_tw: "Traditional Chinese (zh_tw)"
};

export async function translateEntries(
  projectPath: string,
  locale: TargetLocale,
  backend: TranslationBackendConfig,
  entryIds?: string[],
  onProgress?: (completed: number, total: number, message: string) => void
): Promise<TranslationEntry[]> {
  const entries = await loadEntries(projectPath);
  const glossary = await loadGlossary(projectPath);
  const targetIds = entryIds ? new Set(entryIds) : undefined;
  const candidates = entries.filter((entry) => {
    if (entry.status === "ignored") {
      return false;
    }
    if (targetIds && !targetIds.has(entry.id)) {
      return false;
    }
    if (entry.manualTranslations[locale]) {
      return false;
    }
    return Boolean(targetIds) || !entry.aiTranslations[locale];
  });

  if (backend.kind === "manual") {
    onProgress?.(0, candidates.length, "Manual mode selected; no AI translation was generated.");
    return entries;
  }

  const useTranslateGemmaMode = backend.kind === "ollama" && isTranslateGemmaModel(backend.model);
  const batches = chunk(candidates, useTranslateGemmaMode ? 8 : 12);
  let completed = 0;
  for (const batch of batches) {
    onProgress?.(completed, candidates.length, `Translating ${completed + 1}-${completed + batch.length} of ${candidates.length}`);
    const translations =
      backend.kind === "openai-compatible"
        ? await translateWithOpenAiCompatible(batch, locale, backend, glossary)
        : useTranslateGemmaMode
          ? await translateWithOllamaTranslateGemma(batch, locale, backend, glossary)
          : await translateWithOllama(batch, locale, backend, glossary);

    for (const entry of batch) {
      const translated = translations[entry.id];
      if (translated) {
        entry.aiTranslations[locale] = translated;
        entry.status = entry.status === "new" ? "ai" : entry.status;
        entry.updatedAt = nowIso();
      }
    }
    completed += batch.length;
    onProgress?.(completed, candidates.length, `Translated ${completed} of ${candidates.length}`);
  }

  await saveEntries(projectPath, entries);
  return entries;
}

async function translateWithOpenAiCompatible(
  entries: TranslationEntry[],
  locale: TargetLocale,
  backend: TranslationBackendConfig,
  glossary: GlossaryTerm[]
): Promise<Record<string, string>> {
  if (!backend.endpoint || !backend.model) {
    throw new Error("OpenAI-compatible backend requires endpoint and model.");
  }
  const endpoint = backend.endpoint.replace(/\/$/, "");
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: backend.model,
      temperature: backend.temperature ?? 0.2,
      messages: [
        {
          role: "system",
          content:
            "You translate Minecraft modpack text. Preserve placeholders, formatting codes, item IDs, key names, JSON escapes, color codes, and line breaks. Return strict JSON only."
        },
        {
          role: "user",
          content: buildPrompt(entries, locale, glossary)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseTranslationJson(data.choices?.[0]?.message?.content ?? "");
}

async function translateWithOllama(
  entries: TranslationEntry[],
  locale: TargetLocale,
  backend: TranslationBackendConfig,
  glossary: GlossaryTerm[]
): Promise<Record<string, string>> {
  const endpoint = (backend.endpoint || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = backend.model || "llama3.1";
  const response = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You translate Minecraft modpack text. Preserve placeholders, formatting codes, item IDs, key names, JSON escapes, and line breaks. Return strict JSON only."
        },
        {
          role: "user",
          content: buildPrompt(entries, locale, glossary)
        }
      ],
      options: { temperature: backend.temperature ?? 0.2 }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  return parseTranslationJson(data.message?.content ?? "");
}

async function translateWithOllamaTranslateGemma(
  entries: TranslationEntry[],
  locale: TargetLocale,
  backend: TranslationBackendConfig,
  glossary: GlossaryTerm[]
): Promise<Record<string, string>> {
  const endpoint = (backend.endpoint || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = backend.model || "rinex20/translategemma3:12b";
  const translations = parseNumberedTranslations(
    await ollamaGenerate(endpoint, model, buildTranslateGemmaBatchPrompt(entries, locale, glossary), backend.temperature ?? 0.1),
    entries
  );

  const missing = entries.filter((entry) => !translations[entry.id]);
  for (const entry of missing) {
    const translated = cleanTranslateGemmaOutput(
      await ollamaGenerate(endpoint, model, buildTranslateGemmaSinglePrompt(entry, locale, glossary), backend.temperature ?? 0.1)
    );
    if (translated) {
      translations[entry.id] = translated;
    }
  }

  return translations;
}

function buildPrompt(entries: TranslationEntry[], locale: TargetLocale, glossary: GlossaryTerm[]): string {
  const glossaryRows = glossary
    .filter((term) => term.source && (term[locale] || term.note))
    .slice(0, 80)
    .map((term) => `${term.source} => ${term[locale] ?? ""}${term.note ? ` (${term.note})` : ""}`);

  return JSON.stringify(
    {
      targetLocale: localeNames[locale],
      glossary: glossaryRows,
      instructions: [
        "Translate naturally for Minecraft players.",
        "Keep %s, %1$s, {0}, ${value}, <tag>, \\n, color codes such as §a, and Minecraft formatting untouched.",
        "Return an object whose keys are ids and values are translations."
      ],
      items: entries.map((entry) => ({
        id: entry.id,
        sourceType: entry.sourceType,
        key: entry.key,
        text: entry.original,
        note: entry.note
      }))
    },
    null,
    2
  );
}

function buildTranslateGemmaBatchPrompt(entries: TranslationEntry[], locale: TargetLocale, glossary: GlossaryTerm[]): string {
  const glossaryBlock = buildGlossaryBlock(glossary, locale);
  const numberedItems = entries.map((entry, index) => `${index + 1}. ${entry.original}`).join("\n");
  return [
    translateGemmaAnchor(locale),
    "Translate each numbered Minecraft text. Keep the same numbering.",
    "Preserve placeholders, variables, item IDs, formatting codes like \\u00a7a, and line breaks.",
    glossaryBlock,
    numberedItems,
    `Return exactly ${entries.length} numbered translated lines.`
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTranslateGemmaSinglePrompt(entry: TranslationEntry, locale: TargetLocale, glossary: GlossaryTerm[]): string {
  const glossaryBlock = buildGlossaryBlock(glossary, locale);
  return [
    `${translateGemmaAnchor(locale)} ${entry.original}`,
    "Preserve placeholders, variables, item IDs, formatting codes like \\u00a7a, and line breaks.",
    glossaryBlock,
    "Return only the translated text."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildGlossaryBlock(glossary: GlossaryTerm[], locale: TargetLocale): string {
  const rows = glossary
    .filter((term) => term.source && (term[locale] || term.note))
    .slice(0, 40)
    .map((term) => `- ${term.source} => ${term[locale] ?? ""}${term.note ? ` (${term.note})` : ""}`);
  return rows.length ? `Glossary:\n${rows.join("\n")}` : "";
}

function translateGemmaAnchor(locale: TargetLocale): string {
  return locale === "zh_tw" ? "Translate to Traditional Chinese:" : "Translate to Simplified Chinese:";
}

async function ollamaGenerate(endpoint: string, model: string, prompt: string, temperature: number): Promise<string> {
  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama TranslateGemma request failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { response?: string };
  return data.response ?? "";
}

function parseNumberedTranslations(content: string, entries: TranslationEntry[]): Record<string, string> {
  const cleaned = cleanTranslateGemmaOutput(content);
  const numbered = [...cleaned.matchAll(/(?:^|\n)\s*(\d+)[.)\]]\s+(.+?)(?=\n\s*\d+[.)\]]\s+|$)/gs)];
  const result: Record<string, string> = {};

  for (const match of numbered) {
    const index = Number(match[1]) - 1;
    const entry = entries[index];
    const translation = cleanTranslateGemmaOutput(match[2]);
    if (entry && translation) {
      result[entry.id] = translation;
    }
  }

  if (Object.keys(result).length === 0) {
    const lines = cleaned
      .split(/\r?\n/)
      .map((line) => cleanTranslateGemmaOutput(line))
      .filter(Boolean);
    if (lines.length === entries.length) {
      for (let index = 0; index < entries.length; index += 1) {
        result[entries[index].id] = lines[index];
      }
    }
  }

  return result;
}

function cleanTranslateGemmaOutput(content: string): string {
  return content
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^Translation:\s*/i, "")
    .trim();
}

function isTranslateGemmaModel(model?: string): boolean {
  return /translategemma/i.test(model ?? "");
}

function parseTranslationJson(content: string): Record<string, string> {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}
