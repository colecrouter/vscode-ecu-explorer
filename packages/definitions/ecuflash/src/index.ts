import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	AxisDefinition,
	ChecksumDefinition,
	ROMDefinition,
	ROMDefinitionProvider,
	ROMDefinitionStub,
	ROMFingerprint,
	ScalarType,
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";
import { mitsucanChecksum } from "@ecu-explorer/core";
import { XMLParser } from "fast-xml-parser";

const DEFAULT_WIN_DIR = "%ProgramFiles(x86)%\\OpenECU\\EcuFlash\\rommetadata";

type Raw = Record<string, unknown>;

type TableNode = {
	name?: string;
	address?: string;
	type?: string;
	category?: string;
	scaling?: string;
	elements?: string;
	swapxy?: string;
	flipy?: string;
	flipx?: string;
	notes?: string;
	data?: string | string[];
	table?: TableNode | TableNode[];
};

type ScalingNode = {
	name?: string;
	storagetype?: string;
	endian?: string;
	toexpr?: string;
	units?: string;
};

type Affine = { scale: number; offset: number };

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	textNodeName: "#text",
	trimValues: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
	if (!v) return [];
	return Array.isArray(v) ? v : [v];
}

function expandWindowsEnv(input: string): string {
	return input.replace(/%([^%]+)%/g, (_m, name: string) => {
		const v = process.env[name];
		return v ?? `%${name}%`;
	});
}

function uriToFsPath(uriOrPath: string): string {
	if (uriOrPath.startsWith("file:")) return fileURLToPath(uriOrPath);
	return uriOrPath;
}

function fsPathToUri(p: string): string {
	return pathToFileURL(p).toString();
}

function parseNumberish(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const v = value.trim();
	if (!v) return undefined;
	// Most ECUFlash addresses are hex, often without a 0x prefix.
	const isHex = /^0x/i.test(v) || /[a-f]/i.test(v);
	const n = Number.parseInt(v.replace(/^0x/i, ""), isHex ? 16 : 10);
	return Number.isFinite(n) ? n : undefined;
}

function parseAddress(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const v = value.trim();
	if (!v) return undefined;
	// ECUFlash addresses are always hex, often without a 0x prefix.
	const n = Number.parseInt(v.replace(/^0x/i, ""), 16);
	return Number.isFinite(n) ? n : undefined;
}

function normalizeHex(hex: string): string {
	return hex.replace(/[^a-fA-F0-9]/g, "");
}

function storageTypeToScalarType(storage?: string): ScalarType {
	switch (storage?.toLowerCase()) {
		case "uint8":
			return "u8";
		case "int8":
			return "i8";
		case "uint16":
			return "u16";
		case "int16":
			return "i16";
		case "uint32":
			return "u32";
		case "int32":
			return "i32";
		case "float":
		case "float32":
			return "f32";
		default:
			// Many ECUFlash scalings are bloblist/bitfields; default raw bytes.
			return "u8";
	}
}

/**
 * Get the byte size of a scalar type
 */
function byteSize(dtype: ScalarType): number {
	switch (dtype) {
		case "u8":
		case "i8":
			return 1;
		case "u16":
		case "i16":
			return 2;
		case "u32":
		case "i32":
		case "f32":
			return 4;
	}
}

function scalingEndianness(endian?: string): "le" | "be" {
	return endian?.toLowerCase() === "big" ? "be" : "le";
}

function tryParseAffineToExpr(toexpr: string | undefined): Affine | null {
	if (!toexpr) return null;
	const expr = toexpr.trim();
	if (!expr) return null;

	// v0: we only accept a very small, safe arithmetic subset that is linear in x.
	// This intentionally rejects any alphabetic characters other than x.
	if (!/^[0-9xX+\-*/().\s]+$/.test(expr)) return null;

	let fn: ((x: number) => number) | null = null;
	try {
		// eslint-disable-next-line no-new-func
		fn = new Function(
			"x",
			`"use strict"; return (${expr.replaceAll("X", "x")});`,
		) as (x: number) => number;
	} catch {
		return null;
	}

	const f0 = fn(0);
	const f1 = fn(1);
	const f2 = fn(2);
	if (![f0, f1, f2].every((n) => Number.isFinite(n))) return null;

	const scale = f1 - f0;
	const offset = f0;
	// Check linearity at x=2.
	const expected2 = offset + scale * 2;
	if (Math.abs(f2 - expected2) > 1e-6) return null;

	return { scale, offset };
}

function affineFromScaling(scaling: ScalingNode | undefined): Affine | null {
	return tryParseAffineToExpr(scaling?.toexpr);
}

/**
 * Parse checksum module name to ChecksumDefinition
 *
 * Maps known ECUFlash checksum module names to checksum definitions.
 * For unknown modules, returns undefined (graceful degradation).
 *
 * @param checksumModule - Name of the checksum module from XML (e.g., "mitsucan")
 * @returns ChecksumDefinition if known, undefined otherwise
 */
function parseChecksumModule(
	checksumModule: string | undefined,
): ChecksumDefinition | undefined {
	if (!checksumModule) return undefined;

	const module = checksumModule.toLowerCase().trim();

	// Mitsubishi CAN checksum (common for Evo X and other Mitsubishi ECUs)
	// 32-bit big-endian word sum fixup algorithm confirmed by analysis of two real ROMs
	// See MITSUCAN_ALGORITHM_FINDINGS.md for details
	if (module === "mitsucan") {
		return {
			algorithm: "custom",
			regions: [{ start: 0x0, end: 0x100000 }],
			storage: {
				offset: 0x0bfff0, // Fixup value stored big-endian at 0x0BFFF0
				size: 4,
				endianness: "be",
			},
			customFunction: mitsucanChecksum,
		};
	}

	// Add other known checksum modules here as needed
	// For example:
	// if (module === "subarucan") { ... }
	// if (module === "nissan") { ... }

	// Unknown checksum module - return undefined for graceful degradation
	return undefined;
}

function extractRom(obj: Raw): Raw | undefined {
	const rom = obj["rom"];
	return (rom as Raw | undefined) ?? undefined;
}

function extractText(v: unknown): string | undefined {
	if (typeof v === "string") return v;
	// fast-xml-parser parses all-digit text content as numbers (e.g. "56890009" → 56890009).
	// Convert numbers back to their string representation so callers receive the raw text.
	if (typeof v === "number") return String(v);
	if (v && typeof v === "object" && "#text" in v) {
		const t = (v as Raw)["#text"];
		if (typeof t === "string") return t;
		if (typeof t === "number") return String(t);
	}
	return undefined;
}

function buildScalingIndex(rom: Raw): Map<string, ScalingNode> {
	const scalings = asArray(
		(rom as Raw)["scaling"] as ScalingNode | ScalingNode[],
	);
	const map = new Map<string, ScalingNode>();
	for (const s of scalings) {
		const name = s?.name;
		if (name) map.set(name, s);
	}
	return map;
}

type TemplateAxis = {
	role: "x" | "y";
	name: string | undefined;
	elements: number | undefined;
	scaling: string | undefined;
	data: number[] | undefined;
};

type TemplateTable = {
	name: string;
	category: string | undefined;
	type: "1D" | "2D" | "3D" | undefined;
	scaling: string | undefined;
	swapxy: boolean;
	axes: TemplateAxis[];
};

function parseTemplateTable(node: TableNode): TemplateTable | null {
	if (!node.name) return null;
	const axes: TemplateAxis[] = [];
	const children = asArray(node.table);
	for (const child of children) {
		const role = child.type?.toLowerCase().includes("x axis")
			? "x"
			: child.type?.toLowerCase().includes("y axis")
				? "y"
				: undefined;
		if (!role) continue;
		axes.push({
			role,
			name: child.name,
			elements: parseNumberish(child.elements) ?? undefined,
			scaling: child.scaling,
			data: (() => {
				const values = asArray(child.data)
					.map((d) => Number.parseFloat(String(d)))
					.filter((n) => Number.isFinite(n));
				return values.length ? values : undefined;
			})(),
		});
	}

	return {
		name: node.name,
		category: node.category,
		type:
			node.type === "1D" || node.type === "2D" || node.type === "3D"
				? node.type
				: undefined,
		scaling: node.scaling,
		swapxy: node.swapxy === "true",
		axes,
	};
}

function buildTemplateIndex(rom: Raw): Map<string, TemplateTable> {
	const out = new Map<string, TemplateTable>();
	const tables = asArray((rom as Raw)["table"] as TableNode | TableNode[]);
	for (const t of tables) {
		const parsed = parseTemplateTable(t);
		if (!parsed) continue;
		if (!out.has(parsed.name)) out.set(parsed.name, parsed);
	}
	return out;
}

async function listXmlFilesRecursive(rootDir: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(dir: string) {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				await walk(p);
				continue;
			}
			if (e.isFile() && p.toLowerCase().endsWith(".xml")) out.push(p);
		}
	}
	await walk(rootDir);
	return out;
}

/**
 * List XML files in a single directory (non-recursive)
 */
async function listXmlFilesInDirectory(dir: string): Promise<string[]> {
	const out: string[] = [];
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const p = path.join(dir, e.name);
		if (e.isFile() && p.toLowerCase().endsWith(".xml")) {
			out.push(p);
		}
	}
	return out;
}

export class EcuFlashProvider implements ROMDefinitionProvider {
	id = "ecuflash";
	label = "ECUFlash";

	private cachedDefinitionUris: string[] | null = null;
	private additionalSearchPaths: string[] = [];

	/**
	 * Create a new EcuFlashProvider
	 * @param searchPaths Additional paths to search for definition files (e.g., workspace folders)
	 */
	constructor(searchPaths: string[] = []) {
		this.additionalSearchPaths = searchPaths;
	}

	/**
	 * Invalidate the cached definition URIs, forcing a re-scan on next access.
	 * Call this when search paths change or when the provider needs to be refreshed.
	 */
	invalidateCache(): void {
		this.cachedDefinitionUris = null;
	}

	/**
	 * Dispose the provider and clear all internal caches.
	 */
	dispose(): void {
		this.cachedDefinitionUris = null;
	}

	async discoverDefinitionUris(romUri?: string): Promise<string[]> {
		// If romUri is provided, search near the ROM file
		if (romUri) {
			return this.discoverDefinitionUrisNearRom(romUri);
		}

		// Otherwise use cached results or search default paths
		if (this.cachedDefinitionUris) return this.cachedDefinitionUris;

		const allFiles: string[] = [];

		// Search default Windows directory
		const rootDir = expandWindowsEnv(DEFAULT_WIN_DIR);
		try {
			const files = await listXmlFilesRecursive(rootDir);
			allFiles.push(...files);
		} catch {
			// Ignore errors if default directory doesn't exist (e.g., on macOS/Linux)
		}

		// Search additional paths (e.g., workspace folders)
		for (const searchPath of this.additionalSearchPaths) {
			try {
				const files = await listXmlFilesRecursive(searchPath);
				allFiles.push(...files);
			} catch {
				// Ignore errors for paths that don't exist
			}
		}

		this.cachedDefinitionUris = allFiles.map(fsPathToUri);
		return this.cachedDefinitionUris;
	}

	/**
	 * Discover definition files near a ROM file
	 * Searches the ROM's directory and parent directories (up to 3 levels)
	 */
	private async discoverDefinitionUrisNearRom(
		romUri: string,
	): Promise<string[]> {
		const allFiles: string[] = [];
		const romPath = uriToFsPath(romUri);
		const romDir = path.dirname(romPath);

		// Search ROM's directory
		try {
			const files = await listXmlFilesInDirectory(romDir);
			allFiles.push(...files);
		} catch {
			// Ignore errors
		}

		// Search parent directories (up to 3 levels)
		let currentDir = romDir;
		for (let i = 0; i < 3; i++) {
			const parentDir = path.dirname(currentDir);
			// Stop if we've reached the root
			if (parentDir === currentDir) break;
			currentDir = parentDir;

			try {
				const files = await listXmlFilesInDirectory(currentDir);
				allFiles.push(...files);
			} catch {
				// Ignore errors
			}
		}

		// Also include cached definitions from default paths
		if (this.cachedDefinitionUris) {
			allFiles.push(...this.cachedDefinitionUris.map(uriToFsPath));
		}

		// Remove duplicates and convert to URIs
		const uniqueFiles = [...new Set(allFiles)];
		return uniqueFiles.map(fsPathToUri);
	}

	async peek(definitionUri: string): Promise<ROMDefinitionStub> {
		const doc = await this.readXml(definitionUri);
		const rom = extractRom(doc);
		if (!rom) {
			return {
				uri: definitionUri,
				name: "ECUFlash Definition",
				fingerprints: [],
			};
		}

		const romid = (rom as Raw)["romid"] as Raw | undefined;
		const xmlid = extractText(romid?.["xmlid"]);
		const internalidaddress = extractText(romid?.["internalidaddress"]);
		const internalidhex = extractText(romid?.["internalidhex"]);

		const name = xmlid ?? internalidhex ?? "ECUFlash Definition";
		const fingerprints: ROMFingerprint[] = [];
		if (internalidaddress && internalidhex) {
			const addr = parseAddress(internalidaddress) ?? 0;
			const expected = normalizeHex(internalidhex);
			fingerprints.push({
				reads: [{ address: addr, length: expected.length / 2 }],
				expectedHex: [expected],
				description: `internalidhex ${expected} at 0x${addr.toString(16)}`,
			});
		}

		return { uri: definitionUri, name, fingerprints };
	}

	async parse(definitionUri: string): Promise<ROMDefinition> {
		const doc = await this.readXml(definitionUri);
		const rom = extractRom(doc);
		if (!rom) {
			const stub = await this.peek(definitionUri);
			return {
				...stub,
				platform: {},
				tables: [],
			};
		}

		const includes = await this.loadIncludes(definitionUri, rom);
		const templates = includes.templates;
		// Merge scalings defined in the main file and included base/template files.
		const scalingIndex = new Map<string, ScalingNode>([
			...includes.scalings.entries(),
			...buildScalingIndex(rom).entries(),
		]);

		const romid = (rom as Raw)["romid"] as Raw | undefined;
		const platform: ROMDefinition["platform"] = {};
		const make = extractText(romid?.["make"]);
		const model = extractText(romid?.["model"]);
		const submodel = extractText(romid?.["submodel"]);
		const market = extractText(romid?.["market"]);
		const transmission = extractText(romid?.["transmission"]);
		const yearText = extractText(romid?.["year"]);
		const yearNum = yearText ? Number.parseInt(yearText, 10) : NaN;
		if (make) platform.make = make;
		if (model) platform.model = model;
		if (submodel) platform.submodel = submodel;
		if (market) platform.market = market;
		if (transmission) platform.transmission = transmission;
		if (Number.isFinite(yearNum)) platform.year = yearNum;

		const stub = await this.peek(definitionUri);
		const tables = this.parseTablesFromDoc(rom, templates, scalingIndex);

		// Parse checksum module if present
		const checksumModule = extractText(romid?.["checksummodule"]);
		const checksum = parseChecksumModule(checksumModule);

		return {
			...stub,
			platform,
			tables,
			...(checksum ? { checksum } : {}),
		};
	}

	private async readXml(definitionUri: string): Promise<Raw> {
		const fsPath = uriToFsPath(definitionUri);
		const raw = await fs.readFile(fsPath, "utf8");
		return xml.parse(raw) as Raw;
	}

	private async loadIncludes(
		definitionUri: string,
		rom: Raw,
	): Promise<{
		templates: Map<string, TemplateTable>;
		scalings: Map<string, ScalingNode>;
	}> {
		const includes = asArray(
			(rom as Raw)["include"] as unknown as string | string[],
		)
			.map((s) => String(s).trim())
			.filter(Boolean);
		if (!includes.length) {
			return { templates: new Map(), scalings: new Map() };
		}

		const currentDir = path.dirname(uriToFsPath(definitionUri));
		const templates = new Map<string, TemplateTable>();
		const scalings = new Map<string, ScalingNode>();

		for (const inc of includes) {
			const candidate = path.join(currentDir, `${inc}.xml`);
			let doc: Raw | null = null;
			try {
				doc = await this.readXml(fsPathToUri(candidate));
			} catch {
				doc = null;
			}
			const baseRom = doc ? extractRom(doc) : undefined;
			if (!baseRom) continue;
			for (const [k, v] of buildTemplateIndex(baseRom).entries()) {
				if (!templates.has(k)) templates.set(k, v);
			}
			for (const [k, v] of buildScalingIndex(baseRom).entries()) {
				if (!scalings.has(k)) scalings.set(k, v);
			}
		}

		return { templates, scalings };
	}

	private parseTablesFromDoc(
		rom: Raw,
		templates: Map<string, TemplateTable>,
		scalings: Map<string, ScalingNode>,
	): TableDefinition[] {
		const out: TableDefinition[] = [];
		const nodes = asArray((rom as Raw)["table"] as TableNode | TableNode[]);

		for (const node of nodes) {
			const name = node.name;
			const address = parseAddress(node.address);
			if (!name || address === undefined) continue;

			const tmpl = templates.get(name);
			const type =
				tmpl?.type ?? (node.type as "1D" | "2D" | "3D" | undefined) ?? "1D";
			const category = tmpl?.category ?? node.category;
			const scalingName = node.scaling ?? tmpl?.scaling;
			const scaling = scalingName ? scalings.get(scalingName) : undefined;
			const affine = affineFromScaling(scaling);

			const z: Table1DDefinition["z"] = {
				name,
				address,
				dtype: storageTypeToScalarType(scaling?.storagetype),
				endianness: scalingEndianness(scaling?.endian),
				// v0: apply simple affine (linear) scalings when possible, otherwise keep raw.
				scale: affine?.scale ?? 1,
				offset: affine?.offset ?? 0,
				...(scaling?.units ? { unit: { symbol: scaling.units } as any } : {}),
			};

			if (type === "1D") {
				const def: Table1DDefinition = {
					kind: "table1d",
					name,
					...(category ? { category } : {}),
					rows: 1,
					z: { ...z, length: 1 },
				};
				out.push(def);
				continue;
			}

			if (type === "2D") {
				const x = this.buildAxisDefinition(
					node,
					tmpl?.axes.find((a) => a.role === "y") ??
						tmpl?.axes.find((a) => a.role === "x"),
					scalings,
				);
				const rows =
					(x && x.kind === "dynamic" ? x.length : undefined) ??
					(x && x.kind === "static" ? x.values.length : undefined) ??
					1;
				const def: Table1DDefinition = {
					kind: "table1d",
					name,
					...(category ? { category } : {}),
					rows,
					...(x ? { x } : {}),
					z: { ...z, length: rows },
				};
				out.push(def);
				continue;
			}

			// ECUFlash 3D tables are 2D surfaces (X and Y axes).
			const swapxy = node.swapxy === "true" || tmpl?.swapxy === true;

			// Build axis definitions WITHOUT swapping
			const x = this.buildAxisDefinition(
				node,
				tmpl?.axes.find((a) => a.role === "x"),
				scalings,
			);
			const y = this.buildAxisDefinition(
				node,
				tmpl?.axes.find((a) => a.role === "y"),
				scalings,
			);

			// Calculate dimensions
			const cols =
				(x && x.kind === "dynamic" ? x.length : undefined) ??
				(x && x.kind === "static" ? x.values.length : undefined) ??
				1;
			const rows =
				(y && y.kind === "dynamic" ? y.length : undefined) ??
				(y && y.kind === "static" ? y.values.length : undefined) ??
				1;

			// For swapxy, adjust strides to read column-major data
			const elementSize = byteSize(
				storageTypeToScalarType(scaling?.storagetype),
			);
			const colStrideBytes = swapxy ? rows * elementSize : undefined;
			const rowStrideBytes = swapxy ? elementSize : undefined;

			const def: Table2DDefinition = {
				kind: "table2d",
				name,
				...(category ? { category } : {}),
				rows,
				cols,
				...(x ? { x } : {}),
				...(y ? { y } : {}),
				z: {
					...z,
					length: rows * cols,
					...(colStrideBytes ? { colStrideBytes } : {}),
					...(rowStrideBytes ? { rowStrideBytes } : {}),
				},
			};
			out.push(def);
		}

		return out;
	}

	private buildAxisDefinition(
		node: TableNode,
		template: TemplateAxis | undefined,
		scalings: Map<string, ScalingNode>,
	): AxisDefinition | undefined {
		// Try to find a child axis table in the definition file.
		const children = asArray(node.table);
		let axisNode: TableNode | undefined;
		if (template?.name) {
			axisNode = children.find((c) => c.name === template.name);
		}
		axisNode ??= children[0];
		if (!axisNode && template?.data && template.data.length) {
			const scalingName = template.scaling;
			const scaling = scalingName ? scalings.get(scalingName) : undefined;
			return {
				kind: "static",
				name: template.name ?? "Axis",
				values: template.data,
				...(scaling?.units ? { unit: { symbol: scaling.units } as any } : {}),
			};
		}
		if (!axisNode) return undefined;

		const axisAddress = parseAddress(axisNode.address);
		const elements =
			parseNumberish(axisNode.elements) ?? template?.elements ?? undefined;
		const scalingName = axisNode.scaling ?? template?.scaling;
		const scaling = scalingName ? scalings.get(scalingName) : undefined;
		const affine = affineFromScaling(scaling);

		if (axisAddress === undefined) {
			const values = asArray(axisNode.data)
				.map((d) => Number.parseFloat(String(d)))
				.filter((n) => Number.isFinite(n));
			if (!values.length) return undefined;
			return {
				kind: "static",
				name: axisNode.name ?? "Axis",
				values,
				...(scaling?.units ? { unit: { symbol: scaling.units } as any } : {}),
			};
		}

		if (!elements) return undefined;
		return {
			kind: "dynamic",
			name: axisNode.name ?? template?.name ?? "Axis",
			address: axisAddress,
			length: elements,
			dtype: storageTypeToScalarType(scaling?.storagetype),
			endianness: scalingEndianness(scaling?.endian),
			scale: affine?.scale ?? 1,
			offset: affine?.offset ?? 0,
			...(scaling?.units ? { unit: { symbol: scaling.units } as any } : {}),
		};
	}
}
