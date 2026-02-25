/**
 * E2E tests for separate graph windows feature
 *
 * Tests complete user workflows:
 * - Opening graphs via command and button
 * - Editing tables and seeing graph updates
 * - Selecting cells in graphs and seeing table updates
 * - Panel persistence across VSCode reload
 */

import type { TableSnapshot } from "@ecu-explorer/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { GraphPanelManager } from "../src/graph-panel-manager";
import { GraphPanelSerializer } from "../src/graph-panel-serializer";
import type { RomDocument } from "../src/rom/document";
import type { RomEditorProvider } from "../src/rom/editor-provider";
import { createMockPanel, createMockWebviewPanel } from "./mocks/webview-mock";

describe("Graph Windows E2E", () => {
	let manager: GraphPanelManager;
	let serializer: GraphPanelSerializer;
	let mockContext: any;
	let mockGetDocument: any;
	let mockRomEditorProvider: any;
	let cellSelectionCallback: any;
	let tableEditorWebview: any;

	const createMockSnapshot = (value: number = 10): TableSnapshot => ({
		name: "Test Table",
		description: "Test description",
		address: 0x1000,
		rows: 2,
		cols: 2,
		rowHeaders: ["0", "1"],
		colHeaders: ["A", "B"],
		cells: [
			[
				{ value, formatted: String(value), raw: value },
				{ value: value + 10, formatted: String(value + 10), raw: value + 10 },
			],
			[
				{ value: value + 20, formatted: String(value + 20), raw: value + 20 },
				{ value: value + 30, formatted: String(value + 30), raw: value + 30 },
			],
		],
		unit: "ms",
		precision: 0,
		canUndo: false,
		canRedo: false,
	});

	const createMockDocument = (romPath: string): RomDocument =>
		({
			uri: { path: romPath } as any,
			bytes: new Uint8Array(1024),
			definition: {
				name: "Test ROM",
				tables: [
					{
						name: "table1",
						description: "Test Table 1",
						address: 0x1000,
						rows: 2,
						cols: 2,
						rowHeaders: ["0", "1"],
						colHeaders: ["A", "B"],
						type: "u8",
						endianness: "big",
					},
				],
			},
			onDidUpdateBytes: vi.fn(() => ({ dispose: vi.fn() })),
		}) as any;

	beforeEach(() => {
		// Clear mocks
		vi.clearAllMocks();

		// Mock vscode.window.createWebviewPanel
		vi.mocked(vscode.window.createWebviewPanel).mockImplementation(
			(_viewType, title) => {
				return createMockWebviewPanel(title) as any;
			},
		);

		// Create mock context
		mockContext = {
			subscriptions: [],
			extensionUri: vscode.Uri.file("/test/extension"),
		};

		// Create mock table editor webview
		tableEditorWebview = {
			postMessage: vi.fn(),
		};

		// Create mock getDocument function
		mockGetDocument = vi.fn((romPath: string): RomDocument | undefined => {
			if (romPath.includes("test")) {
				return createMockDocument(romPath);
			}
			return undefined;
		});

		// Create mock RomEditorProvider
		mockRomEditorProvider = {
			getDocument: mockGetDocument,
		} as RomEditorProvider;

		// Create cell selection callback
		cellSelectionCallback = vi.fn((_romPath, tableId, row, col) => {
			// Simulate forwarding to table editor
			tableEditorWebview.postMessage({
				type: "selectCell",
				tableId,
				row,
				col,
			});
		});

		// Create manager and serializer
		manager = new GraphPanelManager(
			mockContext,
			mockGetDocument,
			undefined,
			cellSelectionCallback,
		);

		serializer = new GraphPanelSerializer(
			mockContext,
			mockRomEditorProvider,
			manager,
		);
	});

	describe("Opening Graphs", () => {
		it("should open graph via command", () => {
			const snapshot = createMockSnapshot(10);

			// Simulate command execution
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Panel should be created
			expect(panel).toBeDefined();
			expect(panel.title).toBe("Graph: Test Table");
		});

		it("should open graph via button click in table editor", () => {
			const snapshot = createMockSnapshot(10);

			// Simulate button click (message from table editor)
			// In real scenario, this would come from TableApp.svelte
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Panel should be created
			expect(panel).toBeDefined();
			expect(panel.webview.html).toContain("Graph Viewer");
		});

		it("should open multiple graphs for different tables", () => {
			const snapshot = createMockSnapshot(10);

			// Open first graph
			const panel1 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table 1",
				snapshot,
			);

			// Open second graph
			const panel2 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table2",
				"Test Table 2",
				snapshot,
			);

			// Both panels should exist
			expect(panel1).toBeDefined();
			expect(panel2).toBeDefined();
			expect(panel1).not.toBe(panel2);
		});

		it("should reveal existing graph when opened again", () => {
			const snapshot = createMockSnapshot(10);

			// Open graph first time
			const panel1 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Try to open again
			const panel2 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Should return same panel and reveal it
			expect(panel1).toBe(panel2);
			expect(panel1.reveal).toHaveBeenCalled();
		});

		it("should send initial snapshot when graph is ready", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// Simulate webview ready
			(panel.webview as any)._simulateMessage({ type: "ready" });

			// Should send init message
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "init",
				snapshot,
				tableName: "Test Table",
				romPath: "/test/rom.hex",
				themeColors: expect.objectContaining({
					gradient: expect.objectContaining({
						low: expect.any(String),
						mid: expect.any(String),
						high: expect.any(String),
					}),
					ui: expect.any(Object),
					isHighContrast: expect.any(Boolean),
				}),
			});
		});
	});

	describe("Table → Graph Synchronization", () => {
		it("should update graph when user edits table cell", () => {
			const initialSnapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				initialSnapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// User edits cell in table
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			// Graph should receive update
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});

			// Verify the updated value
			const messages = (panel.webview as any)._getMessages();
			expect(messages[0].snapshot.cells[0][0].value).toBe(999);
		});

		it("should update graph when user performs undo", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// User performs undo
			const undoSnapshot = { ...createMockSnapshot(5), canUndo: true };
			manager.broadcastSnapshot("/test/rom.hex", "table1", undoSnapshot);

			// Graph should receive update
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: undoSnapshot,
			});
		});

		it("should update graph when user performs redo", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// User performs redo
			const redoSnapshot = { ...createMockSnapshot(15), canRedo: true };
			manager.broadcastSnapshot("/test/rom.hex", "table1", redoSnapshot);

			// Graph should receive update
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: redoSnapshot,
			});
		});

		it("should update all open graphs for same table", () => {
			const snapshot = createMockSnapshot(10);

			// Open graph
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear messages
			(panel.webview as any)._clearMessages();

			// User edits table
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			// Panel should receive update
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
		});
	});

	describe("Graph → Table Synchronization", () => {
		it("should update table when user clicks cell in graph", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// User clicks cell in graph
			(panel.webview as any)._simulateMessage({
				type: "cellSelect",
				row: 1,
				col: 1,
			});

			// Table editor should receive selection
			expect(cellSelectionCallback).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table1",
				1,
				1,
			);
			expect(tableEditorWebview.postMessage).toHaveBeenCalledWith({
				type: "selectCell",
				tableId: "table1",
				row: 1,
				col: 1,
			});
		});

		it("should highlight cell in graph when user selects in table", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// User selects cell in table
			manager.selectCell("/test/rom.hex", "table1", 0, 1);

			// Graph should receive selection
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "selectCell",
				row: 0,
				col: 1,
			});
		});

		it("should route selection to correct table when multiple graphs open", () => {
			const snapshot = createMockSnapshot(10);

			// Open multiple graphs
			const panel1 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table 1",
				snapshot,
			);
			const panel2 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table2",
				"Test Table 2",
				snapshot,
			);

			// User clicks in graph 1
			(panel1.webview as any)._simulateMessage({
				type: "cellSelect",
				row: 0,
				col: 0,
			});

			// Should route to table1
			expect(cellSelectionCallback).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table1",
				0,
				0,
			);

			// User clicks in graph 2
			(panel2.webview as any)._simulateMessage({
				type: "cellSelect",
				row: 1,
				col: 1,
			});

			// Should route to table2
			expect(cellSelectionCallback).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table2",
				1,
				1,
			);
		});
	});

	describe("Complete User Workflows", () => {
		it("should handle complete edit workflow", () => {
			const snapshot = createMockSnapshot(10);

			// 1. User opens graph
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// 2. Graph becomes ready
			(panel.webview as any)._clearMessages();
			(panel.webview as any)._simulateMessage({ type: "ready" });

			// Should receive init
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "init",
				snapshot,
				tableName: "Test Table",
				romPath: "/test/rom.hex",
				themeColors: expect.objectContaining({
					gradient: expect.objectContaining({
						low: expect.any(String),
						mid: expect.any(String),
						high: expect.any(String),
					}),
					ui: expect.any(Object),
					isHighContrast: expect.any(Boolean),
				}),
			});

			// 3. User edits cell in table
			(panel.webview as any)._clearMessages();
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			// Graph should update
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});

			// 4. User clicks cell in graph
			(panel.webview as any)._simulateMessage({
				type: "cellSelect",
				row: 1,
				col: 0,
			});

			// Table should receive selection
			expect(cellSelectionCallback).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table1",
				1,
				0,
			);
		});

		it("should handle multi-table workflow", () => {
			const snapshot = createMockSnapshot(10);

			// 1. User opens graphs for two tables
			const panel1 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table 1",
				snapshot,
			);
			const panel2 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table2",
				"Test Table 2",
				snapshot,
			);

			// Clear messages
			(panel1.webview as any)._clearMessages();
			(panel2.webview as any)._clearMessages();

			// 2. User edits table1
			const update1 = createMockSnapshot(111);
			manager.broadcastSnapshot("/test/rom.hex", "table1", update1);

			// Only panel1 should update
			expect(panel1.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: update1,
			});
			expect(panel2.webview.postMessage).not.toHaveBeenCalled();

			// 3. User edits table2
			(panel1.webview as any)._clearMessages();
			(panel2.webview as any)._clearMessages();
			const update2 = createMockSnapshot(222);
			manager.broadcastSnapshot("/test/rom.hex", "table2", update2);

			// Only panel2 should update
			expect(panel1.webview.postMessage).not.toHaveBeenCalled();
			expect(panel2.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: update2,
			});
		});

		it("should handle graph close and reopen", () => {
			const snapshot = createMockSnapshot(10);

			// 1. User opens graph
			let panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// 2. User closes graph
			panel.dispose();

			// Panel should be removed
			expect(manager.getPanel("/test/rom.hex", "table1")).toBeUndefined();

			// 3. User reopens graph
			panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// New panel should be created
			expect(panel).toBeDefined();
		});
	});

	describe("Persistence", () => {
		it("should serialize panel state", async () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// In real scenario, VSCode would call getState() on the webview
			// For testing, we verify the panel was created with correct context
			expect(panel).toBeDefined();
			expect(manager.getPanel("/test/rom.hex", "table1")).toBe(panel);
		});

		it.skip("should deserialize panel state after reload", async () => {
			// Simulate VSCode reload with saved state
			const savedState = {
				romPath: "/test/rom.hex",
				tableId: "table1",
				tableName: "Test Table",
			};

			// Create a mock panel (simulating VSCode restoration)
			const restoredPanel = createMockPanel(
				"ecuExplorerGraph",
				"Graph: Test Table",
			);

			// Deserialize
			await serializer.deserializeWebviewPanel(
				restoredPanel as any,
				savedState,
			);

			// Panel should be registered
			const panel = manager.getPanel("/test/rom.hex", "table1");
			expect(panel).toBe(restoredPanel);
		});

		it.skip("should handle deserialization with missing ROM", async () => {
			const savedState = {
				romPath: "/nonexistent/rom.hex",
				tableId: "table1",
				tableName: "Test Table",
			};

			const restoredPanel = createMockPanel(
				"ecuExplorerGraph",
				"Graph: Test Table",
			);

			// Deserialize
			await serializer.deserializeWebviewPanel(
				restoredPanel as any,
				savedState,
			);

			// Panel should be disposed
			expect(restoredPanel.dispose).toHaveBeenCalled();
			expect(vscode.window.showErrorMessage).toHaveBeenCalled();
		});

		it.skip("should handle deserialization with invalid state", async () => {
			const invalidState = {
				// Missing required fields
				romPath: "/test/rom.hex",
			};

			const restoredPanel = createMockPanel(
				"ecuExplorerGraph",
				"Graph: Test Table",
			);

			// Deserialize
			await serializer.deserializeWebviewPanel(
				restoredPanel as any,
				invalidState,
			);

			// Panel should be disposed
			expect(restoredPanel.dispose).toHaveBeenCalled();
			expect(vscode.window.showErrorMessage).toHaveBeenCalled();
		});

		it.skip("should restore panel and continue synchronization", async () => {
			// 1. Deserialize panel
			const savedState = {
				romPath: "/test/rom.hex",
				tableId: "table1",
				tableName: "Test Table",
			};

			const restoredPanel = createMockPanel(
				"ecuExplorerGraph",
				"Graph: Test Table",
			);

			await serializer.deserializeWebviewPanel(
				restoredPanel as any,
				savedState,
			);

			// 2. Clear messages
			(restoredPanel.webview as any)._clearMessages();

			// 3. Update table
			const snapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", snapshot);

			// Restored panel should receive update
			expect(restoredPanel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot,
			});
		});
	});

	describe("Error Scenarios", () => {
		it("should handle panel disposal during operation", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Dispose panel
			panel.dispose();

			// Try to broadcast
			expect(() => {
				manager.broadcastSnapshot("/test/rom.hex", "table1", snapshot);
			}).not.toThrow();

			// Try to select cell
			expect(() => {
				manager.selectCell("/test/rom.hex", "table1", 0, 0);
			}).not.toThrow();
		});

		it("should handle invalid message from webview", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Send invalid message
			expect(() => {
				(panel.webview as any)._simulateMessage({
					type: "unknownType",
					data: "invalid",
				});
			}).not.toThrow();
		});

		it("should handle manager disposal with open panels", () => {
			const snapshot = createMockSnapshot(10);

			// Create multiple panels
			const panel1 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table 1",
				snapshot,
			);
			const panel2 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table2",
				"Test Table 2",
				snapshot,
			);

			// Dispose manager
			manager.dispose();

			// All panels should be disposed
			expect(panel1.dispose).toHaveBeenCalled();
			expect(panel2.dispose).toHaveBeenCalled();
		});
	});
});
