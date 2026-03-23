/**
 * diff_tables tool handler for the ECU Explorer MCP server.
 *
 * Compares calibration tables across two ROMs. When `table` is omitted, returns
 * a summary of the table-level differences. When `table` is provided, returns a
 * detailed diff for that single named table.
 */

import type { McpConfig } from "../config.js";
import { buildMarkdownTable } from "../formatters/markdown.js";
import { toYamlFrontmatter } from "../formatters/yaml-formatter.js";
import { loadRom } from "../rom-loader.js";
import {
	analyzeTablePair,
	buildDiffFrontmatterData,
	type DiffStatus,
	findTableByName,
	formatDiffNumber,
	type Portability,
	renderChangedCellsMarkdown,
	sortWeight,
	type TablePairAnalysis,
	tableCols,
	tableRows,
} from "../table-diff.js";

function toLoadRomOptions(definitionPath?: string) {
	return definitionPath === undefined ? {} : { definitionPath };
}

interface DiffTablesOptions {
	baseRom: string;
	targetRom: string;
	baseDefinitionPath?: string | undefined;
	targetDefinitionPath?: string | undefined;
	table?: string | undefined;
	query?: string | undefined;
	page?: number | undefined;
	pageSize?: number | undefined;
}

interface SummaryRow {
	name: string;
	category: string;
	kind: string;
	unit: string;
	status: DiffStatus;
	cellsChanged?: number | undefined;
	maxAbsDelta?: number | undefined;
	portability: Portability;
}

function queryText(row: SummaryRow): string {
	return [
		row.name,
		row.category,
		row.kind,
		row.status,
		row.unit,
		row.portability,
	]
		.join(" ")
		.toLowerCase();
}

function matchesSummaryQuery(row: SummaryRow, query?: string): boolean {
	if (query === undefined || query.trim() === "") return true;
	const haystack = queryText(row);
	const terms = query
		.toLowerCase()
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
	return terms.every((term) => haystack.includes(term));
}

function summarizeRows(analyses: TablePairAnalysis[]): SummaryRow[] {
	return analyses.map((analysis) => ({
		name: analysis.name,
		category: analysis.category,
		kind: analysis.kind,
		unit: analysis.unit,
		status: analysis.status,
		cellsChanged: analysis.metrics?.cellsChanged,
		maxAbsDelta: analysis.metrics?.maxAbsDelta,
		portability: analysis.portability,
	}));
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
	const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
	const safePage = Math.min(page, totalPages);
	const start = (safePage - 1) * pageSize;
	return {
		page: safePage,
		totalPages,
		rows: rows.slice(start, start + pageSize),
	};
}

function summaryCounts(analyses: TablePairAnalysis[]) {
	return {
		comparableTables: analyses.filter(
			(analysis) =>
				analysis.status === "unchanged" ||
				analysis.status === "changed" ||
				analysis.status === "axis_changed",
		).length,
		changedTables: analyses.filter((analysis) => analysis.status === "changed")
			.length,
		axisChangedTables: analyses.filter(
			(analysis) => analysis.status === "axis_changed",
		).length,
		incompatibleTables: analyses.filter(
			(analysis) => analysis.status === "incompatible",
		).length,
		baseOnlyTables: analyses.filter(
			(analysis) => analysis.status === "base_only",
		).length,
		targetOnlyTables: analyses.filter(
			(analysis) => analysis.status === "target_only",
		).length,
		unchangedTables: analyses.filter(
			(analysis) => analysis.status === "unchanged",
		).length,
	};
}

function buildSummaryOutput(
	options: DiffTablesOptions,
	analyses: TablePairAnalysis[],
	baseDefinitionName: string,
	targetDefinitionName: string,
): string {
	const summaryRows = summarizeRows(analyses)
		.filter((row) => matchesSummaryQuery(row, options.query))
		.sort((left, right) => {
			const statusDelta = sortWeight(left.status) - sortWeight(right.status);
			if (statusDelta !== 0) return statusDelta;
			const cellsDelta = (right.cellsChanged ?? 0) - (left.cellsChanged ?? 0);
			if (cellsDelta !== 0) return cellsDelta;
			const maxDelta = (right.maxAbsDelta ?? 0) - (left.maxAbsDelta ?? 0);
			if (maxDelta !== 0) return maxDelta;
			return left.name.localeCompare(right.name);
		});

	const pageSize = options.pageSize ?? 25;
	const page = options.page ?? 1;
	const paginated = paginate(summaryRows, page, pageSize);
	const counts = summaryCounts(analyses);

	const frontmatterData: Record<string, unknown> = {
		base_rom: options.baseRom,
		target_rom: options.targetRom,
		base_definition: baseDefinitionName,
		target_definition: targetDefinitionName,
		same_definition: baseDefinitionName === targetDefinitionName,
		total_base_tables: analyses.filter(
			(analysis) => analysis.baseTable !== undefined,
		).length,
		total_target_tables: analyses.filter(
			(analysis) => analysis.targetTable !== undefined,
		).length,
		comparable_tables: counts.comparableTables,
		changed_tables: counts.changedTables,
		axis_changed_tables: counts.axisChangedTables,
		incompatible_tables: counts.incompatibleTables,
		base_only_tables: counts.baseOnlyTables,
		target_only_tables: counts.targetOnlyTables,
		unchanged_tables: counts.unchangedTables,
		page: paginated.page,
		page_size: pageSize,
		total_pages: paginated.totalPages,
	};

	if (baseDefinitionName !== targetDefinitionName) {
		frontmatterData.warning =
			"definitions differ; only exact-name table matches are compared";
	}

	const headers = [
		"#",
		"name",
		"category",
		"kind",
		"status",
		"cells_changed",
		"max_abs_delta",
		"portability",
	];
	const rows = paginated.rows.map((row, index) => [
		String((paginated.page - 1) * pageSize + index + 1),
		row.name,
		row.category,
		row.kind,
		row.status,
		row.cellsChanged === undefined ? "" : String(row.cellsChanged),
		row.maxAbsDelta === undefined ? "" : formatDiffNumber(row.maxAbsDelta),
		row.portability,
	]);

	return `${toYamlFrontmatter(frontmatterData)}\n${buildMarkdownTable(headers, rows)}`;
}

function buildAxisDifferenceTable(
	axisName: string,
	baseValues: number[],
	targetValues: number[],
): string {
	const headers = ["index", `${axisName} base`, `${axisName} target`];
	const length = Math.max(baseValues.length, targetValues.length);
	const rows = Array.from({ length }, (_, index) => [
		String(index),
		baseValues[index] === undefined ? "" : formatDiffNumber(baseValues[index]),
		targetValues[index] === undefined
			? ""
			: formatDiffNumber(targetValues[index]),
	]);
	return buildMarkdownTable(headers, rows);
}

function buildDetailOutput(
	options: DiffTablesOptions,
	analysis: TablePairAnalysis,
	baseDefinitionName: string,
	targetDefinitionName: string,
): string {
	const baseSnapshot = analysis.baseSnapshot;
	const targetSnapshot = analysis.targetSnapshot;
	const rows =
		baseSnapshot?.rows ??
		targetSnapshot?.rows ??
		tableRows(analysis.baseTable) ??
		tableRows(analysis.targetTable);
	const cols =
		baseSnapshot?.cols ??
		targetSnapshot?.cols ??
		tableCols(analysis.baseTable) ??
		tableCols(analysis.targetTable);

	const frontmatterData: Record<string, unknown> = {
		...buildDiffFrontmatterData(analysis),
		base_rom: options.baseRom,
		target_rom: options.targetRom,
		base_definition: baseDefinitionName,
		target_definition: targetDefinitionName,
		rows,
		cols,
	};

	const frontmatter = toYamlFrontmatter(frontmatterData);

	switch (analysis.status) {
		case "changed": {
			const heading = `Changed cells for ${analysis.name}.`;
			return `${frontmatter}\n${heading}\n\n${renderChangedCellsMarkdown(analysis)}`;
		}
		case "unchanged":
			return `${frontmatter}\n${analysis.name} is unchanged between the base and target ROMs.`;
		case "axis_changed": {
			const sections = [
				`${analysis.name} has matching shape but different axis breakpoints. Review before porting values directly.`,
			];
			if (analysis.xAxisChanged && baseSnapshot && targetSnapshot) {
				const axisName =
					analysis.baseTable?.x?.name ??
					analysis.targetTable?.x?.name ??
					"X Axis";
				sections.push(
					buildAxisDifferenceTable(
						axisName,
						baseSnapshot.xAxisValues,
						targetSnapshot.xAxisValues,
					),
				);
			}
			if (analysis.yAxisChanged && baseSnapshot && targetSnapshot) {
				const axisName =
					analysis.baseTable?.kind === "table2d"
						? analysis.baseTable.y?.name
						: analysis.targetTable?.kind === "table2d"
							? analysis.targetTable.y?.name
							: "Y Axis";
				sections.push(
					buildAxisDifferenceTable(
						String(axisName),
						baseSnapshot.yAxisValues,
						targetSnapshot.yAxisValues,
					),
				);
			}
			return `${frontmatter}\n${sections.join("\n\n")}`;
		}
		case "incompatible":
			return `${frontmatter}\n${analysis.name} is not safely comparable: ${analysis.incompatibilityReason ?? "incompatible table shapes or metadata"}.`;
		case "base_only":
			return `${frontmatter}\n${analysis.name} exists only in the base ROM definition.`;
		case "target_only":
			return `${frontmatter}\n${analysis.name} exists only in the target ROM definition.`;
	}
}

export async function handleDiffTables(
	options: DiffTablesOptions,
	config: McpConfig,
): Promise<string> {
	if (options.table !== undefined) {
		if (
			options.query !== undefined ||
			options.page !== undefined ||
			options.pageSize !== undefined
		) {
			throw new Error(
				'"query", "page", and "pageSize" are only valid when "table" is omitted.',
			);
		}
	}

	const baseLoaded = await loadRom(
		options.baseRom,
		config.definitionsPaths,
		toLoadRomOptions(options.baseDefinitionPath),
	);
	const targetLoaded = await loadRom(
		options.targetRom,
		config.definitionsPaths,
		toLoadRomOptions(options.targetDefinitionPath),
	);

	if (baseLoaded.romBytes.length !== targetLoaded.romBytes.length) {
		throw new Error(
			`ROM size mismatch: base is ${baseLoaded.romBytes.length} bytes, target is ${targetLoaded.romBytes.length} bytes.`,
		);
	}

	if (options.table !== undefined) {
		const baseTable = findTableByName(
			baseLoaded.definition.tables,
			options.table,
		);
		const targetTable = findTableByName(
			targetLoaded.definition.tables,
			options.table,
		);

		if (baseTable === undefined && targetTable === undefined) {
			throw new Error(
				`Table "${options.table}" not found in either ROM definition. Use diff_tables without "table" to inspect available matches.`,
			);
		}

		const analysis = analyzeTablePair(
			options.table,
			options.baseRom,
			options.targetRom,
			baseTable,
			targetTable,
			baseLoaded.romBytes,
			targetLoaded.romBytes,
		);

		return buildDetailOutput(
			options,
			analysis,
			baseLoaded.definition.name,
			targetLoaded.definition.name,
		);
	}

	const baseTableMap = new Map(
		baseLoaded.definition.tables.map((table) => [table.name, table] as const),
	);
	const targetTableMap = new Map(
		targetLoaded.definition.tables.map((table) => [table.name, table] as const),
	);
	const tableNames = [
		...new Set([...baseTableMap.keys(), ...targetTableMap.keys()]),
	];

	const analyses = tableNames.map((name) =>
		analyzeTablePair(
			name,
			options.baseRom,
			options.targetRom,
			baseTableMap.get(name),
			targetTableMap.get(name),
			baseLoaded.romBytes,
			targetLoaded.romBytes,
		),
	);

	return buildSummaryOutput(
		options,
		analyses,
		baseLoaded.definition.name,
		targetLoaded.definition.name,
	);
}
