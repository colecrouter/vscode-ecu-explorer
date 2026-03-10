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
	options: {
		query?: string;
		page?: number;
		pageSize?: number;
	} = {},
	definitionPath?: string,
): Promise<string> {
	const { query, page = 1, pageSize = 25 } = options;
	const loaded = await loadRom(
		romPath,
		config.definitionsPaths,
		toLoadRomOptions(definitionPath),
	);
	const { definition } = loaded;

	// Filter tables by metadata query if provided
	const tables =
		query !== undefined
			? definition.tables.filter((table) => {
					const haystack = [
						table.name,
						table.category ?? "",
						table.kind,
						table.z.unit ?? "",
						table.x?.name ?? "",
						table.kind === "table2d" || table.kind === "table3d"
							? (table.y?.name ?? "")
							: "",
					]
						.join(" ")
						.toLowerCase();

					return query
						.toLowerCase()
						.split(/\s+/)
						.filter((token) => token.length > 0)
						.every((token) => haystack.includes(token));
				})
			: definition.tables;

	const safePageSize = Math.max(1, pageSize);
	const totalPages = tables.length === 0 ? 0 : Math.ceil(tables.length / safePageSize);
	const safePage = totalPages === 0 ? 1 : Math.min(Math.max(1, page), totalPages);
	const startIndex = (safePage - 1) * safePageSize;
	const pagedTables = tables.slice(startIndex, startIndex + safePageSize);

	// Build frontmatter
	const frontmatterData: Record<string, unknown> = {
		rom: romPath,
		definition: definition.name,
		total_tables: tables.length,
		page: safePage,
		page_size: safePageSize,
		total_pages: totalPages,
		query: query ?? null,
	};

	const frontmatter = toYamlFrontmatter(frontmatterData);

	if (pagedTables.length === 0) {
		return `${frontmatter}\n(No tables matched the query)`;
	}

	const tableContent = formatTableListMarkdown(pagedTables);

	return `${frontmatter}\n${tableContent}`;
}
