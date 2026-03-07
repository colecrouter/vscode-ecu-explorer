/**
 * list_tables tool handler for the ECU Explorer MCP server.
 *
 * Lists all calibration tables available in a ROM file.
 * Returns YAML frontmatter with ROM metadata + markdown table of all tables.
 */

import type { McpConfig } from "../config.js";
import { formatTableListMarkdown } from "../formatters/table-summary.js";
import { toYamlFrontmatter } from "../formatters/yaml-formatter.js";
import { loadRom } from "../rom-loader.js";

function toLoadRomOptions(definitionPath?: string) {
	return definitionPath === undefined ? {} : { definitionPath };
}

/**
 * Handle the list_tables tool call.
 *
 * @param romPath - Path to the ROM binary
 * @param config - MCP server configuration
 * @returns Formatted output string
 */
export async function handleListTables(
	romPath: string,
	config: McpConfig,
	categoryFilter?: string,
	definitionPath?: string,
): Promise<string> {
	const loaded = await loadRom(
		romPath,
		config.definitionsPaths,
		toLoadRomOptions(definitionPath),
	);
	const { definition } = loaded;

	// Filter tables by category if provided
	const tables =
		categoryFilter !== undefined
			? definition.tables.filter((t) =>
					(t.category ?? "")
						.toLowerCase()
						.includes(categoryFilter.toLowerCase()),
				)
			: definition.tables;

	// Build frontmatter
	const frontmatterData: Record<string, unknown> = {
		rom: romPath,
		definition: definition.name,
		table_count: tables.length,
	};

	const frontmatter = toYamlFrontmatter(frontmatterData);

	const tableContent = formatTableListMarkdown(tables);

	return `${frontmatter}\n${tableContent}`;
}
