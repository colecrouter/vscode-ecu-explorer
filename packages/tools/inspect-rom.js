/**
 * inspect-rom - CLI tool for inspecting ROM files and their matched definitions.
 *
 * Outputs YAML/markdown inspection output compatible with MCP formatting.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import {
	findClosestMatches,
	planRomDefinitionResolution,
	ROM_DEFINITION_CONFIDENCE_THRESHOLD,
} from "@ecu-explorer/core";
import { EcuFlashProvider } from "@ecu-explorer/definitions-ecuflash";
import sade from "sade";
import { formatTable } from "../mcp/dist/formatters/table-formatter.js";
import { formatTableListMarkdown } from "../mcp/dist/formatters/table-summary.js";
import { toYamlFrontmatter } from "../mcp/dist/formatters/yaml-formatter.js";
import { resolveCliPath } from "./mcp-cli.js";

/**
 * Converts a filesystem path to a file:// URI.
 * @param {string} fsPath - Filesystem path
 * @returns {string} file:// URI
 */
function toFileUri(fsPath) {
	return `file://${fsPath.replace(/\\/g, "/")}`;
}

/**
 * Resolves a ROM definition for the given ROM file.
 * @param {string} romPath - Path to the ROM file
 * @param {Uint8Array} romBytes - ROM file contents
 * @param {EcuFlashProvider} provider - Definition provider
 * @param {string|undefined} explicitDefinitionPath - Explicit definition path
 * @returns {Promise<any>} Resolved inspection result
 */
async function resolveDefinition(
	romPath,
	romBytes,
	provider,
	explicitDefinitionPath,
) {
	if (explicitDefinitionPath) {
		const definitionUri = toFileUri(explicitDefinitionPath);
		const definition = await provider.parse(definitionUri);
		return { mode: "explicit", definition, definitionUri };
	}

	const plan = await planRomDefinitionResolution(toFileUri(romPath), romBytes, [
		provider,
	]);

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
		throw new Error(
			"Definition resolution requires interactive candidate selection",
		);
	}

	if (plan.kind === "prompt-all") {
		console.error(
			"No matching definition candidates were found. Non-interactive inspection stopped before manual definition selection.",
		);
		throw new Error(
			"Definition resolution requires manual definition selection",
		);
	}

	console.error(
		"No definition files were discovered. Non-interactive inspection stopped before file picker selection.",
	);
	throw new Error("Definition resolution requires manual file selection");
}

/** @param {string} romPath @param {any} definition */
function buildListTablesOutput(romPath, definition) {
	const frontmatter = toYamlFrontmatter({
		rom: romPath,
		definition: definition.name,
		table_count: definition.tables.length,
	});
	return `${frontmatter}\n${formatTableListMarkdown(definition.tables)}`;
}

/** @param {any} definition @param {string} tableName @returns {any} */
function findTableByName(definition, tableName) {
	let tableDef = definition.tables.find(
		/** @param {any} t */ (t) => t.name === tableName,
	);
	if (!tableDef) {
		tableDef = definition.tables.find(
			/** @param {any} t */ (t) =>
				t.name.toLowerCase() === tableName.toLowerCase(),
		);
	}
	if (!tableDef) {
		const tableNames = definition.tables.map(
			/** @param {any} t */ (t) => t.name,
		);
		const suggestions = findClosestMatches(tableName, tableNames, 3, 20);
		const suggestionText =
			suggestions.length > 0
				? `\nDid you mean: ${suggestions.join(", ")}?`
				: "";
		throw new Error(
			`Table "${tableName}" not found in ROM definition "${definition.name}".${suggestionText}`,
		);
	}
	return tableDef;
}

/**
 * Inspects a ROM file and outputs its metadata and tables.
 * @param {string} romPath - Path to the ROM file
 * @param {any} opts - CLI options
 * @returns {Promise<void>}
 */
async function inspectRom(romPath, opts) {
	const definitionsRoot = opts["definitions-root"];
	const definitionsRoots = definitionsRoot
		? [resolveCliPath(definitionsRoot)]
		: [];
	const resolvedRomPath = resolveCliPath(romPath);
	const definitionPath = opts.definition
		? resolveCliPath(opts.definition)
		: undefined;
	const romBytes = new Uint8Array(await fs.readFile(resolvedRomPath));
	const provider = new EcuFlashProvider(definitionsRoots);
	const resolved = await resolveDefinition(
		resolvedRomPath,
		romBytes,
		provider,
		definitionPath,
	);

	if (opts["list-markdown"]) {
		console.log(buildListTablesOutput(resolvedRomPath, resolved.definition));
		return;
	}

	const readTableName = opts["read-table"];
	if (readTableName) {
		const tableDef = findTableByName(resolved.definition, readTableName);
		console.log(formatTable(resolvedRomPath, tableDef, romBytes).content);
		return;
	}

	console.log(buildListTablesOutput(resolvedRomPath, resolved.definition));
}

// Create CLI with Sade
const prog = sade("inspect-rom", true);

prog
	.version("1.0.0")
	.describe("Inspect ROM metadata and tables using YAML/markdown output")
	.example("inspect-rom ./rom.hex")
	.example("inspect-rom ./rom.hex --definition ./definition.xml")
	.example("inspect-rom ./rom.hex --definitions-root ./definitions")
	.example(
		"inspect-rom ./rom.hex --definition ./definition.xml --list-markdown",
	)
	.example(
		'inspect-rom ./rom.hex --definition ./definition.xml --read-table "Fuel Injector Scaling"',
	)
	.option("-d, --definition", "Explicit definition XML override")
	.option("--definitions-root", "Extra search root for auto-discovery")
	.option("--list-markdown", "Print markdown table listing using MCP formatter")
	.option("--read-table", "Read and print a specific table using MCP formatter")
	.option("--rom", "Path to ROM image")
	.action((opts) => {
		if (!opts.rom) {
			console.error("Missing required --rom argument");
			process.exit(1);
		}
		inspectRom(opts.rom, opts).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

prog.parse(process.argv);
