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
import { handleQueryLogs } from "./tools/query-logs.js";
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
		if ("roms" in data && Array.isArray(data["roms"])) {
			currentOpenContext.roms = data["roms"] as typeof currentOpenContext.roms;
		}
		if ("tables" in data && Array.isArray(data["tables"])) {
			currentOpenContext.tables = data[
				"tables"
			] as typeof currentOpenContext.tables;
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
		const payload = JSON.stringify(currentOpenContext, null, 2);
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
	"list_tables",
	"List all calibration tables in a ROM. Use `category` to filter (e.g. 'Fuel', 'Ignition'). Call this first to discover table names before reading or patching.",
	{
		rom: z
			.string()
			.describe("Absolute or workspace-relative path to the ROM binary"),
		category: z
			.string()
			.optional()
			.describe(
				"Filter string — only tables whose category contains this string (case-insensitive) are returned",
			),
	},
	async ({ rom, category }) => {
		try {
			const content = await handleListTables(rom, config, category);
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
	"Read a calibration table from a ROM. Returns axis breakpoints and cell values. Use row/column indices from this output when calling patch_table.",
	{
		rom: z
			.string()
			.describe("Absolute or workspace-relative path to the ROM binary"),
		table: z.string().describe("Table name (from list_tables)"),
	},
	async ({ rom, table }) => {
		try {
			const content = await handleReadTable(rom, table, config);
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
	"Apply an operation to cells in a ROM table, returns the updated table. (Note: this produces rounding errors, due to how the ROM stores values.)",
	{
		rom: z.string().describe("Path to ROM file"),
		table: z.string().describe("Table name (from list_tables)"),
		op: z
			.enum(["set", "add", "multiply", "clamp", "smooth"])
			.describe("Operation to apply"),
		value: z.number().optional().describe("Operand for set/add/multiply"),
		min: z.number().optional().describe("Lower bound for clamp"),
		max: z.number().optional().describe("Upper bound for clamp"),
		row: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe("0-based row index; omit for all rows"),
		col: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe("0-based column index; omit for all columns"),
	},
	async ({ rom, table, op, value, min, max, row, col }) => {
		try {
			const opts: import("./tools/patch-table.js").PatchTableOptions = {
				rom,
				table,
				op,
			};
			if (value !== undefined) opts.value = value;
			if (min !== undefined) opts.min = min;
			if (max !== undefined) opts.max = max;
			if (row !== undefined) opts.row = row;
			if (col !== undefined) opts.col = col;
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
	},
	async ({ rom }) => {
		try {
			const content = await handleRomInfo(rom, config);
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
	"List available log files sorted by recency (1 = most recent). Returns channel names available in each file. Use the filename with `query_logs` to filter a specific session, or omit to search all logs.",
	{},
	async () => {
		try {
			const content = await handleListLogs(config);
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

// ─── Tool: query_logs ─────────────────────────────────────────────────────────

server.tool(
	"query_logs",
	"Query log data using a filter expression. Channel names are case-sensitive and must match `list_logs` output exactly. `sample_rate` reduces output density (e.g. `sample_rate: 10` on a 100 Hz log returns every 10th matching row). Omit `file` to search all logs — useful when you don't know which session contains the relevant data.",
	{
		filter: z
			.string()
			.describe(
				"Filter expression, e.g. 'RPM > 3000 && Knock > 0'. Channel names are case-sensitive.",
			),
		channels: z
			.array(z.string())
			.optional()
			.describe("Additional channels to include beyond those in the filter"),
		file: z
			.string()
			.optional()
			.describe(
				"Filename from list_logs to search; omit to search all log files",
			),
		sample_rate: z
			.number()
			.positive()
			.optional()
			.describe(
				"Target sample rate in Hz; server computes stride from actual log rate",
			),
	},
	async ({ filter, channels, file, sample_rate }) => {
		try {
			const queryOpts: {
				filter: string;
				channels?: string[];
				file?: string;
				sampleRate?: number;
			} = { filter };
			if (channels !== undefined) queryOpts.channels = channels;
			if (file !== undefined) queryOpts.file = file;
			if (sample_rate !== undefined) queryOpts.sampleRate = sample_rate;
			const content = await handleQueryLogs(queryOpts, config);
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
