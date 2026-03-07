import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	planRomDefinitionResolution,
	ROM_DEFINITION_CONFIDENCE_THRESHOLD,
	type ROMDefinition,
	type ROMDefinitionCandidate,
	type ROMDefinitionProvider,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import { EcuFlashProvider } from "./index.js";

type CliOptions = {
	romPath: string;
	definitionPath?: string;
	definitionsRoots: string[];
	format: "lines";
};

type ResolvedInspection =
	| {
			mode: "explicit";
			definition: ROMDefinition;
			definitionUri: string;
	  }
	| {
			mode: "auto";
			definition: ROMDefinition;
			definitionUri: string;
			candidates: ROMDefinitionCandidate[];
	  };

function printUsage(): void {
	console.error(
		[
			"Usage: npm run inspect:rom -- --rom <path> [--definition <path>] [--definitions-root <path>]",
			"",
			"Flags:",
			"  --rom <path>                ROM image to inspect (required)",
			"  --definition <path>         Explicit definition XML override",
			"  --definitions-root <path>   Extra search root for auto-discovery (repeatable)",
			"  --format lines              Deterministic line output (default)",
		].join("\n"),
	);
}

function normalizeFsPath(input: string): string {
	return path.resolve(input);
}

function parseArgs(argv: string[]): CliOptions {
	const definitionsRoots: string[] = [];
	let romPath: string | undefined;
	let definitionPath: string | undefined;
	let format: "lines" = "lines";

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--rom") {
			romPath = argv[++i];
		} else if (arg === "--definition") {
			definitionPath = argv[++i];
		} else if (arg === "--definitions-root") {
			const value = argv[++i];
			if (value) definitionsRoots.push(normalizeFsPath(value));
		} else if (arg === "--format") {
			const value = argv[++i];
			if (value !== "lines") {
				throw new Error(`Unsupported format: ${value}`);
			}
			format = value;
		} else if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!romPath) {
		throw new Error("Missing required --rom argument");
	}

	const options: CliOptions = {
		romPath: normalizeFsPath(romPath),
		definitionsRoots: Array.from(new Set(definitionsRoots)),
		format,
	};

	if (definitionPath) {
		options.definitionPath = normalizeFsPath(definitionPath);
	}

	return options;
}

function toFileUri(fsPath: string): string {
	return pathToFileURL(fsPath).toString();
}

function formatValue(value: string | number | boolean | undefined): string {
	if (value === undefined) return "";
	return String(value).replaceAll("\n", "\\n");
}

function printLine(
	kind: string,
	fields: Record<string, string | number | boolean | undefined>,
): void {
	const serialized = Object.entries({ kind, ...fields })
		.map(([key, value]) => `${key}=${JSON.stringify(formatValue(value))}`)
		.join(" ");
	console.log(serialized);
}

function debugLog(
	step: string,
	fields?: Record<string, string | number | boolean>,
): void {
	const serialized = fields
		? ` ${Object.entries(fields)
				.map(([key, value]) => `${key}=${JSON.stringify(formatValue(value))}`)
				.join(" ")}`
		: "";
	console.error(`[inspect:rom] step=${step}${serialized}`);
}

async function resolveDefinition(
	romPath: string,
	romBytes: Uint8Array,
	provider: ROMDefinitionProvider,
	explicitDefinitionPath?: string,
): Promise<ResolvedInspection> {
	if (explicitDefinitionPath) {
		const definitionUri = toFileUri(explicitDefinitionPath);
		debugLog("definition.parse.start", { definitionUri, mode: "explicit" });
		const definition = await provider.parse(definitionUri);
		debugLog("definition.parse.done", {
			definitionUri,
			tables: definition.tables.length,
			mode: "explicit",
		});
		return { mode: "explicit", definition, definitionUri };
	}

	debugLog("definition.plan.start", { romPath });
	const plan = await planRomDefinitionResolution(toFileUri(romPath), romBytes, [
		provider,
	]);
	debugLog("definition.plan.done", { kind: plan.kind });

	if (plan.kind === "auto") {
		return {
			mode: "auto",
			definition: plan.definition,
			definitionUri: plan.definitionUri,
			candidates: plan.candidates,
		};
	}

	if (plan.kind === "prompt-candidate") {
		console.error(
			`No usable definition met confidence threshold ${ROM_DEFINITION_CONFIDENCE_THRESHOLD}. Non-interactive inspection stopped before UI selection.`,
		);
		for (const candidate of plan.candidates.slice(0, 20)) {
			printLine("candidate", {
				provider: candidate.provider.id,
				name: candidate.peek.name,
				uri: candidate.peek.uri,
				score: candidate.score,
			});
		}
		throw new Error(
			"Definition resolution requires interactive candidate selection",
		);
	}

	if (plan.kind === "prompt-all") {
		console.error(
			"No matching definition candidates were found. Non-interactive inspection stopped before manual definition selection.",
		);
		for (const definition of plan.allDefinitions.slice(0, 20)) {
			printLine("candidate", {
				provider: definition.provider.id,
				name: definition.peek.name,
				uri: definition.peek.uri,
				score: 0,
			});
		}
		throw new Error(
			"Definition resolution requires manual definition selection",
		);
	}

	console.error(
		"No definition files were discovered. Non-interactive inspection stopped before file picker selection.",
	);
	throw new Error("Definition resolution requires manual file selection");
}

function emitTable(table: TableDefinition, romBytes: Uint8Array): void {
	const snapshot = snapshotTable(table, romBytes);
	if (snapshot.kind === "table1d") {
		printLine("table", {
			name: table.name,
			tableKind: table.kind,
			category: table.category,
			rows: snapshot.rows,
			cols: snapshot.z.length,
			address: table.z.address,
			dtype: table.z.dtype,
			unit: table.z.unit?.symbol,
			xCount: snapshot.x?.length ?? 0,
			valuesCount: snapshot.z.length,
			firstValue: snapshot.z[0],
			lastValue: snapshot.z[snapshot.z.length - 1],
		});
		return;
	}

	printLine("table", {
		name: table.name,
		tableKind: table.kind,
		category: table.category,
		rows: snapshot.rows,
		cols: snapshot.cols,
		address: table.z.address,
		dtype: table.z.dtype,
		unit: table.z.unit?.symbol,
		xCount: snapshot.x?.length ?? 0,
		yCount: snapshot.y?.length ?? 0,
		firstValue: snapshot.z[0]?.[0],
		lastValue: snapshot.z[snapshot.rows - 1]?.[snapshot.cols - 1],
	});
}

export async function inspectRom(argv: string[]): Promise<void> {
	const options = parseArgs(argv);
	debugLog("rom.read.start", { romPath: options.romPath });
	const romBytes = new Uint8Array(await fs.readFile(options.romPath));
	debugLog("rom.read.done", {
		romPath: options.romPath,
		size: romBytes.length,
	});
	const provider = new EcuFlashProvider(options.definitionsRoots);
	debugLog("provider.ready", {
		provider: provider.id,
		definitionsRoots: options.definitionsRoots.length,
	});
	const resolved = await resolveDefinition(
		options.romPath,
		romBytes,
		provider,
		options.definitionPath,
	);
	debugLog("definition.resolved", {
		mode: resolved.mode,
		definitionUri: resolved.definitionUri,
		tables: resolved.definition.tables.length,
	});

	printLine("rom", {
		path: options.romPath,
		size: romBytes.length,
		definitionMode: resolved.mode,
		definitionUri: resolved.definitionUri,
		tables: resolved.definition.tables.length,
		platformMake: resolved.definition.platform.make,
		platformModel: resolved.definition.platform.model,
		platformYear: resolved.definition.platform.year,
	});

	if (resolved.mode === "auto") {
		for (const [index, candidate] of resolved.candidates
			.slice(0, 5)
			.entries()) {
			printLine("match", {
				rank: index + 1,
				name: candidate.peek.name,
				uri: candidate.peek.uri,
				score: candidate.score,
				selected: candidate.peek.uri === resolved.definitionUri,
			});
		}
	}

	debugLog("table.emit.start", { count: resolved.definition.tables.length });
	for (const table of resolved.definition.tables) {
		emitTable(table, romBytes);
	}
	debugLog("table.emit.done", { count: resolved.definition.tables.length });
}

async function main(): Promise<void> {
	try {
		await inspectRom(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

const isEntrypoint = process.argv[1]
	? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
	: false;

if (isEntrypoint) {
	void main();
}
