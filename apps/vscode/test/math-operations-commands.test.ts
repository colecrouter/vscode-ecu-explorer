import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	type EditOperation,
	isBatchEdit,
	UndoRedoManager,
} from "../src/undo-redo-manager";

// Mock fs module to avoid file system operations
vi.mock("node:fs/promises", () => ({
	default: {
		readdir: vi.fn().mockResolvedValue([]),
		readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
	},
	readdir: vi.fn().mockResolvedValue([]),
	readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
}));

import { activate } from "../src/extension";

/**
 * Create a mock FileSystemWatcher that has onDidChange/onDidCreate/onDidDelete event handlers.
 */
function createMockFileSystemWatcher() {
	return {
		onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		dispose: vi.fn(),
		ignoreCreateEvents: false,
		ignoreChangeEvents: false,
		ignoreDeleteEvents: false,
	};
}

/**
 * Tests for math operations commands
 *
 * These tests verify that the math operation commands are properly registered
 * and can be executed through VSCode's command palette.
 */
describe("Math Operations Commands", () => {
	beforeAll(async () => {
		// Reset commands if possible
		if (
			vscode.commands.registerCommand &&
			(vscode.commands.registerCommand as any).mock
		) {
			(vscode.commands.registerCommand as any).mockClear();
		}

		// Mock createFileSystemWatcher so the ROM file watcher in activate() works
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
			createMockFileSystemWatcher() as any,
		);

		// Create mock context and activate extension
		const mockContext = {
			subscriptions: [],
			extensionPath: "/test/path",
			extensionUri: vscode.Uri.file("/test/path"),
			// Required by registerMcpProvider (mcp-provider.ts line 41)
			extension: {
				packageJSON: { version: "0.0.0" },
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			workspaceState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			globalStorageUri: vscode.Uri.file("/test/globalStorage"),
		};
		await activate(mockContext as any);
	});
	describe("Command Registration", () => {
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

	describe("Command Execution", () => {
		// TODO: These tests require an active ROM/panel context to work properly
		// They should be rewritten to set up the full context or test the handlers directly
		it.skip("should show input box for add operation", async () => {
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValue(undefined);

			await vscode.commands.executeCommand("rom.mathOpAdd");

			expect(showInputBoxSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("constant"),
				}),
			);

			showInputBoxSpy.mockRestore();
		});

		it.skip("should show input box for multiply operation", async () => {
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValue(undefined);

			await vscode.commands.executeCommand("rom.mathOpMultiply");

			expect(showInputBoxSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("factor"),
				}),
			);

			showInputBoxSpy.mockRestore();
		});

		it.skip("should show input boxes for clamp operation", async () => {
			const showInputBoxSpy = vi
				.spyOn(vscode.window, "showInputBox")
				.mockResolvedValueOnce(undefined);

			await vscode.commands.executeCommand("rom.mathOpClamp");

			expect(showInputBoxSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("minimum"),
				}),
			);

			showInputBoxSpy.mockRestore();
		});

		it.skip("should show quick pick for smooth operation", async () => {
			const showQuickPickSpy = vi
				.spyOn(vscode.window, "showQuickPick")
				.mockResolvedValue(undefined);

			await vscode.commands.executeCommand("rom.mathOpSmooth");

			expect(showQuickPickSpy).toHaveBeenCalledWith(
				expect.arrayContaining(["3", "5", "7", "9"]),
				expect.objectContaining({
					title: expect.stringContaining("Kernel Size"),
				}),
			);

			showQuickPickSpy.mockRestore();
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
	 * Unit tests for the UndoRedoManager batch undo logic.
	 *
	 * These tests use the real UndoRedoManager from undo-redo-manager.ts to verify
	 * that math operations are correctly tracked and undone as a single batch.
	 */
	describe("Math Operation Undo Behavior", () => {
		let manager: UndoRedoManager;

		beforeEach(() => {
			manager = new UndoRedoManager();
		});

		describe("pushBatch", () => {
			it("should push a batch of operations as a single undo unit", () => {
				const ops: EditOperation[] = [
					{
						row: 0,
						col: 0,
						address: 0x100,
						oldValue: new Uint8Array([0x10]),
						newValue: new Uint8Array([0x20]),
						timestamp: Date.now(),
					},
					{
						row: 0,
						col: 1,
						address: 0x101,
						oldValue: new Uint8Array([0x30]),
						newValue: new Uint8Array([0x40]),
						timestamp: Date.now(),
					},
				];

				manager.pushBatch(ops, "Math op: add");

				expect(manager.canUndo()).toBe(true);
				expect(manager.isAtInitialState()).toBe(false);
			});

			it("should not push empty batch", () => {
				manager.pushBatch([], "Empty batch");

				expect(manager.canUndo()).toBe(false);
				expect(manager.isAtInitialState()).toBe(true);
			});

			it("should clear redo stack when batch is pushed", () => {
				// Push a single op and undo it to populate redo stack
				manager.push({
					row: 0,
					col: 0,
					oldValue: new Uint8Array([0x10]),
					newValue: new Uint8Array([0x20]),
					timestamp: Date.now(),
				});
				manager.undo();
				expect(manager.canRedo()).toBe(true);

				// Push a batch — should clear redo stack
				manager.pushBatch(
					[
						{
							row: 0,
							col: 0,
							address: 0x100,
							oldValue: new Uint8Array([0x10]),
							newValue: new Uint8Array([0x20]),
							timestamp: Date.now(),
						},
					],
					"Math op",
				);

				expect(manager.canRedo()).toBe(false);
			});
		});

		describe("batch undo", () => {
			it("should undo all ops in a batch as a single unit", () => {
				const romBytes = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
				const ops: EditOperation[] = [
					{
						row: 0,
						col: 0,
						address: 0,
						oldValue: new Uint8Array([0x10]),
						newValue: new Uint8Array([0xaa]),
						timestamp: Date.now(),
					},
					{
						row: 0,
						col: 1,
						address: 1,
						oldValue: new Uint8Array([0x20]),
						newValue: new Uint8Array([0xbb]),
						timestamp: Date.now(),
					},
				];

				// Apply the math op
				for (const op of ops) {
					romBytes.set(op.newValue, op.address!);
				}
				manager.pushBatch(ops, "Math op: add");

				expect(romBytes[0]).toBe(0xaa);
				expect(romBytes[1]).toBe(0xbb);

				// Undo the batch
				const entry = manager.undo();
				expect(entry).not.toBeNull();
				expect(isBatchEdit(entry!)).toBe(true);

				if (entry && isBatchEdit(entry)) {
					// Revert all ops in reverse order
					for (const op of [...entry.ops].reverse()) {
						romBytes.set(op.oldValue, op.address!);
					}
				}

				expect(romBytes[0]).toBe(0x10);
				expect(romBytes[1]).toBe(0x20);
				// Unchanged bytes should remain
				expect(romBytes[2]).toBe(0x30);
				expect(romBytes[3]).toBe(0x40);
			});

			it("should move batch to redo stack after undo", () => {
				manager.pushBatch(
					[
						{
							row: 0,
							col: 0,
							address: 0x100,
							oldValue: new Uint8Array([0x10]),
							newValue: new Uint8Array([0x20]),
							timestamp: Date.now(),
						},
					],
					"Math op",
				);

				manager.undo();

				expect(manager.canUndo()).toBe(false);
				expect(manager.canRedo()).toBe(true);
				expect(manager.isAtInitialState()).toBe(true);
			});

			it("should redo a batch after undo", () => {
				const romBytes = new Uint8Array([0x10, 0x20]);
				const ops: EditOperation[] = [
					{
						row: 0,
						col: 0,
						address: 0,
						oldValue: new Uint8Array([0x10]),
						newValue: new Uint8Array([0xaa]),
						timestamp: Date.now(),
					},
					{
						row: 0,
						col: 1,
						address: 1,
						oldValue: new Uint8Array([0x20]),
						newValue: new Uint8Array([0xbb]),
						timestamp: Date.now(),
					},
				];

				// Apply math op
				for (const op of ops) {
					romBytes.set(op.newValue, op.address!);
				}
				manager.pushBatch(ops, "Math op: add");

				// Undo
				const undoEntry = manager.undo();
				if (undoEntry && isBatchEdit(undoEntry)) {
					for (const op of [...undoEntry.ops].reverse()) {
						romBytes.set(op.oldValue, op.address!);
					}
				}
				expect(romBytes[0]).toBe(0x10);
				expect(romBytes[1]).toBe(0x20);

				// Redo
				const redoEntry = manager.redo();
				expect(redoEntry).not.toBeNull();
				expect(isBatchEdit(redoEntry!)).toBe(true);

				if (redoEntry && isBatchEdit(redoEntry)) {
					for (const op of redoEntry.ops) {
						romBytes.set(op.newValue, op.address!);
					}
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
				const batchOps: EditOperation[] = [];
				for (const edit of mathEdits) {
					const newValue = new Uint8Array(edit.after);
					const oldValue = romBytes.slice(
						edit.address,
						edit.address + newValue.length,
					);
					batchOps.push({
						row: 0,
						col: 0,
						address: edit.address,
						oldValue,
						newValue,
						timestamp: Date.now(),
						label: "Math op: add",
					});
					romBytes.set(newValue, edit.address);
				}
				manager.pushBatch(batchOps, "Math op: add (2 cells)");

				// Verify ROM was updated
				expect(romBytes[0]).toBe(0xaa);
				expect(romBytes[1]).toBe(0xbb);

				// Simulate undo
				const entry = manager.undo();
				expect(entry).not.toBeNull();
				expect(isBatchEdit(entry!)).toBe(true);

				if (entry && isBatchEdit(entry)) {
					for (const op of [...entry.ops].reverse()) {
						romBytes.set(op.oldValue, op.address!);
					}
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
				const batchOps: EditOperation[] = [];

				for (const edit of mathEdits) {
					const newValue = new Uint8Array(edit.after);
					batchOps.push({
						row: 0,
						col: 0,
						address: edit.address,
						oldValue: new Uint8Array(0),
						newValue,
						timestamp: Date.now(),
					});
				}
				manager.pushBatch(batchOps, "Math op: add (0 cells)");

				// No ops pushed — undo stack should be empty
				expect(manager.canUndo()).toBe(false);
				expect(manager.isAtInitialState()).toBe(true);
			});

			it("should interleave correctly with single cell edits", () => {
				const romBytes = new Uint8Array([0x10, 0x20, 0x30]);

				// Single cell edit
				const singleOldValue = romBytes.slice(0, 1);
				const singleNewValue = new Uint8Array([0x55]);
				romBytes.set(singleNewValue, 0);
				manager.push({
					row: 0,
					col: 0,
					address: 0,
					oldValue: singleOldValue,
					newValue: singleNewValue,
					timestamp: Date.now(),
					label: "Edit cell (0, 0)",
				});

				// Math op on cells 1 and 2
				const mathEdits = [
					{ address: 1, after: [0xaa] },
					{ address: 2, after: [0xbb] },
				];
				const batchOps: EditOperation[] = [];
				for (const edit of mathEdits) {
					const newValue = new Uint8Array(edit.after);
					const oldValue = romBytes.slice(
						edit.address,
						edit.address + newValue.length,
					);
					batchOps.push({
						row: 0,
						col: 0,
						address: edit.address,
						oldValue,
						newValue,
						timestamp: Date.now(),
					});
					romBytes.set(newValue, edit.address);
				}
				manager.pushBatch(batchOps, "Math op: add");

				expect(romBytes).toEqual(new Uint8Array([0x55, 0xaa, 0xbb]));

				// Undo math op (batch)
				const batchEntry = manager.undo();
				expect(isBatchEdit(batchEntry!)).toBe(true);
				if (batchEntry && isBatchEdit(batchEntry)) {
					for (const op of [...batchEntry.ops].reverse()) {
						romBytes.set(op.oldValue, op.address!);
					}
				}
				expect(romBytes).toEqual(new Uint8Array([0x55, 0x20, 0x30]));

				// Undo single cell edit
				const singleEntry = manager.undo();
				expect(isBatchEdit(singleEntry!)).toBe(false);
				if (singleEntry && !isBatchEdit(singleEntry)) {
					romBytes.set(singleEntry.oldValue, singleEntry.address!);
				}
				expect(romBytes).toEqual(new Uint8Array([0x10, 0x20, 0x30]));

				// Should be back to initial state
				expect(manager.isAtInitialState()).toBe(true);
			});
		});
	});
});
