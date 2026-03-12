import type { TableDefinition } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import {
	createTableSessionId,
	TableEditSession,
} from "../src/history/table-edit-session.js";
import { RomDocument } from "../src/rom/document.js";

const TABLE_DEF: TableDefinition = {
	id: "test-table",
	name: "Test Table",
	kind: "table1d",
	rows: 4,
	z: {
		id: "test-table-z",
		name: "Values",
		address: 0,
		dtype: "u8",
	},
} as TableDefinition;

function makeSession() {
	const romDocument = new RomDocument(
		vscode.Uri.file("/test/rom.bin"),
		new Uint8Array([0x10, 0x20, 0x30, 0x40]),
	);
	const tableUri = vscode.Uri.parse(
		"ecu-table:/test/rom.bin?table=Test%20Table",
	);

	return new TableEditSession({
		id: createTableSessionId(tableUri),
		tableUri,
		tableDef: TABLE_DEF,
		romDocument,
	});
}

describe("TableEditSession", () => {
	it("uses the table URI string as the session id", () => {
		const tableUri = vscode.Uri.parse(
			"ecu-table:/test/rom.bin?table=Test%20Table",
		);

		expect(createTableSessionId(tableUri)).toBe(tableUri.toString());
	});

	it("owns an undo manager and can mark the current state as saved", () => {
		const session = makeSession();

		session.undoRedoManager.push({
			row: 0,
			col: 0,
			oldValue: new Uint8Array([0x10]),
			newValue: new Uint8Array([0xee]),
			timestamp: Date.now(),
		});
		expect(session.undoRedoManager.isAtSavePoint()).toBe(false);

		session.markSaved();

		expect(session.undoRedoManager.isAtSavePoint()).toBe(true);
	});

	it("tracks the current panel reference", () => {
		const session = makeSession();
		const panel = { webview: {} } as vscode.WebviewPanel;

		expect(session.activePanel).toBeNull();

		session.setPanel(panel);
		expect(session.activePanel).toBe(panel);

		session.clearPanel(panel);
		expect(session.activePanel).toBeNull();
	});

	it("creates a VS Code history executor for the underlying document", () => {
		const session = makeSession();
		const executor = session.createExecutor();

		const result = executor.apply({
			label: "edit",
			timestamp: Date.now(),
			edits: [
				{
					address: 1,
					before: new Uint8Array([0x20]),
					after: new Uint8Array([0xee]),
				},
			],
		});

		expect(Array.from(session.romDocument.romBytes)).toEqual([
			0x10, 0xee, 0x30, 0x40,
		]);
		expect(result.range).toEqual({ offset: 1, length: 1 });
	});

	it("records typed transactions into the backing undo manager", () => {
		const session = makeSession();

		session.recordTransaction({
			label: "Edit cell",
			timestamp: Date.now(),
			edits: [
				{
					address: 1,
					before: new Uint8Array([0x20]),
					after: new Uint8Array([0xee]),
					metadata: { row: 0, col: 1 },
				},
			],
		});

		expect(session.undoRedoManager.canUndo()).toBe(true);
		const entry = session.undoRedoManager.undo();
		expect(entry).not.toBeNull();
	});

	it("undoes through the session and returns an update message", () => {
		const session = makeSession();

		session.undoRedoManager.push({
			row: 0,
			col: 0,
			address: 1,
			oldValue: new Uint8Array([0x20]),
			newValue: new Uint8Array([0xee]),
			timestamp: Date.now(),
			label: "Edit cell",
		});
		session.romDocument.romBytes.set(new Uint8Array([0xee]), 1);
		session.romDocument.updateBytes(session.romDocument.romBytes, 1, 1, true);

		const result = session.undo();

		expect(result?.message.reason).toBe("undo");
		expect(Array.from(session.romDocument.romBytes)).toEqual([
			0x10, 0x20, 0x30, 0x40,
		]);
	});
});
