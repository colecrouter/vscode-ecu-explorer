import sade from "sade";
import { handlePatchTable } from "../mcp/dist/tools/patch-table.js";
import {
	loadToolMcpConfig,
	parseOptionalNumber,
	resolveCliPath,
	runCliAction,
} from "./mcp-cli.js";

const prog = sade("patch-table", true);

prog
	.version("1.0.0")
	.describe("Patch a ROM table using the same selector and formatter as MCP")
	.option("--rom", "Path to ROM image")
	.option("--table", "Table name from list-tables")
	.option("-d, --definition", "Optional explicit definition XML override")
	.option("--definitions-path", "Optional definitions search path")
	.option("--op", "Operation: set, add, multiply, clamp, or smooth")
	.option("--value", "Operand for set/add/multiply")
	.option("--min", "Lower bound for clamp")
	.option("--max", "Upper bound for clamp")
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
		if (!opts.op) {
			console.error("Missing required --op argument");
			process.exit(1);
		}

		runCliAction(async () => {
			const config = loadToolMcpConfig({
				definitionsPath: opts["definitions-path"],
			});
			/** @type {Parameters<typeof handlePatchTable>[0]} */
			const patchOptions = {
				rom: resolveCliPath(opts.rom),
				table: opts.table,
				op: opts.op,
			};
			if (opts.definition !== undefined) {
				patchOptions.definitionPath = resolveCliPath(opts.definition);
			}
			const value = parseOptionalNumber(opts.value, "value");
			if (value !== undefined) patchOptions.value = value;
			const min = parseOptionalNumber(opts.min, "min");
			if (min !== undefined) patchOptions.min = min;
			const max = parseOptionalNumber(opts.max, "max");
			if (max !== undefined) patchOptions.max = max;
			if (opts.where !== undefined) patchOptions.where = opts.where;
			return handlePatchTable(patchOptions, config);
		});
	});

prog.parse(process.argv);
