(function initOpenEvidencePromptPicker() {
  let lastEditable = null;
  let pickerRoot = null;
  let pickerShadow = null;
  let toastTimer = null;
  let pickerState = {
    prompts: [],
    query: "",
    selectedIndex: 0
  };
  const PICKER_STYLES = `
    :host {
      all: initial;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    .oe-shortcuts-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      background: rgba(16, 24, 40, 0.28);
      pointer-events: auto;
    }

    .oe-shortcuts-picker {
      position: fixed;
      top: 12vh;
      left: 50%;
      z-index: 2147483647;
      display: flex;
      width: min(640px, calc(100vw - 32px));
      max-height: min(620px, calc(100vh - 96px));
      transform: translateX(-50%);
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #cfd8dc;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 18px 60px rgba(16, 24, 40, 0.24);
      color: #1f2933;
      pointer-events: auto;
    }

    .oe-shortcuts-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 40px;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid #e4e7eb;
    }

    .oe-shortcuts-search {
      width: 100%;
      min-width: 0;
      height: 40px;
      border: 1px solid #b8c4cc;
      border-radius: 6px;
      padding: 10px 12px;
      background: #ffffff;
      color: #1f2933;
      font-size: 15px;
      line-height: 20px;
    }

    .oe-shortcuts-search:focus {
      border-color: #0f766e;
      outline: 2px solid rgba(15, 118, 110, 0.2);
    }

    .oe-shortcuts-close {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border: 1px solid #cfd8dc;
      border-radius: 6px;
      background: #ffffff;
      color: #52616b;
      cursor: pointer;
      font-size: 24px;
      line-height: 1;
    }

    .oe-shortcuts-close:hover,
    .oe-shortcuts-row:hover,
    .oe-shortcuts-row.is-selected {
      background: #edf7f6;
    }

    .oe-shortcuts-results {
      overflow: auto;
      padding: 8px;
    }

    .oe-shortcuts-row {
      display: grid;
      width: 100%;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
      border: 0;
      border-radius: 6px;
      padding: 10px 12px;
      background: transparent;
      color: #1f2933;
      cursor: pointer;
      text-align: left;
    }

    .oe-shortcuts-title {
      overflow: hidden;
      font-size: 14px;
      font-weight: 650;
      line-height: 20px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .oe-shortcuts-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .oe-shortcuts-tag {
      border: 1px solid #d9e2e7;
      border-radius: 999px;
      padding: 2px 7px;
      background: #f7fafc;
      color: #52616b;
      font-size: 12px;
      line-height: 16px;
    }

    .oe-shortcuts-empty {
      margin: 16px;
      color: #52616b;
      font-size: 14px;
    }
  `;

  function logDev(message, details) {
    if (chrome.runtime && chrome.runtime.id) {
      OePromptStorage.addDevLog("content", message, details);
    }
  }

  function logError(message, details) {
    if (chrome.runtime && chrome.runtime.id) {
      OePromptStorage.addErrorLog("content", message, details);
    }
  }

  function describeElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    return {
      tagName: element.tagName,
      type: element.type || "",
      role: element.getAttribute("role") || "",
      contentEditable: element.getAttribute("contenteditable") || "",
      className: String(element.className || "").slice(0, 160),
      id: element.id || ""
    };
  }

  function isInsidePicker(element) {
    return Boolean(element && pickerRoot && (element === pickerRoot || pickerRoot.contains(element)));
  }

  window.addEventListener("error", (event) => {
    logError("Unhandled content script error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    logError("Unhandled content script promise rejection", {
      reason: event.reason && event.reason.message ? event.reason.message : String(event.reason)
    });
  });

  function isEditable(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    return (
      tagName === "textarea" ||
      (tagName === "input" && !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(element.type)) ||
      element.isContentEditable ||
      element.getAttribute("role") === "textbox"
    );
  }

  function closestEditable(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const formControl = target.closest("textarea,input");
    if (formControl && isEditable(formControl)) {
      return formControl;
    }

    const explicitEditable = target.closest("[contenteditable='true'],[contenteditable='plaintext-only'],[role='textbox']");
    if (explicitEditable && isEditable(explicitEditable)) {
      return explicitEditable;
    }

    let element = target;
    while (element && element !== document.documentElement) {
      if (element.isContentEditable && (!element.parentElement || !element.parentElement.isContentEditable)) {
        return element;
      }
      element = element.parentElement;
    }

    return null;
  }

  function findBestPageEditable() {
    const candidates = Array.from(document.querySelectorAll("textarea,input,[contenteditable='true'],[contenteditable='plaintext-only'],[role='textbox']"))
      .filter((element) => !isInsidePicker(element))
      .filter(isEditable)
      .filter((element) => !element.disabled && !element.readOnly)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

    if (!candidates.length) {
      return null;
    }

    const focused = candidates.find((element) => element === document.activeElement || element.contains(document.activeElement));
    if (focused) {
      return focused;
    }

    const textareas = candidates.filter((element) => element.tagName.toLowerCase() === "textarea");
    if (textareas.length) {
      return textareas[textareas.length - 1];
    }

    return candidates[candidates.length - 1];
  }

  function rememberEditable(event) {
    if (isInsidePicker(event.target)) {
      return;
    }

    const editable = closestEditable(event.target);
    if (editable) {
      lastEditable = editable;
      logDev("Editable control remembered", {
        eventType: event.type,
        editable: describeElement(editable)
      });
    }
  }

  function appendToEditable(element, text) {
    if (!element || !document.contains(element)) {
      throw new Error("Select or focus an editable OpenEvidence control first.");
    }

    const target = closestEditable(element) || element;
    const normalizedText = normalizeInsertText(text);
    const appendText = getAppendText(target, normalizedText);
    target.focus();

    if (target.isContentEditable || target.getAttribute("role") === "textbox") {
      appendToContentEditable(target, appendText);
      return;
    }

    appendToFormControl(target, appendText);
  }

  function normalizeInsertText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\\n/g, "\n");
  }

  function getAppendText(element, text) {
    const currentText = element.isContentEditable || element.getAttribute("role") === "textbox"
      ? element.innerText || element.textContent || ""
      : element.value || "";
    const prefix = currentText && !currentText.endsWith("\n") ? "\n" : "";
    return `${prefix}${text}`;
  }

  function appendToFormControl(element, text) {
    const currentValue = element.value || "";
    const nextValue = `${currentValue}${text}`;
    const prototype = element.tagName.toLowerCase() === "textarea"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    const valueSetter = valueDescriptor && valueDescriptor.set;

    if (valueSetter) {
      valueSetter.call(element, nextValue);
    } else {
      element.value = nextValue;
    }

    element.selectionStart = nextValue.length;
    element.selectionEnd = nextValue.length;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function appendToContentEditable(element, text) {
    element.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    if (typeof document.queryCommandSupported === "function" && document.queryCommandSupported("insertText") && document.execCommand("insertText", false, text)) {
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const currentText = element.innerText || element.textContent || "";
    element.textContent = `${currentText}${text}`;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function showToast(message) {
    const existingToast = document.querySelector(".oe-shortcuts-toast");
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement("div");
    toast.className = "oe-shortcuts-toast";
    toast.textContent = message;
    toast.style.cssText = [
      "all: initial",
      "position: fixed",
      "right: 18px",
      "bottom: 18px",
      "z-index: 2147483647",
      "max-width: min(360px, calc(100vw - 36px))",
      "box-sizing: border-box",
      "border: 1px solid #b8c4cc",
      "border-radius: 6px",
      "padding: 10px 12px",
      "background: #ffffff",
      "box-shadow: 0 12px 36px rgba(16, 24, 40, 0.18)",
      "color: #1f2933",
      "font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "font-size: 14px",
      "line-height: 20px",
      "letter-spacing: 0"
    ].join("; ");
    document.documentElement.appendChild(toast);

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.remove();
    }, 2400);
  }

  function filterPrompts() {
    const query = pickerState.query.trim().toLowerCase();
    if (!query) {
      return pickerState.prompts;
    }

    const terms = query.split(/\s+/);
    return pickerState.prompts.filter((prompt) => {
      const haystack = `${prompt.title} ${(prompt.tags || []).join(" ")} ${prompt.body}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }

  function closePicker() {
    if (pickerRoot) {
      pickerRoot.remove();
      pickerRoot = null;
      pickerShadow = null;
    }
  }

  function renderPicker() {
    const matches = filterPrompts();
    pickerState.selectedIndex = Math.min(pickerState.selectedIndex, Math.max(matches.length - 1, 0));

    const promptRows = matches.map((prompt, index) => {
      const tags = (prompt.tags || []).map((tag) => `<span class="oe-shortcuts-tag">${escapeHtml(tag)}</span>`).join("");
      return `
        <button class="oe-shortcuts-row ${index === pickerState.selectedIndex ? "is-selected" : ""}" data-prompt-id="${escapeHtml(prompt.id)}" type="button">
          <span class="oe-shortcuts-title">${escapeHtml(prompt.title)}</span>
          <span class="oe-shortcuts-tags">${tags}</span>
        </button>
      `;
    }).join("");

    pickerShadow.innerHTML = `
      <style>${PICKER_STYLES}</style>
      <div class="oe-shortcuts-backdrop" data-close-picker></div>
      <section class="oe-shortcuts-picker" role="dialog" aria-modal="true" aria-label="OpenEvidence prompts">
        <div class="oe-shortcuts-header">
          <input class="oe-shortcuts-search" type="search" placeholder="Search prompts" value="${escapeHtml(pickerState.query)}" autofocus>
          <button class="oe-shortcuts-close" type="button" data-close-picker aria-label="Close">×</button>
        </div>
        <div class="oe-shortcuts-results">
          ${matches.length ? promptRows : '<p class="oe-shortcuts-empty">No prompts found.</p>'}
        </div>
      </section>
    `;

    const search = pickerShadow.querySelector(".oe-shortcuts-search");
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function choosePrompt(promptId) {
    const prompt = pickerState.prompts.find((candidate) => candidate.id === promptId);
    if (!prompt) {
      logError("Selected prompt was not found", { promptId });
      return;
    }

    const insertionTarget = lastEditable && document.contains(lastEditable)
      ? lastEditable
      : findBestPageEditable();

    logDev("Prompt selected", {
      promptId: prompt.id,
      title: prompt.title,
      bodyLength: prompt.body.length,
      editable: describeElement(insertionTarget || document.activeElement)
    });

    closePicker();
    try {
      appendToEditable(insertionTarget || document.activeElement, prompt.body);
      logDev("Prompt inserted", {
        promptId: prompt.id,
        title: prompt.title,
        editable: describeElement(insertionTarget || document.activeElement)
      });
      showToast("Prompt inserted");
    } catch (error) {
      logError("Prompt insertion failed", {
        message: error.message,
        promptId: prompt.id,
        activeElement: describeElement(document.activeElement),
        lastEditable: describeElement(lastEditable)
      });
      showToast(error.message);
    }
  }

  async function openPicker() {
    logDev("Opening prompt picker", {
      activeElement: describeElement(document.activeElement),
      lastEditable: describeElement(lastEditable)
    });

    try {
      await OePromptStorage.repairTestPromptNewlines();
      pickerState.prompts = await OePromptStorage.getPrompts();
    } catch (error) {
      logError("Failed to load prompts", error.message);
      showToast(`Failed to load prompts: ${error.message}`);
      return;
    }

    pickerState.query = "";
    pickerState.selectedIndex = 0;
    logDev("Prompt picker loaded prompts", { promptCount: pickerState.prompts.length });

    if (!pickerRoot) {
      pickerRoot = document.createElement("oe-shortcuts-picker");
      pickerRoot.style.cssText = [
        "all: initial",
        "display: block",
        "position: fixed",
        "top: 0",
        "right: 0",
        "bottom: 0",
        "left: 0",
        "width: 100vw",
        "height: 100vh",
        "z-index: 2147483647",
        "pointer-events: none"
      ].join("; ");
      pickerShadow = pickerRoot.attachShadow({ mode: "open" });
      document.documentElement.appendChild(pickerRoot);

      pickerShadow.addEventListener("click", (event) => {
        const closeButton = event.target.closest("[data-close-picker]");
        const row = event.target.closest("[data-prompt-id]");

        if (closeButton) {
          closePicker();
          return;
        }

        if (row) {
          choosePrompt(row.dataset.promptId);
        }
      });

      pickerShadow.addEventListener("input", (event) => {
        if (event.target.classList.contains("oe-shortcuts-search")) {
          pickerState.query = event.target.value;
          pickerState.selectedIndex = 0;
          renderPicker();
        }
      });

      pickerShadow.addEventListener("keydown", (event) => {
        const matches = filterPrompts();

        if (event.key === "Escape") {
          event.preventDefault();
          closePicker();
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          pickerState.selectedIndex = Math.min(pickerState.selectedIndex + 1, Math.max(matches.length - 1, 0));
          renderPicker();
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          pickerState.selectedIndex = Math.max(pickerState.selectedIndex - 1, 0);
          renderPicker();
          return;
        }

        if (event.key === "Enter" && matches[pickerState.selectedIndex]) {
          event.preventDefault();
          choosePrompt(matches[pickerState.selectedIndex].id);
        }
      });
    }

    renderPicker();
  }

  document.addEventListener("focusin", rememberEditable, true);
  document.addEventListener("contextmenu", rememberEditable, true);
  logDev("Content script initialized", { url: window.location.href });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "OE_SHORTCUTS_OPEN_PICKER") {
      logDev("Open picker message received");
      openPicker();
    }
  });
})();
