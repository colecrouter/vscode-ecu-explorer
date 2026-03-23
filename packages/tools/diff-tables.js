import sade from "sade";
import { handleDiffTables } from "../mcp/dist/tools/diff-tables.js";
import { loadToolMcpConfig, resolveCliPath, runCliAction } from "./mcp-cli.js";

const prog = sade("diff-tables", true);

prog
	.version("1.0.0")
	.describe(
		"Compare calibration tables across two ROMs using the same output as the MCP tool",
	)
	.option("--base-rom", "Path to baseline ROM image")
	.option("--target-rom", "Path to comparison ROM image")
	.option(
		"--base-definition",
		"Optional explicit definition XML override for base ROM",
	)
	.option(
		"--target-definition",
		"Optional explicit definition XML override for target ROM",
	)
	.option("--table", "Optional exact table name for detail mode")
	.option("--query", "Optional metadata query for summary mode")
	.option("--page", "Optional 1-based page number for summary mode")
	.option("--page-size", "Optional page size for summary mode")
	.option(
		"--definitions-path",
		"Optional definitions search path (same meaning as the MCP server)",
	)
	.action((opts) => {
		if (!opts["base-rom"]) {
			console.error("Missing required --base-rom argument");
			process.exit(1);
		}

		if (!opts["target-rom"]) {
			console.error("Missing required --target-rom argument");
			process.exit(1);
		}

		runCliAction(async () => {
			const config = loadToolMcpConfig({
				definitionsPath: opts["definitions-path"],
			});
			return handleDiffTables(
				{
					baseRom: resolveCliPath(opts["base-rom"]),
					targetRom: resolveCliPath(opts["target-rom"]),
					baseDefinitionPath: opts["base-definition"]
						? resolveCliPath(opts["base-definition"])
						: undefined,
					targetDefinitionPath: opts["target-definition"]
						? resolveCliPath(opts["target-definition"])
						: undefined,
					table: opts.table,
					query: opts.query,
					page: opts.page ? Number.parseInt(String(opts.page), 10) : undefined,
					pageSize: opts["page-size"]
						? Number.parseInt(String(opts["page-size"]), 10)
						: undefined,
				},
				config,
			);
		});
	});

prog.parse(process.argv);
