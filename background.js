importScripts("storage.js");

function logDev(message, details) {
  OePromptStorage.addDevLog("background", message, details);
}

function logError(message, details) {
  OePromptStorage.addErrorLog("background", message, details);
}

function registerContextMenu(reason) {
  logDev("Registering context menu", { reason });

  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      logError("Failed to clear context menus", chrome.runtime.lastError.message);
      return;
    }

    chrome.contextMenus.create({
      id: "open-prompt-picker",
      title: "OpenEvidence Prompts",
      contexts: ["editable", "page", "selection"],
      documentUrlPatterns: ["https://www.openevidence.com/*"]
    }, () => {
      if (chrome.runtime.lastError) {
        logError("Failed to create context menu", chrome.runtime.lastError.message);
        return;
      }

      logDev("Context menu registered", { reason });
    });
  });
}

function seedTestPrompts() {
  OePromptStorage.seedTestPromptsIfEmpty().then((seeded) => {
    logDev("Seed prompt check completed", { seeded });
    return OePromptStorage.repairTestPromptNewlines();
  }).then((repaired) => {
    logDev("Test prompt newline repair completed", { repaired });
  }, (error) => {
    logError("Seed prompt check or repair failed", error.message);
  });
}

function openPromptPickerInTab(tab, source) {
  logDev("Opening prompt picker in tab", {
    source,
    tabId: tab && tab.id,
    url: tab && tab.url
  });

  if (!tab || !tab.id) {
    logError("Cannot open picker without an active tab", { source });
    return;
  }

  if (!tab.url || !tab.url.startsWith("https://www.openevidence.com/")) {
    logError("Cannot open picker outside OpenEvidence", {
      source,
      url: tab.url || ""
    });
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "OE_SHORTCUTS_OPEN_PICKER" }, () => {
    if (chrome.runtime.lastError) {
      logError("Failed to send picker message to content script", {
        source,
        message: chrome.runtime.lastError.message
      });
      return;
    }

    logDev("Picker message sent to content script", { source, tabId: tab.id });
  });
}

self.addEventListener("error", (event) => {
  logError("Unhandled service worker error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

self.addEventListener("unhandledrejection", (event) => {
  logError("Unhandled service worker promise rejection", {
    reason: event.reason && event.reason.message ? event.reason.message : String(event.reason)
  });
});

logDev("Service worker started");
registerContextMenu("service-worker-start");

chrome.runtime.onInstalled.addListener((details) => {
  logDev("Extension installed or updated", details);
  seedTestPrompts();
  registerContextMenu("runtime-onInstalled");
});

chrome.runtime.onStartup.addListener(() => {
  logDev("Browser startup event received");
  registerContextMenu("runtime-onStartup");
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  logDev("Context menu clicked", {
    menuItemId: info.menuItemId,
    tabId: tab && tab.id,
    url: tab && tab.url
  });

  if (info.menuItemId !== "open-prompt-picker" || !tab || !tab.id) {
    logError("Ignoring context menu click without expected tab/menu data", {
      menuItemId: info.menuItemId,
      hasTab: Boolean(tab)
    });
    return;
  }

  openPromptPickerInTab(tab, "context-menu");
});

chrome.commands.onCommand.addListener((command) => {
  logDev("Command received", { command });

  if (command !== "open-prompt-picker") {
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      logError("Failed to query active tab for command", chrome.runtime.lastError.message);
      return;
    }

    openPromptPickerInTab(tabs[0], "keyboard-shortcut");
  });
});
