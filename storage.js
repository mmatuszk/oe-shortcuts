(function initPromptStorage(globalScope) {
  const PROMPTS_KEY = "oeShortcuts.prompts";
  const SEED_STATE_KEY = "oeShortcuts.seededTestPrompts";
  const LOG_SETTINGS_KEY = "oeShortcuts.logSettings";
  const DEV_LOG_KEY = "oeShortcuts.devLog";
  const ERROR_LOG_KEY = "oeShortcuts.errorLog";
  const MAX_LOG_ENTRIES = 500;

  const TEST_PROMPTS = [
    {
      id: "test-summarize-evidence",
      title: "[TEST] Summarize evidence",
      body: "Summarize the evidence for the following clinical question:\n\n",
      tags: ["test", "summary"],
      updatedAt: "2026-05-04T00:00:00.000Z"
    },
    {
      id: "test-differential-diagnosis",
      title: "[TEST] Differential diagnosis",
      body: "Generate a concise differential diagnosis for the following presentation. Include likely causes, must-not-miss diagnoses, and what evidence would support or argue against each:\n\n",
      tags: ["test", "diagnosis", "clinical-reasoning"],
      updatedAt: "2026-05-04T00:00:00.000Z"
    },
    {
      id: "test-patient-friendly-summary",
      title: "[TEST] Patient-friendly summary",
      body: "Rewrite the following clinical evidence in plain language for a patient. Keep it accurate, concise, and avoid overstating certainty:\n\n",
      tags: ["test", "patient", "summary"],
      updatedAt: "2026-05-04T00:00:00.000Z"
    }
  ];

  const IMPORT_JSON_HELPER_PROMPT =
    "Create import JSON for my Chrome extension called OpenEvidence Shortcuts. Return only valid JSON, no markdown fence and no commentary. The JSON must be an array of prompt objects. Each object must have: title as a short string, body as the full raw Markdown prompt string, and tags as an array of lowercase strings. Do not include comments or trailing commas. Use this shape:\\n\\n[\\n  {\\n    \\\"title\\\": \\\"Prompt title\\\",\\n    \\\"body\\\": \\\"Raw Markdown prompt text with placeholders if useful\\\",\\n    \\\"tags\\\": [\\\"tag-one\\\", \\\"tag-two\\\"]\\n  }\\n]\\n\\nPrompts to create:\\n";

  function chromeGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function chromeSet(values) {
    return chrome.storage.local.set(values);
  }

  function serializeDetails(details) {
    if (details === undefined || details === null) {
      return "";
    }

    if (typeof details === "string") {
      return details;
    }

    try {
      return JSON.stringify(details);
    } catch (error) {
      return String(details);
    }
  }

  function newPromptId() {
    if (globalScope.crypto && typeof globalScope.crypto.randomUUID === "function") {
      return globalScope.crypto.randomUUID();
    }
    return `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeTags(tags) {
    if (!Array.isArray(tags)) {
      if (typeof tags === "string") {
        tags = tags.split(",");
      } else {
        return [];
      }
    }

    return tags
      .map((tag) => String(tag).trim().toLowerCase())
      .filter(Boolean)
      .filter((tag, index, allTags) => allTags.indexOf(tag) === index);
  }

  function normalizePrompt(input) {
    const now = new Date().toISOString();
    const title = String(input.title || "").trim();
    const body = String(input.body || input.prompt || input.content || "").replace(/\r\n/g, "\n");

    if (!title) {
      throw new Error("Prompt title is required.");
    }

    if (!body.trim()) {
      throw new Error(`Prompt "${title}" must include body text.`);
    }

    return {
      id: String(input.id || newPromptId()),
      title,
      body,
      tags: normalizeTags(input.tags),
      updatedAt: input.updatedAt ? String(input.updatedAt) : now
    };
  }

  async function getPrompts() {
    const result = await chromeGet(PROMPTS_KEY);
    const prompts = Array.isArray(result[PROMPTS_KEY]) ? result[PROMPTS_KEY] : [];
    return prompts.map(normalizePrompt).sort((a, b) => a.title.localeCompare(b.title));
  }

  async function savePrompts(prompts) {
    const normalized = prompts.map(normalizePrompt);
    await chromeSet({ [PROMPTS_KEY]: normalized });
    return normalized;
  }

  async function seedTestPromptsIfEmpty() {
    const result = await chromeGet([PROMPTS_KEY, SEED_STATE_KEY]);
    const prompts = Array.isArray(result[PROMPTS_KEY]) ? result[PROMPTS_KEY] : [];

    if (prompts.length || result[SEED_STATE_KEY]) {
      return false;
    }

    await chromeSet({
      [PROMPTS_KEY]: TEST_PROMPTS,
      [SEED_STATE_KEY]: true
    });
    return true;
  }

  async function repairTestPromptNewlines() {
    const result = await chromeGet(PROMPTS_KEY);
    const prompts = Array.isArray(result[PROMPTS_KEY]) ? result[PROMPTS_KEY] : [];
    const testPromptIds = new Set(TEST_PROMPTS.map((prompt) => prompt.id));
    let changed = false;

    const repairedPrompts = prompts.map((prompt) => {
      if (!testPromptIds.has(prompt.id) || typeof prompt.body !== "string" || !prompt.body.includes("\\n")) {
        return prompt;
      }

      changed = true;
      return {
        ...prompt,
        body: prompt.body.replace(/\\n/g, "\n"),
        updatedAt: new Date().toISOString()
      };
    });

    if (changed) {
      await chromeSet({ [PROMPTS_KEY]: repairedPrompts });
    }

    return changed;
  }

  async function upsertPrompt(prompt) {
    const prompts = await getPrompts();
    const normalized = normalizePrompt({ ...prompt, updatedAt: new Date().toISOString() });
    const index = prompts.findIndex((existing) => existing.id === normalized.id);

    if (index >= 0) {
      prompts[index] = normalized;
    } else {
      prompts.push(normalized);
    }

    return savePrompts(prompts);
  }

  async function deletePrompt(id) {
    const prompts = await getPrompts();
    return savePrompts(prompts.filter((prompt) => prompt.id !== id));
  }

  function parseImportedJson(text) {
    const parsed = JSON.parse(text);
    const promptList = Array.isArray(parsed) ? parsed : parsed.prompts;

    if (!Array.isArray(promptList)) {
      throw new Error("Import JSON must be an array or an object with a prompts array.");
    }

    return promptList.map(normalizePrompt);
  }

  function exportPromptsJson(prompts) {
    return JSON.stringify(prompts.map(normalizePrompt), null, 2);
  }

  function mergePrompts(existingPrompts, importedPrompts) {
    const byId = new Map(existingPrompts.map((prompt) => [prompt.id, prompt]));

    for (const prompt of importedPrompts) {
      byId.set(prompt.id || newPromptId(), normalizePrompt(prompt));
    }

    return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  async function getLogSettings() {
    const result = await chromeGet(LOG_SETTINGS_KEY);
    const settings = result[LOG_SETTINGS_KEY] || {};

    return {
      devLogEnabled: settings.devLogEnabled !== false,
      errorLogEnabled: settings.errorLogEnabled !== false
    };
  }

  async function saveLogSettings(settings) {
    const currentSettings = await getLogSettings();
    const nextSettings = {
      devLogEnabled: settings.devLogEnabled !== undefined ? Boolean(settings.devLogEnabled) : currentSettings.devLogEnabled,
      errorLogEnabled: settings.errorLogEnabled !== undefined ? Boolean(settings.errorLogEnabled) : currentSettings.errorLogEnabled
    };

    await chromeSet({ [LOG_SETTINGS_KEY]: nextSettings });
    return nextSettings;
  }

  async function appendLog(type, source, message, details) {
    try {
      const settings = await getLogSettings();
      const isError = type === "error";
      const enabled = isError ? settings.errorLogEnabled : settings.devLogEnabled;

      if (!enabled) {
        return null;
      }

      const key = isError ? ERROR_LOG_KEY : DEV_LOG_KEY;
      const result = await chromeGet(key);
      const existingLogs = Array.isArray(result[key]) ? result[key] : [];
      const entry = {
        id: newPromptId(),
        timestamp: new Date().toISOString(),
        source: String(source || "unknown"),
        message: String(message || ""),
        details: serializeDetails(details)
      };
      const nextLogs = existingLogs.concat(entry).slice(-MAX_LOG_ENTRIES);

      await chromeSet({ [key]: nextLogs });
      return entry;
    } catch (error) {
      return null;
    }
  }

  function addDevLog(source, message, details) {
    return appendLog("dev", source, message, details);
  }

  function addErrorLog(source, message, details) {
    return appendLog("error", source, message, details);
  }

  async function getLogs() {
    const result = await chromeGet([DEV_LOG_KEY, ERROR_LOG_KEY]);

    return {
      devLog: Array.isArray(result[DEV_LOG_KEY]) ? result[DEV_LOG_KEY] : [],
      errorLog: Array.isArray(result[ERROR_LOG_KEY]) ? result[ERROR_LOG_KEY] : []
    };
  }

  async function clearLogs(type) {
    if (type === "dev") {
      await chromeSet({ [DEV_LOG_KEY]: [] });
      return;
    }

    if (type === "error") {
      await chromeSet({ [ERROR_LOG_KEY]: [] });
      return;
    }

    await chromeSet({ [DEV_LOG_KEY]: [], [ERROR_LOG_KEY]: [] });
  }

  function formatLogText(logs, title) {
    const lines = [`${title}`, `Generated: ${new Date().toISOString()}`, ""];

    for (const entry of logs) {
      lines.push(`[${entry.timestamp}] ${entry.source}: ${entry.message}`);
      if (entry.details) {
        lines.push(`  ${entry.details}`);
      }
    }

    return lines.join("\n");
  }

  globalScope.OePromptStorage = {
    IMPORT_JSON_HELPER_PROMPT,
    TEST_PROMPTS,
    addDevLog,
    addErrorLog,
    clearLogs,
    deletePrompt,
    exportPromptsJson,
    formatLogText,
    getLogSettings,
    getLogs,
    getPrompts,
    mergePrompts,
    normalizePrompt,
    parseImportedJson,
    repairTestPromptNewlines,
    saveLogSettings,
    savePrompts,
    seedTestPromptsIfEmpty,
    upsertPrompt
  };
})(globalThis);
