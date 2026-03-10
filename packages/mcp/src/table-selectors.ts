/**
 * Shared table selector helpers for read_table / patch_table.
 */

import { compileExpression } from "filtrex";
import type { Table1DDefinition, Table2DDefinition, TableDefinition } from "@ecu-explorer/core";
import {
	buildAliasedObject,
	buildUnknownFieldError,
	buildFieldAliasMap,
	detectUnknownFieldFragments,
	escapeRegex,
	normalizeExpression,
	rewriteExpressionWithAliases,
} from "./query-utils.js";

export interface TableSelection {
	rowIndices: number[];
	colIndices: number[];
	cellsMatched: number;
	matchedCells: Array<{ row: number; col: number }>;
	selectorAxes: string[];
}

function uniqueSorted(values: number[]): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

function getSelectorAxes(table: TableDefinition): string[] {
	const axes: string[] = [];
	if (table.x?.name) axes.push(table.x.name);
	if ((table.kind === "table2d" || table.kind === "table3d") && table.y?.name) {
		axes.push(table.y.name);
	}
	return axes;
}

function buildEqualitySuggestion(
	where: string,
	axisName: string,
	axisValues: number[],
): string[] {
	const escaped = escapeRegex(axisName);
	const re = new RegExp(
		`(^|[^A-Za-z0-9_])${escaped}\\s*==\\s*(-?\\d+(?:\\.\\d+)?)`,
		"g",
	);
	const suggestions: string[] = [];

	for (const match of where.matchAll(re)) {
		const requested = Number(match[2]);
		if (!Number.isFinite(requested)) continue;
		const nearest = [...axisValues]
			.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested))
			.slice(0, 3);
		if (nearest.length > 0) {
			suggestions.push(`${axisName}: nearest values are ${nearest.join(", ")}`);
		}
	}

	return suggestions;
}

export function selectTableCells(
	table: TableDefinition,
	xAxisValues: number[],
	yAxisValues: number[],
	where?: string,
): TableSelection {
	if (where === undefined) {
		const rowCount = table.rows;
		const colCount = table.kind === "table1d" ? 1 : table.cols;
		return {
			rowIndices: Array.from({ length: rowCount }, (_, index) => index),
			colIndices: Array.from({ length: colCount }, (_, index) => index),
			cellsMatched: rowCount * colCount,
			matchedCells: Array.from({ length: rowCount }, (_, row) =>
				Array.from({ length: colCount }, (_, col) => ({ row, col })),
			).flat(),
			selectorAxes: getSelectorAxes(table),
		};
	}

	const selectorAxes = getSelectorAxes(table);
	const { fieldToAlias } = buildFieldAliasMap(selectorAxes, "__axis_");
	const unknownFragments = detectUnknownFieldFragments(where, selectorAxes);
	if (unknownFragments.length > 0) {
		throw buildUnknownFieldError("axis name", unknownFragments, selectorAxes);
	}

	const rewritten = rewriteExpressionWithAliases(normalizeExpression(where), fieldToAlias);

	let selector: (values: Record<string, number>) => unknown;
	try {
		selector = compileExpression(rewritten);
	} catch (err) {
		throw new Error(
			`Invalid where expression for table selector: ${err instanceof Error ? err.message : String(err)}. Available axes: ${selectorAxes.join(", ")}`,
		);
	}

	const matchedRows: number[] = [];
	const matchedCols: number[] = [];
	const matchedCells: Array<{ row: number; col: number }> = [];

	if (table.kind === "table1d") {
		const table1d = table as Table1DDefinition;
		for (let rowIndex = 0; rowIndex < table1d.rows; rowIndex++) {
			const row = {
				[table1d.x?.name ?? "Index"]: xAxisValues[rowIndex] ?? rowIndex,
			};
			const aliasRow = buildAliasedObject(row, fieldToAlias);
			if (selector({ ...row, ...aliasRow })) {
				matchedRows.push(rowIndex);
				matchedCells.push({ row: rowIndex, col: 0 });
			}
		}
	} else if (table.kind === "table2d") {
		const table2d = table as Table2DDefinition;
		for (let rowIndex = 0; rowIndex < table2d.rows; rowIndex++) {
			for (let colIndex = 0; colIndex < table2d.cols; colIndex++) {
				const row = {
					[table2d.x?.name ?? "X"]: xAxisValues[colIndex] ?? colIndex,
					[table2d.y?.name ?? "Y"]: yAxisValues[rowIndex] ?? rowIndex,
				};
				const aliasRow = buildAliasedObject(row, fieldToAlias);
				if (selector({ ...row, ...aliasRow })) {
					matchedRows.push(rowIndex);
					matchedCols.push(colIndex);
					matchedCells.push({ row: rowIndex, col: colIndex });
				}
			}
		}
	} else {
		throw new Error("Table selectors are only supported for 1D and 2D tables.");
	}

	const rowIndices = uniqueSorted(matchedRows);
	const colIndices =
		table.kind === "table1d"
			? [0]
			: uniqueSorted(matchedCols);

	if (rowIndices.length === 0 || colIndices.length === 0) {
		const axisSuggestions = [
			...(table.x?.name
				? buildEqualitySuggestion(where, table.x.name, xAxisValues)
				: []),
			...(table.kind === "table2d" && table.y?.name
				? buildEqualitySuggestion(where, table.y.name, yAxisValues)
				: []),
		];

		throw new Error(
			`Table selector matched no cells. Available axes: ${selectorAxes.join(", ")}.` +
				(axisSuggestions.length > 0 ? ` ${axisSuggestions.join(" ")}` : ""),
		);
	}

	return {
		rowIndices,
		colIndices,
		cellsMatched: matchedCells.length,
		matchedCells,
		selectorAxes,
	};
}
