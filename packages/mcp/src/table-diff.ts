import type { TableDefinition } from "@ecu-explorer/core";
import { buildMarkdownTable } from "./formatters/markdown.js";
import { formatTable } from "./formatters/table-formatter.js";
import { formatUnit } from "./formatters/unit.js";

export type DiffStatus =
	| "unchanged"
	| "changed"
	| "axis_changed"
	| "incompatible"
	| "base_only"
	| "target_only";

export type Portability = "safe" | "review" | "no";

export interface TableSnapshot {
	definition: TableDefinition;
	rows: number;
	cols: number;
	values: number[][];
	xAxisValues: number[];
	yAxisValues: number[];
}

export interface DiffMetrics {
	cellsChanged: number;
	maxAbsDelta: number;
	meanAbsDelta: number;
}

export interface TablePairAnalysis {
	status: DiffStatus;
	name: string;
	category: string;
	kind: string;
	unit: string;
	portability: Portability;
	baseTable?: TableDefinition | undefined;
	targetTable?: TableDefinition | undefined;
	baseSnapshot?: TableSnapshot | undefined;
	targetSnapshot?: TableSnapshot | undefined;
	metrics?: DiffMetrics | undefined;
	xAxisChanged?: boolean | undefined;
	yAxisChanged?: boolean | undefined;
	incompatibilityReason?: string | undefined;
}

export function buildDiffFrontmatterData(
	analysis: TablePairAnalysis,
): Record<string, unknown> {
	const frontmatterData: Record<string, unknown> = {
		table: analysis.name,
		kind: analysis.kind,
		rows: analysis.baseSnapshot?.rows ?? tableRows(analysis.baseTable),
		cols: analysis.baseSnapshot?.cols ?? tableCols(analysis.baseTable),
		status: analysis.status,
		portability: analysis.portability,
	};

	if (analysis.metrics !== undefined) {
		frontmatterData.cells_changed = analysis.metrics.cellsChanged;
		frontmatterData.max_abs_delta = analysis.metrics.maxAbsDelta;
		frontmatterData.mean_abs_delta = analysis.metrics.meanAbsDelta;
	}
	if (analysis.xAxisChanged !== undefined) {
		frontmatterData.x_axis_changed = analysis.xAxisChanged;
	}
	if (analysis.yAxisChanged !== undefined) {
		frontmatterData.y_axis_changed = analysis.yAxisChanged;
	}

	return frontmatterData;
}

export function formatDiffNumber(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	const s = n.toFixed(4);
	return s.replace(/\.?0+$/, "");
}

export function compareNumericArrays(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export function hasDuplicateNumbers(values: number[]): boolean {
	return new Set(values).size !== values.length;
}

export function compareValueGrids(a: number[][], b: number[][]): DiffMetrics {
	let cellsChanged = 0;
	let maxAbsDelta = 0;
	let totalAbsDelta = 0;

	for (let row = 0; row < a.length; row++) {
		const leftRow = a[row] ?? [];
		const rightRow = b[row] ?? [];
		for (let col = 0; col < leftRow.length; col++) {
			const left = leftRow[col];
			const right = rightRow[col];
			if (left === undefined || right === undefined) continue;
			if (left === right) continue;
			const delta = Math.abs(right - left);
			cellsChanged += 1;
			totalAbsDelta += delta;
			if (delta > maxAbsDelta) {
				maxAbsDelta = delta;
			}
		}
	}

	return {
		cellsChanged,
		maxAbsDelta,
		meanAbsDelta: cellsChanged === 0 ? 0 : totalAbsDelta / cellsChanged,
	};
}

export function portabilityForStatus(status: DiffStatus): Portability {
	switch (status) {
		case "changed":
		case "unchanged":
			return "safe";
		case "axis_changed":
		case "base_only":
		case "target_only":
			return "review";
		case "incompatible":
			return "no";
	}
}

export function sortWeight(status: DiffStatus): number {
	switch (status) {
		case "changed":
			return 0;
		case "axis_changed":
			return 1;
		case "incompatible":
			return 2;
		case "base_only":
		case "target_only":
			return 3;
		case "unchanged":
			return 4;
	}
}

export function findTableByName(
	tables: TableDefinition[],
	tableName: string,
): TableDefinition | undefined {
	const exact = tables.find((table) => table.name === tableName);
	if (exact) return exact;
	return tables.find(
		(table) => table.name.toLowerCase() === tableName.toLowerCase(),
	);
}

export function getTableSnapshot(
	romPath: string,
	table: TableDefinition,
	romBytes: Uint8Array,
): TableSnapshot | undefined {
	if (table.kind !== "table1d" && table.kind !== "table2d") {
		return undefined;
	}

	const formatted = formatTable(romPath, table, romBytes);
	return {
		definition: table,
		rows: formatted.rows,
		cols: formatted.cols,
		values: formatted.values,
		xAxisValues: formatted.xAxisValues,
		yAxisValues: formatted.yAxisValues,
	};
}

export function tableRows(
	table: TableDefinition | undefined,
): number | undefined {
	if (table === undefined) return undefined;
	return table.rows;
}

export function tableCols(
	table: TableDefinition | undefined,
): number | undefined {
	if (table === undefined) return undefined;
	return table.kind === "table2d" || table.kind === "table3d" ? table.cols : 1;
}

export function analyzeTablePair(
	name: string,
	baseRomPath: string,
	targetRomPath: string,
	baseTable: TableDefinition | undefined,
	targetTable: TableDefinition | undefined,
	baseBytes: Uint8Array,
	targetBytes: Uint8Array,
): TablePairAnalysis {
	const tableForMeta = baseTable ?? targetTable;
	const category = tableForMeta?.category ?? "";
	const kind = tableForMeta?.kind ?? "";
	const unit = formatUnit(tableForMeta?.z.unit);

	if (baseTable === undefined) {
		return {
			status: "target_only",
			name,
			category,
			kind,
			unit,
			portability: portabilityForStatus("target_only"),
			targetTable,
		};
	}

	if (targetTable === undefined) {
		return {
			status: "base_only",
			name,
			category,
			kind,
			unit,
			portability: portabilityForStatus("base_only"),
			baseTable,
		};
	}

	if (baseTable.kind !== targetTable.kind) {
		return {
			status: "incompatible",
			name,
			category,
			kind: `${baseTable.kind} vs ${targetTable.kind}`,
			unit,
			portability: portabilityForStatus("incompatible"),
			baseTable,
			targetTable,
			incompatibilityReason: `different kinds: ${baseTable.kind} vs ${targetTable.kind}`,
		};
	}

	if (baseTable.kind === "table1d" && baseTable.rows !== targetTable.rows) {
		return {
			status: "incompatible",
			name,
			category,
			kind,
			unit,
			portability: portabilityForStatus("incompatible"),
			baseTable,
			targetTable,
			incompatibilityReason: `different dimensions: ${baseTable.rows} vs ${targetTable.rows}`,
		};
	}

	if (
		baseTable.kind === "table2d" &&
		targetTable.kind === "table2d" &&
		(baseTable.rows !== targetTable.rows || baseTable.cols !== targetTable.cols)
	) {
		return {
			status: "incompatible",
			name,
			category,
			kind,
			unit,
			portability: portabilityForStatus("incompatible"),
			baseTable,
			targetTable,
			incompatibilityReason: `different dimensions: ${baseTable.rows}x${baseTable.cols} vs ${targetTable.rows}x${targetTable.cols}`,
		};
	}

	const baseSnapshot = getTableSnapshot(baseRomPath, baseTable, baseBytes);
	const targetSnapshot = getTableSnapshot(
		targetRomPath,
		targetTable,
		targetBytes,
	);

	if (baseSnapshot === undefined || targetSnapshot === undefined) {
		return {
			status: "incompatible",
			name,
			category,
			kind,
			unit,
			portability: portabilityForStatus("incompatible"),
			baseTable,
			targetTable,
			incompatibilityReason: "only 1D and 2D tables are comparable in v1",
		};
	}

	if (
		baseSnapshot.rows !== targetSnapshot.rows ||
		baseSnapshot.cols !== targetSnapshot.cols
	) {
		return {
			status: "incompatible",
			name,
			category,
			kind,
			unit,
			portability: portabilityForStatus("incompatible"),
			baseTable,
			targetTable,
			baseSnapshot,
			targetSnapshot,
			incompatibilityReason: "decoded table shapes differ",
		};
	}

	const xAxisChanged = !compareNumericArrays(
		baseSnapshot.xAxisValues,
		targetSnapshot.xAxisValues,
	);
	const yAxisChanged = !compareNumericArrays(
		baseSnapshot.yAxisValues,
		targetSnapshot.yAxisValues,
	);
	const metrics = compareValueGrids(baseSnapshot.values, targetSnapshot.values);

	if (xAxisChanged || yAxisChanged) {
		return {
			status: "axis_changed",
			name,
			category,
			kind,
			unit,
			portability: portabilityForStatus("axis_changed"),
			baseTable,
			targetTable,
			baseSnapshot,
			targetSnapshot,
			metrics,
			xAxisChanged,
			yAxisChanged,
		};
	}

	if (metrics.cellsChanged > 0) {
		return {
			status: "changed",
			name,
			category,
			kind,
			unit,
			portability: portabilityForStatus("changed"),
			baseTable,
			targetTable,
			baseSnapshot,
			targetSnapshot,
			metrics,
			xAxisChanged,
			yAxisChanged,
		};
	}

	return {
		status: "unchanged",
		name,
		category,
		kind,
		unit,
		portability: portabilityForStatus("unchanged"),
		baseTable,
		targetTable,
		baseSnapshot,
		targetSnapshot,
		metrics,
		xAxisChanged,
		yAxisChanged,
	};
}

export function renderChangedCellsMarkdown(
	analysis: TablePairAnalysis,
): string {
	const baseSnapshot = analysis.baseSnapshot;
	const targetSnapshot = analysis.targetSnapshot;
	if (baseSnapshot === undefined || targetSnapshot === undefined) {
		return "";
	}

	const rows: string[][] = [];

	if (analysis.kind === "table1d") {
		const showIndexColumn = hasDuplicateNumbers(baseSnapshot.xAxisValues);
		for (let row = 0; row < baseSnapshot.rows; row++) {
			const baseValue = baseSnapshot.values[row]?.[0];
			const targetValue = targetSnapshot.values[row]?.[0];
			if (baseValue === undefined || targetValue === undefined) continue;
			if (baseValue === targetValue) continue;
			rows.push([
				...(showIndexColumn ? [String(row)] : []),
				formatDiffNumber(baseSnapshot.xAxisValues[row] ?? row),
				formatDiffNumber(baseValue),
				formatDiffNumber(targetValue),
				formatDiffNumber(targetValue - baseValue),
			]);
		}

		return buildMarkdownTable(
			showIndexColumn
				? ["index", "axis", "base_value", "target_value", "delta"]
				: ["axis", "base_value", "target_value", "delta"],
			rows,
		);
	}

	for (let row = 0; row < baseSnapshot.rows; row++) {
		for (let col = 0; col < baseSnapshot.cols; col++) {
			const baseValue = baseSnapshot.values[row]?.[col];
			const targetValue = targetSnapshot.values[row]?.[col];
			if (baseValue === undefined || targetValue === undefined) continue;
			if (baseValue === targetValue) continue;
			rows.push([
				formatDiffNumber(baseSnapshot.yAxisValues[row] ?? row),
				formatDiffNumber(baseSnapshot.xAxisValues[col] ?? col),
				formatDiffNumber(baseValue),
				formatDiffNumber(targetValue),
				formatDiffNumber(targetValue - baseValue),
			]);
		}
	}

	return buildMarkdownTable(
		["row_axis", "col_axis", "base_value", "target_value", "delta"],
		rows,
	);
}
