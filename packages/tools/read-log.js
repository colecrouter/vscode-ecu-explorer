import sade from "sade";
import { handleReadLog } from "../mcp/dist/tools/read-log.js";
import {
	loadToolMcpConfig,
	parseCommaSeparatedList,
	parseOptionalNumber,
	runCliAction,
} from "./mcp-cli.js";

const prog = sade("read-log", true);

prog
	.version("1.0.0")
	.describe("Read a log schema or selected slice using the MCP log formatter")
	.option("--file", "Filename from list-logs")
	.option("--logs-dir", "Optional log directory override")
	.option("--where", "Optional row filter expression")
	.option("--channels", "Optional comma-separated channel subset")
	.option("--start-s", "Optional start time in seconds")
	.option("--end-s", "Optional end time in seconds")
	.option("--before-ms", "Optional context window before each match")
	.option("--after-ms", "Optional context window after each match")
	.option("--step-ms", "Optional minimum time spacing between rows")
	.action((opts) => {
		if (!opts.file) {
			console.error("Missing required --file argument");
			process.exit(1);
		}

		runCliAction(async () => {
			const config = loadToolMcpConfig({
				logsDir: opts["logs-dir"],
			});
			/** @type {Parameters<typeof handleReadLog>[0]} */
			const readOptions = {
				file: opts.file,
			};
			if (opts.where !== undefined) readOptions.where = opts.where;
			const channels = parseCommaSeparatedList(opts.channels);
			if (channels !== undefined) readOptions.channels = channels;
			const startS = parseOptionalNumber(opts["start-s"], "start-s", 0);
			if (startS !== undefined) readOptions.startS = startS;
			const endS = parseOptionalNumber(opts["end-s"], "end-s", 0);
			if (endS !== undefined) readOptions.endS = endS;
			const beforeMs = parseOptionalNumber(opts["before-ms"], "before-ms", 0);
			if (beforeMs !== undefined) readOptions.beforeMs = beforeMs;
			const afterMs = parseOptionalNumber(opts["after-ms"], "after-ms", 0);
			if (afterMs !== undefined) readOptions.afterMs = afterMs;
			const stepMs = parseOptionalNumber(opts["step-ms"], "step-ms", 1);
			if (stepMs !== undefined) readOptions.stepMs = stepMs;
			return handleReadLog(readOptions, config);
		});
	});

prog.parse(process.argv);
