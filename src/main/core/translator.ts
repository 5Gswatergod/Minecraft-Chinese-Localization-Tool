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
    return !entry.manualTranslations[locale];
  });

  if (backend.kind === "manual") {
    onProgress?.(0, candidates.length, "Manual mode selected; no AI translation was generated.");
    return entries;
  }

  const batches = chunk(candidates, 12);
  let completed = 0;
  for (const batch of batches) {
    onProgress?.(completed, candidates.length, `Translating ${completed + 1}-${completed + batch.length} of ${candidates.length}`);
    const translations =
      backend.kind === "openai-compatible"
        ? await translateWithOpenAiCompatible(batch, locale, backend, glossary)
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
