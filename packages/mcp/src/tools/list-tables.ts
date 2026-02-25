/**
 * list_tables tool handler for the ECU Explorer MCP server.
 *
 * Lists all calibration tables available in a ROM file.
 * Returns YAML frontmatter with ROM metadata + markdown table of all tables.
 */

import type { McpConfig } from "../config.js";
import { buildMarkdownTable } from "../formatters/markdown.js";
import { toYamlFrontmatter } from "../formatters/yaml-formatter.js";
import { loadRom } from "../rom-loader.js";

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
): Promise<string> {
	const loaded = await loadRom(romPath, config.definitionsPaths);
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

	// Build markdown table matching spec: name, category, dimensions, unit
	const headers = ["Name", "Category", "Dimensions", "Unit"];

	const rows = tables.map((table) => {
		const dims =
			table.kind === "table1d"
				? `1x${table.rows}`
				: table.kind === "table2d"
					? `${table.cols}x${table.rows}`
					: `${table.cols}x${table.rows}x${table.depth}`;
		const unit = String(table.z.unit ?? "");
		const category = table.category ?? "";

		return [table.name, category, dims, unit];
	});

	const tableContent = buildMarkdownTable(headers, rows);

	return `${frontmatter}\n${tableContent}`;
}
