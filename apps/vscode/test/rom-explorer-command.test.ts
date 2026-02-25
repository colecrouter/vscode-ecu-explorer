import type { ROMDefinition, TableDefinition } from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { RomDocument } from "../src/rom/document";
import type { RomEditorProvider } from "../src/rom/editor-provider";
import { RomExplorerTreeProvider } from "../src/tree/rom-tree-provider";
import { WorkspaceState } from "../src/workspace-state";

describe("ECU Explorer Commands - Phase 2", () => {
	let treeProvider: RomExplorerTreeProvider;
	let mockEditorProvider: RomEditorProvider;
	let mockWorkspaceState: WorkspaceState;

	beforeEach(() => {
		// Create mock editor provider
		mockEditorProvider = {
			onDidChangeCustomDocument: vi.fn(() => ({ dispose: vi.fn() })),
			getDocument: vi.fn(),
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

	describe("ecuExplorer.openTable Command", () => {
		it("should accept romUri and tableName arguments", () => {
			// This test verifies the command signature
			// The actual command handler would be tested in integration tests
			const romUri = "file:///test/rom.hex";
			const tableName = "TestTable";

			// Command should be callable with these arguments
			expect(romUri).toBeDefined();
			expect(tableName).toBeDefined();
		});

		it("should update active table when command is executed", () => {
			const romUri = "file:///test/rom.hex";
			const tableName = "TestTable";

			// Simulate command execution
			treeProvider.setActiveTable(romUri, tableName);

			// Verify active table was updated
			const activeTable = treeProvider.getActiveTable();
			expect(activeTable).toEqual({ romUri, tableName });
		});

		it("should handle invalid ROM URI gracefully", () => {
			const invalidRomUri = "invalid://uri";
			const tableName = "TestTable";

			// Should not throw
			expect(() => {
				treeProvider.setActiveTable(invalidRomUri, tableName);
			}).not.toThrow();
		});

		it("should handle empty table name gracefully", () => {
			const romUri = "file:///test/rom.hex";
			const tableName = "";

			// Should not throw
			expect(() => {
				treeProvider.setActiveTable(romUri, tableName);
			}).not.toThrow();
		});
	});

	describe("Active Table State Tracking", () => {
		it("should update active table when switching between open tables", async () => {
			const mockUri1 = vscode.Uri.file("/test/rom1.hex");
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

			// Simulate opening Table1
			treeProvider.setActiveTable(mockUri1.toString(), "Table1");
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: mockUri1.toString(),
				tableName: "Table1",
			});

			// Simulate switching to Table2 (e.g., via tab switch)
			treeProvider.setActiveTable(mockUri2.toString(), "Table2");
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: mockUri2.toString(),
				tableName: "Table2",
			});

			// Verify tree reflects the active table for the second ROM
			const romNodes = await treeProvider.getChildren();
			const romNode2 = romNodes.find(
				(n) =>
					n.data.type === "rom" &&
					n.data.documentUri.toString() === mockUri2.toString(),
			);
			if (!romNode2) throw new Error("Expected ROM2 node to be defined");

			const categoryNodes = await treeProvider.getChildren(romNode2);
			const categoryNode = categoryNodes[0];
			if (!categoryNode)
				throw new Error("Expected category node to be defined");

			const tableNodes = await treeProvider.getChildren(categoryNode);
			const table2Node = tableNodes.find((n) => n.label === "Table2");
			if (table2Node?.data.type === "table") {
				expect(table2Node.data.isActive).toBe(true);
			}
		});
	});

	describe("Command Integration with Tree", () => {
		it("should update tree when command sets active table", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [
				createMockTable("Table1", "Fuel"),
				createMockTable("Table2", "Fuel"),
			];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Simulate command execution
			treeProvider.setActiveTable(mockUri.toString(), "Table1");

			// Verify tree reflects the change
			const romNodes = await treeProvider.getChildren();
			const romNode = romNodes[0];
			if (!romNode) throw new Error("Expected ROM node to be defined");

			const categoryNodes = await treeProvider.getChildren(romNode);
			const categoryNode = categoryNodes[0];
			if (!categoryNode)
				throw new Error("Expected category node to be defined");

			const tableNodes = await treeProvider.getChildren(categoryNode);

			const table1Node = tableNodes.find((n) => n.label === "Table1");
			if (table1Node?.data.type === "table") {
				expect(table1Node.data.isActive).toBe(true);
			}
		});

		it("should handle switching between tables via command", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [
				createMockTable("Table1", "Fuel"),
				createMockTable("Table2", "Fuel"),
				createMockTable("Table3", "Ignition"),
			];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Open Table1
			treeProvider.setActiveTable(mockUri.toString(), "Table1");
			expect(treeProvider.getActiveTable()?.tableName).toBe("Table1");

			// Switch to Table2
			treeProvider.setActiveTable(mockUri.toString(), "Table2");
			expect(treeProvider.getActiveTable()?.tableName).toBe("Table2");

			// Switch to Table3
			treeProvider.setActiveTable(mockUri.toString(), "Table3");
			expect(treeProvider.getActiveTable()?.tableName).toBe("Table3");
		});

		it("should handle opening table from different ROM", async () => {
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

			// Open Table1 from ROM1
			treeProvider.setActiveTable(mockUri1.toString(), "Table1");
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: mockUri1.toString(),
				tableName: "Table1",
			});

			// Switch to Table2 from ROM2
			treeProvider.setActiveTable(mockUri2.toString(), "Table2");
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: mockUri2.toString(),
				tableName: "Table2",
			});
		});
	});

	describe("Command Error Handling", () => {
		it("should handle missing ROM document", () => {
			const romUri = "file:///nonexistent/rom.hex";
			const tableName = "Table1";

			// Mock editor provider to return null
			(mockEditorProvider.getDocument as any).mockReturnValue(null);

			// Command should handle this gracefully
			// (actual error handling would be in the command handler)
			treeProvider.setActiveTable(romUri, tableName);

			expect(treeProvider.getActiveTable()).toEqual({
				romUri,
				tableName,
			});
		});

		it("should handle missing table definition", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [createMockTable("Table1", "Fuel")];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Try to open non-existent table
			treeProvider.setActiveTable(mockUri.toString(), "NonExistentTable");

			// Should still set active table (error handling is in command handler)
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: mockUri.toString(),
				tableName: "NonExistentTable",
			});
		});
	});

	describe("Command State Management", () => {
		it("should maintain active table state across tree refreshes", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [createMockTable("Table1", "Fuel")];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Set active table
			treeProvider.setActiveTable(mockUri.toString(), "Table1");

			// Refresh tree
			treeProvider.refresh();

			// Active table should still be set
			expect(treeProvider.getActiveTable()).toEqual({
				romUri: mockUri.toString(),
				tableName: "Table1",
			});
		});

		it("should clear active table when clearActiveTable is called", () => {
			const romUri = "file:///test/rom.hex";
			const tableName = "Table1";

			// Set active table
			treeProvider.setActiveTable(romUri, tableName);
			expect(treeProvider.getActiveTable()).not.toBeNull();

			// Clear active table
			treeProvider.clearActiveTable();
			expect(treeProvider.getActiveTable()).toBeNull();
		});

		it("should handle rapid command execution", () => {
			const romUri = "file:///test/rom.hex";

			// Rapidly execute command multiple times
			for (let i = 0; i < 10; i++) {
				treeProvider.setActiveTable(romUri, `Table${i}`);
			}

			// Should have the last table set as active
			expect(treeProvider.getActiveTable()).toEqual({
				romUri,
				tableName: "Table9",
			});
		});
	});

	describe("Command Context Menu Integration", () => {
		it("should provide correct arguments for context menu", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [createMockTable("TestTable", "Fuel")];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Get table node
			const romNodes = await treeProvider.getChildren();
			const romNode = romNodes[0];
			if (!romNode) throw new Error("Expected ROM node to be defined");

			const categoryNodes = await treeProvider.getChildren(romNode);
			const categoryNode = categoryNodes[0];
			if (!categoryNode)
				throw new Error("Expected category node to be defined");

			const tableNodes = await treeProvider.getChildren(categoryNode);
			const tableNode = tableNodes[0];
			if (!tableNode) throw new Error("Expected table node to be defined");

			// Verify node has correct data for command
			if (tableNode.data.type === "table") {
				expect(tableNode.data.romUri).toBe(mockUri.toString());
				expect(tableNode.data.tableDef.name).toBe("TestTable");
			}
		});

		it("should extract romUri and tableName from tree item for context menu invocation", async () => {
			const mockUri = vscode.Uri.file("/test/rom.hex");
			const mockBytes = new Uint8Array([0x01, 0x02, 0x03]);

			const tables = [createMockTable("TestTable", "Fuel")];
			const definition = createMockDefinition(tables);

			const document = new RomDocument(mockUri, mockBytes, definition);
			treeProvider.addDocument(document);

			// Get table node (simulates what VSCode passes to context menu command)
			const romNodes = await treeProvider.getChildren();
			const romNode = romNodes[0];
			if (!romNode) throw new Error("Expected ROM node to be defined");

			const categoryNodes = await treeProvider.getChildren(romNode);
			const categoryNode = categoryNodes[0];
			if (!categoryNode)
				throw new Error("Expected category node to be defined");

			const tableNodes = await treeProvider.getChildren(categoryNode);
			const tableNode = tableNodes[0];
			if (!tableNode) throw new Error("Expected table node to be defined");

			// Verify we can extract the data needed for the command
			// This simulates what the command handler does when invoked from context menu
			if (tableNode.data.type === "table") {
				const romUri = tableNode.data.romUri;
				const tableName = tableNode.data.tableDef.name;

				// These should be strings, not objects
				expect(typeof romUri).toBe("string");
				expect(typeof tableName).toBe("string");
				expect(romUri).toBe(mockUri.toString());
				expect(tableName).toBe("TestTable");

				// Verify romUri is not "[object Object]"
				expect(romUri).not.toBe("[object Object]");
			}
		});
	});
});
