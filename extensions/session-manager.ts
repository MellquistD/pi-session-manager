import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { Container, SelectList, type SelectItem, Text } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import { unlink, readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

type SessionInfo = Awaited<ReturnType<typeof SessionManager.list>>[number];

// ─── Bookmark Store ───────────────────────────────────────────────────────────

interface BookmarkEntry {
	note?: string;
	createdAt: string;
}

interface BookmarksFile {
	version: 1;
	bookmarks: Record<string, BookmarkEntry>;
}

class BookmarkStore {
	private static path(): string {
		return join(homedir(), ".pi", "agent", "sessions", "bookmarks.json");
	}

	static async load(): Promise<BookmarksFile> {
		try {
			const raw = await readFile(BookmarkStore.path(), "utf8");
			return JSON.parse(raw) as BookmarksFile;
		} catch {
			return { version: 1, bookmarks: {} };
		}
	}

	static async save(data: BookmarksFile): Promise<void> {
		const p = BookmarkStore.path();
		await mkdir(dirname(p), { recursive: true });
		await writeFile(p, JSON.stringify(data, null, 2), "utf8");
	}

	static async isBookmarked(sessionPath: string): Promise<boolean> {
		const data = await BookmarkStore.load();
		return sessionPath in data.bookmarks;
	}

	static async add(sessionPath: string, note?: string): Promise<void> {
		const data = await BookmarkStore.load();
		data.bookmarks[sessionPath] = { createdAt: new Date().toISOString(), ...(note ? { note } : {}) };
		await BookmarkStore.save(data);
	}

	static async remove(sessionPath: string): Promise<void> {
		const data = await BookmarkStore.load();
		delete data.bookmarks[sessionPath];
		await BookmarkStore.save(data);
	}

	static async getNote(sessionPath: string): Promise<string | undefined> {
		const data = await BookmarkStore.load();
		return data.bookmarks[sessionPath]?.note;
	}
}

function formatAge(date: Date): string {
	const s = Math.floor((Date.now() - date.getTime()) / 1000);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

function shortCwd(cwd: string): string {
	const home = process.env.HOME || "";
	const s = home ? cwd.replace(home, "~") : cwd;
	const p = s.split("/").filter(Boolean);
	return p.length <= 3 ? s : "…/" + p.slice(-3).join("/");
}

function title(s: SessionInfo): string {
	if (s.name) return s.name;
	const f = (s.firstMessage ?? "").trim();
	if (!f) return basename(s.path, ".jsonl");
	return f.length > 60 ? f.slice(0, 57) + "…" : f;
}

async function browse(pi: ExtensionAPI, ctx: ExtensionCommandContext, showAll: boolean, filterBookmarks = false) {
	while (true) {
		const sessions = (showAll
			? await SessionManager.listAll()
			: await SessionManager.list(ctx.cwd)
		).sort((a, b) => b.modified.getTime() - a.modified.getTime());

		if (!sessions.length) {
			ctx.ui.notify("No sessions found.", "info");
			return;
		}

		const bookmarkData = await BookmarkStore.load();

		const visibleSessions = filterBookmarks
			? sessions.filter(s => s.path in bookmarkData.bookmarks)
			: sessions;

		if (!visibleSessions.length) {
			ctx.ui.notify(filterBookmarks ? "No bookmarked sessions." : "No sessions found.", "info");
			if (filterBookmarks) { filterBookmarks = false; continue; }
			return;
		}

		const items: SelectItem[] = visibleSessions.map((s, i) => {
			const bm = bookmarkData.bookmarks[s.path];
			const bmTag = bm ? (bm.note ? ` 🔖 ${bm.note}` : " 🔖") : "";
			return {
				value: String(i),
				label: title(s),
				description: `${formatAge(s.modified)} · ${s.messageCount} msg · ${shortCwd(s.cwd)}${bmTag}`,
			};
		});

		let sel = visibleSessions[0]!;

		type R = { a: "resume" | "delete" | "rename" | "toggle" | "bookmark" | "filter" | "cancel"; s?: SessionInfo };

		const r = await ctx.ui.custom<R>(
			(tui, theme, _kb, done) => {
				const c = new Container();
				c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				c.addChild(new Text(theme.fg("accent", theme.bold(filterBookmarks ? " 🔖 Bookmarks" : " Sessions")) + "  " + theme.fg("dim", showAll ? "all projects" : "current project"), 1, 0));
				const list = new SelectList(items, Math.min(visibleSessions.length, 12), {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => theme.fg("accent", t),
					description: (t) => theme.fg("dim", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});
				list.onSelectionChange = (item) => { sel = visibleSessions[Number(item.value)]!; };
				list.onSelect = (item) => done({ a: "resume", s: visibleSessions[Number(item.value)]! });
				list.onCancel = () => done({ a: "cancel" });
				c.addChild(list);
				c.addChild(new Text(theme.fg("dim", "Enter resume · d delete · n rename · b bookmark · f filter · Tab scope · Esc close"), 1, 0));
				c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				return {
					render: (w) => c.render(w),
					invalidate: () => c.invalidate(),
					handleInput: (data) => {
						if (matchesKey(data, "tab")) { done({ a: "toggle" }); return; }
						if (data === "d") { done({ a: "delete", s: sel }); return; }
						if (data === "n") { done({ a: "rename", s: sel }); return; }
						if (data === "b") { done({ a: "bookmark", s: sel }); return; }
						if (data === "f") { done({ a: "filter" }); return; }
						list.handleInput(data);
					},
				};
			},
			{ overlay: true, overlayOptions: { anchor: "center", width: "80%", minWidth: 70, maxHeight: "80%" } },
		);

		if (!r || r.a === "cancel") return;
		if (r.a === "toggle") { showAll = !showAll; continue; }
		if (r.a === "filter") { filterBookmarks = !filterBookmarks; continue; }

		if (r.a === "bookmark") {
			const path = r.s!.path;
			const already = path in bookmarkData.bookmarks;
			if (already) {
				await BookmarkStore.remove(path);
				ctx.ui.notify("Bookmark removed.", "info");
				if (path === ctx.sessionManager.getSessionFile()) {
					ctx.ui.setStatus("sm-bm", undefined);
				}
			} else {
				const note = await ctx.ui.input("Bookmark note (optional):", "");
				await BookmarkStore.add(path, note?.trim() || undefined);
				ctx.ui.notify("Bookmarked.", "info");
				if (path === ctx.sessionManager.getSessionFile()) {
					ctx.ui.setStatus("sm-bm", "🔖");
				}
			}
			continue;
		}

		if (r.a === "resume") {
			if (r.s!.path === ctx.sessionManager.getSessionFile()) {
				ctx.ui.notify("Already in this session.", "info");
				return;
			}
			await ctx.switchSession(r.s!.path, {
				withSession: (newCtx) => {
					const name = newCtx.sessionManager.getSessionName();
					newCtx.ui.setStatus("sm", name ? newCtx.ui.theme.fg("accent", `📁 ${name}`) : undefined);
				},
			});
			return;
		}

		if (r.a === "delete") {
			if (await ctx.ui.confirm("Delete?", `"${title(r.s!)}"\n\nThis cannot be undone.`)) {
				try { await unlink(r.s!.path); ctx.ui.notify("Deleted.", "info"); }
				catch (e) { ctx.ui.notify(`Failed: ${e}`, "error"); }
			}
			continue;
		}

		if (r.a === "rename") {
			if (r.s!.path === ctx.sessionManager.getSessionFile()) {
				const name = await ctx.ui.input("New name:", r.s!.name ?? "");
				if (name?.trim()) {
					pi.setSessionName(name.trim());
					ctx.ui.setStatus("sm", ctx.ui.theme.fg("accent", `📁 ${name.trim()}`));
				}
			} else {
				ctx.ui.notify("Resume that session first, then use /name.", "warning");
			}
			continue;
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_e, ctx) => {
		const name = ctx.sessionManager.getSessionName();
		ctx.ui.setStatus("sm", name ? ctx.ui.theme.fg("accent", `📁 ${name}`) : undefined);

		const sessionPath = ctx.sessionManager.getSessionFile();
		if (sessionPath) {
			const bookmarked = await BookmarkStore.isBookmarked(sessionPath);
			ctx.ui.setStatus("sm-bm", bookmarked ? "🔖" : undefined);
		}
	});

	pi.registerCommand("sessions", {
		description: "Browse sessions (/sessions [all])",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();
			await browse(pi, ctx, args.trim().toLowerCase() === "all");
		},
	});

	pi.registerCommand("bookmark", {
		description: "Bookmark the current session with an optional note",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();
			const sessionPath = ctx.sessionManager.getSessionFile();
			if (!sessionPath) {
				ctx.ui.notify("No active session to bookmark.", "warning");
				return;
			}
			const existingNote = await BookmarkStore.getNote(sessionPath);
			const note = await ctx.ui.input("Bookmark note (optional):", existingNote ?? "");
			if (note === undefined) return; // cancelled
			await BookmarkStore.add(sessionPath, note.trim() || undefined);
			ctx.ui.setStatus("sm-bm", "🔖");
			ctx.ui.notify("Bookmarked.", "info");
		},
	});

	pi.registerCommand("sall", {
		description: "Browse all sessions",
		handler: async (_a, ctx) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();
			await browse(pi, ctx, true);
		},
	});
}
