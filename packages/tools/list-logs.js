import sade from "sade";
import { handleListLogs } from "../mcp/dist/tools/list-logs.js";
import {
	loadToolMcpConfig,
	parseOptionalInteger,
	runCliAction,
} from "./mcp-cli.js";

const prog = sade("list-logs", true);

prog
	.version("1.0.0")
	.describe("List logs using the same metadata output as the MCP tool")
	.option("--logs-dir", "Optional log directory override")
	.option("--query", "Optional metadata query")
	.option("--page", "1-based page number")
	.option("--page-size", "Maximum rows to return per page")
	.action((opts) => {
		runCliAction(async () => {
			const config = loadToolMcpConfig({
				logsDir: opts["logs-dir"],
			});
			/** @type {Parameters<typeof handleListLogs>[1]} */
			const listOptions = {};
			if (opts.query !== undefined) listOptions.query = opts.query;
			const page = parseOptionalInteger(opts.page, "page", 1);
			if (page !== undefined) listOptions.page = page;
			const pageSize = parseOptionalInteger(opts["page-size"], "page-size", 1);
			if (pageSize !== undefined) listOptions.pageSize = pageSize;
			return handleListLogs(config, listOptions);
		});
	});

prog.parse(process.argv);
