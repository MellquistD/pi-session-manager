# pi-session-manager

A session browser extension for the [pi coding agent](https://github.com/badlogic/pi-mono). Browse, resume, rename, and delete sessions from an interactive TUI overlay — without leaving your current conversation.

## Install

```bash
pi install npm:pi-session-manager
```

## Features

- **Browse sessions** — interactive fuzzy-searchable list with age, message count, and working directory
- **Resume** — switch to any previous session instantly
- **Delete** — remove sessions with a confirmation prompt
- **Rename** — give sessions a meaningful name (current session only; use `/name` for others)
- **Scope toggle** — switch between *current project* and *all projects* with `Tab`
- **Status bar** — active session name shown persistently in the footer when set

## Commands

| Command | Description |
|---------|-------------|
| `/sessions` | Browse sessions for the current working directory |
| `/sessions all` | Browse sessions across all projects |
| `/sall` | Shorthand for `/sessions all` |

## Keyboard Shortcuts

Inside the session browser:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate sessions |
| `Enter` | Resume selected session |
| `d` | Delete selected session |
| `n` | Rename selected session |
| `Tab` | Toggle scope (current project ↔ all projects) |
| `Esc` | Close browser |

Type to filter sessions by title, message content, or working directory.

## How It Works

The extension registers two commands and a `session_start` hook:

- On `session_start`, it reads the active session's name and renders it in the status bar (e.g. `📁 my-feature`).
- `/sessions` / `/sall` open a centered overlay built with pi's TUI primitives (`SelectList`, `Container`, `DynamicBorder`).
- Sessions are loaded via `SessionManager.list()` (current directory) or `SessionManager.listAll()` (global), sorted newest-first.
- The list displays a human-readable title (session name → first message → filename fallback), age, message count, and a shortened working directory path.
- Resuming a session calls `ctx.switchSession()`. If the session has a name, the status bar is updated immediately.
- Rename only works on the currently active session; for other sessions, you must resume first and then use `/name`.

## Requirements

- [pi coding agent](https://github.com/badlogic/pi-mono) with TUI support

## License

MIT
