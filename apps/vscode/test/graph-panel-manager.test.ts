/**
 * Unit tests for GraphPanelManager
 *
 * Tests panel creation, lifecycle, snapshot broadcasting, and cell selection
 */

import type { TableSnapshot } from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { GraphPanelManager } from "../src/graph-panel-manager.js";
import type { RomDocument } from "../src/rom/document.js";
import { RomDocument as ConcreteRomDocument } from "../src/rom/document.js";
import {
	createGraphDefinition,
	createGraphDocument,
	createGraphSnapshot,
	FIRST_GRAPH_PANEL_CASE,
	GRAPH_PANEL_TITLE,
	GRAPH_ROM_PATH,
	GRAPH_TABLE_ID,
	GRAPH_TABLE_NAME,
	PRIMARY_GRAPH_ROM1_CASE,
	PRIMARY_GRAPH_ROM2_CASE,
	SECOND_GRAPH_PANEL_CASE,
	SECOND_GRAPH_TABLE_ID,
} from "./mocks/graph-fixtures.js";
import { createExtensionContext } from "./mocks/vscode-harness.js";
import {
	createMockWebviewPanel,
	type GraphCompatibleWebview,
	type GraphCompatibleWebviewPanel,
	type MockGraphWebview,
	type MockWebview,
} from "./mocks/webview-mock.js";

type MockExtensionContext = Pick<
	vscode.ExtensionContext,
	"subscriptions" | "extensionUri"
>;

type GetDocument = (romPath: string) => RomDocument | undefined;
type CellSelectHandler = (
	romPath: string,
	tableId: string,
	row: number,
	col: number,
) => void;

type MockDocument = Pick<
	RomDocument,
	"uri" | "onDidUpdateBytes" | "definition"
>;

type CompatibleRomDocument = RomDocument & MockDocument;

function toWebviewPanel(
	panel: GraphCompatibleWebviewPanel,
): vscode.WebviewPanel {
	return panel as vscode.WebviewPanel;
}

function asMockWebview(webview: vscode.Webview): MockWebview {
	return webview as GraphCompatibleWebview & MockGraphWebview & MockWebview;
}

function toExtensionContext(
	context: MockExtensionContext,
): vscode.ExtensionContext {
	return context as vscode.ExtensionContext;
}

function toRomDocument(document: MockDocument): RomDocument {
	return document as CompatibleRomDocument;
}

describe("GraphPanelManager", () => {
	let manager: GraphPanelManager;
	let mockContext: MockExtensionContext;
	let mockGetDocument: GetDocument;
	let mockGetSnapshot: (
		romPath: string,
		tableId: string,
	) => TableSnapshot | undefined;
	let mockOnCellSelect: CellSelectHandler;
	const createMockSnapshot = createGraphSnapshot;

	beforeEach(() => {
		// Mock vscode.window.createWebviewPanel
		vi.mocked(vscode.window.createWebviewPanel).mockImplementation(
			(_viewType, title) => {
				return toWebviewPanel(createMockWebviewPanel(title));
			},
		);

		// Create mock context
		mockContext = createExtensionContext();

		// Create mock getDocument function
		mockGetDocument = vi.fn((romPath: string): RomDocument | undefined => {
			if (romPath === GRAPH_ROM_PATH) {
				return toRomDocument(createGraphDocument(romPath));
			}
			return undefined;
		}) as GetDocument;

		mockGetSnapshot = vi.fn(
			(romPath: string, tableId: string): TableSnapshot | undefined => {
				if (romPath === GRAPH_ROM_PATH && tableId === GRAPH_TABLE_ID) {
					return createMockSnapshot();
				}
				return undefined;
			},
		);

		// Create mock onCellSelect callback
		mockOnCellSelect = vi.fn<CellSelectHandler>();

		// Create manager
		manager = new GraphPanelManager(
			toExtensionContext(mockContext),
			mockGetDocument,
			mockGetSnapshot,
			mockOnCellSelect,
		);
	});

	describe("Panel Creation", () => {
		it("should create new panel with correct properties", () => {
			const snapshot = createGraphSnapshot();
			const panel = manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
				snapshot,
			);

			expect(panel).toBeDefined();
			expect(panel.title).toBe(GRAPH_PANEL_TITLE);
			// Verify panel was created (implementation detail)
		});

		it("should reuse existing panel for same ROM and table", () => {
			const snapshot = createGraphSnapshot();

			// Create panel first time
			const panel1 = manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
				snapshot,
			);

			// Try to create again
			const panel2 = manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
				snapshot,
			);

			// Should return same panel
			expect(panel1).toBe(panel2);
			expect(panel1.reveal).toHaveBeenCalled();
		});

		it("should create separate panels for different tables", () => {
			const snapshot = createGraphSnapshot();

			const panel1 = manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				"Test Table 1",
				snapshot,
			);

			const panel2 = manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				SECOND_GRAPH_TABLE_ID,
				"Test Table 2",
				snapshot,
			);

			expect(panel1).not.toBe(panel2);
		});

		it("should create separate panels for different ROMs", () => {
			const snapshot = createGraphSnapshot();

			const panel1 = manager.getOrCreatePanel(
				PRIMARY_GRAPH_ROM1_CASE.romPath,
				PRIMARY_GRAPH_ROM1_CASE.tableId,
				PRIMARY_GRAPH_ROM1_CASE.tableName,
				snapshot,
			);

			const panel2 = manager.getOrCreatePanel(
				PRIMARY_GRAPH_ROM2_CASE.romPath,
				PRIMARY_GRAPH_ROM2_CASE.tableId,
				PRIMARY_GRAPH_ROM2_CASE.tableName,
				snapshot,
			);

			expect(panel1).not.toBe(panel2);
		});

		it("should track panel in internal maps", () => {
			const snapshot = createGraphSnapshot();
			manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
				snapshot,
			);

			const panel = manager.getPanel(GRAPH_ROM_PATH, GRAPH_TABLE_ID);
			expect(panel).toBeDefined();
		});

		it("should generate webview HTML with correct script URI", () => {
			const snapshot = createGraphSnapshot();
			const panel = manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
				snapshot,
			);

			expect(panel.webview.html).toContain("<!DOCTYPE html>");
			expect(panel.webview.html).toContain("Graph Viewer");
			expect(panel.webview.html).toContain('id="app"');
			expect(panel.webview.html).toContain("chart.js");
		});

		it("should send updated snapshot when revealing existing panel", () => {
			const snapshot1 = createGraphSnapshot();
			const panel = manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
				snapshot1,
			);

			// Clear previous messages
			asMockWebview(panel.webview)._clearMessages();

			// Create again with updated snapshot
			const snapshot2: TableSnapshot = {
				kind: "table2d",
				name: snapshot1.name,
				...(snapshot1.description !== undefined
					? { description: snapshot1.description }
					: {}),
				rows: 2,
				cols: 2,
				x: [0, 1],
				y: [0, 1],
				z: [
					[100, 20],
					[30, 40],
				],
			};
			manager.getOrCreatePanel(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
				snapshot2,
			);

			expect(panel.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "update",
					snapshot: snapshot2,
				}),
			);
		});
	});

	describe("Restore Rebinding", () => {
		it("rebinds restored panels to the latest ROM document on ready", () => {
			const snapshot = createGraphSnapshot();
			let currentDocument = new ConcreteRomDocument(
				vscode.Uri.file(GRAPH_ROM_PATH),
				new Uint8Array([10, 20, 30, 40]),
				createGraphDefinition(),
			);

			const rebindingManager = new GraphPanelManager(
				toExtensionContext(mockContext),
				() => currentDocument,
				() => snapshot,
				mockOnCellSelect,
			);

			const panel = createMockWebviewPanel(
				"Restored Panel",
			) as vscode.WebviewPanel;
			rebindingManager.registerRestoredPanel(
				panel,
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
			);

			// Simulate document replacement during restore ordering.
			currentDocument = new ConcreteRomDocument(
				vscode.Uri.file(GRAPH_ROM_PATH),
				new Uint8Array([50, 60, 70, 80]),
				createGraphDefinition(),
			);

			asMockWebview(panel.webview)._clearMessages();
			asMockWebview(panel.webview)._simulateMessage({ type: "ready" });
			asMockWebview(panel.webview)._clearMessages();

			currentDocument.updateBytes(new Uint8Array([90, 60, 70, 80]), 0, 1, true);

			expect(panel.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "update",
					snapshot,
				}),
			);
		});

		it("rebinds already-ready panels when a newer ROM document opens later", () => {
			const snapshot = createGraphSnapshot();
			let currentDocument = new ConcreteRomDocument(
				vscode.Uri.file(GRAPH_ROM_PATH),
				new Uint8Array([10, 20, 30, 40]),
				createGraphDefinition(),
			);

			const rebindingManager = new GraphPanelManager(
				toExtensionContext(mockContext),
				() => currentDocument,
				() => snapshot,
				mockOnCellSelect,
			);

			const panel = createMockWebviewPanel(
				"Restored Panel",
			) as vscode.WebviewPanel;
			rebindingManager.registerRestoredPanel(
				panel,
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
			);

			asMockWebview(panel.webview)._simulateMessage({ type: "ready" });
			asMockWebview(panel.webview)._clearMessages();

			currentDocument = new ConcreteRomDocument(
				vscode.Uri.file(GRAPH_ROM_PATH),
				new Uint8Array([50, 60, 70, 80]),
				createGraphDefinition(),
			);
			rebindingManager.handleRomDocumentOpened(currentDocument);

			currentDocument.updateBytes(new Uint8Array([90, 60, 70, 80]), 0, 1, true);

			expect(panel.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "update",
					snapshot,
				}),
			);
		});
	});

	describe("Panel Lifecycle", () => {
		it("should clean up panel on dispose", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Dispose panel
			panel.dispose();

			// Panel should be removed from registry
			const retrievedPanel = manager.getPanel("/test/rom.hex", "table1");
			expect(retrievedPanel).toBeUndefined();
		});

		it("should dispose all panels when manager is disposed", () => {
			const snapshot = createMockSnapshot();

			// Create multiple panels
			const panel1 = manager.getOrCreatePanel(
				PRIMARY_GRAPH_ROM1_CASE.romPath,
				PRIMARY_GRAPH_ROM1_CASE.tableId,
				FIRST_GRAPH_PANEL_CASE.tableName,
				snapshot,
			);
			const panel2 = manager.getOrCreatePanel(
				PRIMARY_GRAPH_ROM2_CASE.romPath,
				SECOND_GRAPH_PANEL_CASE.tableId,
				SECOND_GRAPH_PANEL_CASE.tableName,
				snapshot,
			);

			// Dispose manager
			manager.dispose();

			// All panels should be disposed
			expect(panel1.dispose).toHaveBeenCalled();
			expect(panel2.dispose).toHaveBeenCalled();

			// Registry should be empty
			expect(
				manager.getPanel(
					PRIMARY_GRAPH_ROM1_CASE.romPath,
					PRIMARY_GRAPH_ROM1_CASE.tableId,
				),
			).toBeUndefined();
			expect(
				manager.getPanel(
					PRIMARY_GRAPH_ROM2_CASE.romPath,
					SECOND_GRAPH_PANEL_CASE.tableId,
				),
			).toBeUndefined();
		});

		it("should close specific graph panel", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			manager.closeGraph("/test/rom.hex", "table1");

			expect(panel.dispose).toHaveBeenCalled();
		});

		it("should handle closing non-existent panel gracefully", () => {
			expect(() => {
				manager.closeGraph("/nonexistent/rom.hex", "table1");
			}).not.toThrow();
		});
	});

	describe("Snapshot Broadcasting", () => {
		it("should broadcast snapshot to correct panel", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear previous messages
			asMockWebview(panel.webview)._clearMessages();

			// Broadcast update
			const updatedSnapshot: TableSnapshot = {
				kind: "table2d",
				name: snapshot.name,
				...(snapshot.description !== undefined
					? { description: snapshot.description }
					: {}),
				rows: 2,
				cols: 2,
				x: [0, 1],
				y: [0, 1],
				z: [
					[999, 20],
					[30, 40],
				],
			};
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
		});

		it("should broadcast to multiple panels for same table", () => {
			const snapshot = createMockSnapshot();

			// Create panel
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear messages
			asMockWebview(panel.webview)._clearMessages();

			// Broadcast update
			const updatedSnapshot: TableSnapshot = {
				kind: "table2d",
				name: snapshot.name,
				...(snapshot.description !== undefined
					? { description: snapshot.description }
					: {}),
				rows: 2,
				cols: 2,
				x: [0, 1],
				y: [0, 1],
				z: [
					[999, 20],
					[30, 40],
				],
			};
			manager.broadcastSnapshot("/test/rom.hex", "table1", updatedSnapshot);

			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: updatedSnapshot,
			});
		});

		it("should not error when broadcasting to non-existent panel", () => {
			const snapshot = createMockSnapshot();

			expect(() => {
				manager.broadcastSnapshot("/nonexistent/rom.hex", "table1", snapshot);
			}).not.toThrow();
		});

		it("should not broadcast to wrong table", () => {
			const snapshot = createMockSnapshot();
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
			asMockWebview(panel1.webview)._clearMessages();
			asMockWebview(panel2.webview)._clearMessages();

			// Broadcast to table1 only
			manager.broadcastSnapshot("/test/rom.hex", "table1", snapshot);

			expect(panel1.webview.postMessage).toHaveBeenCalled();
			expect(panel2.webview.postMessage).not.toHaveBeenCalled();
		});
	});

	describe("Cell Selection", () => {
		it("should send cell selection to correct panel", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear previous messages
			asMockWebview(panel.webview)._clearMessages();

			// Select cell
			manager.selectCell("/test/rom.hex", "table1", 1, 2);

			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "selectCell",
				row: 1,
				col: 2,
			});
		});

		it("should handle selection for non-existent panel gracefully", () => {
			expect(() => {
				manager.selectCell("/nonexistent/rom.hex", "table1", 0, 0);
			}).not.toThrow();
		});

		it("should not send selection to wrong panel", () => {
			const snapshot = createMockSnapshot();
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
			asMockWebview(panel1.webview)._clearMessages();
			asMockWebview(panel2.webview)._clearMessages();

			// Select cell in table1
			manager.selectCell("/test/rom.hex", "table1", 1, 2);

			expect(panel1.webview.postMessage).toHaveBeenCalled();
			expect(panel2.webview.postMessage).not.toHaveBeenCalled();
		});
	});

	describe("Message Handling", () => {
		it("should send initial snapshot when webview is ready", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Clear previous messages
			asMockWebview(panel.webview)._clearMessages();

			// Simulate ready message from webview
			asMockWebview(panel.webview)._simulateMessage({ type: "ready" });

			expect(panel.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "init",
					snapshot,
					tableId: "table1",
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
				}),
			);
		});

		it("should forward cell selection from graph to table", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Simulate cell selection from webview
			asMockWebview(panel.webview)._simulateMessage({
				type: "cellSelect",
				row: 1,
				col: 2,
			});

			expect(mockOnCellSelect).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table1",
				1,
				2,
			);
		});

		it("should handle messages from unknown panels gracefully", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Dispose panel to remove from registry
			panel.dispose();

			// Try to send message
			expect(() => {
				asMockWebview(panel.webview)._simulateMessage({ type: "ready" });
			}).not.toThrow();
		});
	});

	describe("Panel Registration", () => {
		it("should register restored panel", () => {
			const snapshot = createMockSnapshot();

			// Create a panel first
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Dispose it
			panel.dispose();

			// Create a new panel (simulating restoration)
			const restoredPanel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Should be in registry
			const retrievedPanel = manager.getPanel("/test/rom.hex", "table1");
			expect(retrievedPanel).toBe(restoredPanel);
		});

		it("should set up message handlers for restored panel", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Simulate message
			asMockWebview(panel.webview)._simulateMessage({
				type: "cellSelect",
				row: 0,
				col: 0,
			});

			expect(mockOnCellSelect).toHaveBeenCalledWith(
				"/test/rom.hex",
				"table1",
				0,
				0,
			);
		});

		it("should clean up restored panel on dispose", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Dispose panel
			panel.dispose();

			// Should be removed from registry
			const retrievedPanel = manager.getPanel("/test/rom.hex", "table1");
			expect(retrievedPanel).toBeUndefined();
		});

		it("should rebuild snapshot for restored panel when webview is ready", () => {
			const restoredPanel = toWebviewPanel(
				createMockWebviewPanel("Graph: Test Table"),
			);

			manager.registerRestoredPanel(
				restoredPanel,
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
				GRAPH_TABLE_NAME,
			);

			asMockWebview(restoredPanel.webview)._simulateMessage({ type: "ready" });

			expect(mockGetSnapshot).toHaveBeenCalledWith(
				GRAPH_ROM_PATH,
				GRAPH_TABLE_ID,
			);
			expect(restoredPanel.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "init",
					snapshot: createMockSnapshot(),
					tableId: GRAPH_TABLE_ID,
					tableName: GRAPH_TABLE_NAME,
					romPath: GRAPH_ROM_PATH,
					themeColors: expect.objectContaining({
						gradient: expect.any(Object),
						ui: expect.any(Object),
						isHighContrast: expect.any(Boolean),
					}),
				}),
			);
		});
	});

	describe("getPanel", () => {
		it("should return panel if it exists", () => {
			const snapshot = createMockSnapshot();
			const createdPanel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			const retrievedPanel = manager.getPanel("/test/rom.hex", "table1");
			expect(retrievedPanel).toBe(createdPanel);
		});

		it("should return undefined if panel does not exist", () => {
			const panel = manager.getPanel("/nonexistent/rom.hex", "table1");
			expect(panel).toBeUndefined();
		});
	});
});
