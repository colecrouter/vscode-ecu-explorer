import type { ROMDefinition, TableDefinition } from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { RomDocument } from "../src/rom/document";
import { TableDocument } from "../src/table-document";

describe("table-document", () => {
	let romDocument: RomDocument;
	let romUri: vscode.Uri;
	let romBytes: Uint8Array;
	let romDefinition: ROMDefinition;
	let tableDef: TableDefinition;

	beforeEach(() => {
		// Create mock ROM data
		romUri = vscode.Uri.file("/path/to/rom.hex");
		romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
		romDefinition = {
			name: "Test ROM",
			platform: "test",
			uri: "file:///test.xml",
			fingerprints: [],
			tables: [],
		} as ROMDefinition;

		// Create mock table definition
		tableDef = {
			name: "Fuel Map",
			kind: "table2d",
			rows: 10,
			z: {
				name: "z",
				address: 0x1000,
				dtype: "u8",
			},
		} as TableDefinition;

		// Create ROM document
		romDocument = new RomDocument(romUri, romBytes, romDefinition);
	});

	describe("constructor", () => {
		it("creates valid TableDocument instance", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc).toBeInstanceOf(TableDocument);
			expect(tableDoc.uri).toBe(tableUri);
			expect(tableDoc.romDocument).toBe(romDocument);
			expect(tableDoc.tableId).toBe("Fuel Map");
			expect(tableDoc.tableDef).toBe(tableDef);
		});

		it("properly references parent ROM document", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.romDocument).toBe(romDocument);
			expect(tableDoc.romDocument.uri).toBe(romUri);
			expect(tableDoc.romDocument.romBytes).toBe(romBytes);
			expect(tableDoc.romDocument.definition).toBe(romDefinition);
		});

		it("stores table ID correctly", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableId = "Fuel Map Primary";
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				tableId,
				tableDef,
			);

			expect(tableDoc.tableId).toBe(tableId);
		});

		it("stores table definition correctly", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.tableDef).toBe(tableDef);
			expect(tableDoc.tableDef.name).toBe("Fuel Map");
			expect(tableDoc.tableDef.kind).toBe("table2d");
		});
	});

	describe("uri property", () => {
		it("returns the correct table URI", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.uri).toBe(tableUri);
			expect(tableDoc.uri.scheme).toBe("ecu-explorer");
			expect(tableDoc.uri.authority).toBe("table");
		});

		it("maintains URI immutability", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			const uri1 = tableDoc.uri;
			const uri2 = tableDoc.uri;

			expect(uri1).toBe(uri2);
		});
	});

	describe("romDocument property", () => {
		it("returns the parent ROM document", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.romDocument).toBe(romDocument);
		});

		it("allows access to ROM data through parent", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.romDocument.romBytes).toBe(romBytes);
			expect(tableDoc.romDocument.definition).toBe(romDefinition);
		});
	});

	describe("tableId property", () => {
		it("returns the table ID", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.tableId).toBe("Fuel Map");
		});

		it("handles table IDs with special characters", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableId = "Fuel Map (Primary) [High Load]";
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				tableId,
				tableDef,
			);

			expect(tableDoc.tableId).toBe(tableId);
		});
	});

	describe("tableDef property", () => {
		it("returns the table definition", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.tableDef).toBe(tableDef);
		});

		it("provides access to table metadata", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.tableDef.name).toBe("Fuel Map");
			expect(tableDoc.tableDef.kind).toBe("table2d");
			expect(tableDoc.tableDef.rows).toBe(10);
		});
	});

	describe("isDirty property", () => {
		it("delegates to parent ROM document", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.isDirty).toBe(false);
			expect(tableDoc.isDirty).toBe(romDocument.isDirty);
		});

		it("reflects parent ROM dirty state changes", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			expect(tableDoc.isDirty).toBe(false);

			// Make ROM dirty
			romDocument.makeDirty();

			expect(tableDoc.isDirty).toBe(true);
			expect(tableDoc.isDirty).toBe(romDocument.isDirty);
		});

		it("reflects parent ROM clean state changes", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			// Make ROM dirty then clean
			romDocument.makeDirty();
			expect(tableDoc.isDirty).toBe(true);

			romDocument.makeClean();
			expect(tableDoc.isDirty).toBe(false);
		});
	});

	describe("multiple table documents", () => {
		it("allows multiple table documents for same ROM", () => {
			const tableUri1 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableUri2 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t2",
			);

			const tableDef2: TableDefinition = {
				name: "Ignition Map",
				kind: "table2d",
				rows: 8,
				z: {
					name: "z",
					address: 0x2000,
					dtype: "u8",
				},
			} as TableDefinition;

			const tableDoc1 = new TableDocument(
				tableUri1,
				romDocument,
				"Fuel Map",
				tableDef,
			);
			const tableDoc2 = new TableDocument(
				tableUri2,
				romDocument,
				"Ignition Map",
				tableDef2,
			);

			expect(tableDoc1.romDocument).toBe(romDocument);
			expect(tableDoc2.romDocument).toBe(romDocument);
			expect(tableDoc1.romDocument).toBe(tableDoc2.romDocument);
		});

		it("shares dirty state across table documents", () => {
			const tableUri1 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableUri2 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t2",
			);

			const tableDef2: TableDefinition = {
				name: "Ignition Map",
				kind: "table2d",
				rows: 8,
				z: {
					name: "z",
					address: 0x2000,
					dtype: "u8",
				},
			} as TableDefinition;

			const tableDoc1 = new TableDocument(
				tableUri1,
				romDocument,
				"Fuel Map",
				tableDef,
			);
			const tableDoc2 = new TableDocument(
				tableUri2,
				romDocument,
				"Ignition Map",
				tableDef2,
			);

			// Make ROM dirty
			romDocument.makeDirty();

			// Both table documents should reflect dirty state
			expect(tableDoc1.isDirty).toBe(true);
			expect(tableDoc2.isDirty).toBe(true);
		});

		it("maintains separate URIs for different tables", () => {
			const tableUri1 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableUri2 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t2",
			);

			const tableDef2: TableDefinition = {
				name: "Ignition Map",
				kind: "table2d",
				rows: 8,
				z: {
					name: "z",
					address: 0x2000,
					dtype: "u8",
				},
			} as TableDefinition;

			const tableDoc1 = new TableDocument(
				tableUri1,
				romDocument,
				"Fuel Map",
				tableDef,
			);
			const tableDoc2 = new TableDocument(
				tableUri2,
				romDocument,
				"Ignition Map",
				tableDef2,
			);

			expect(tableDoc1.uri).not.toBe(tableDoc2.uri);
			expect(tableDoc1.uri.toString()).not.toBe(tableDoc2.uri.toString());
		});

		it("maintains separate table IDs", () => {
			const tableUri1 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableUri2 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t2",
			);

			const tableDef2: TableDefinition = {
				name: "Ignition Map",
				kind: "table2d",
				rows: 8,
				z: {
					name: "z",
					address: 0x2000,
					dtype: "u8",
				},
			} as TableDefinition;

			const tableDoc1 = new TableDocument(
				tableUri1,
				romDocument,
				"Fuel Map",
				tableDef,
			);
			const tableDoc2 = new TableDocument(
				tableUri2,
				romDocument,
				"Ignition Map",
				tableDef2,
			);

			expect(tableDoc1.tableId).toBe("Fuel Map");
			expect(tableDoc2.tableId).toBe("Ignition Map");
			expect(tableDoc1.tableId).not.toBe(tableDoc2.tableId);
		});

		it("maintains separate table definitions", () => {
			const tableUri1 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableUri2 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t2",
			);

			const tableDef2: TableDefinition = {
				name: "Ignition Map",
				kind: "table2d",
				rows: 8,
				z: {
					name: "z",
					address: 0x2000,
					dtype: "u8",
				},
			} as TableDefinition;

			const tableDoc1 = new TableDocument(
				tableUri1,
				romDocument,
				"Fuel Map",
				tableDef,
			);
			const tableDoc2 = new TableDocument(
				tableUri2,
				romDocument,
				"Ignition Map",
				tableDef2,
			);

			expect(tableDoc1.tableDef).toBe(tableDef);
			expect(tableDoc2.tableDef).toBe(tableDef2);
			expect(tableDoc1.tableDef).not.toBe(tableDoc2.tableDef);
		});
	});

	describe("dispose", () => {
		it("fires onDidDispose event", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			const disposeSpy = vi.fn();
			tableDoc.onDidDispose(disposeSpy);

			tableDoc.dispose();

			expect(disposeSpy).toHaveBeenCalledTimes(1);
		});

		it("cleans up event emitters", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			const disposeSpy = vi.fn();
			tableDoc.onDidDispose(disposeSpy);

			tableDoc.dispose();

			// Disposing again should not fire event
			tableDoc.dispose();

			expect(disposeSpy).toHaveBeenCalledTimes(1);
		});

		it("does not affect parent ROM document", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			tableDoc.dispose();

			// ROM document should still be accessible
			expect(romDocument.romBytes).toBe(romBytes);
			expect(romDocument.definition).toBe(romDefinition);
		});

		it("allows multiple table documents to dispose independently", () => {
			const tableUri1 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableUri2 = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t2",
			);

			const tableDef2: TableDefinition = {
				name: "Ignition Map",
				kind: "table2d",
				rows: 8,
				z: {
					name: "z",
					address: 0x2000,
					dtype: "u8",
				},
			} as TableDefinition;

			const tableDoc1 = new TableDocument(
				tableUri1,
				romDocument,
				"Fuel Map",
				tableDef,
			);
			const tableDoc2 = new TableDocument(
				tableUri2,
				romDocument,
				"Ignition Map",
				tableDef2,
			);

			const disposeSpy1 = vi.fn();
			const disposeSpy2 = vi.fn();
			tableDoc1.onDidDispose(disposeSpy1);
			tableDoc2.onDidDispose(disposeSpy2);

			// Dispose first document
			tableDoc1.dispose();

			expect(disposeSpy1).toHaveBeenCalledTimes(1);
			expect(disposeSpy2).not.toHaveBeenCalled();

			// Dispose second document
			tableDoc2.dispose();

			expect(disposeSpy1).toHaveBeenCalledTimes(1);
			expect(disposeSpy2).toHaveBeenCalledTimes(1);
		});
	});

	describe("onDidDispose event", () => {
		it("allows subscribing to dispose event", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			const disposeSpy = vi.fn();
			const subscription = tableDoc.onDidDispose(disposeSpy);

			expect(subscription).toBeDefined();
			expect(typeof subscription.dispose).toBe("function");
		});

		it("allows multiple subscribers", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			const disposeSpy1 = vi.fn();
			const disposeSpy2 = vi.fn();
			tableDoc.onDidDispose(disposeSpy1);
			tableDoc.onDidDispose(disposeSpy2);

			tableDoc.dispose();

			expect(disposeSpy1).toHaveBeenCalledTimes(1);
			expect(disposeSpy2).toHaveBeenCalledTimes(1);
		});
	});

	describe("integration with ROM document lifecycle", () => {
		it("reflects ROM document updates", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			// Update ROM bytes
			const newBytes = new Uint8Array([0x05, 0x06, 0x07, 0x08]);
			romDocument.updateBytes(newBytes);

			expect(tableDoc.romDocument.romBytes).toBe(newBytes);
			expect(tableDoc.isDirty).toBe(true);
		});

		it("reflects ROM definition updates", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			// Update ROM definition
			const newDefinition: ROMDefinition = {
				name: "Updated ROM",
				platform: "test",
				uri: "file:///updated.xml",
				fingerprints: [],
				tables: [],
			} as ROMDefinition;
			romDocument.setDefinition(newDefinition);

			expect(tableDoc.romDocument.definition).toBe(newDefinition);
		});

		it("survives ROM document state changes", () => {
			const tableUri = vscode.Uri.parse(
				"ecu-explorer://table?file=test&table=t1",
			);
			const tableDoc = new TableDocument(
				tableUri,
				romDocument,
				"Fuel Map",
				tableDef,
			);

			// Make ROM dirty and clean multiple times
			romDocument.makeDirty();
			expect(tableDoc.isDirty).toBe(true);

			romDocument.makeClean();
			expect(tableDoc.isDirty).toBe(false);

			romDocument.makeDirty();
			expect(tableDoc.isDirty).toBe(true);

			// Table document should still be valid
			expect(tableDoc.tableId).toBe("Fuel Map");
			expect(tableDoc.tableDef).toBe(tableDef);
		});
	});
});
