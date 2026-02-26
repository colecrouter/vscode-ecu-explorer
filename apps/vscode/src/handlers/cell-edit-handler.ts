import {
	type RomInstance,
	type ScalarType,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import type * as vscode from "vscode";
import type { RomDocument } from "../rom/document";
import type { UndoRedoManager } from "../undo-redo-manager";

/**
 * Get references to extension state
 */
let getStateRefs:
	| (() => {
			activeRom: RomInstance | null;
			undoRedoManager: UndoRedoManager | null;
			getRomDocumentForPanel: (
				panel: vscode.WebviewPanel,
			) => RomDocument | undefined;
			decodeScalarBytes: (
				bytes: Uint8Array,
				dtype: ScalarType,
				endianness: "le" | "be",
			) => number;
			sizeOf: (dtype: ScalarType) => number;
	  })
	| null = null;

/**
 * Set the state reference getter for cell edit handler
 */
export function setCellEditHandlerContext(
	stateRefGetter: typeof getStateRefs extends null
		? never
		: typeof getStateRefs,
): void {
	getStateRefs = stateRefGetter;
}

/**
 * Helper to get state refs
 */
function getState() {
	if (!getStateRefs) {
		throw new Error("Cell edit handler context not initialized");
	}
	return getStateRefs();
}

/**
 * Calculate the byte address for a cell in the ROM
 *
 * @param def - Table definition
 * @param row - Row index
 * @param col - Column index
 * @returns Byte address in ROM
 */
function calculateCellAddress(
	def: TableDefinition,
	row: number,
	col: number,
): number {
	const { z } = def;
	const base = z.address ?? 0;
	const elementSize = getState().sizeOf(z.dtype);
	const colStride = z.colStrideBytes ?? elementSize;

	if (def.kind === "table1d") {
		const rowStride = z.rowStrideBytes ?? elementSize;
		return base + row * rowStride;
	}

	const t = def;
	const rowStride = z.rowStrideBytes ?? t.cols * colStride;
	return base + row * rowStride + col * colStride;
}

/**
 * Handle cell edit message from webview
 *
 * Processes cell edit messages from the table webview:
 * 1. Validates cell address is within ROM bounds
 * 2. Captures old value for undo support
 * 3. Records operation in undo stack
 * 4. Applies change to ROM bytes
 * 5. Marks RomDocument as dirty
 * 6. Sends confirmation back to webview
 *
 * @param msg - Cell edit message from webview
 * @param def - Table definition
 * @param panel - Webview panel
 */
export function handleCellEdit(
	msg: {
		type: string;
		row: number;
		col: number;
		depth?: number;
		value: Uint8Array;
		label?: string;
	},
	def: TableDefinition,
	panel: vscode.WebviewPanel,
): void {
	const state = getState();

	if (!state.activeRom || !state.undoRedoManager) {
		console.log("[DEBUG] handleCellEdit: Missing activeRom or undoRedoManager");
		return;
	}

	const { row, col, value, label } = msg;

	// Calculate address for the cell
	const address = calculateCellAddress(def, row, col);
	console.log(
		`[DEBUG] handleCellEdit: row=${row}, col=${col}, address=0x${address.toString(
			16,
		)}, romSize=${state.activeRom.bytes.length}`,
	);
	if (address < 0 || address >= state.activeRom.bytes.length) {
		panel.webview.postMessage({
			type: "error",
			message: `Cell address out of bounds: 0x${address.toString(16)}`,
		});
		return;
	}

	// Get old value
	const elementSize = state.sizeOf(def.z.dtype);
	const oldValue = state.activeRom.bytes.slice(address, address + elementSize);

	// Value is already encoded as Uint8Array from webview
	const newValue = new Uint8Array(value);

	console.log(
		`[DEBUG] handleCellEdit: oldValue=[${Array.from(oldValue)
			.map((b) => `0x${b.toString(16).padStart(2, "0")}`)
			.join(", ")}], newValue=[${Array.from(newValue)
			.map((b) => `0x${b.toString(16).padStart(2, "0")}`)
			.join(", ")}]`,
	);

	// Store operation in undo stack
	state.undoRedoManager.push({
		row,
		col,
		...(msg.depth !== undefined ? { depth: msg.depth } : {}),
		oldValue,
		newValue,
		timestamp: Date.now(),
		label: label || `Edit cell (${row}, ${col})`,
	});
	console.log(
		`[DEBUG] handleCellEdit: Pushed to undo stack, canUndo=${state.undoRedoManager.canUndo()}`,
	);

	// Apply change to ROM
	state.activeRom.bytes.set(newValue, address);

	// Mark the RomDocument as dirty (enables native ● marker)
	const document = state.getRomDocumentForPanel(panel);
	console.log(
		`[DEBUG] handleCellEdit: Got document=${!!document}, isDirty=${
			document?.isDirty
		}`,
	);
	if (document) {
		document.updateBytes(state.activeRom.bytes, address, newValue.length);
		console.log(
			`[DEBUG] handleCellEdit: Called updateBytes, isDirty=${document.isDirty}`,
		);
	}

	// Send confirmation back to webview
	const newSnapshot = snapshotTable(def, state.activeRom.bytes);
	const decodedValue = state.decodeScalarBytes(
		newValue,
		def.z.dtype,
		def.z.endianness ?? "le",
	);
	const scaledValue = decodedValue * (def.z.scale ?? 1) + (def.z.offset ?? 0);
	panel.webview.postMessage({
		type: "cellCommit",
		row,
		col,
		value: scaledValue,
		snapshot: newSnapshot,
	});
}
