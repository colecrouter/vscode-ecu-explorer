#!/usr/bin/env node

/**
 * ECU Explorer MCP Server
 *
 * Exposes ROM calibration data and live-data logs to LLM agents via the
 * Model Context Protocol (MCP). Runs as a standalone Node.js process using
 * stdio transport.
 *
 * Usage:
 *   ecu-mcp [--definitions-path <path>] [--logs-dir <path>]
 *
 * Environment variables:
 *   ECU_DEFINITIONS_PATH  Path to ECUFlash XML definitions directory
 *   ECU_LOGS_DIR          Path to log files directory
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { setupContextIpc } from "./context-ipc.js";
import {
	buildOpenDocumentsContextPayload,
	buildQuerySyntaxResourceText,
} from "./resources.js";
import { handleDiffTables } from "./tools/diff-tables.js";
import type { PatchTableOptions } from "./tools/patch-table.js";

/**
 * Open documents context shared state
 */
interface OpenDocumentsContext {
	version: number;
	timestamp: string;
	roms: Array<{
		uri: string;
		path: string;
		name: string;
		sizeBytes: number;
		definition?: { name: string; uri?: string };
		isDirty: boolean;
		activeEditors: number;
		isFocused?: boolean;
		lastFocusedAt?: string;
	}>;
	tables: Array<{
		uri: string;
		tableId: string;
		romPath: string;
		romUri: string;
		kind: string;
		dimensions: { rows: number; cols: number };
		unit?: string;
		definitionUri?: string;
		activeEditors: number;
		isFocused?: boolean;
		lastFocusedAt?: string;
	}>;
}

const currentOpenContext: OpenDocumentsContext = {
	version: 1,
	timestamp: new Date().toISOString(),
	roms: [],
	tables: [],
};

import { handleListLogs } from "./tools/list-logs.js";
import { handleListTables } from "./tools/list-tables.js";
import { handlePatchTable } from "./tools/patch-table.js";
import { handleReadLog } from "./tools/read-log.js";
import { handleReadTable } from "./tools/read-table.js";
import { handleRomInfo } from "./tools/rom-info.js";

let config: ReturnType<typeof loadConfig>;
try {
	config = loadConfig();
} catch (err) {
	process.stderr.write(
		`Warning: failed to load config, using defaults: ${err instanceof Error ? err.message : String(err)}\n`,
	);
	config = { definitionsPaths: [], logsDir: "./logs" };
}

const server = new McpServer({
	name: "ecu-explorer",
	version: "1.0.0",
	icons: [
		{
			src: "assets/logo-silhouette.svg",
			mimeType: "image/svg+xml",
			sizes: ["any"],
		},
	],
});

// Set up context IPC to listen for updates from VS Code extension
setupContextIpc((data: Record<string, unknown>) => {
	// Update the current open context with new data from the extension
	if (typeof data === "object" && data !== null) {
		if ("roms" in data && Array.isArray(data.roms)) {
			currentOpenContext.roms = data.roms as typeof currentOpenContext.roms;
		}
		if ("tables" in data && Array.isArray(data.tables)) {
			currentOpenContext.tables =
				data.tables as typeof currentOpenContext.tables;
		}
		currentOpenContext.timestamp = new Date().toISOString();
	}
});

// ─── Resource: open-documents context ─────────────────────────────────────────

/**
 * Provide the current open documents context as a resource
 * This is updated by the VSCode extension via stdin messages
 */
server.resource(
	"ecu-explorer://context/open-documents",
	"ecu-explorer://context/open-documents",
	async () => {
		const payload = buildOpenDocumentsContextPayload(currentOpenContext);
		return {
			contents: [
				{
					uri: "ecu-explorer://context/open-documents",
					mimeType: "application/json",
					text: payload,
				},
			],
		};
	},
);

server.resource(
	"ecu-explorer://docs/query-syntax",
	"ecu-explorer://docs/query-syntax",
	async () => ({
		contents: [
			{
				uri: "ecu-explorer://docs/query-syntax",
				mimeType: "text/markdown",
				text: buildQuerySyntaxResourceText(),
			},
		],
	}),
);

/**
 * Update open documents context (called by the VS Code extension)
 */
export function updateOpenContext(
	context: Partial<OpenDocumentsContext>,
): void {
	if (context.roms !== undefined) {
		currentOpenContext.roms = context.roms;
	}
	if (context.tables !== undefined) {
		currentOpenContext.tables = context.tables;
	}
	currentOpenContext.timestamp = new Date().toISOString();
}

// ─── Tool: list_tables ────────────────────────────────────────────────────────

server.tool(
	"diff_tables",
	"Compare calibration tables across two ROMs. Omit `table` for a changed-table summary, or provide `table` to inspect one table in detail.",
	{
		base_rom: z
			.string()
			.describe("Absolute or workspace-relative path to the baseline ROM"),
		target_rom: z
			.string()
			.describe("Absolute or workspace-relative path to the comparison ROM"),
		base_definition: z
			.string()
			.optional()
			.describe("Optional explicit definition path for `base_rom`"),
		target_definition: z
			.string()
			.optional()
			.describe("Optional explicit definition path for `target_rom`"),
		table: z
			.string()
			.optional()
			.describe(
				"Optional exact table name to inspect in detail; omit for summary mode",
			),
		query: z
			.string()
			.optional()
			.describe(
				"Optional metadata query over summary results; valid only when `table` is omitted",
			),
		page: z.number().int().min(1).optional().describe("1-based page number"),
		page_size: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("Maximum rows to return per page in summary mode"),
	},
	async ({
		base_rom,
		target_rom,
		base_definition,
		target_definition,
		table,
		query,
		page,
		page_size,
	}) => {
		try {
			const content = await handleDiffTables(
				{
					baseRom: base_rom,
					targetRom: target_rom,
					baseDefinitionPath: base_definition,
					targetDefinitionPath: target_definition,
					table,
					query,
					page,
					pageSize: page_size,
				},
				config,
			);
			return { content: [{ type: "text", text: content }] };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

server.tool(
	"list_tables",
	"Discover calibration tables in a ROM. Supports metadata query and pagination. Includes axis names so agents can transition directly into read_table or patch_table selectors.",
	{
		rom: z
			.string()
			.describe("Absolute or workspace-relative path to the ROM binary"),
		definition: z
			.string()
			.optional()
			.describe("Optional explicit path to an ECU definition XML file"),
		query: z
			.string()
			.optional()
			.describe(
				"Optional metadata query across table name, category, dimensions, unit, and axis names",
			),
		page: z.number().int().min(1).optional().describe("1-based page number"),
		page_size: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("Maximum rows to return per page"),
	},
	async ({ rom, definition, query, page, page_size }) => {
		try {
			const listTableOptions: Parameters<typeof handleListTables>[2] = {};
			if (query !== undefined) listTableOptions.query = query;
			if (page !== undefined) listTableOptions.page = page;
			if (page_size !== undefined) listTableOptions.pageSize = page_size;

			const content = await handleListTables(
				rom,
				config,
				listTableOptions,
				definition,
			);
			return { content: [{ type: "text", text: content }] };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ─── Tool: read_table ─────────────────────────────────────────────────────────

server.tool(
	"read_table",
	"Read a calibration table from a ROM. Omit `where` to read the full table, or use `where` with the table's real axis names to read a selected slice.",
	{
		rom: z
			.string()
			.describe("Absolute or workspace-relative path to the ROM binary"),
		definition: z
			.string()
			.optional()
			.describe("Optional explicit path to an ECU definition XML file"),
		table: z.string().describe("Table name (from list_tables)"),
		where: z
			.string()
			.optional()
			.describe(
				"Optional selector expression using the table's real axis names, e.g. 'RPM (rpm) == 4000 && Load (g/rev) == 1.8'",
			),
	},
	async ({ rom, definition, table, where }) => {
		try {
			const content = await handleReadTable(
				rom,
				table,
				config,
				where,
				definition,
			);
			return { content: [{ type: "text", text: content }] };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ─── Tool: patch_table ────────────────────────────────────────────────────────

server.tool(
	"patch_table",
	"Apply an operation to cells in a ROM table using a value-based `where` selector. Returns the affected slice after the patch. Equality matches exact axis breakpoint values.",
	{
		rom: z.string().describe("Path to ROM file"),
		definition: z
			.string()
			.optional()
			.describe("Optional explicit path to an ECU definition XML file"),
		table: z.string().describe("Table name (from list_tables)"),
		op: z
			.enum(["set", "add", "multiply", "clamp", "smooth"])
			.describe("Operation to apply"),
		value: z.number().optional().describe("Operand for set/add/multiply"),
		min: z.number().optional().describe("Lower bound for clamp"),
		max: z.number().optional().describe("Upper bound for clamp"),
		where: z
			.string()
			.optional()
			.describe(
				"Optional selector expression using the table's real axis names, e.g. 'RPM (rpm) >= 3000 && Load (g/rev) <= 2.0'",
			),
	},
	async ({ rom, definition, table, op, value, min, max, where }) => {
		try {
			const opts: PatchTableOptions = {
				rom,
				table,
				op,
			};
			if (definition !== undefined) opts.definitionPath = definition;
			if (value !== undefined) opts.value = value;
			if (min !== undefined) opts.min = min;
			if (max !== undefined) opts.max = max;
			if (where !== undefined) opts.where = where;
			const content = await handlePatchTable(opts, config);
			return { content: [{ type: "text", text: content }] };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ─── Tool: rom_info ───────────────────────────────────────────────────────────

server.tool(
	"rom_info",
	"Get ROM metadata: matched definition, vehicle info, and checksum validity. Check `checksum_valid` before recommending a flash — a `false` value means the ROM has been modified without a checksum update (this should not happen if edits were made via `patch_table`).",
	{
		rom: z
			.string()
			.describe("Absolute or workspace-relative path to the ROM binary"),
		definition: z
			.string()
			.optional()
			.describe("Optional explicit path to an ECU definition XML file"),
	},
	async ({ rom, definition }) => {
		try {
			const content = await handleRomInfo(rom, config, definition);
			return { content: [{ type: "text", text: content }] };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ─── Tool: list_logs ──────────────────────────────────────────────────────────

server.tool(
	"list_logs",
	"Discover available log files. Supports metadata search and pagination. Use `read_log(file)` to inspect one selected log.",
	{
		query: z
			.string()
			.optional()
			.describe(
				"Optional metadata query across filename, channels, date, row count, duration, and sample rate",
			),
		page: z.number().int().min(1).optional().describe("1-based page number"),
		page_size: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("Maximum rows to return per page"),
	},
	async ({ query, page, page_size }) => {
		try {
			const listLogOptions: Parameters<typeof handleListLogs>[1] = {};
			if (query !== undefined) listLogOptions.query = query;
			if (page !== undefined) listLogOptions.page = page;
			if (page_size !== undefined) listLogOptions.pageSize = page_size;

			const content = await handleListLogs(config, listLogOptions);
			return { content: [{ type: "text", text: content }] };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ─── Tool: read_log ───────────────────────────────────────────────────────────

server.tool(
	"read_log",
	"Inspect one selected log file. Call with only `file` to get fields/units/schema. Add `where`, time range, and `step_ms` to read a slice from that log.",
	{
		file: z.string().describe("Filename from list_logs"),
		where: z
			.string()
			.optional()
			.describe(
				"Optional row filter expression using fields from read_log(file), e.g. 'Engine RPM > 3000 && Knock Sum > 0'",
			),
		channels: z
			.array(z.string())
			.optional()
			.describe("Optional subset of channels to include in the output"),
		start_s: z
			.number()
			.nonnegative()
			.optional()
			.describe("Optional start time in seconds"),
		end_s: z
			.number()
			.nonnegative()
			.optional()
			.describe("Optional end time in seconds"),
		before_ms: z
			.number()
			.nonnegative()
			.optional()
			.describe("Optional context window before each where match"),
		after_ms: z
			.number()
			.nonnegative()
			.optional()
			.describe("Optional context window after each where match"),
		step_ms: z
			.number()
			.positive()
			.optional()
			.describe(
				"Optional minimum time spacing between returned rows in milliseconds",
			),
	},
	async ({
		file,
		where,
		channels,
		start_s,
		end_s,
		before_ms,
		after_ms,
		step_ms,
	}) => {
		try {
			const readLogOptions: Parameters<typeof handleReadLog>[0] = { file };
			if (where !== undefined) readLogOptions.where = where;
			if (channels !== undefined) readLogOptions.channels = channels;
			if (start_s !== undefined) readLogOptions.startS = start_s;
			if (end_s !== undefined) readLogOptions.endS = end_s;
			if (before_ms !== undefined) readLogOptions.beforeMs = before_ms;
			if (after_ms !== undefined) readLogOptions.afterMs = after_ms;
			if (step_ms !== undefined) readLogOptions.stepMs = step_ms;

			const content = await handleReadLog(readLogOptions, config);
			return { content: [{ type: "text", text: content }] };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ─── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
