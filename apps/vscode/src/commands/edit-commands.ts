import {
	calculateCellAddress,
	type RomInstance,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { RomDocument } from "../rom/document";
import type { UndoRedoManager } from "../undo-redo-manager";
import { isBatchEdit } from "../undo-redo-manager";

/**
 * Get references to extension state
 */
let getStateRefs:
	| (() => {
			activeRom: RomInstance | null;
			activePanel: vscode.WebviewPanel | null;
			activeTableDef: TableDefinition | null;
			undoRedoManager: UndoRedoManager | null;
			getRomDocumentForPanel: (
				panel: vscode.WebviewPanel,
			) => RomDocument | undefined;
	  })
	| null = null;

/**
 * Set the state reference getter for edit commands
 */
export function setEditCommandsContext(
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
		throw new Error("Edit commands context not initialized");
	}
	return getStateRefs();
}

/**
 * Handle undo command
 * Integrates with VSCode's undo/redo system
 */
export function handleUndo(): void {
	const state = getState();

	if (
		!state.undoRedoManager ||
		!state.activeRom ||
		!state.activePanel ||
		!state.activeTableDef
	) {
		return;
	}

	const entry = state.undoRedoManager.undo();
	if (!entry) return;

	const document = state.getRomDocumentForPanel(state.activePanel);

	if (isBatchEdit(entry)) {
		// Batch undo: revert all ops in reverse order
		let minAddress = Number.MAX_SAFE_INTEGER;
		let maxAddress = 0;
		for (const op of [...entry.ops].reverse()) {
			const address =
				op.address !== undefined
					? op.address
					: calculateCellAddress(state.activeTableDef, op.row, op.col);
			state.activeRom.bytes.set(op.oldValue, address);
			minAddress = Math.min(minAddress, address);
			maxAddress = Math.max(maxAddress, address + op.oldValue.length);
		}
		if (document) {
			const atInitial = state.undoRedoManager.isAtInitialState();
			if (atInitial) {
				document.makeClean();
			}
			document.updateBytes(
				state.activeRom.bytes,
				minAddress,
				maxAddress - minAddress,
				!atInitial,
			);
		}
	} else {
		// Single op undo
		const address =
			entry.address !== undefined
				? entry.address
				: calculateCellAddress(state.activeTableDef, entry.row, entry.col);

		// Revert ROM bytes
		state.activeRom.bytes.set(entry.oldValue, address);

		if (document) {
			// Check if we're back to the initial state (no changes)
			const atInitial = state.undoRedoManager.isAtInitialState();
			if (atInitial) {
				// Clear dirty state when back to initial state
				document.makeClean();
			}
			// Fire update event even if we're back to initial state, so other views sync
			document.updateBytes(
				state.activeRom.bytes,
				address,
				entry.oldValue.length,
				!atInitial,
			);
		}
	}
	// Note: If not at initial state, document remains dirty (no action needed)

	// Notify the active webview panel so its UI reflects the undo
	if (state.activePanel && state.activeTableDef && state.activeRom) {
		const newSnapshot = snapshotTable(
			state.activeTableDef,
			state.activeRom.bytes,
		);
		state.activePanel.webview.postMessage({
			type: "update",
			snapshot: newSnapshot,
			rom: Array.from(state.activeRom.bytes),
			reason: "undo",
		});
	}
}

/**
 * Handle redo command
 * Integrates with VSCode's undo/redo system
 */
export function handleRedo(): void {
	const state = getState();

	if (
		!state.undoRedoManager ||
		!state.activeRom ||
		!state.activePanel ||
		!state.activeTableDef
	)
		return;
	const entry = state.undoRedoManager.redo();
	if (!entry) return;

	const document = state.getRomDocumentForPanel(state.activePanel);

	if (isBatchEdit(entry)) {
		// Batch redo: apply all ops in forward order
		let minAddress = Number.MAX_SAFE_INTEGER;
		let maxAddress = 0;
		for (const op of entry.ops) {
			const address =
				op.address !== undefined
					? op.address
					: calculateCellAddress(state.activeTableDef, op.row, op.col);
			state.activeRom.bytes.set(op.newValue, address);
			minAddress = Math.min(minAddress, address);
			maxAddress = Math.max(maxAddress, address + op.newValue.length);
		}
		if (document) {
			// Always mark as dirty on redo (redo applies changes)
			document.updateBytes(
				state.activeRom.bytes,
				minAddress,
				maxAddress - minAddress,
				true,
			);
		}
	} else {
		// Single op redo
		const address =
			entry.address !== undefined
				? entry.address
				: calculateCellAddress(state.activeTableDef, entry.row, entry.col);

		// Apply ROM bytes
		state.activeRom.bytes.set(entry.newValue, address);

		// Mark the RomDocument as dirty (redo modifies the ROM)
		if (document) {
			document.updateBytes(
				state.activeRom.bytes,
				address,
				entry.newValue.length,
				true,
			);
		}
	}

	// Notify the active webview panel so its UI reflects the redo
	if (state.activePanel && state.activeTableDef && state.activeRom) {
		const newSnapshot = snapshotTable(
			state.activeTableDef,
			state.activeRom.bytes,
		);
		state.activePanel.webview.postMessage({
			type: "update",
			snapshot: newSnapshot,
			rom: Array.from(state.activeRom.bytes),
			reason: "redo",
		});
	}
}

/**
 * Handle math operation: Add constant to selection
 */
export async function handleMathOpAdd(): Promise<void> {
	const state = getState();

	if (!state.activePanel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const constant = await vscode.window.showInputBox({
		prompt: "Enter constant to add (can be negative)",
		placeHolder: "e.g., 5 or -10",
		validateInput: (value) => {
			const num = Number.parseFloat(value);
			return Number.isNaN(num) ? "Please enter a valid number" : null;
		},
	});

	if (constant === undefined) return;

	await state.activePanel.webview.postMessage({
		type: "mathOp",
		operation: "add",
		constant: Number.parseFloat(constant),
	});
}

/**
 * Handle math operation: Multiply selection by factor
 */
export async function handleMathOpMultiply(): Promise<void> {
	const state = getState();

	if (!state.activePanel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const factor = await vscode.window.showInputBox({
		prompt: "Enter multiplication factor",
		placeHolder: "e.g., 1.5 or 0.5",
		validateInput: (value) => {
			const num = Number.parseFloat(value);
			return Number.isNaN(num) ? "Please enter a valid number" : null;
		},
	});

	if (factor === undefined) return;

	await state.activePanel.webview.postMessage({
		type: "mathOp",
		operation: "multiply",
		factor: Number.parseFloat(factor),
	});
}

/**
 * Handle math operation: Clamp selection to range
 */
export async function handleMathOpClamp(): Promise<void> {
	const state = getState();

	if (!state.activePanel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const min = await vscode.window.showInputBox({
		prompt: "Enter minimum value",
		placeHolder: "e.g., 0",
		validateInput: (value) => {
			const num = Number.parseFloat(value);
			return Number.isNaN(num) ? "Please enter a valid number" : null;
		},
	});

	if (min === undefined) return;

	const max = await vscode.window.showInputBox({
		prompt: "Enter maximum value",
		placeHolder: "e.g., 255",
		validateInput: (value) => {
			const num = Number.parseFloat(value);
			if (Number.isNaN(num)) return "Please enter a valid number";
			if (num < Number.parseFloat(min)) {
				return "Maximum must be greater than or equal to minimum";
			}
			return null;
		},
	});

	if (max === undefined) return;

	await state.activePanel.webview.postMessage({
		type: "mathOp",
		operation: "clamp",
		min: Number.parseFloat(min),
		max: Number.parseFloat(max),
	});
}

/**
 * Handle math operation: Smooth selection (2D/3D only)
 */
export async function handleMathOpSmooth(): Promise<void> {
	const state = getState();

	if (!state.activePanel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	if (!state.activeTableDef || state.activeTableDef.kind === "table1d") {
		vscode.window.showErrorMessage(
			"Smooth operation is only available for 2D and 3D tables",
		);
		return;
	}

	const kernelSize = await vscode.window.showQuickPick(["3", "5", "7", "9"], {
		placeHolder: "Select kernel size",
		title: "Smooth Operation - Kernel Size",
	});

	if (kernelSize === undefined) return;

	const iterations = await vscode.window.showInputBox({
		prompt: "Enter number of iterations",
		placeHolder: "e.g., 1",
		value: "1",
		validateInput: (value) => {
			const num = Number.parseInt(value, 10);
			if (Number.isNaN(num) || num < 1) {
				return "Please enter a positive integer";
			}
			return null;
		},
	});

	if (iterations === undefined) return;

	const boundaryMode = await vscode.window.showQuickPick(
		[
			{ label: "Pad with zeros", value: "pad" },
			{ label: "Repeat edge values", value: "repeat" },
			{ label: "Mirror edge values", value: "mirror" },
		],
		{
			placeHolder: "Select boundary handling mode",
			title: "Smooth Operation - Boundary Mode",
		},
	);

	if (boundaryMode === undefined) return;

	await state.activePanel.webview.postMessage({
		type: "mathOp",
		operation: "smooth",
		kernelSize: Number.parseInt(kernelSize, 10),
		iterations: Number.parseInt(iterations, 10),
		boundaryMode: boundaryMode.value,
	});
}

/**
 * Get size of scalar type in bytes
 */
function sizeOf(dtype: string): number {
	switch (dtype) {
		case "u8":
		case "i8":
			return 1;
		case "u16":
		case "i16":
			return 2;
		case "u32":
		case "i32":
		case "f32":
			return 4;
		default:
			return 4;
	}
}
