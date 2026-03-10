import type { TableDefinition } from "@ecu-explorer/core";
import { buildMarkdownTable } from "./markdown.js";
import { formatUnit } from "./unit.js";

export function formatTableDimensions(table: TableDefinition): string {
	return table.kind === "table1d"
		? `1x${table.rows}`
		: table.kind === "table2d"
			? `${table.cols}x${table.rows}`
			: `${table.cols}x${table.rows}x${table.depth}`;
}

export function formatTableListMarkdown(tables: TableDefinition[]): string {
	const headers = ["Name", "Category", "Dimensions", "Unit", "X Axis", "Y Axis"];
	const rows = tables.map((table) => [
		table.name,
		table.category ?? "",
		formatTableDimensions(table),
		formatUnit(table.z.unit),
		table.x?.name ?? "",
		table.kind === "table2d" || table.kind === "table3d"
			? (table.y?.name ?? "")
			: "",
	]);

	return buildMarkdownTable(headers, rows);
}
