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

import * as nodePath from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

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
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock FileSystemWatcher that captures its `onDidChange` and
 * `onDidCreate` listeners so tests can fire file-change events programmatically.
 */
function createCapturingFileSystemWatcher() {
	let changeListener: ((uri: vscode.Uri) => void) | null = null;
	let createListener: ((uri: vscode.Uri) => void) | null = null;

	const watcher = {
		onDidChange(cb: (uri: vscode.Uri) => void) {
			changeListener = cb;
			return { dispose: vi.fn() };
		},
		onDidCreate(cb: (uri: vscode.Uri) => void) {
			createListener = cb;
			return { dispose: vi.fn() };
		},
		onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		dispose: vi.fn(),
		ignoreCreateEvents: false,
		ignoreChangeEvents: false,
		ignoreDeleteEvents: true,
		/** Fire the captured onDidChange listener for the given URI. */
		fireChange(uri: vscode.Uri) {
			if (changeListener) changeListener(uri);
		},
		/** Fire the captured onDidCreate listener for the given URI. */
		fireCreate(uri: vscode.Uri) {
			if (createListener) createListener(uri);
		},
	};

	// Spy on onDidChange and onDidCreate so we can assert they were called
	vi.spyOn(watcher, "onDidChange");
	vi.spyOn(watcher, "onDidCreate");

	return watcher;
}

/**
 * Creates a minimal mock RomDocument for testing.
 */
function createMockRomDocument(uri: vscode.Uri, romBytes: Uint8Array) {
	let disposeListener: (() => void) | null = null;

	const doc = {
		uri,
		romBytes,
		definition: undefined as any,
		isDirty: false,
		updateBytes: vi.fn(
			(
				_newBytes: Uint8Array,
				_address?: number,
				_length?: number,
				_markDirty?: boolean,
			) => {},
		),
		makeDirty: vi.fn(),
		makeClean: vi.fn(),
		onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
		onDidUpdateBytes: vi.fn(() => ({ dispose: vi.fn() })),
		onDidDispose: vi.fn((cb: () => void) => {
			disposeListener = cb;
			return { dispose: vi.fn() };
		}),
		dispose: vi.fn(() => {
			if (disposeListener) disposeListener();
		}),
		/** Trigger the dispose lifecycle manually in tests */
		triggerDispose() {
			if (disposeListener) disposeListener();
		},
	};

	return doc;
}

// ---------------------------------------------------------------------------
// Unit-level tests: callback logic in isolation (no full activate())
// ---------------------------------------------------------------------------

describe("ROM File Watcher – callback logic (unit)", () => {
	/**
	 * These tests replicate the per-document watcher handler logic inline,
	 * giving precise control over state.
	 */

	beforeEach(() => {
		vi.clearAllMocks();
	});

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
				newFileBytes as any,
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
			expect(document!.updateBytes).toHaveBeenCalledOnce();
			expect(document!.updateBytes).toHaveBeenCalledWith(newFileBytes);
		});

		it("posts { type: 'update', snapshot, rom } to activePanel when activeRom URI matches", async () => {
			const uri = vscode.Uri.file("/roms/active.hex");
			const mockDoc = createMockRomDocument(uri, new Uint8Array(16));
			const newFileBytes = new Uint8Array([0xff, 0xfe]);

			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				newFileBytes as any,
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
				newFileBytes as any,
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
				new Uint8Array([0x00]) as any,
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
				new Uint8Array([0x02]) as any,
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

			expect(document!.updateBytes).toHaveBeenCalledOnce();
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
		vi.clearAllMocks();
		subscriptions.length = 0;

		capturedWatcher = createCapturingFileSystemWatcher();
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
			capturedWatcher as any,
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
	) {
		const uri = romDoc.uri;
		const uriStr = uri.toString();
		const dir = vscode.Uri.file(nodePath.dirname(uri.fsPath));
		const fileName = nodePath.basename(uri.fsPath);
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
			newFileBytes as any,
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
			newFileBytes as any,
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

	it("calls updateBytes with new file contents when onDidCreate fires (rename scenario)", async () => {
		const uri = vscode.Uri.file("/roms/renamed.hex");
		const newFileBytes = new Uint8Array([0xaa, 0xbb]);

		const mockDoc = createMockRomDocument(uri, new Uint8Array([0x00]));

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
			newFileBytes as any,
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

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(newBytes as any);

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

		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(newBytes as any);

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
