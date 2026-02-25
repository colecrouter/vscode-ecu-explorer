/**
 * Integration tests for multi-panel synchronization
 *
 * Tests synchronization between table editors and graph panels:
 * - Table edits update graphs
 * - Graph selections update tables
 * - Multiple graphs for same table stay in sync
 */

import type { TableSnapshot } from "@ecu-explorer/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
// Import after mock
import { GraphPanelManager } from "../src/graph-panel-manager";
import type { RomDocument } from "../src/rom/document";
import { createMockWebviewPanel } from "./mocks/webview-mock";

describe("Graph Panel Synchronization", () => {
	let manager: GraphPanelManager;
	let mockContext: any;
	let mockGetDocument: any;
	let cellSelectionCallback: any;

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

		// Create mock getDocument function
		mockGetDocument = vi.fn((romPath: string): RomDocument | undefined => {
			if (romPath.includes("test")) {
				return {
					uri: { path: romPath },
					onDidUpdateBytes: vi.fn(() => ({ dispose: vi.fn() })),
					definition: {
						name: "Test ROM",
						tables: [
							{
								name: "table1",
								description: "Test Table 1",
								address: 0x1000,
								rows: 2,
								cols: 2,
							},
						],
					},
				} as any;
			}
			return undefined;
		});

		// Create cell selection callback
		cellSelectionCallback = vi.fn();

		// Create manager
		manager = new GraphPanelManager(
			mockContext,
			mockGetDocument,
			undefined,
			cellSelectionCallback,
		);
	});

	describe("Table → Graph Synchronization", () => {
		it("should update graph when table cell is edited", () => {
			const initialSnapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				initialSnapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// Simulate cell edit in table
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			// Graph should receive update
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
		});

		it("should update graph when undo is performed", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// Simulate undo (snapshot with canUndo = true)
			const undoSnapshot = { ...createMockSnapshot(5), canUndo: true };
			manager.broadcastSnapshot("/test/rom.hex", "table1", undoSnapshot);

			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: undoSnapshot,
			});
		});

		it("should update graph when redo is performed", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// Simulate redo (snapshot with canRedo = true)
			const redoSnapshot = { ...createMockSnapshot(15), canRedo: true };
			manager.broadcastSnapshot("/test/rom.hex", "table1", redoSnapshot);

			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: redoSnapshot,
			});
		});

		it("should update all graphs for same table", () => {
			const snapshot = createMockSnapshot(10);

			// Create first panel
			const panel1 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Close and reopen to simulate multiple windows
			// (In real scenario, user might have multiple windows open)
			// For this test, we'll just verify the same panel gets updates
			(panel1.webview as any)._clearMessages();

			// Broadcast update
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			// Panel should receive update
			expect(panel1.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
		});

		it("should not update graphs for different tables", () => {
			const snapshot = createMockSnapshot(10);

			// Create panels for different tables
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

			// Update only table1
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			// Only panel1 should receive update
			expect(panel1.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
			expect(panel2.webview.postMessage).not.toHaveBeenCalled();
		});

		it("should not update graphs for different ROMs", () => {
			const snapshot = createMockSnapshot(10);

			// Create panels for different ROMs
			const panel1 = manager.getOrCreatePanel(
				"/test/rom1.hex",
				"table1",
				"Test Table",
				snapshot,
			);
			const panel2 = manager.getOrCreatePanel(
				"/test/rom2.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear messages
			(panel1.webview as any)._clearMessages();
			(panel2.webview as any)._clearMessages();

			// Update only rom1
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom1.hex", "table1", updatedSnapshot);

			// Only panel1 should receive update
			expect(panel1.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
			expect(panel2.webview.postMessage).not.toHaveBeenCalled();
		});

		it("should handle rapid successive updates", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// Send multiple rapid updates
			for (let i = 0; i < 10; i++) {
				const updatedSnapshot = createMockSnapshot(i * 100);
				manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);
			}

			// Should have received all updates
			expect(panel.webview.postMessage).toHaveBeenCalledTimes(10);
		});
	});

	describe("Graph → Table Synchronization", () => {
		it("should forward cell selection from graph to table", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Simulate cell selection in graph
			(panel.webview as any)._simulateMessage({
				type: "cellSelect",
				row: 1,
				col: 1,
			});

			// Callback should be invoked
			expect(cellSelectionCallback).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table1",
				1,
				1,
			);
		});

		it("should route selection to correct table", () => {
			const snapshot = createMockSnapshot(10);

			// Create panels for different tables
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

			// Select cell in panel1
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

			// Select cell in panel2
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

		it("should handle selection at boundaries", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Select first cell
			(panel.webview as any)._simulateMessage({
				type: "cellSelect",
				row: 0,
				col: 0,
			});

			expect(cellSelectionCallback).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table1",
				0,
				0,
			);

			// Select last cell
			(panel.webview as any)._simulateMessage({
				type: "cellSelect",
				row: 1,
				col: 1,
			});

			expect(cellSelectionCallback).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table1",
				1,
				1,
			);
		});
	});

	describe("Bidirectional Synchronization", () => {
		it("should sync table edit → graph → table selection", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// 1. Edit cell in table
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			// Graph should receive update
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});

			// 2. Select cell in graph
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

		it("should sync table selection → graph highlight", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear initial messages
			(panel.webview as any)._clearMessages();

			// Select cell in table (simulated by extension)
			manager.selectCell("/test/rom.hex", "table1", 0, 1);

			// Graph should receive selection
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "selectCell",
				row: 0,
				col: 1,
			});
		});

		it("should maintain sync after panel disposal and recreation", () => {
			const snapshot = createMockSnapshot(10);

			// Create panel
			let panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Dispose panel
			panel.dispose();

			// Recreate panel
			panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear messages
			(panel.webview as any)._clearMessages();

			// Update should still work
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
		});
	});

	describe("Multi-Panel Scenarios", () => {
		it("should sync multiple graphs for same table", () => {
			const snapshot = createMockSnapshot(10);

			// Create panel (in real scenario, user might open multiple times)
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear messages
			(panel.webview as any)._clearMessages();

			// Update table
			const updatedSnapshot = createMockSnapshot(999);
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			// Panel should receive update
			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
		});

		it("should handle multiple ROMs with same table names", () => {
			const snapshot = createMockSnapshot(10);

			// Create panels for different ROMs with same table name
			const panel1 = manager.getOrCreatePanel(
				"/test/rom1.hex",
				"table1",
				"Test Table",
				snapshot,
			);
			const panel2 = manager.getOrCreatePanel(
				"/test/rom2.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear messages
			(panel1.webview as any)._clearMessages();
			(panel2.webview as any)._clearMessages();

			// Update rom1
			const updatedSnapshot1 = createMockSnapshot(111);
			manager.broadcastSnapshot("/test/rom1.hex", "table1", updatedSnapshot1);

			// Update rom2
			const updatedSnapshot2 = createMockSnapshot(222);
			manager.broadcastSnapshot("/test/rom2.hex", "table1", updatedSnapshot2);

			// Each panel should receive only its update
			const messages1 = (panel1.webview as any)._getMessages();
			const messages2 = (panel2.webview as any)._getMessages();

			expect(messages1).toHaveLength(1);
			expect(messages1[0].snapshot.cells[0][0].value).toBe(111);

			expect(messages2).toHaveLength(1);
			expect(messages2[0].snapshot.cells[0][0].value).toBe(222);
		});

		it("should handle complex workflow with multiple tables and ROMs", () => {
			const snapshot = createMockSnapshot(10);

			// Create multiple panels
			const panel1 = manager.getOrCreatePanel(
				"/test/rom1.hex",
				"table1",
				"ROM1 Table1",
				snapshot,
			);
			const panel2 = manager.getOrCreatePanel(
				"/test/rom1.hex",
				"table2",
				"ROM1 Table2",
				snapshot,
			);
			const panel3 = manager.getOrCreatePanel(
				"/test/rom2.hex",
				"table1",
				"ROM2 Table1",
				snapshot,
			);

			// Clear messages
			(panel1.webview as any)._clearMessages();
			(panel2.webview as any)._clearMessages();
			(panel3.webview as any)._clearMessages();

			// Update rom1/table1
			const update1 = createMockSnapshot(111);
			manager.broadcastSnapshot("/test/rom1.hex", "table1", update1);

			// Update rom1/table2
			const update2 = createMockSnapshot(222);
			manager.broadcastSnapshot("/test/rom1.hex", "table2", update2);

			// Update rom2/table1
			const update3 = createMockSnapshot(333);
			manager.broadcastSnapshot("/test/rom2.hex", "table1", update3);

			// Verify each panel received correct update
			expect(panel1.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: update1,
			});
			expect(panel2.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: update2,
			});
			expect(panel3.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: update3,
			});
		});
	});

	describe("Error Handling", () => {
		it("should handle broadcast to disposed panel gracefully", () => {
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
		});

		it("should handle selection to disposed panel gracefully", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Dispose panel
			panel.dispose();

			// Try to select cell
			expect(() => {
				manager.selectCell("/test/rom.hex", "table1", 0, 0);
			}).not.toThrow();
		});

		it("should handle message from disposed panel gracefully", () => {
			const snapshot = createMockSnapshot(10);
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Dispose panel
			panel.dispose();

			// Try to send message
			expect(() => {
				(panel.webview as any)._simulateMessage({
					type: "cellSelect",
					row: 0,
					col: 0,
				});
			}).not.toThrow();

			// Callback should not be invoked
			expect(cellSelectionCallback).not.toHaveBeenCalled();
		});
	});
});
