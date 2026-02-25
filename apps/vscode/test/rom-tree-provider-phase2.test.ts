import type { ROMDefinition, TableDefinition } from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { RomDocument } from "../src/rom/document";
import type { RomEditorProvider } from "../src/rom/editor-provider";
import { RomExplorerTreeProvider } from "../src/tree/rom-tree-provider";
import { WorkspaceState } from "../src/workspace-state";

describe("RomExplorerTreeProvider - Phase 2: Active Table Tracking", () => {
	let treeProvider: RomExplorerTreeProvider;
	let mockEditorProvider: RomEditorProvider;
	let mockWorkspaceState: WorkspaceState;

	beforeEach(() => {
		// Create mock editor provider
		mockEditorProvider = {
			onDidChangeCustomDocument: vi.fn(() => ({ dispose: vi.fn() })),
		} as any;

		// Create mock workspace state
		const mockMemento = {
			get: vi.fn(() => undefined),
			update: vi.fn(),
		} as any;
		mockWorkspaceState = new WorkspaceState(mockMemento);

		// Create tree provider
		treeProvider = new RomExplorerTreeProvider(
			mockEditorProvider,
			mockWorkspaceState,
		);
	});

	/**
	 * Helper to create a mock table definition
	 */
	function createMockTable(
		name: string,
		category?: string,
		kind: "table1d" | "table2d" | "table3d" = "table1d",
	): TableDefinition {
		const baseTable = {
			name,
			kind,
			rows: 10,
			z: {
				name: "z",
				address: 0x1000,
				dtype: "u8" as const,
			},
		};

		if (category) {
			return { ...baseTable, category } as any;
		}

		return baseTable as any;
	}

	/**
	 * Helper to create a mock ROM definition
	 */
	function createMockDefinition(tables: TableDefinition[]): ROMDefinition {
		return {
			uri: "file:///test/definition.xml",
			name: "Test Definition",
			fingerprints: [],
			platform: {},
			tables,
		};
	}

	describe("Active Table Tracking", () => {
		it("should set active table", () => {
			const romUri = "file:///test/rom.hex";
			const tableName = "TestTable";

			treeProvider.setActiveTable(romUri, tableName);

			const activeTable = treeProvider.getActiveTable();
			expect(activeTable).toEqual({ romUri, tableName });
		});

		it("should clear active table", () => {
			const romUri = "file:///test/rom.hex";
			const tableName = "TestTable";

			treeProvider.setActiveTable(romUri, tableName);
			expect(treeProvider.getActiveTable()).not.toBeNull();

			treeProvider.clearActiveTable();
			expect(treeProvider.getActiveTable()).toBeNull();
		});

		it("should return null when no active table is set", () => {
			expect(treeProvider.getActiveTable()).toBeNull();
		});

		it("should update active table when setActiveTable is called multiple times", () => {
			treeProvider.setActiveTable("file:///test/rom1.hex", "Table1");
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: "file:///test/rom1.hex",
				tableName: "Table1",
			});

			treeProvider.setActiveTable("file:///test/rom2.hex", "Table2");
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: "file:///test/rom2.hex",
				tableName: "Table2",
			});
		});
	});

	describe("Active Table Display in Tree", () => {
		it("should mark active table node with isActive flag", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [
				createMockTable("Table1", "Fuel"),
				createMockTable("Table2", "Fuel"),
			];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Set Table1 as active
			treeProvider.setActiveTable(mockUri.toString(), "Table1");

			// Get table nodes
			const romNodes = await treeProvider.getChildren();
			const firstRomNode = romNodes[0];
			if (!firstRomNode)
				throw new Error("Expected first ROM node to be defined");
			const categoryNodes = await treeProvider.getChildren(firstRomNode);
			const firstCategoryNode = categoryNodes[0];
			if (!firstCategoryNode)
				throw new Error("Expected first category node to be defined");
			const tableNodes = await treeProvider.getChildren(firstCategoryNode);

			// Find Table1 and Table2
			const table1Node = tableNodes.find((n) => n.label === "Table1");
			const table2Node = tableNodes.find((n) => n.label === "Table2");

			expect(table1Node?.data.type).toBe("table");
			if (table1Node?.data.type === "table") {
				expect(table1Node.data.isActive).toBe(true);
			}

			expect(table2Node?.data.type).toBe("table");
			if (table2Node?.data.type === "table") {
				expect(table2Node.data.isActive).toBe(false);
			}
		});

		it("should show checkmark icon for active table", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [createMockTable("Table1", "Fuel")];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Set Table1 as active
			treeProvider.setActiveTable(mockUri.toString(), "Table1");

			// Get table node
			const romNodes = await treeProvider.getChildren();
			const firstRomNode = romNodes[0];
			if (!firstRomNode)
				throw new Error("Expected first ROM node to be defined");
			const categoryNodes = await treeProvider.getChildren(firstRomNode);
			const firstCategoryNode = categoryNodes[0];
			if (!firstCategoryNode)
				throw new Error("Expected first category node to be defined");
			const tableNodes = await treeProvider.getChildren(firstCategoryNode);
			const tableNode = tableNodes[0];
			if (!tableNode) throw new Error("Expected table node to be defined");

			// Check that icon is set (checkmark for active table)
			expect(tableNode.iconPath).toBeDefined();
		});

		it("should update active table indicator when switching active tables", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [
				createMockTable("Table1", "Fuel"),
				createMockTable("Table2", "Fuel"),
			];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Set Table1 as active
			treeProvider.setActiveTable(mockUri.toString(), "Table1");

			let romNodes = await treeProvider.getChildren();
			const firstRomNode = romNodes[0];
			if (!firstRomNode)
				throw new Error("Expected first ROM node to be defined");
			let categoryNodes = await treeProvider.getChildren(firstRomNode);
			const firstCategoryNode = categoryNodes[0];
			if (!firstCategoryNode)
				throw new Error("Expected first category node to be defined");
			let tableNodes = await treeProvider.getChildren(firstCategoryNode);

			let table1Node = tableNodes.find((n) => n.label === "Table1");
			if (table1Node?.data.type === "table") {
				expect(table1Node.data.isActive).toBe(true);
			}

			// Switch to Table2
			treeProvider.setActiveTable(mockUri.toString(), "Table2");

			romNodes = await treeProvider.getChildren();
			const secondRomNode = romNodes[0];
			if (!secondRomNode) throw new Error("Expected ROM node to be defined");
			categoryNodes = await treeProvider.getChildren(secondRomNode);
			const secondCategoryNode = categoryNodes[0];
			if (!secondCategoryNode)
				throw new Error("Expected category node to be defined");
			tableNodes = await treeProvider.getChildren(secondCategoryNode);

			table1Node = tableNodes.find((n) => n.label === "Table1");
			const table2Node = tableNodes.find((n) => n.label === "Table2");

			if (table1Node?.data.type === "table") {
				expect(table1Node.data.isActive).toBe(false);
			}
			if (table2Node?.data.type === "table") {
				expect(table2Node.data.isActive).toBe(true);
			}
		});

		it("should handle multiple ROMs with different active tables", async () => {
			const mockUri1 = vscode.Uri.file("/test/rom1.hex") as any;
			const mockUri2 = vscode.Uri.file("/test/rom2.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables1 = [createMockTable("Table1", "Fuel")];
			const tables2 = [createMockTable("Table2", "Boost")];

			const definition1 = createMockDefinition(tables1);
			const definition2 = createMockDefinition(tables2);

			const document1 = new RomDocument(mockUri1, mockBytes, definition1);
			const document2 = new RomDocument(mockUri2, mockBytes, definition2);

			treeProvider.addDocument(document1);
			treeProvider.addDocument(document2);

			// Set Table1 in ROM1 as active
			treeProvider.setActiveTable(mockUri1.toString(), "Table1");

			// Get ROM1 tables
			const romNodes = await treeProvider.getChildren();
			const rom1Node = romNodes.find((n) => n.label === "rom1.hex");
			if (!rom1Node) throw new Error("rom1.hex node not found");
			const rom1Categories = await treeProvider.getChildren(rom1Node);
			const firstCategory = rom1Categories[0];
			if (!firstCategory) throw new Error("No categories found for rom1");
			const rom1Tables = await treeProvider.getChildren(firstCategory);

			const table1Node = rom1Tables[0];
			if (!table1Node) throw new Error("No tables found for rom1");
			if (table1Node.data.type === "table") {
				expect(table1Node.data.isActive).toBe(true);
			}

			// Get ROM2 tables (should not be active)
			const rom2Node = romNodes.find((n) => n.label === "rom2.hex");
			if (!rom2Node) throw new Error("rom2.hex node not found");
			const rom2Categories = await treeProvider.getChildren(rom2Node);
			const firstCategory2 = rom2Categories[0];
			if (!firstCategory2) throw new Error("No categories found for rom2");
			const rom2Tables = await treeProvider.getChildren(firstCategory2);

			const table2Node = rom2Tables[0];
			if (!table2Node) throw new Error("No tables found for rom2");
			if (table2Node.data.type === "table") {
				expect(table2Node.data.isActive).toBe(false);
			}
		});

		it("should clear active indicator when clearActiveTable is called", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [createMockTable("Table1", "Fuel")];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Set Table1 as active
			treeProvider.setActiveTable(mockUri.toString(), "Table1");

			let romNodes = await treeProvider.getChildren();
			const firstRomNode = romNodes[0];
			if (!firstRomNode)
				throw new Error("Expected first ROM node to be defined");
			let categoryNodes = await treeProvider.getChildren(firstRomNode);
			const firstCategoryNode = categoryNodes[0];
			if (!firstCategoryNode)
				throw new Error("Expected first category node to be defined");
			let tableNodes = await treeProvider.getChildren(firstCategoryNode);

			let tableNode = tableNodes[0];
			if (!tableNode) throw new Error("Expected table node to be defined");
			if (tableNode.data.type === "table") {
				expect(tableNode.data.isActive).toBe(true);
			}

			// Clear active table
			treeProvider.clearActiveTable();

			romNodes = await treeProvider.getChildren();
			const secondRomNode = romNodes[0];
			if (!secondRomNode) throw new Error("Expected ROM node to be defined");
			categoryNodes = await treeProvider.getChildren(secondRomNode);
			const secondCategoryNode = categoryNodes[0];
			if (!secondCategoryNode)
				throw new Error("Expected category node to be defined");
			tableNodes = await treeProvider.getChildren(secondCategoryNode);

			tableNode = tableNodes[0];
			if (!tableNode) throw new Error("Expected table node to be defined");
			if (tableNode.data.type === "table") {
				expect(tableNode.data.isActive).toBe(false);
			}
		});
	});

	describe("Tree Refresh on Active Table Change", () => {
		it("should trigger tree refresh when setActiveTable is called", () => {
			const refreshSpy = vi.fn();
			(treeProvider as any)._onDidChangeTreeData.fire = refreshSpy;

			treeProvider.setActiveTable("file:///test/rom.hex", "Table1");

			expect(refreshSpy).toHaveBeenCalled();
		});

		it("should trigger tree refresh when clearActiveTable is called", () => {
			const refreshSpy = vi.fn();
			(treeProvider as any)._onDidChangeTreeData.fire = refreshSpy;

			treeProvider.setActiveTable("file:///test/rom.hex", "Table1");
			refreshSpy.mockClear();

			treeProvider.clearActiveTable();

			expect(refreshSpy).toHaveBeenCalled();
		});
	});

	describe("Edge Cases", () => {
		it("should handle setting active table for non-existent ROM", () => {
			// Should not throw
			expect(() => {
				treeProvider.setActiveTable("file:///nonexistent/rom.hex", "Table1");
			}).not.toThrow();

			expect(treeProvider.getActiveTable()).toEqual({
				romUri: "file:///nonexistent/rom.hex",
				tableName: "Table1",
			});
		});

		it("should handle setting active table for non-existent table", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [createMockTable("Table1", "Fuel")];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Set non-existent table as active
			treeProvider.setActiveTable(mockUri.toString(), "NonExistentTable");

			// Should not throw and should set the active table
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: mockUri.toString(),
				tableName: "NonExistentTable",
			});

			// But no table nodes should be marked as active
			const romNodes = await treeProvider.getChildren();
			const firstRomNode = romNodes[0];
			if (!firstRomNode)
				throw new Error("Expected first ROM node to be defined");

			const categoryNodes = await treeProvider.getChildren(firstRomNode);
			const firstCategoryNode = categoryNodes[0];
			if (!firstCategoryNode)
				throw new Error("Expected first category node to be defined");
			const tableNodes = await treeProvider.getChildren(firstCategoryNode);

			for (const node of tableNodes) {
				if (node.data.type === "table") {
					expect(node.data.isActive).toBe(false);
				}
			}
		});

		it("should handle empty table list", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const definition = createMockDefinition([]);
			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Set active table (even though there are no tables)
			treeProvider.setActiveTable(mockUri.toString(), "Table1");

			expect(treeProvider.getActiveTable()).toEqual({
				romUri: mockUri.toString(),
				tableName: "Table1",
			});
		});
	});
});
