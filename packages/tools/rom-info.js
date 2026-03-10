import sade from "sade";
import { handleRomInfo } from "../mcp/dist/tools/rom-info.js";
import { loadToolMcpConfig, resolveCliPath, runCliAction } from "./mcp-cli.js";

const prog = sade("rom-info", true);

prog
	.version("1.0.0")
	.describe("Inspect ROM metadata using the same formatter as the MCP tool")
	.option("--rom", "Path to ROM image")
	.option("-d, --definition", "Optional explicit definition XML override")
	.option(
		"--definitions-path",
		"Optional definitions search path (same meaning as the MCP server)",
	)
	.action((opts) => {
		if (!opts.rom) {
			console.error("Missing required --rom argument");
			process.exit(1);
		}

		runCliAction(async () => {
			const config = loadToolMcpConfig({
				definitionsPath: opts["definitions-path"],
			});
			return handleRomInfo(
				resolveCliPath(opts.rom),
				config,
				opts.definition ? resolveCliPath(opts.definition) : undefined,
			);
		});
	});

prog.parse(process.argv);
