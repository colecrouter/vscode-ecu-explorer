/**
 * read_table tool handler for the ECU Explorer MCP server.
 *
 * Reads a calibration table from a ROM file (read-only).
 * Returns YAML frontmatter + markdown table with axis labels.
 */

import { findClosestMatches } from "@ecu-explorer/core";
import type { McpConfig } from "../config.js";
import { formatTable, formatTableSlice } from "../formatters/table-formatter.js";
import { loadRom } from "../rom-loader.js";
import { selectTableCells } from "../table-selectors.js";

function toLoadRomOptions(definitionPath?: string) {
	return definitionPath === undefined ? {} : { definitionPath };
}

/**
 * Handle the read_table tool call.
 *
 * @param romPath - Path to the ROM binary
 * @param tableName - Exact table name to read
 * @param config - MCP server configuration
 * @returns Formatted output string
 */
export async function handleReadTable(
	romPath: string,
	tableName: string,
	config: McpConfig,
	where?: string,
	definitionPath?: string,
): Promise<string> {
	const loaded = await loadRom(
		romPath,
		config.definitionsPaths,
		toLoadRomOptions(definitionPath),
	);
	const { definition, romBytes } = loaded;

	// Find the table definition by name
	let tableDef = definition.tables.find((t) => t.name === tableName);

	// If not found, try case-insensitive exact match
	if (!tableDef) {
		tableDef = definition.tables.find(
			(t) => t.name.toLowerCase() === tableName.toLowerCase(),
		);
	}

	if (!tableDef) {
		const tableNames = definition.tables.map((t) => t.name);

		// Find fuzzy matches
		const suggestions = findClosestMatches(tableName, tableNames, 3, 20);
		const suggestionText =
			suggestions.length > 0
				? `\nDid you mean: ${suggestions.join(", ")}?`
				: "";

		throw new Error(
			`Table "${tableName}" not found in ROM definition "${definition.name}". ` +
				suggestionText +
				"\nUse list_tables to see all available tables.",
		);
	}

	if (where !== undefined && tableDef.kind === "table3d") {
		throw new Error("Table selectors are only supported for 1D and 2D tables.");
	}

	const full = formatTable(romPath, tableDef, romBytes);
	const result =
		where === undefined
			? full
			: formatTableSlice(
					romPath,
					tableDef,
					romBytes,
					{
						...selectTableCells(
							tableDef,
							full.xAxisValues,
							full.yAxisValues,
							where,
						),
						where,
					},
				);
	return result.content;
}
