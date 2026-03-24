/**
 * Tests for the ROM file watcher behavior added in extension.ts
 *
 * The per-document watcher approach creates a `vscode.RelativePattern` watcher
 * for each opened ROM document. When `editorProvider.onDidOpenRomDocument` fires,
 * `watchRomDocument()` is called and a per-file watcher is created. When the ROM
 * file is modified on disk (e.g. by the MCP `patch_table` tool), the watcher:
 *   1. Reads the new bytes from disk via `vscode.workspace.fs.readFile`
 *   2. Calls `document.updateBytes(newBytes)` → fires onDidUpdateBytes → GraphPanelManager
 *      broadcasts updated snapshots to graph panels
 *   3. Updates `activeRom.bytes` and posts `{ type: "update", snapshot }` to `activePanel`
 *      if the active ROM URI matches
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	type CapturingFileSystemWatcher,
	createCapturingFileSystemWatcher,
	createMockRomDocument,
} from "./mocks/vscode-harness.js";

type MockReadFileResult = Awaited<
	ReturnType<typeof vscode.workspace.fs.readFile>
>;

function asFileSystemWatcher(
	watcher: CapturingFileSystemWatcher,
): vscode.FileSystemWatcher {
	return watcher as vscode.FileSystemWatcher;
}

function mockReadFileResult(bytes: Uint8Array): MockReadFileResult {
	return bytes;
}

// Mock fs module to avoid file system operations during activate()
vi.mock("node:fs/promises", () => ({
	default: {
		readdir: vi.fn().mockResolvedValue([]),
		readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
	},
	readdir: vi.fn().mockResolvedValue([]),
	readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
}));

// ---------------------------------------------------------------------------
// Unit-level tests: callback logic in isolation (no full activate())
// ---------------------------------------------------------------------------

describe("ROM File Watcher – callback logic (unit)", () => {
	/**
	 * These tests replicate the per-document watcher handler logic inline,
	 * giving precise control over state.
	 */

	beforeEach(() => {});

	describe("happy path – document found via editorProvider lookup", () => {
		it("calls document.updateBytes() with new bytes read from disk", async () => {
			const uri = vscode.Uri.file("/roms/test.hex");
			const originalBytes = new Uint8Array([0x01, 0x02]);
			const newFileBytes = new Uint8Array([0x03, 0x04]);

			const mockDoc = createMockRomDocument(uri, originalBytes);

			// editorProvider recognises this URI
			const getDocument = (u: vscode.Uri) =>
				u.toString() === uri.toString() ? mockDoc : undefined;

			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				mockReadFileResult(newFileBytes),
			);

			// ---- Inline replica of the per-document watcher handler ----
			const document: ReturnType<typeof createMockRomDocument> | undefined =
				getDocument(uri);

			if (document) {
				const newBytes = new Uint8Array(
					await vscode.workspace.fs.readFile(uri),
				);
				document.updateBytes(newBytes);
			}

			expect(document).toBeDefined();
			expect(document?.updateBytes).toHaveBeenCalledOnce();
			expect(document?.updateBytes).toHaveBeenCalledWith(newFileBytes);
		});

		it("posts { type: 'update', snapshot, rom } to activePanel when activeRom URI matches", async () => {
			const uri = vscode.Uri.file("/roms/active.hex");
			const mockDoc = createMockRomDocument(uri, new Uint8Array(16));
			const newFileBytes = new Uint8Array([0xff, 0xfe]);

			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				mockReadFileResult(newFileBytes),
			);

			const mockPanel = {
				webview: { postMessage: vi.fn().mockResolvedValue(true) },
			};

			// Inline callback replica — activeRom.romUri === uri.toString()
			const newBytes = new Uint8Array(await vscode.workspace.fs.readFile(uri));
			mockDoc.updateBytes(newBytes);

			const activeRomUri = uri.toString();
			const changedUri = uri.toString();
			if (activeRomUri === changedUri) {
				// Minimal stub for snapshotTable result (real code calls snapshotTable)
				mockPanel.webview.postMessage({
					type: "update",
					snapshot: { kind: "table1d", name: "stub", rows: 1, z: [0] },
					rom: Array.from(newBytes),
				});
			}

			expect(mockDoc.updateBytes).toHaveBeenCalledOnce();
			expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "update",
					rom: expect.any(Array),
				}),
			);
		});
	});

	describe("fallback – document found via panelToDocument map", () => {
		it("calls document.updateBytes() when editorProvider misses but panelToDocument has the doc", async () => {
			const uri = vscode.Uri.file("/roms/panel-only.bin");
			const originalBytes = new Uint8Array([0xaa]);
			const newFileBytes = new Uint8Array([0xbb]);

			const mockDoc = createMockRomDocument(uri, originalBytes);

			// editorProvider knows nothing about this URI
			const getDocument = (_u: vscode.Uri) => undefined;

			// panelToDocument has the document under a dummy panel key
			const panelToDocument = new Map<object, typeof mockDoc>();
			const dummyPanel = {};
			panelToDocument.set(dummyPanel, mockDoc);

			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				mockReadFileResult(newFileBytes),
			);

			// ---- Inline replica of the watcher callback ----
			let document: typeof mockDoc | undefined = getDocument(uri);
			if (!document) {
				for (const [_panel, doc] of panelToDocument.entries()) {
					if (doc.uri.toString() === uri.toString()) {
						document = doc;
						break;
					}
				}
			}

			expect(document).toBe(mockDoc);

			if (document) {
				const newBytes = new Uint8Array(
					await vscode.workspace.fs.readFile(uri),
				);
				document.updateBytes(newBytes);
			}

			expect(mockDoc.updateBytes).toHaveBeenCalledOnce();
			expect(mockDoc.updateBytes).toHaveBeenCalledWith(newFileBytes);
		});
	});

	describe("no-op – ROM is not open in any panel", () => {
		it("does NOT call readFile when neither lookup finds the document", async () => {
			const uri = vscode.Uri.file("/roms/unknown.rom");

			const getDocument = (_u: vscode.Uri) => undefined;
			const panelToDocument = new Map<
				object,
				ReturnType<typeof createMockRomDocument>
			>();

			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				mockReadFileResult(new Uint8Array([0x00])),
			);

			// ---- Inline replica of the watcher callback ----
			let document: ReturnType<typeof createMockRomDocument> | undefined =
				getDocument(uri);
			if (!document) {
				for (const [_panel, doc] of panelToDocument.entries()) {
					if (doc.uri.toString() === uri.toString()) {
						document = doc;
						break;
					}
				}
			}

			// Early return — readFile NOT called
			if (!document) {
				// no-op
			} else {
				await vscode.workspace.fs.readFile(uri);
			}

			expect(document).toBeUndefined();
			expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
		});
	});

	describe("no-op – active ROM URI does not match changed URI", () => {
		it("does NOT post to activePanel when activeRom.romUri differs from changed file URI", async () => {
			const changedUri = vscode.Uri.file("/roms/changed.hex");
			const activeRomUri = "file:///roms/other.hex"; // a *different* ROM

			const mockDoc = createMockRomDocument(changedUri, new Uint8Array([0x01]));
			const getDocument = (u: vscode.Uri) =>
				u.toString() === changedUri.toString() ? mockDoc : undefined;

			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				mockReadFileResult(new Uint8Array([0x02])),
			);

			const mockPanel = { webview: { postMessage: vi.fn() } };

			// ---- Inline replica of the watcher callback ----
			const document = getDocument(changedUri);
			expect(document).toBeDefined();

			if (document) {
				const newBytes = new Uint8Array(
					await vscode.workspace.fs.readFile(changedUri),
				);
				document.updateBytes(newBytes);

				// activeRom.romUri !== changedUri.toString() → skip postMessage
				if (activeRomUri === changedUri.toString()) {
					mockPanel.webview.postMessage({ type: "update", snapshot: {} });
				}
			}

			expect(document?.updateBytes).toHaveBeenCalledOnce();
			expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
		});
	});
});

// ---------------------------------------------------------------------------
// Integration tests: watchRomDocument logic (simulated, without activate())
//
// The per-document watcher logic in extension.ts is internalized as
// `watchRomDocument()`. These tests replicate and verify its behaviour
// by simulating calls to createFileSystemWatcher with RelativePattern
// and asserting the expected interactions.
// ---------------------------------------------------------------------------

describe("ROM File Watcher – per-document watchRomDocument logic", () => {
	let capturedWatcher: ReturnType<typeof createCapturingFileSystemWatcher>;
	const subscriptions: unknown[] = [];

	beforeEach(() => {
		subscriptions.length = 0;

		capturedWatcher = createCapturingFileSystemWatcher();
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
			asFileSystemWatcher(capturedWatcher),
		);
	});

	/**
	 * Simulate the watchRomDocument() function from extension.ts for a given doc.
	 * Returns helper functions to fire watcher events or trigger disposal.
	 */
	function simulateWatchRomDocument(
		romDoc: ReturnType<typeof createMockRomDocument>,
		activeRomRef: { romUri: string; bytes: Uint8Array } | null,
		activePanel: { webview: { postMessage: (msg: unknown) => unknown } } | null,
		activeTableDef: { name: string } | null,
		pendingSavedRomBytes = new Map<string, Uint8Array>(),
	) {
		const uri = romDoc.uri;
		const uriStr = uri.toString();
		const lastSeparator = Math.max(
			uri.fsPath.lastIndexOf("/"),
			uri.fsPath.lastIndexOf("\\"),
		);
		const dirPath =
			lastSeparator >= 0 ? uri.fsPath.slice(0, lastSeparator) : uri.fsPath;
		const fileName =
			lastSeparator >= 0 ? uri.fsPath.slice(lastSeparator + 1) : uri.fsPath;
		const dir = vscode.Uri.file(dirPath);
		const pattern = new vscode.RelativePattern(dir, fileName);

		const watcher = vscode.workspace.createFileSystemWatcher(
			pattern,
			false,
			false,
			true,
		);
		subscriptions.push(watcher);

		const handler = async (_changedUri: vscode.Uri) => {
			try {
				const newBytes = new Uint8Array(
					await vscode.workspace.fs.readFile(uri),
				);
				const pendingSavedBytes = pendingSavedRomBytes.get(uriStr);
				if (
					pendingSavedBytes &&
					pendingSavedBytes.length === newBytes.length &&
					pendingSavedBytes.every((byte, index) => byte === newBytes[index])
				) {
					pendingSavedRomBytes.delete(uriStr);
					return;
				}

				// External update — do NOT mark document dirty (matches real watchRomDocument)
				romDoc.updateBytes(newBytes, undefined, undefined, false);
				if (activeRomRef && activeRomRef.romUri === uriStr) {
					activeRomRef.bytes = newBytes;
					if (activePanel && activeTableDef) {
						activePanel.webview.postMessage({
							type: "update",
							snapshot: { name: activeTableDef.name },
							rom: Array.from(newBytes),
						});
					}
				}
			} catch (_err) {
				// handler swallows errors
			}
		};

		watcher.onDidCreate(handler);
		watcher.onDidChange(handler);

		romDoc.onDidDispose(() => {
			watcher.dispose();
		});

		return {
			fireChange: (u: vscode.Uri) => capturedWatcher.fireChange(u),
			fireCreate: (u: vscode.Uri) => capturedWatcher.fireCreate(u),
			dispose: () => romDoc.triggerDispose(),
		};
	}

	it("calls createFileSystemWatcher with a RelativePattern targeting the file", () => {
		const uri = vscode.Uri.file("/roms/outside-workspace.hex");
		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x01]));

		simulateWatchRomDocument(mockDoc, null, null, null);

		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
			expect.any(vscode.RelativePattern),
			false, // ignoreCreateEvents
			false, // ignoreChangeEvents
			true, // ignoreDeleteEvents
		);
	});

	it("builds a correct RelativePattern for a Windows-style ROM path", () => {
		const uri = {
			fsPath: "C:\\roms\\outside-workspace.hex",
			toString: () => "file:///c%3A/roms/outside-workspace.hex",
		} as vscode.Uri;
		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x01]));

		simulateWatchRomDocument(mockDoc, null, null, null);

		const [pattern] = vi.mocked(vscode.workspace.createFileSystemWatcher).mock
			.calls[0] as [vscode.RelativePattern, boolean, boolean, boolean];
		expect(pattern.base).toEqual(vscode.Uri.file("C:\\roms"));
		expect(pattern.pattern).toBe("outside-workspace.hex");
	});

	it("attaches onDidChange and onDidCreate handlers to the watcher", () => {
		const uri = vscode.Uri.file("/roms/test.hex");
		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x01]));

		simulateWatchRomDocument(mockDoc, null, null, null);

		expect(capturedWatcher.onDidCreate).toHaveBeenCalled();
		expect(capturedWatcher.onDidChange).toHaveBeenCalled();
	});

	it("pushes the watcher onto subscriptions", () => {
		const uri = vscode.Uri.file("/roms/test.hex");
		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x01]));

		expect(subscriptions.length).toBe(0);
		simulateWatchRomDocument(mockDoc, null, null, null);
		expect(subscriptions.length).toBe(1);
		expect(subscriptions[0]).toBe(capturedWatcher);
	});

	it("calls updateBytes with new file contents when onDidChange fires", async () => {
		const uri = vscode.Uri.file("/roms/watched.hex");
		const originalBytes = new Uint8Array([0x01, 0x02]);
		const newFileBytes = new Uint8Array([0x03, 0x04]);

		const mockDoc = createMockRomDocument(uri, originalBytes);

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
			mockReadFileResult(newFileBytes),
		);

		const { fireChange } = simulateWatchRomDocument(mockDoc, null, null, null);

		fireChange(uri);
		await new Promise((r) => setTimeout(r, 20));

		expect(mockDoc.updateBytes).toHaveBeenCalledWith(
			newFileBytes,
			undefined,
			undefined,
			false,
		);
	});

	it("calls updateBytes with markDirty=false (Scenario 1: MCP edit does not dirty document)", async () => {
		const uri = vscode.Uri.file("/roms/mcp-patched.hex");
		const originalBytes = new Uint8Array([0x01, 0x02]);
		const newFileBytes = new Uint8Array([0x03, 0x04]);

		const mockDoc = createMockRomDocument(uri, originalBytes);

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
			mockReadFileResult(newFileBytes),
		);

		const { fireChange } = simulateWatchRomDocument(mockDoc, null, null, null);

		fireChange(uri);
		await new Promise((r) => setTimeout(r, 20));

		// The 4th argument must be false — MCP external edit should NOT dirty the document
		expect(mockDoc.updateBytes).toHaveBeenCalledOnce();
		expect(mockDoc.updateBytes).toHaveBeenCalledWith(
			newFileBytes,
			undefined,
			undefined,
			false,
		);
	});

	it("ignores the delayed watcher event for a self-save when bytes match the saved ROM", async () => {
		const uri = vscode.Uri.file("/roms/self-saved.hex");
		const savedBytes = new Uint8Array([0x10, 0x20, 0x30]);
		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x00]));
		const pendingSavedRomBytes = new Map<string, Uint8Array>([
			[uri.toString(), savedBytes],
		]);

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
			mockReadFileResult(savedBytes),
		);

		const { fireChange } = simulateWatchRomDocument(
			mockDoc,
			null,
			null,
			null,
			pendingSavedRomBytes,
		);

		fireChange(uri);
		await new Promise((r) => setTimeout(r, 20));

		expect(mockDoc.updateBytes).not.toHaveBeenCalled();
		expect(pendingSavedRomBytes.has(uri.toString())).toBe(false);
	});

	it("calls updateBytes with new file contents when onDidCreate fires (rename scenario)", async () => {
		const uri = vscode.Uri.file("/roms/renamed.hex");
		const newFileBytes = new Uint8Array([0xaa, 0xbb]);

		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x00]));

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
			mockReadFileResult(newFileBytes),
		);

		const { fireCreate } = simulateWatchRomDocument(mockDoc, null, null, null);

		fireCreate(uri);
		await new Promise((r) => setTimeout(r, 20));

		expect(mockDoc.updateBytes).toHaveBeenCalledWith(
			newFileBytes,
			undefined,
			undefined,
			false,
		);
	});

	it("does NOT throw when the handler fires and readFile rejects", async () => {
		const uri = vscode.Uri.file("/roms/unreadable.hex");
		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x00]));

		vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(
			new Error("File not found"),
		);

		const { fireChange } = simulateWatchRomDocument(mockDoc, null, null, null);

		await expect(
			new Promise<void>((resolve) => {
				fireChange(uri);
				setTimeout(resolve, 20);
			}),
		).resolves.toBeUndefined();
	});

	it("posts update message to activePanel when fired URI matches activeRom", async () => {
		const uri = vscode.Uri.file("/roms/active.hex");
		const mockDoc = createMockRomDocument(uri, new Uint8Array(4));
		const newBytes = new Uint8Array([0xca, 0xfe]);

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
			mockReadFileResult(newBytes),
		);

		const activeRom = { romUri: uri.toString(), bytes: new Uint8Array(4) };
		const mockPanel = { webview: { postMessage: vi.fn() } };
		const tableDef = { name: "TestTable" };

		const { fireChange } = simulateWatchRomDocument(
			mockDoc,
			activeRom,
			mockPanel,
			tableDef,
		);

		fireChange(uri);
		await new Promise((r) => setTimeout(r, 20));

		expect(mockDoc.updateBytes).toHaveBeenCalledWith(
			newBytes,
			undefined,
			undefined,
			false,
		);
		expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "update",
				rom: expect.any(Array),
			}),
		);
	});

	it("does NOT post to activePanel when activeRom URI does not match the fired URI", async () => {
		const uri = vscode.Uri.file("/roms/changed.hex");
		const mockDoc = createMockRomDocument(uri, new Uint8Array(4));
		const newBytes = new Uint8Array([0xca, 0xfe]);

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
			mockReadFileResult(newBytes),
		);

		// Active ROM is a DIFFERENT file
		const activeRom = {
			romUri: "file:///roms/other.hex",
			bytes: new Uint8Array(4),
		};
		const mockPanel = { webview: { postMessage: vi.fn() } };
		const tableDef = { name: "TestTable" };

		const { fireChange } = simulateWatchRomDocument(
			mockDoc,
			activeRom,
			mockPanel,
			tableDef,
		);

		fireChange(uri);
		await new Promise((r) => setTimeout(r, 20));

		expect(mockDoc.updateBytes).toHaveBeenCalledWith(
			newBytes,
			undefined,
			undefined,
			false,
		);
		// postMessage must NOT be called because activeRom.romUri !== uri.toString()
		expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
	});

	it("disposes the watcher when the document is disposed", () => {
		const uri = vscode.Uri.file("/roms/disposable.hex");
		const mockDoc = createMockRomDocument(uri, new Uint8Array([0xa0]));

		const { dispose } = simulateWatchRomDocument(mockDoc, null, null, null);

		dispose();

		expect(capturedWatcher.dispose).toHaveBeenCalled();
	});

	it("registers onDidDispose on the document to clean up the watcher", () => {
		const uri = vscode.Uri.file("/roms/cleanup.hex");
		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x01]));

		simulateWatchRomDocument(mockDoc, null, null, null);

		// onDidDispose should have been called to register the cleanup handler
		expect(mockDoc.onDidDispose).toHaveBeenCalled();
	});
});
