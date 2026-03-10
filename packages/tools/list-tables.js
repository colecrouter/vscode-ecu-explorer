import sade from "sade";
import { handleListTables } from "../mcp/dist/tools/list-tables.js";
import {
	loadToolMcpConfig,
	parseOptionalInteger,
	resolveCliPath,
	runCliAction,
} from "./mcp-cli.js";

const prog = sade("list-tables", true);

prog
	.version("1.0.0")
	.describe("List calibration tables using the same output as the MCP tool")
	.option("--rom", "Path to ROM image")
	.option("-d, --definition", "Optional explicit definition XML override")
	.option("--definitions-path", "Optional definitions search path")
	.option("--query", "Optional metadata query")
	.option("--page", "1-based page number")
	.option("--page-size", "Maximum rows to return per page")
	.action((opts) => {
		if (!opts.rom) {
			console.error("Missing required --rom argument");
			process.exit(1);
		}

		runCliAction(async () => {
			const config = loadToolMcpConfig({
				definitionsPath: opts["definitions-path"],
			});
			/** @type {Parameters<typeof handleListTables>[2]} */
			const listOptions = {};
			if (opts.query !== undefined) listOptions.query = opts.query;
			const page = parseOptionalInteger(opts.page, "page", 1);
			if (page !== undefined) listOptions.page = page;
			const pageSize = parseOptionalInteger(opts["page-size"], "page-size", 1);
			if (pageSize !== undefined) listOptions.pageSize = pageSize;
			return handleListTables(
				resolveCliPath(opts.rom),
				config,
				listOptions,
				opts.definition ? resolveCliPath(opts.definition) : undefined,
			);
		});
	});

prog.parse(process.argv);
