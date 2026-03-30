import { readFileSync } from "node:fs";
import type { TableDefinition } from "@ecu-explorer/core";
import {
	type Edit,
	type EditTransaction,
	HistoryStack,
} from "@ecu-explorer/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	handleMathOpAdd,
	handleMathOpClamp,
	handleMathOpFormula,
	handleMathOpMultiply,
	handleMathOpSmooth,
	handlePasteSpecialFormula,
	handleRedo,
	handleUndo,
	setEditCommandsContext,
} from "../src/commands/edit-commands.js";
import { activate } from "../src/extension.js";
import type { TableEditSession } from "../src/history/table-edit-session.js";
import type { RomEditorProvider } from "../src/rom/editor-provider.js";
import { WorkspaceState } from "../src/workspace-state.js";
import {
	createExtensionContext,
	createMockFileSystemWatcher,
	createMockWorkspaceState,
} from "./mocks/vscode-harness.js";

type RegisteredCommandHandler = (...args: readonly unknown[]) => unknown;

type RegisteredCommandCall = readonly [
	commandId: string,
	handler: RegisteredCommandHandler,
	...rest: readonly unknown[],
];

type MockedRegisterCommand = typeof vscode.commands.registerCommand & {
	mock: {
		calls: readonly RegisteredCommandCall[];
	};
	mockClear(): void;
};

type ActivateContext = Pick<
	vscode.ExtensionContext,
	"subscriptions" | "workspaceState" | "globalStorageUri"
> & {
	extensionPath: string;
	extensionUri: vscode.Uri;
	extension: {
		packageJSON: {
			version: string;
		};
	};
};

type ActiveTab = Pick<vscode.Tab, "input">;

type ActiveTabGroupShape = Pick<
	vscode.TabGroup,
	"activeTab" | "isActive" | "viewColumn" | "tabs"
>;

type EditCommandEditorProvider = Pick<
	RomEditorProvider,
	"getTableDocument" | "getPanelForDocument"
>;

type EditCommandTableSession = Pick<
	TableEditSession,
	"activePanel" | "tableDef" | "undo" | "redo"
>;

function createMockExtensionContext(): ActivateContext {
	return createExtensionContext({
		extensionPath: "/test/path",
		extensionUri: vscode.Uri.file("/test/path"),
		extension: {
			packageJSON: { version: "0.0.0" },
		},
		workspaceState: createMockWorkspaceState(),
		globalStorageUri: vscode.Uri.file("/test/globalStorage"),
	}) as ActivateContext;
}

function createTabGroupWithUri(uri: vscode.Uri): ActiveTabGroupShape {
	const activeTab: ActiveTab = {
		input: { uri } as vscode.TabInputText,
	};

	return {
		activeTab: activeTab as vscode.Tab,
		isActive: true,
		viewColumn: vscode.ViewColumn.One,
		tabs: [],
	};
}

function createTabGroupWithoutActiveTab(): ActiveTabGroupShape {
	return {
		activeTab: undefined,
		isActive: true,
		viewColumn: vscode.ViewColumn.One,
		tabs: [],
	};
}

function getMockedRegisterCommand(): MockedRegisterCommand {
	return vscode.commands.registerCommand as MockedRegisterCommand;
}

function getMockedClipboardReadText(): ReturnType<
	typeof vi.fn<() => Promise<string>>
> {
	const clipboard = { readText: vi.fn<() => Promise<string>>() };
	Object.defineProperty(vscode, "env", {
		value: { clipboard },
		configurable: true,
	});
	return clipboard.readText;
}

// Mock fs module to avoid file system operations
vi.mock("node:fs/promises", () => ({
	default: {
		readdir: vi.fn().mockResolvedValue([]),
		readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
	},
	readdir: vi.fn().mockResolvedValue([]),
	readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
}));

function getRequiredAddress(edit: Edit<Uint8Array>): number {
	return edit.address;
}

function makeEdit(
	address: number,
	oldByte: number,
	newByte: number,
): Edit<Uint8Array> {
	return {
		address,
		before: new Uint8Array([oldByte]),
		after: new Uint8Array([newByte]),
	};
}

function makeTransaction(
	edits: readonly Edit<Uint8Array>[],
	label: string,
): EditTransaction<Edit<Uint8Array>> {
	return {
		label,
		timestamp: Date.now(),
		edits,
	};
}

function setMathCommandState(options?: {
	activePanel?: vscode.WebviewPanel | null;
	activeTableDef?: TableDefinition | null;
	editorProvider?: EditCommandEditorProvider | null;
	activeTableSession?: EditCommandTableSession | null;
	getTableSessionForUri?: (uri: vscode.Uri) => EditCommandTableSession | null;
}): void {
	setEditCommandsContext(() => ({
		activePanel: options?.activePanel ?? null,
		activeTableSession:
			options?.activeTableSession ??
			(options?.activeTableDef === undefined || options.activeTableDef === null
				? null
				: ({
						activePanel: null,
						tableDef: options.activeTableDef,
						undo: vi.fn().mockReturnValue(null),
						redo: vi.fn().mockReturnValue(null),
					} satisfies EditCommandTableSession)),
		editorProvider: options?.editorProvider ?? null,
		getTableSessionForUri: options?.getTableSessionForUri ?? (() => null),
	}));
}

function createActivePanel(): vscode.WebviewPanel {
	// biome-ignore lint: Need to properly mock this later
	return {
		webview: {
			postMessage: vi.fn().mockResolvedValue(true),
		},
	} as unknown as vscode.WebviewPanel;
}

function create2DTableDef() {
	return {
		kind: "table2d",
		name: "Test Table",
		id: "table1",
		rows: 2,
		cols: 2,
		z: {
			id: "table1-z",
			name: "Values",
			address: 0x1000,
			dtype: "u8",
		},
	} satisfies TableDefinition;
}

function create1DTableDef() {
	return {
		kind: "table1d",
		name: "Test 1D Table",
		id: "table1d",
		rows: 4,
		z: {
			id: "table1d-z",
			name: "Values",
			address: 0x1000,
			dtype: "u8",
		},
	} satisfies TableDefinition;
}

function createCustomEditorTabGroup(uri: vscode.Uri): vscode.TabGroup {
	return {
		activeTab: {
			input: {
				uri,
				viewType: "romViewer.tableEditor",
			},
		} as vscode.Tab,
		isActive: true,
		viewColumn: vscode.ViewColumn.One,
		tabs: [],
	} as vscode.TabGroup;
}

/**
 * Tests for math operations commands
 *
 * These tests verify that the math operation commands are properly registered
 * and can be executed through VSCode's command palette.
 */
describe("Math Operations Commands", () => {
	const extensionManifest = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as {
		contributes?: {
			commands?: { command: string; enablement?: string }[];
			menus?: {
				commandPalette?: { command: string; when?: string }[];
			};
		};
	};

	beforeEach(async () => {
		// Reset commands if possible
		const registerCommand = getMockedRegisterCommand();
		if (registerCommand.mock) {
			registerCommand.mockClear();
		}

		// Mock createFileSystemWatcher so the ROM file watcher in activate() works
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
			createMockFileSystemWatcher(),
		);

		// Create mock context and activate extension
		const mockContext = createMockExtensionContext();
		await activate(mockContext as vscode.ExtensionContext);
	});
	describe("Command Registration", () => {
		it("exposes math commands for the table editor in the extension manifest", () => {
			const commands = extensionManifest.contributes?.commands ?? [];
			const commandPaletteEntries =
				extensionManifest.contributes?.menus?.commandPalette ?? [];
			const addCommand = commands.find(
				(entry) => entry.command === "rom.mathOpAdd",
			);
			const multiplyCommand = commands.find(
				(entry) => entry.command === "rom.mathOpMultiply",
			);
			const formulaCommand = commands.find(
				(entry) => entry.command === "rom.mathOpFormula",
			);
			const pasteSpecialCommand = commands.find(
				(entry) => entry.command === "rom.pasteSpecialFormula",
			);
			const clampCommand = commands.find(
				(entry) => entry.command === "rom.mathOpClamp",
			);
			const smoothCommand = commands.find(
				(entry) => entry.command === "rom.mathOpSmooth",
			);

			expect(addCommand?.enablement).toBe(
				"activeCustomEditorId == 'romViewer.tableEditor'",
			);
			expect(multiplyCommand?.enablement).toBe(
				"activeCustomEditorId == 'romViewer.tableEditor'",
			);
			expect(formulaCommand?.enablement).toBe(
				"activeCustomEditorId == 'romViewer.tableEditor'",
			);
			expect(pasteSpecialCommand?.enablement).toBe(
				"activeCustomEditorId == 'romViewer.tableEditor'",
			);
			expect(clampCommand?.enablement).toBe(
				"activeCustomEditorId == 'romViewer.tableEditor'",
			);
			expect(smoothCommand?.enablement).toBe(
				"activeCustomEditorId == 'romViewer.tableEditor' && ecuExplorer.activeTableIs2D",
			);
			expect(
				commandPaletteEntries.find(
					(entry) => entry.command === "rom.mathOpFormula",
				)?.when,
			).toBe("activeCustomEditorId == 'romViewer.tableEditor'");
			expect(
				commandPaletteEntries.find(
					(entry) => entry.command === "rom.pasteSpecialFormula",
				)?.when,
			).toBe("activeCustomEditorId == 'romViewer.tableEditor'");
			expect(
				commandPaletteEntries.find((entry) => entry.command === "rom.mathOpAdd")
					?.when,
			).toBe("activeCustomEditorId == 'romViewer.tableEditor'");
			expect(
				commandPaletteEntries.find(
					(entry) => entry.command === "rom.mathOpSmooth",
				)?.when,
			).toBe(
				"activeCustomEditorId == 'romViewer.tableEditor' && ecuExplorer.activeTableIs2D",
			);
		});

		it("should register ecuExplorer.clearDefinitionCache command", async () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"ecuExplorer.clearDefinitionCache",
				expect.any(Function),
			);
		});

		it("should register ecuExplorer.clearDefinitionCacheForActiveRom command", async () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"ecuExplorer.clearDefinitionCacheForActiveRom",
				expect.any(Function),
			);
		});

		it("should register rom.mathOpAdd command", async () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"rom.mathOpAdd",
				expect.any(Function),
			);
		});

		it("should register rom.mathOpMultiply command", async () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"rom.mathOpMultiply",
				expect.any(Function),
			);
		});

		it("should register rom.mathOpFormula command", async () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"rom.mathOpFormula",
				expect.any(Function),
			);
		});

		it("should register rom.pasteSpecialFormula command", async () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"rom.pasteSpecialFormula",
				expect.any(Function),
			);
		});

		it("should register rom.mathOpClamp command", async () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"rom.mathOpClamp",
				expect.any(Function),
			);
		});

		it("should register rom.mathOpSmooth command", async () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"rom.mathOpSmooth",
				expect.any(Function),
			);
		});
	});

	describe("Definition Cache Clear Commands", () => {
		function getRegisteredHandler(commandId: string): RegisteredCommandHandler {
			const registerCalls = getMockedRegisterCommand().mock.calls;
			const match = registerCalls.find((call) => call[0] === commandId);
			if (!match) {
				throw new Error(`Command not registered: ${commandId}`);
			}
			return match[1];
		}

		it("clears all cached state for ecuExplorer.clearDefinitionCache", async () => {
			const clearAllSpy = vi.spyOn(WorkspaceState.prototype, "clearAll");
			const infoSpy = vi.spyOn(vscode.window, "showInformationMessage");
			const handler = getRegisteredHandler("ecuExplorer.clearDefinitionCache");

			await handler();

			expect(clearAllSpy).toHaveBeenCalledTimes(1);
			expect(infoSpy).toHaveBeenCalledWith(
				"Cleared all cached ROM definition mappings for this workspace.",
			);

			clearAllSpy.mockRestore();
			infoSpy.mockRestore();
		});

		it("clears active ROM cached state for ecuExplorer.clearDefinitionCacheForActiveRom", async () => {
			const activeTabGroupSpy = vi
				.spyOn(vscode.window.tabGroups, "activeTabGroup", "get")
				.mockReturnValue(
					createTabGroupWithUri(
						vscode.Uri.file("/test/active.rom"),
					) as vscode.TabGroup,
				);

			const clearRomStateSpy = vi.spyOn(
				WorkspaceState.prototype,
				"clearRomState",
			);
			const infoSpy = vi.spyOn(vscode.window, "showInformationMessage");
			const handler = getRegisteredHandler(
				"ecuExplorer.clearDefinitionCacheForActiveRom",
			);

			await handler();

			expect(clearRomStateSpy).toHaveBeenCalledWith(
				expect.stringMatching(/[\\/]test[\\/]active\.rom$/),
			);
			expect(infoSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					/^Cleared cached ROM definition mapping for: .*active\.rom$/,
				),
			);

			activeTabGroupSpy.mockRestore();
			clearRomStateSpy.mockRestore();
			infoSpy.mockRestore();
		});

		it("shows warning when there is no active ROM for targeted clear", async () => {
			const activeTabGroupSpy = vi
				.spyOn(vscode.window.tabGroups, "activeTabGroup", "get")
				.mockReturnValue(createTabGroupWithoutActiveTab() as vscode.TabGroup);

			const clearRomStateSpy = vi.spyOn(
				WorkspaceState.prototype,
				"clearRomState",
			);
			const warningSpy = vi.spyOn(vscode.window, "showWarningMessage");
			const handler = getRegisteredHandler(
				"ecuExplorer.clearDefinitionCacheForActiveRom",
			);

			await handler();

			expect(clearRomStateSpy).not.toHaveBeenCalled();
			expect(warningSpy).toHaveBeenCalledWith(
				"No active ROM found to clear definition cache.",
			);

			activeTabGroupSpy.mockRestore();
			clearRomStateSpy.mockRestore();
			warningSpy.mockRestore();
		});
	});

	describe("Command Execution", () => {
		it("should show input box for add operation", async () => {
			setMathCommandState({ activePanel: createActivePanel() });
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValue(undefined);

			await handleMathOpAdd();

			expect(showInputBoxSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("constant"),
				}),
			);

			showInputBoxSpy.mockRestore();
		});

		it("should show input box for multiply operation", async () => {
			setMathCommandState({ activePanel: createActivePanel() });
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValue(undefined);

			await handleMathOpMultiply();

			expect(showInputBoxSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("factor"),
				}),
			);

			showInputBoxSpy.mockRestore();
		});

		it("should show input box for formula operation", async () => {
			setMathCommandState({ activePanel: createActivePanel() });
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValue(undefined);

			await handleMathOpFormula();

			expect(showInputBoxSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("formula"),
				}),
			);

			showInputBoxSpy.mockRestore();
		});

		it("should read clipboard and show input box for paste special", async () => {
			setMathCommandState({ activePanel: createActivePanel() });
			const clipboardReadText = getMockedClipboardReadText();
			clipboardReadText.mockResolvedValue("1\t2");
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValue(undefined);

			await handlePasteSpecialFormula();

			expect(clipboardReadText).toHaveBeenCalledTimes(1);
			expect(showInputBoxSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("paste-special"),
				}),
			);

			showInputBoxSpy.mockRestore();
		});

		it("should show input boxes for clamp operation", async () => {
			setMathCommandState({ activePanel: createActivePanel() });
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValueOnce(undefined);

			await handleMathOpClamp();

			expect(showInputBoxSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("minimum"),
				}),
			);

			showInputBoxSpy.mockRestore();
		});

		it("should show quick pick for smooth operation", async () => {
			setMathCommandState({
				activePanel: createActivePanel(),
				activeTableDef: create2DTableDef(),
			});
			const showQuickPickSpy = vi
				.spyOn(vscode.window, "showQuickPick")
				.mockResolvedValue(undefined);

			await handleMathOpSmooth();

			expect(showQuickPickSpy).toHaveBeenCalledWith(
				expect.arrayContaining(["3", "5", "7", "9"]),
				expect.objectContaining({
					title: expect.stringContaining("Kernel Size"),
				}),
			);

			showQuickPickSpy.mockRestore();
		});

		it("routes math commands through the active custom table tab when cached panel state is stale", async () => {
			const panel = createActivePanel();
			const tableUri = vscode.Uri.parse(
				"ecu-table:///test/active.rom/Test%20Table?table=table1",
			);
			const activeTabGroupSpy = vi
				.spyOn(vscode.window.tabGroups, "activeTabGroup", "get")
				.mockReturnValue(createCustomEditorTabGroup(tableUri));
			const editorProvider = {
				getTableDocument: vi.fn().mockReturnValue({
					tableDef: create2DTableDef(),
					romDocument: { uri: vscode.Uri.file("/test/active.rom") },
				}),
				getPanelForDocument: vi.fn().mockReturnValue(panel),
			} satisfies EditCommandEditorProvider;
			setMathCommandState({
				activePanel: null,
				editorProvider,
			});
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValue("5");

			await handleMathOpAdd();

			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "mathOp",
				operation: "formula",
				expression: "x + (5)",
			});

			showInputBoxSpy.mockRestore();
			activeTabGroupSpy.mockRestore();
		});
	});

	describe("Active Table Resolution", () => {
		it("uses the active custom tab's session for undo/redo when cached session state is stale", () => {
			const panel = createActivePanel();
			const tableUri = vscode.Uri.parse(
				"ecu-table:///test/active.rom/Test%20Table?table=table1",
			);
			const activeTabGroupSpy = vi
				.spyOn(vscode.window.tabGroups, "activeTabGroup", "get")
				.mockReturnValue(createCustomEditorTabGroup(tableUri));
			const undoMessage = {
				type: "update",
				snapshot: {} as never,
				rom: [],
				reason: "undo" as const,
			};
			const redoMessage = {
				type: "update",
				snapshot: {} as never,
				rom: [],
				reason: "redo" as const,
			};
			const tableSession = {
				activePanel: panel,
				tableDef: create2DTableDef(),
				undo: vi.fn().mockReturnValue({ message: undoMessage }),
				redo: vi.fn().mockReturnValue({ message: redoMessage }),
			} satisfies EditCommandTableSession;
			const editorProvider = {
				getTableDocument: vi.fn().mockReturnValue({
					tableDef: create2DTableDef(),
					romDocument: { uri: vscode.Uri.file("/test/active.rom") },
				}),
				getPanelForDocument: vi.fn().mockReturnValue(panel),
			} satisfies EditCommandEditorProvider;
			setMathCommandState({
				activePanel: null,
				editorProvider,
				getTableSessionForUri: () => tableSession,
			});

			handleUndo();
			handleRedo();

			expect(panel.webview.postMessage).toHaveBeenNthCalledWith(1, undoMessage);
			expect(panel.webview.postMessage).toHaveBeenNthCalledWith(2, redoMessage);

			activeTabGroupSpy.mockRestore();
		});

		it("uses the active custom tab's table definition for smooth validation", async () => {
			const tableUri = vscode.Uri.parse(
				"ecu-table:///test/active.rom/Test%20Table?table=table1",
			);
			const activeTabGroupSpy = vi
				.spyOn(vscode.window.tabGroups, "activeTabGroup", "get")
				.mockReturnValue(createCustomEditorTabGroup(tableUri));
			const panel = createActivePanel();
			const editorProvider = {
				getTableDocument: vi.fn().mockReturnValue({
					tableDef: create1DTableDef(),
					romDocument: { uri: vscode.Uri.file("/test/active.rom") },
				}),
				getPanelForDocument: vi.fn().mockReturnValue(panel),
			} satisfies EditCommandEditorProvider;
			const errorSpy = vi.spyOn(vscode.window, "showErrorMessage");
			setMathCommandState({
				activePanel: null,
				editorProvider,
			});

			await handleMathOpSmooth();

			expect(errorSpy).toHaveBeenCalledWith(
				"Smooth operation is only available for 2D and 3D tables",
			);

			errorSpy.mockRestore();
			activeTabGroupSpy.mockRestore();
		});
	});

	describe("Input Validation", () => {
		it("should validate numeric input for add operation", async () => {
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockImplementation(async (options) => {
					if (options?.validateInput) {
						// Test invalid input
						expect(options.validateInput("abc")).toBeTruthy();
						// Test valid input
						expect(options.validateInput("5")).toBeNull();
						expect(options.validateInput("-10")).toBeNull();
					}
					return undefined;
				});

			await vscode.commands.executeCommand("rom.mathOpAdd");

			showInputBoxSpy.mockRestore();
		});

		it("should validate numeric input for multiply operation", async () => {
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockImplementation(async (options) => {
					if (options?.validateInput) {
						// Test invalid input
						expect(options.validateInput("xyz")).toBeTruthy();
						// Test valid input
						expect(options.validateInput("1.5")).toBeNull();
						expect(options.validateInput("0.5")).toBeNull();
					}
					return undefined;
				});

			await vscode.commands.executeCommand("rom.mathOpMultiply");

			showInputBoxSpy.mockRestore();
		});

		it("should validate formula syntax for formula operation", async () => {
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockImplementation(async (options) => {
					expect(options?.prompt).toContain("x, row, col, depth, or i");
					expect(options?.placeHolder).toContain("x + row");
					if (options?.validateInput) {
						expect(options.validateInput("x +")).toBeTruthy();
						expect(options.validateInput("x * 1.5 + 10")).toBeNull();
						expect(options.validateInput("42")).toBeNull();
					}
					return undefined;
				});

			await vscode.commands.executeCommand("rom.mathOpFormula");

			showInputBoxSpy.mockRestore();
		});

		it("should validate paste special formula syntax and advertise src", async () => {
			const clipboardReadText = getMockedClipboardReadText();
			clipboardReadText.mockResolvedValue("10\t20");
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockImplementation(async (options) => {
					expect(options?.prompt).toContain("src");
					expect(options?.placeHolder).toContain("src * 0.8");
					if (options?.validateInput) {
						expect(options.validateInput("src +")).toBeTruthy();
						expect(options.validateInput("src * 0.8")).toBeNull();
						expect(options.validateInput("x + src * 0.1")).toBeNull();
					}
					return undefined;
				});

			await vscode.commands.executeCommand("rom.pasteSpecialFormula");

			showInputBoxSpy.mockRestore();
		});

		it("shows an error when paste special is used with an empty clipboard", async () => {
			setMathCommandState({ activePanel: createActivePanel() });
			const clipboardReadText = getMockedClipboardReadText();
			clipboardReadText.mockResolvedValue("");
			const errorSpy = vi.spyOn(vscode.window, "showErrorMessage");

			await handlePasteSpecialFormula();

			expect(errorSpy).toHaveBeenCalledWith(
				"Clipboard is empty. Copy table values before using Paste Special.",
			);

			errorSpy.mockRestore();
		});

		it("should validate min <= max for clamp operation", async () => {
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockImplementation(async (options) => {
					if (options?.prompt?.includes("minimum")) {
						return "10";
					}
					if (options?.prompt?.includes("maximum") && options?.validateInput) {
						// Test max < min
						expect(options.validateInput("5")).toBeTruthy();
						// Test max >= min
						expect(options.validateInput("10")).toBeNull();
						expect(options.validateInput("20")).toBeNull();
					}
					return undefined;
				});

			await vscode.commands.executeCommand("rom.mathOpClamp");

			showInputBoxSpy.mockRestore();
		});
	});

	/**
	 * Unit tests for shared batch history behavior used by math operations.
	 *
	 * These tests use the shared HistoryStack to verify that math operations are
	 * tracked and undone as a single transaction.
	 */
	describe("Math Operation Undo Behavior", () => {
		let history: HistoryStack<EditTransaction<Edit<Uint8Array>>>;

		beforeEach(() => {
			history = new HistoryStack<EditTransaction<Edit<Uint8Array>>>();
		});

		describe("record", () => {
			it("should push a batch of operations as a single undo unit", () => {
				history.record(
					makeTransaction(
						[makeEdit(0x100, 0x10, 0x20), makeEdit(0x101, 0x30, 0x40)],
						"Math op: add",
					),
				);

				const snapshot = history.getSnapshot();
				expect(snapshot.canUndo).toBe(true);
				expect(snapshot.atInitialState).toBe(false);
			});

			it("should not push empty batch", () => {
				const snapshot = history.getSnapshot();
				expect(snapshot.canUndo).toBe(false);
				expect(snapshot.atInitialState).toBe(true);
			});

			it("should clear redo stack when batch is pushed", () => {
				// Push a single op and undo it to populate redo stack
				history.record(
					makeTransaction([makeEdit(0, 0x10, 0x20)], "Single edit"),
				);
				history.undo();
				expect(history.getSnapshot().canRedo).toBe(true);

				// Push a batch — should clear redo stack
				history.record(
					makeTransaction([makeEdit(0x100, 0x10, 0x20)], "Math op"),
				);

				expect(history.getSnapshot().canRedo).toBe(false);
			});
		});

		describe("batch undo", () => {
			it("should undo all ops in a batch as a single unit", () => {
				const romBytes = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
				const edits = [makeEdit(0, 0x10, 0xaa), makeEdit(1, 0x20, 0xbb)];

				// Apply the math op
				for (const edit of edits) {
					romBytes.set(edit.after, getRequiredAddress(edit));
				}
				history.record(makeTransaction(edits, "Math op: add"));

				expect(romBytes[0]).toBe(0xaa);
				expect(romBytes[1]).toBe(0xbb);

				// Undo the batch
				const entry = history.undo();
				expect(entry).not.toBeNull();
				if (entry === null) {
					throw new Error("Expected batch entry to exist");
				}

				for (const edit of [...entry.transaction.edits].reverse()) {
					romBytes.set(edit.before, getRequiredAddress(edit));
				}

				expect(romBytes[0]).toBe(0x10);
				expect(romBytes[1]).toBe(0x20);
				// Unchanged bytes should remain
				expect(romBytes[2]).toBe(0x30);
				expect(romBytes[3]).toBe(0x40);
			});

			it("should move batch to redo stack after undo", () => {
				history.record(
					makeTransaction([makeEdit(0x100, 0x10, 0x20)], "Math op"),
				);

				history.undo();

				const snapshot = history.getSnapshot();
				expect(snapshot.canUndo).toBe(false);
				expect(snapshot.canRedo).toBe(true);
				expect(snapshot.atInitialState).toBe(true);
			});

			it("should redo a batch after undo", () => {
				const romBytes = new Uint8Array([0x10, 0x20]);
				const edits = [makeEdit(0, 0x10, 0xaa), makeEdit(1, 0x20, 0xbb)];

				// Apply math op
				for (const edit of edits) {
					romBytes.set(edit.after, getRequiredAddress(edit));
				}
				history.record(makeTransaction(edits, "Math op: add"));

				// Undo
				const undoEntry = history.undo();
				if (undoEntry) {
					for (const edit of [...undoEntry.transaction.edits].reverse()) {
						romBytes.set(edit.before, getRequiredAddress(edit));
					}
				}
				expect(romBytes[0]).toBe(0x10);
				expect(romBytes[1]).toBe(0x20);

				// Redo
				const redoEntry = history.redo();
				expect(redoEntry).not.toBeNull();
				if (redoEntry === null) {
					throw new Error("Expected batch entry to exist on redo");
				}

				for (const edit of redoEntry.transaction.edits) {
					romBytes.set(edit.after, getRequiredAddress(edit));
				}
				expect(romBytes[0]).toBe(0xaa);
				expect(romBytes[1]).toBe(0xbb);
			});
		});

		describe("mathOpComplete handler simulation", () => {
			it("should capture before bytes from ROM before applying math op edits", () => {
				// Simulate the ROM state before math op
				const romBytes = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
				const originalBytes = new Uint8Array(romBytes);

				// Simulate mathOpComplete message edits
				const mathEdits = [
					{ address: 0, after: [0xaa] },
					{ address: 1, after: [0xbb] },
				];

				// Simulate the mathOpComplete handler logic
				const batchEdits: Edit<Uint8Array>[] = [];
				for (const edit of mathEdits) {
					const newValue = new Uint8Array(edit.after);
					const oldValue = romBytes.slice(
						edit.address,
						edit.address + newValue.length,
					);
					batchEdits.push({
						address: edit.address,
						before: oldValue,
						after: newValue,
						label: "Math op: add",
					});
					romBytes.set(newValue, edit.address);
				}
				history.record(makeTransaction(batchEdits, "Math op: add (2 cells)"));

				// Verify ROM was updated
				expect(romBytes[0]).toBe(0xaa);
				expect(romBytes[1]).toBe(0xbb);

				// Simulate undo
				const entry = history.undo();
				expect(entry).not.toBeNull();
				if (entry === null) {
					throw new Error("Expected batch entry to exist");
				}

				for (const edit of [...entry.transaction.edits].reverse()) {
					romBytes.set(edit.before, getRequiredAddress(edit));
				}

				// ROM should be back to original state
				expect(romBytes[0]).toBe(originalBytes[0]);
				expect(romBytes[1]).toBe(originalBytes[1]);
				expect(romBytes[2]).toBe(originalBytes[2]);
				expect(romBytes[3]).toBe(originalBytes[3]);
			});

			it("should not push to undo stack if no edits in mathOpComplete", () => {
				// Simulate mathOpComplete with empty edits
				const mathEdits: { address: number; after: number[] }[] = [];
				const batchEdits: Edit<Uint8Array>[] = [];

				for (const edit of mathEdits) {
					const newValue = new Uint8Array(edit.after);
					batchEdits.push({
						address: edit.address,
						before: new Uint8Array(0),
						after: newValue,
					});
				}
				if (batchEdits.length > 0) {
					history.record(makeTransaction(batchEdits, "Math op: add (0 cells)"));
				}

				// No ops pushed — undo stack should be empty
				const snapshot = history.getSnapshot();
				expect(snapshot.canUndo).toBe(false);
				expect(snapshot.atInitialState).toBe(true);
			});

			it("should interleave correctly with single cell edits", () => {
				const romBytes = new Uint8Array([0x10, 0x20, 0x30]);

				// Single cell edit
				const singleOldValue = romBytes.slice(0, 1);
				const singleNewValue = new Uint8Array([0x55]);
				romBytes.set(singleNewValue, 0);
				history.record(
					makeTransaction(
						[
							{
								address: 0,
								before: singleOldValue,
								after: singleNewValue,
								label: "Edit cell (0, 0)",
							},
						],
						"Edit cell (0, 0)",
					),
				);

				// Math op on cells 1 and 2
				const mathEdits = [
					{ address: 1, after: [0xaa] },
					{ address: 2, after: [0xbb] },
				];
				const batchEdits: Edit<Uint8Array>[] = [];
				for (const edit of mathEdits) {
					const newValue = new Uint8Array(edit.after);
					const oldValue = romBytes.slice(
						edit.address,
						edit.address + newValue.length,
					);
					batchEdits.push({
						address: edit.address,
						before: oldValue,
						after: newValue,
					});
					romBytes.set(newValue, edit.address);
				}
				history.record(makeTransaction(batchEdits, "Math op: add"));

				expect(romBytes).toEqual(new Uint8Array([0x55, 0xaa, 0xbb]));

				// Undo math op (batch)
				const batchEntry = history.undo();
				if (batchEntry === null) {
					throw new Error("Expected batch entry to exist");
				}
				for (const edit of [...batchEntry.transaction.edits].reverse()) {
					romBytes.set(edit.before, getRequiredAddress(edit));
				}
				expect(romBytes).toEqual(new Uint8Array([0x55, 0x20, 0x30]));

				// Undo single cell edit
				const singleEntry = history.undo();
				if (singleEntry === null) {
					throw new Error("Expected single entry to exist");
				}
				expect(singleEntry.transaction.edits).toHaveLength(1);
				const [singleEdit] = singleEntry.transaction.edits;
				if (!singleEdit) {
					throw new Error("Expected single edit to exist");
				}
				romBytes.set(singleEdit.before, singleEdit.address);
				expect(romBytes).toEqual(new Uint8Array([0x10, 0x20, 0x30]));

				// Should be back to initial state
				expect(history.getSnapshot().atInitialState).toBe(true);
			});
		});
	});
});
