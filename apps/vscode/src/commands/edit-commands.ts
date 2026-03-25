import { Parser } from "expr-eval";
import * as vscode from "vscode";
import type { TableEditSession } from "../history/table-edit-session.js";
import type { RomEditorProvider } from "../rom/editor-provider.js";

type EditCommandsTableSession = Pick<
	TableEditSession,
	"activePanel" | "tableDef" | "undo" | "redo"
>;

type EditCommandsEditorProvider = Pick<
	RomEditorProvider,
	"getPanelForDocument" | "getTableDocument"
>;

/**
 * Get references to extension state
 */
let getStateRefs:
	| (() => {
			activePanel: vscode.WebviewPanel | null;
			activeTableSession: EditCommandsTableSession | null;
			editorProvider: EditCommandsEditorProvider | null;
			getTableSessionForUri: (
				uri: vscode.Uri,
			) => EditCommandsTableSession | null;
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

function isCustomTabInput(
	input: unknown,
): input is { uri: vscode.Uri; viewType: string } {
	if (!input || typeof input !== "object") {
		return false;
	}

	const candidate = input as {
		uri?: unknown;
		viewType?: unknown;
	};

	return (
		typeof candidate.viewType === "string" &&
		typeof candidate.uri === "object" &&
		candidate.uri !== null
	);
}

function resolveActiveTableContext() {
	const state = getState();
	const activeTabInput =
		vscode.window.tabGroups?.activeTabGroup?.activeTab?.input;

	let panel =
		state.activeTableSession?.activePanel ?? state.activePanel ?? null;
	let tableSession = state.activeTableSession;

	if (isCustomTabInput(activeTabInput)) {
		const tableDoc = state.editorProvider?.getTableDocument(activeTabInput.uri);
		if (tableDoc) {
			panel =
				state.editorProvider?.getPanelForDocument(tableDoc.romDocument) ??
				panel;
			tableSession =
				state.getTableSessionForUri(activeTabInput.uri) ?? tableSession;

			return {
				panel,
				tableDef: tableDoc.tableDef,
				tableSession,
			};
		}
	}

	return {
		panel,
		tableDef: tableSession?.tableDef ?? null,
		tableSession,
	};
}

const formulaParser = new Parser({
	allowMemberAccess: false,
	operators: {
		add: true,
		concatenate: false,
		conditional: false,
		divide: true,
		factorial: false,
		logical: false,
		multiply: true,
		power: true,
		remainder: true,
		subtract: true,
		comparison: false,
		in: false,
		assignment: false,
	},
});

function validateNumberInput(value: string): string | null {
	const num = Number.parseFloat(value);
	return Number.isNaN(num) ? "Please enter a valid number" : null;
}

function validateFormulaInput(value: string): string | null {
	if (value.trim().length === 0) {
		return "Formula cannot be empty";
	}

	try {
		formulaParser.parse(value);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "Invalid formula";
	}
}

async function postScalarFormula(
	expression: string,
	panel: vscode.WebviewPanel,
): Promise<void> {
	await panel.webview.postMessage({
		type: "mathOp",
		operation: "formula",
		expression,
	});
}

async function promptForFormula(
	initialValue = "x",
): Promise<string | undefined> {
	return vscode.window.showInputBox({
		prompt:
			"Enter a formula using x, row, col, depth, or i (all zero-based except x)",
		placeHolder: "Examples: 42, x + 5, x + row, x + col * 2, x + depth * 10",
		value: initialValue,
		validateInput: validateFormulaInput,
	});
}

/**
 * Handle undo command
 * Integrates with VSCode's undo/redo system
 */
export function handleUndo(): void {
	const { panel, tableSession } = resolveActiveTableContext();

	if (!tableSession) {
		return;
	}

	const result = tableSession.undo();
	if (!result) {
		return;
	}

	if (panel) {
		panel.webview.postMessage(result.message);
	}
}

/**
 * Handle redo command
 * Integrates with VSCode's undo/redo system
 */
export function handleRedo(): void {
	const { panel, tableSession } = resolveActiveTableContext();

	if (!tableSession) {
		return;
	}

	const result = tableSession.redo();
	if (!result) {
		return;
	}

	if (panel) {
		panel.webview.postMessage(result.message);
	}
}

/**
 * Handle math operation: Add constant to selection
 */
export async function handleMathOpAdd(): Promise<void> {
	const { panel } = resolveActiveTableContext();

	if (!panel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const constant = await vscode.window.showInputBox({
		prompt: "Enter constant to add (can be negative)",
		placeHolder: "e.g., 5 or -10",
		validateInput: validateNumberInput,
	});

	if (constant === undefined) return;

	await postScalarFormula(`x + (${Number.parseFloat(constant)})`, panel);
}

/**
 * Handle math operation: Multiply selection by factor
 */
export async function handleMathOpMultiply(): Promise<void> {
	const { panel } = resolveActiveTableContext();

	if (!panel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const factor = await vscode.window.showInputBox({
		prompt: "Enter multiplication factor",
		placeHolder: "e.g., 1.5 or 0.5",
		validateInput: validateNumberInput,
	});

	if (factor === undefined) return;

	await postScalarFormula(`x * (${Number.parseFloat(factor)})`, panel);
}

/**
 * Handle math operation: Apply formula to selection
 */
export async function handleMathOpFormula(initialFormula = "x"): Promise<void> {
	const { panel } = resolveActiveTableContext();

	if (!panel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const expression = await promptForFormula(initialFormula);
	if (expression === undefined) {
		return;
	}

	await postScalarFormula(expression, panel);
}

/**
 * Handle math operation: Clamp selection to range
 */
export async function handleMathOpClamp(): Promise<void> {
	const { panel } = resolveActiveTableContext();

	if (!panel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const min = await vscode.window.showInputBox({
		prompt: "Enter minimum value",
		placeHolder: "e.g., 0",
		validateInput: (value) => {
			return validateNumberInput(value);
		},
	});

	if (min === undefined) return;

	const max = await vscode.window.showInputBox({
		prompt: "Enter maximum value",
		placeHolder: "e.g., 255",
		validateInput: (value) => {
			const numberValidation = validateNumberInput(value);
			if (numberValidation) return numberValidation;
			const num = Number.parseFloat(value);
			if (num < Number.parseFloat(min)) {
				return "Maximum must be greater than or equal to minimum";
			}
			return null;
		},
	});

	if (max === undefined) return;

	await panel.webview.postMessage({
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
	const { panel, tableDef } = resolveActiveTableContext();

	if (!panel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	if (!tableDef || tableDef.kind === "table1d") {
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

	await panel.webview.postMessage({
		type: "mathOp",
		operation: "smooth",
		kernelSize: Number.parseInt(kernelSize, 10),
		iterations: Number.parseInt(iterations, 10),
		boundaryMode: boundaryMode.value,
	});
}
