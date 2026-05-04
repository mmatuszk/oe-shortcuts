# OpenEvidence Shortcuts

Chrome Manifest V3 extension for appending saved Markdown prompts into the current editable control on `https://www.openevidence.com/`.

## Load locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this repo folder.
5. Open `https://www.openevidence.com/`, focus a text control, then right-click and choose **OpenEvidence Prompts** or press `Alt+Shift+O`.

Chrome lets you change the shortcut at `chrome://extensions/shortcuts`.

## Prompt storage

Prompts are stored in `chrome.storage.local`, not bundled as Markdown files. The extension seeds a few `[TEST]` prompts only when storage is empty. Delete them from the options page when testing is done.

The options page supports:

- add, edit, and delete prompts
- import JSON
- import one or more `.md` files
- export JSON backup
- copy a helper prompt for generating valid import JSON with ChatGPT or Codex
- view, toggle, export, and clear dev/error diagnostic logs

## Diagnostics

Open the extension options page and use the **Diagnostics** section.

- **Dev log on** records normal extension activity and status.
- **Error log on** records failures and uncaught errors.
- Both logs are enabled by default.
- Export buttons download text files that can be inspected or shared for debugging.

## Import JSON shape

```json
[
  {
    "title": "Prompt title",
    "body": "Raw Markdown prompt text",
    "tags": ["summary", "diagnosis"]
  }
]
```

The options page includes a copyable generator prompt that asks ChatGPT or Codex to return this format as valid JSON only.
