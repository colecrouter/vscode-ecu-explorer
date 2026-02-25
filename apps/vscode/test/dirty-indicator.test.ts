/**
 * Tests for dirty indicator (●) correctness:
 * - Undo-to-clean state clears the dirty indicator
 * - Revert clears the dirty indicator
 *
 * These tests exercise RomDocument directly since the business logic
 * for dirty state lives there. The bugs were:
 *  A) handleUndo() called makeClean() then updateBytes() (markDirty=true)
 *     → re-dirtied the document immediately after cleaning it.
 *  B) revertCustomDocument() called updateBytes() (markDirty=true)
 *     then makeClean() → worked by accident but was semantically wrong.
 */

import type { TableDefinition } from "@ecu-explorer/core";
import { beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { RomDocument } from "../src/rom/document";
import { TableDocument } from "../src/table-document";

// Minimal vscode.Uri-compatible object
function makeUri(path: string) {
	return {
		fsPath: path,
		toString: () => `file://${path}`,
		scheme: "file",
	} as any;
}

describe("RomDocument dirty-state tracking", () => {
	let doc: RomDocument;
	const initialBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

	beforeEach(() => {
		doc = new RomDocument(makeUri("/test/rom.bin"), initialBytes.slice());
	});

	describe("updateBytes with markDirty=true (default)", () => {
		it("marks document dirty", () => {
			expect(doc.isDirty).toBe(false);
			doc.updateBytes(initialBytes.slice());
			expect(doc.isDirty).toBe(true);
		});
	});

	describe("updateBytes with markDirty=false", () => {
		it("does NOT mark document dirty", () => {
			expect(doc.isDirty).toBe(false);
			doc.updateBytes(initialBytes.slice(), undefined, undefined, false);
			expect(doc.isDirty).toBe(false);
		});

		it("updates the bytes without dirtying while document was previously dirty", () => {
			// First, make dirty via a normal edit
			doc.updateBytes(new Uint8Array([0xff, 0x02, 0x03, 0x04]));
			expect(doc.isDirty).toBe(true);

			// External watcher update passes markDirty=false — should keep bytes updated
			// but NOT change dirty flag (it's already dirty in this scenario)
			const externalBytes = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
			doc.updateBytes(externalBytes, undefined, undefined, false);
			expect(doc.isDirty).toBe(true); // still dirty (was dirty before)
		});
	});

	describe("Bug A fix: undo-to-initial-state does not re-dirty the document", () => {
		it("remains clean after makeClean() + updateBytes(markDirty=false)", () => {
			// Simulate: user made an edit → document is dirty
			doc.updateBytes(new Uint8Array([0xff, 0x02, 0x03, 0x04]));
			expect(doc.isDirty).toBe(true);

			// Simulate: user undoes back to initial state
			// handleUndo() does: makeClean() then updateBytes(..., !atInitial=false)
			doc.makeClean();
			expect(doc.isDirty).toBe(false);

			// updateBytes with markDirty=false (the fix) must NOT re-dirty
			doc.updateBytes(initialBytes.slice(), 0, 4, false);
			expect(doc.isDirty).toBe(false);
		});

		it("becomes dirty again when undo is partial (not at initial state)", () => {
			// Simulate two edits stacked
			doc.updateBytes(new Uint8Array([0xff, 0x02, 0x03, 0x04]));
			doc.updateBytes(new Uint8Array([0xff, 0xee, 0x03, 0x04]));
			expect(doc.isDirty).toBe(true);

			// Undo one edit (still dirty — not at initial state)
			// handleUndo() calls updateBytes(..., markDirty=!atInitial=true)
			doc.updateBytes(new Uint8Array([0xff, 0x02, 0x03, 0x04]), 1, 1, true);
			expect(doc.isDirty).toBe(true);
		});
	});

	describe("Scenario 3 (Save): makeClean() clears dirty indicator", () => {
		it("clears dirty after save (makeClean)", () => {
			// Simulate: user manually edited a cell → document got dirty
			doc.updateBytes(new Uint8Array([0xff, 0x02, 0x03, 0x04]));
			expect(doc.isDirty).toBe(true);

			// Simulate: user presses Cmd+S → saveCustomDocument() calls makeClean()
			doc.makeClean();

			expect(doc.isDirty).toBe(false);
		});
	});

	describe("Bug B fix: revert does not dirty the document", () => {
		it("remains clean after updateBytes(markDirty=false) + makeClean()", () => {
			// Simulate: user made an edit → document is dirty
			doc.updateBytes(new Uint8Array([0xff, 0x02, 0x03, 0x04]));
			expect(doc.isDirty).toBe(true);

			// Simulate revertCustomDocument() with the fix applied:
			// updateBytes(romBytes, undefined, undefined, false) → makeClean()
			const revertedBytes = initialBytes.slice();
			doc.updateBytes(revertedBytes, undefined, undefined, false);
			doc.makeClean();

			expect(doc.isDirty).toBe(false);
		});

		it("revert is clean even without an intermediate dirty state", () => {
			// Document starts clean; revert on a clean doc should stay clean
			expect(doc.isDirty).toBe(false);

			const revertedBytes = initialBytes.slice();
			doc.updateBytes(revertedBytes, undefined, undefined, false);
			doc.makeClean();

			expect(doc.isDirty).toBe(false);
		});
	});
});

/**
 * TableDocument dirty-propagation tests.
 *
 * These tests verify that:
 *  1. Editing Table A fires onDidChange on Table A's TableDocument.
 *  2. Editing Table A does NOT fire onDidChange on Table B's TableDocument.
 *  3. Saving (makeClean) fires onDidChange on all open TableDocuments.
 */
describe("TableDocument onDidChange selective propagation", () => {
	// Two non-overlapping table definitions in the same ROM
	const TABLE_A_DEF: TableDefinition = {
		name: "Table A",
		kind: "table1d",
		rows: 4,
		z: {
			name: "z",
			address: 0x0100,
			dtype: "u8",
		},
	} as TableDefinition;

	const TABLE_B_DEF: TableDefinition = {
		name: "Table B",
		kind: "table1d",
		rows: 4,
		z: {
			name: "z",
			address: 0x0200,
			dtype: "u8",
		},
	} as TableDefinition;

	let romDoc: RomDocument;
	let tableDocA: TableDocument;
	let tableDocB: TableDocument;
	// Use plain counters so there's no type incompatibility with the vs Event<void> signature
	let countA: number;
	let countB: number;

	beforeEach(() => {
		romDoc = new RomDocument(makeUri("/test/rom.bin"), new Uint8Array(0x1000));

		tableDocA = new TableDocument(
			vscode.Uri.parse("ecu-explorer://table?file=rom&table=A"),
			romDoc,
			"Table A",
			TABLE_A_DEF,
		);
		tableDocB = new TableDocument(
			vscode.Uri.parse("ecu-explorer://table?file=rom&table=B"),
			romDoc,
			"Table B",
			TABLE_B_DEF,
		);

		countA = 0;
		countB = 0;
		tableDocA.onDidChange(() => {
			countA++;
		});
		tableDocB.onDidChange(() => {
			countB++;
		});
	});

	it("editing Table A fires onDidChange on Table A", () => {
		// Simulate writeFile(): mutate bytes then call updateBytes with range info
		romDoc.updateBytes(
			romDoc.romBytes,
			TABLE_A_DEF.z.address,
			TABLE_A_DEF.rows, // 4 bytes (u8 × 4 rows)
		);

		expect(countA).toBe(1);
	});

	it("editing Table A does NOT fire onDidChange on Table B", () => {
		romDoc.updateBytes(
			romDoc.romBytes,
			TABLE_A_DEF.z.address,
			TABLE_A_DEF.rows,
		);

		expect(countB).toBe(0);
	});

	it("editing Table B fires onDidChange on Table B only", () => {
		romDoc.updateBytes(
			romDoc.romBytes,
			TABLE_B_DEF.z.address,
			TABLE_B_DEF.rows,
		);

		expect(countB).toBe(1);
		expect(countA).toBe(0);
	});

	it("saveCustomDocument (makeClean) fires onDidChange on ALL open table documents", () => {
		// First make ROM dirty (simulates a prior edit)
		romDoc.updateBytes(
			romDoc.romBytes,
			TABLE_A_DEF.z.address,
			TABLE_A_DEF.rows,
		);
		// Reset counters after the edit
		countA = 0;
		countB = 0;

		// Save: makeClean() should notify ALL listeners (both tabs need to clear ●)
		romDoc.makeClean();

		expect(countA).toBe(1);
		expect(countB).toBe(1);
	});

	it("revert (makeClean after markDirty=false updateBytes) fires onDidChange on all", () => {
		romDoc.updateBytes(
			romDoc.romBytes,
			TABLE_A_DEF.z.address,
			TABLE_A_DEF.rows,
		);
		// Reset counters after the edit
		countA = 0;
		countB = 0;

		// Revert: update bytes without dirtying, then clean
		romDoc.updateBytes(romDoc.romBytes, undefined, undefined, false);
		romDoc.makeClean();

		expect(countA).toBe(1);
		expect(countB).toBe(1);
	});
});

/**
 * Regression test for swapped-axis (swapxy) table2d dirty propagation.
 *
 * ECUFlash tables with swapped X/Y axes have colStrideBytes > rowStrideBytes.
 * The old getTableDataLength() returned rows * rowStride, which ONLY covers the
 * first column range — cells in higher columns fell outside the computed span,
 * causing the overlap check to always fail and the dirty indicator to never show.
 *
 * The fix uses the actual byte span: (rows-1)*rowStride + (cols-1)*colStride + width.
 */
describe("TableDocument swapped-axis (swapxy) dirty propagation regression", () => {
	// Simulates "Throttle Map #2" style ECUFlash table with swapped axes:
	//   rows=16, cols=49, colStrideBytes=32, rowStrideBytes=2, dtype=u16
	//   z.address=0x5130e
	const SWAPXY_TABLE_DEF = {
		name: "Throttle Map",
		kind: "table2d",
		rows: 16,
		cols: 49,
		z: {
			name: "z",
			address: 0x5130e,
			dtype: "u16",
			colStrideBytes: 32,
			rowStrideBytes: 2,
		},
	} as unknown as import("@ecu-explorer/core").TableDefinition;

	let romDoc: RomDocument;
	let throttleDoc: TableDocument;
	let count: number;

	beforeEach(() => {
		// ROM large enough to hold the table at 0x5130e + span(1568 bytes)
		romDoc = new RomDocument(
			{
				fsPath: "/test/rom.bin",
				toString: () => "file:///test/rom.bin",
				scheme: "file",
			} as any,
			new Uint8Array(0x60000),
		);
		throttleDoc = new TableDocument(
			vscode.Uri.parse("ecu-table://throttle?file=rom&table=throttle"),
			romDoc,
			"Throttle Map",
			SWAPXY_TABLE_DEF,
		);
		count = 0;
		throttleDoc.onDidChange(() => {
			count++;
		});
	});

	it("editing a cell in column 7 (address beyond rowStride range) fires onDidChange", () => {
		// Cell (row=0, col=7):  address = 0x5130e + 0*2 + 7*32 = 0x5130e + 224 = 0x513ee
		const cellAddress = 0x5130e + 0 * 2 + 7 * 32;
		// Confirm the address is beyond the old formula's range:
		// old tableLength = rows * rowStride = 16 * 2 = 32 → tableEnd = 0x5132e
		// cell 0x513ee > 0x5132e → old formula would MISS this cell
		expect(cellAddress).toBeGreaterThan(0x5130e + 16 * 2); // beyond old range

		romDoc.updateBytes(
			romDoc.romBytes,
			cellAddress,
			2, // u16 = 2 bytes
		);

		expect(count).toBe(1);
	});

	it("editing a cell in the last column (cols-1) fires onDidChange", () => {
		// Cell (row=0, col=48): address = 0x5130e + 0*2 + 48*32 = 0x5130e + 1536 = 0x5190e
		const cellAddress = 0x5130e + 0 * 2 + 48 * 32;
		romDoc.updateBytes(romDoc.romBytes, cellAddress, 2);
		expect(count).toBe(1);
	});

	it("editing an address outside the table does NOT fire onDidChange", () => {
		// The full span is (15*2 + 48*32 + 2) = 30 + 1536 + 2 = 1568 bytes
		// tableEnd = 0x5130e + 1568 = 0x5192e
		const outsideAddress = 0x5130e + 1568 + 10; // well beyond table end
		romDoc.updateBytes(romDoc.romBytes, outsideAddress, 2);
		expect(count).toBe(0);
	});
});
