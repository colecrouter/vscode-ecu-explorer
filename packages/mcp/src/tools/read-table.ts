/**
 * read_table tool handler for the ECU Explorer MCP server.
 *
 * Reads a calibration table from a ROM file (read-only).
 * Returns YAML frontmatter + markdown table with axis labels.
 */

import { findClosestMatches } from "@ecu-explorer/core";
import type { McpConfig } from "../config.js";
import { formatTable } from "../formatters/table-formatter.js";
import { loadRom } from "../rom-loader.js";

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
): Promise<string> {
	const loaded = await loadRom(romPath, config.definitionsPaths);
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

	// Read-only: format the table
	const result = formatTable(romPath, tableDef, romBytes);
	return result.content;
}
