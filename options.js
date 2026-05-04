(function initOptionsPage() {
  const elements = {
    copyHelperPromptButton: document.getElementById("copyHelperPromptButton"),
    clearLogsButton: document.getElementById("clearLogsButton"),
    deletePromptButton: document.getElementById("deletePromptButton"),
    devLogOutput: document.getElementById("devLogOutput"),
    devLogToggle: document.getElementById("devLogToggle"),
    errorLogOutput: document.getElementById("errorLogOutput"),
    errorLogToggle: document.getElementById("errorLogToggle"),
    exportDevLogButton: document.getElementById("exportDevLogButton"),
    exportErrorLogButton: document.getElementById("exportErrorLogButton"),
    exportJsonButton: document.getElementById("exportJsonButton"),
    helperPrompt: document.getElementById("helperPrompt"),
    importJsonInput: document.getElementById("importJsonInput"),
    importMarkdownInput: document.getElementById("importMarkdownInput"),
    newPromptButton: document.getElementById("newPromptButton"),
    promptBody: document.getElementById("promptBody"),
    promptForm: document.getElementById("promptForm"),
    promptId: document.getElementById("promptId"),
    promptList: document.getElementById("promptList"),
    promptSearch: document.getElementById("promptSearch"),
    promptTags: document.getElementById("promptTags"),
    promptTitle: document.getElementById("promptTitle"),
    refreshLogsButton: document.getElementById("refreshLogsButton"),
    savePromptButton: document.getElementById("savePromptButton"),
    saveStatus: document.getElementById("saveStatus")
  };

  let prompts = [];
  let selectedId = null;
  let logs = {
    devLog: [],
    errorLog: []
  };
  let saveStatusTimer = null;

  function logDev(message, details) {
    if (chrome.runtime && chrome.runtime.id) {
      OePromptStorage.addDevLog("options", message, details);
    }
  }

  function logError(message, details) {
    if (chrome.runtime && chrome.runtime.id) {
      OePromptStorage.addErrorLog("options", message, details);
    }
  }

  window.addEventListener("error", (event) => {
    logError("Unhandled options page error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    logError("Unhandled options page promise rejection", {
      reason: event.reason && event.reason.message ? event.reason.message : String(event.reason)
    });
  });

  function setStatus(button, text, resetText) {
    const originalText = resetText || button.textContent;
    button.textContent = text;
    setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  }

  function setSaveStatus(text, timeoutMs) {
    clearTimeout(saveStatusTimer);
    elements.saveStatus.textContent = text;

    if (text && timeoutMs) {
      saveStatusTimer = setTimeout(() => {
        elements.saveStatus.textContent = "";
        saveStatusTimer = null;
      }, timeoutMs);
    }
  }

  function promptMatchesQuery(prompt, query) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      return true;
    }

    const haystack = `${prompt.title} ${(prompt.tags || []).join(" ")} ${prompt.body}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  function renderList() {
    const query = elements.promptSearch.value;
    const visiblePrompts = prompts.filter((prompt) => promptMatchesQuery(prompt, query));

    elements.promptList.innerHTML = visiblePrompts.map((prompt) => `
      <button class="prompt-row ${prompt.id === selectedId ? "is-selected" : ""}" type="button" data-prompt-id="${escapeHtml(prompt.id)}">
        <span class="prompt-row-title">${escapeHtml(prompt.title)}</span>
        <span class="prompt-row-tags">${escapeHtml((prompt.tags || []).join(", "))}</span>
      </button>
    `).join("");
  }

  function renderEditor() {
    const prompt = prompts.find((candidate) => candidate.id === selectedId);
    elements.deletePromptButton.disabled = !prompt;
    setSaveStatus("");

    if (!prompt) {
      elements.promptId.value = "";
      elements.promptTitle.value = "";
      elements.promptTags.value = "";
      elements.promptBody.value = "";
      return;
    }

    elements.promptId.value = prompt.id;
    elements.promptTitle.value = prompt.title;
    elements.promptTags.value = (prompt.tags || []).join(", ");
    elements.promptBody.value = prompt.body;
  }

  function render() {
    renderList();
    renderEditor();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function titleFromFilename(filename) {
    return filename
      .replace(/\.(md|markdown)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  async function refresh() {
    prompts = await OePromptStorage.getPrompts();
    if (!selectedId && prompts.length) {
      selectedId = prompts[0].id;
    }
    render();
  }

  function downloadTextFile(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function renderLogs() {
    elements.devLogOutput.value = OePromptStorage.formatLogText(logs.devLog, "OpenEvidence Shortcuts Dev Log");
    elements.errorLogOutput.value = OePromptStorage.formatLogText(logs.errorLog, "OpenEvidence Shortcuts Error Log");
  }

  async function refreshLogSettings() {
    const settings = await OePromptStorage.getLogSettings();
    elements.devLogToggle.checked = settings.devLogEnabled;
    elements.errorLogToggle.checked = settings.errorLogEnabled;
  }

  async function refreshLogs() {
    logs = await OePromptStorage.getLogs();
    renderLogs();
  }

  async function saveLogToggles() {
    const settings = await OePromptStorage.saveLogSettings({
      devLogEnabled: elements.devLogToggle.checked,
      errorLogEnabled: elements.errorLogToggle.checked
    });

    logDev("Log settings updated", settings);
    await refreshLogSettings();
    await refreshLogs();
  }

  async function saveCurrentPrompt(event) {
    event.preventDefault();

    const prompt = OePromptStorage.normalizePrompt({
      id: elements.promptId.value || undefined,
      title: elements.promptTitle.value,
      tags: elements.promptTags.value,
      body: elements.promptBody.value
    });

    await OePromptStorage.upsertPrompt(prompt);
    logDev("Prompt saved", { promptId: prompt.id, title: prompt.title });
    selectedId = prompt.id;
    await refresh();
    setSaveStatus("Saved", 1600);
  }

  async function deleteCurrentPrompt() {
    if (!selectedId) {
      return;
    }

    const prompt = prompts.find((candidate) => candidate.id === selectedId);
    if (!prompt || !confirm(`Delete "${prompt.title}"?`)) {
      return;
    }

    await OePromptStorage.deletePrompt(selectedId);
    logDev("Prompt deleted", { promptId: selectedId, title: prompt.title });
    selectedId = null;
    await refresh();
  }

  async function exportJson() {
    const json = OePromptStorage.exportPromptsJson(prompts);
    downloadTextFile(`openevidence-prompts-${new Date().toISOString().slice(0, 10)}.json`, json, "application/json");
    logDev("Prompt JSON exported", { promptCount: prompts.length });
  }

  async function importJson(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const imported = OePromptStorage.parseImportedJson(text);
      const merged = OePromptStorage.mergePrompts(prompts, imported);
      await OePromptStorage.savePrompts(merged);
      logDev("Prompt JSON imported", { fileName: file.name, importedCount: imported.length });
      selectedId = imported[0] ? imported[0].id : selectedId;
      await refresh();
    } catch (error) {
      logError("Prompt JSON import failed", { fileName: file.name, message: error.message });
      alert(error.message);
    } finally {
      event.target.value = "";
    }
  }

  async function importMarkdown(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    try {
      const imported = [];
      for (const file of files) {
        const body = await file.text();
        imported.push(OePromptStorage.normalizePrompt({
          title: titleFromFilename(file.name),
          body,
          tags: ["imported"]
        }));
      }

      const merged = OePromptStorage.mergePrompts(prompts, imported);
      await OePromptStorage.savePrompts(merged);
      logDev("Markdown prompts imported", { importedCount: imported.length, fileNames: files.map((file) => file.name) });
      selectedId = imported[0] ? imported[0].id : selectedId;
      await refresh();
    } catch (error) {
      logError("Markdown import failed", error.message);
      alert(error.message);
    } finally {
      event.target.value = "";
    }
  }

  function startNewPrompt() {
    selectedId = null;
    render();
    elements.promptTitle.focus();
  }

  async function copyHelperPrompt() {
    await navigator.clipboard.writeText(elements.helperPrompt.value);
    logDev("Import JSON generator prompt copied");
    setStatus(elements.copyHelperPromptButton, "Copied", "Copy");
  }

  async function exportDevLog() {
    await refreshLogs();
    downloadTextFile(`openevidence-dev-log-${new Date().toISOString().slice(0, 10)}.txt`, elements.devLogOutput.value);
    logDev("Dev log exported", { entryCount: logs.devLog.length });
  }

  async function exportErrorLog() {
    await refreshLogs();
    downloadTextFile(`openevidence-error-log-${new Date().toISOString().slice(0, 10)}.txt`, elements.errorLogOutput.value);
    logDev("Error log exported", { entryCount: logs.errorLog.length });
  }

  async function clearLogs() {
    if (!confirm("Clear dev and error logs?")) {
      return;
    }

    await OePromptStorage.clearLogs();
    await refreshLogs();
  }

  elements.helperPrompt.value = OePromptStorage.IMPORT_JSON_HELPER_PROMPT;
  elements.promptForm.addEventListener("submit", saveCurrentPrompt);
  elements.deletePromptButton.addEventListener("click", deleteCurrentPrompt);
  elements.exportJsonButton.addEventListener("click", exportJson);
  elements.importJsonInput.addEventListener("change", importJson);
  elements.importMarkdownInput.addEventListener("change", importMarkdown);
  elements.newPromptButton.addEventListener("click", startNewPrompt);
  elements.copyHelperPromptButton.addEventListener("click", copyHelperPrompt);
  elements.devLogToggle.addEventListener("change", saveLogToggles);
  elements.errorLogToggle.addEventListener("change", saveLogToggles);
  elements.refreshLogsButton.addEventListener("click", refreshLogs);
  elements.exportDevLogButton.addEventListener("click", exportDevLog);
  elements.exportErrorLogButton.addEventListener("click", exportErrorLog);
  elements.clearLogsButton.addEventListener("click", clearLogs);
  [elements.promptTitle, elements.promptTags, elements.promptBody].forEach((field) => {
    field.addEventListener("input", () => setSaveStatus(""));
  });
  elements.promptSearch.addEventListener("input", renderList);
  elements.promptList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-prompt-id]");
    if (!row) {
      return;
    }

    selectedId = row.dataset.promptId;
    render();
  });

  logDev("Options page initialized");
  OePromptStorage.seedTestPromptsIfEmpty().then(() => {
    return OePromptStorage.repairTestPromptNewlines();
  }).then(() => {
    refresh();
    refreshLogSettings();
    refreshLogs();
  });
})();
