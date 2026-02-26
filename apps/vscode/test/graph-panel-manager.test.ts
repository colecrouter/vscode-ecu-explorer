/**
 * Unit tests for GraphPanelManager
 *
 * Tests panel creation, lifecycle, snapshot broadcasting, and cell selection
 */

import type { TableSnapshot } from "@ecu-explorer/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { GraphPanelManager } from "../src/graph-panel-manager";
import type { RomDocument } from "../src/rom/document";
import { createMockWebviewPanel } from "./mocks/webview-mock";

describe("GraphPanelManager", () => {
	let manager: GraphPanelManager;
	let mockContext: any;
	let mockGetDocument: any;
	let mockOnCellSelect: any;

	const createMockSnapshot = (): TableSnapshot => ({
		kind: "table2d",
		name: "Test Table",
		description: "Test description",
		rows: 2,
		cols: 2,
		x: [0, 1],
		y: [0, 1],
		z: [
			[10, 20],
			[30, 40],
		],
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
			if (romPath === "/test/rom.hex") {
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

		// Create mock onCellSelect callback
		mockOnCellSelect = vi.fn();

		// Create manager
		manager = new GraphPanelManager(
			mockContext,
			mockGetDocument,
			undefined,
			mockOnCellSelect,
		);
	});

	describe("Panel Creation", () => {
		it("should create new panel with correct properties", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			expect(panel).toBeDefined();
			expect(panel.title).toBe("Graph: Test Table");
			// Verify panel was created (implementation detail)
		});

		it("should reuse existing panel for same ROM and table", () => {
			const snapshot = createMockSnapshot();

			// Create panel first time
			const panel1 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Try to create again
			const panel2 = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Should return same panel
			expect(panel1).toBe(panel2);
			expect(panel1.reveal).toHaveBeenCalled();
		});

		it("should create separate panels for different tables", () => {
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

			expect(panel1).not.toBe(panel2);
		});

		it("should create separate panels for different ROMs", () => {
			const snapshot = createMockSnapshot();

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

			expect(panel1).not.toBe(panel2);
		});

		it("should track panel in internal maps", () => {
			const snapshot = createMockSnapshot();
			manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			const panel = manager.getPanel("/test/rom.hex", "table1");
			expect(panel).toBeDefined();
		});

		it("should generate webview HTML with correct script URI", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			expect(panel.webview.html).toContain("<!DOCTYPE html>");
			expect(panel.webview.html).toContain("Graph Viewer");
			expect(panel.webview.html).toContain('id="app"');
			expect(panel.webview.html).toContain("chart.js");
		});

		it("should send updated snapshot when revealing existing panel", () => {
			const snapshot1 = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot1,
			);

			// Clear previous messages
			(panel.webview as any)._clearMessages();

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
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot2,
			);

			expect(panel.webview.postMessage).toHaveBeenCalledWith({
				type: "update",
				snapshot: snapshot2,
			});
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
				"/test/rom1.hex",
				"table1",
				"Test Table 1",
				snapshot,
			);
			const panel2 = manager.getOrCreatePanel(
				"/test/rom2.hex",
				"table2",
				"Test Table 2",
				snapshot,
			);

			// Dispose manager
			manager.dispose();

			// All panels should be disposed
			expect(panel1.dispose).toHaveBeenCalled();
			expect(panel2.dispose).toHaveBeenCalled();

			// Registry should be empty
			expect(manager.getPanel("/test/rom1.hex", "table1")).toBeUndefined();
			expect(manager.getPanel("/test/rom2.hex", "table2")).toBeUndefined();
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
			(panel.webview as any)._clearMessages();

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
			(panel.webview as any)._clearMessages();

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
			(panel1.webview as any)._clearMessages();
			(panel2.webview as any)._clearMessages();

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
			(panel.webview as any)._clearMessages();

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
			(panel1.webview as any)._clearMessages();
			(panel2.webview as any)._clearMessages();

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
			(panel.webview as any)._clearMessages();

			// Simulate ready message from webview
			(panel.webview as any)._simulateMessage({ type: "ready" });

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

		it("should forward cell selection from graph to table", () => {
			const snapshot = createMockSnapshot();
			const panel = manager.getOrCreatePanel(
				"/test/rom.hex",
				"table1",
				"Test Table",
				snapshot,
			);

			// Simulate cell selection from webview
			(panel.webview as any)._simulateMessage({
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
				(panel.webview as any)._simulateMessage({ type: "ready" });
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
			(panel.webview as any)._simulateMessage({
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
