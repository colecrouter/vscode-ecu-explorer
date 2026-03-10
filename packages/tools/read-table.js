import sade from "sade";
import { handleReadTable } from "../mcp/dist/tools/read-table.js";
import { loadToolMcpConfig, resolveCliPath, runCliAction } from "./mcp-cli.js";

const prog = sade("read-table", true);

prog
	.version("1.0.0")
	.describe("Read a ROM table or selected slice using the MCP table formatter")
	.option("--rom", "Path to ROM image")
	.option("--table", "Table name from list-tables")
	.option("-d, --definition", "Optional explicit definition XML override")
	.option("--definitions-path", "Optional definitions search path")
	.option("--where", "Optional selector using the table's real axis names")
	.action((opts) => {
		if (!opts.rom) {
			console.error("Missing required --rom argument");
			process.exit(1);
		}
		if (!opts.table) {
			console.error("Missing required --table argument");
			process.exit(1);
		}

		runCliAction(async () => {
			const config = loadToolMcpConfig({
				definitionsPath: opts["definitions-path"],
			});
			return handleReadTable(
				resolveCliPath(opts.rom),
				opts.table,
				config,
				opts.where,
				opts.definition ? resolveCliPath(opts.definition) : undefined,
			);
		});
	});

prog.parse(process.argv);
