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
	Unit,
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
	"lt-group"?: string;
	"lt-memory-ptr"?: string;
	"lt-memory-blk"?: string;
	swapxy?: string;
	flipy?: string;
	flipx?: string;
	notes?: string;
	data?: string | string[];
	table?: TableNode | TableNode[];
};

function hasLiveTuneOnlyMetadata(node: TableNode): boolean {
	return (
		node.address === undefined &&
		(node["lt-memory-blk"] !== undefined || node["lt-memory-ptr"] !== undefined)
	);
}

function mergeTableNodes(parent: TableNode, child: TableNode): TableNode {
	const merged: TableNode = { ...parent };

	if (child.name !== undefined) merged.name = child.name;
	if (child.address !== undefined) merged.address = child.address;
	if (child.type !== undefined) merged.type = child.type;
	if (child.category !== undefined) merged.category = child.category;
	if (child.scaling !== undefined) merged.scaling = child.scaling;
	if (child.elements !== undefined) merged.elements = child.elements;
	if (child["lt-group"] !== undefined) merged["lt-group"] = child["lt-group"];
	if (child["lt-memory-ptr"] !== undefined)
		merged["lt-memory-ptr"] = child["lt-memory-ptr"];
	if (child["lt-memory-blk"] !== undefined)
		merged["lt-memory-blk"] = child["lt-memory-blk"];
	if (child.swapxy !== undefined) merged.swapxy = child.swapxy;
	if (child.flipy !== undefined) merged.flipy = child.flipy;
	if (child.flipx !== undefined) merged.flipx = child.flipx;
	if (child.notes !== undefined) merged.notes = child.notes;
	if (child.data !== undefined) merged.data = child.data;

	// Merge child tables (axes) by name or role
	const parentChildren = asArray(parent.table);
	const childChildren = asArray(child.table);

	if (childChildren.length > 0) {
		const mergedChildren: TableNode[] = [...parentChildren];

		for (const childAxis of childChildren) {
			const childKey =
				childAxis.name?.trim() ??
				(childAxis.type?.toLowerCase().includes("x axis")
					? "X Axis"
					: childAxis.type?.toLowerCase().includes("y axis")
						? "Y Axis"
						: undefined);

			const existingIndex = mergedChildren.findIndex((p) => {
				const pKey =
					p.name?.trim() ??
					(p.type?.toLowerCase().includes("x axis")
						? "X Axis"
						: p.type?.toLowerCase().includes("y axis")
							? "Y Axis"
							: undefined);
				return pKey !== undefined && pKey === childKey;
			});

			if (existingIndex !== -1) {
				const existing = mergedChildren[existingIndex];
				if (existing) {
					mergedChildren[existingIndex] = mergeTableNodes(existing, childAxis);
				}
			} else {
				mergedChildren.push(childAxis);
			}
		}
		merged.table = mergedChildren;
	}

	return merged;
}

function applyInheritance(nodes: TableNode[]): TableNode[] {
	// allNodes is [parent1, parent2, ..., child] (parents first, child last).
	// We iterate backward so the child is processed first and stored in the map.
	// When a parent is encountered later, existing=child and node=parent, so we
	// call mergeTableNodes(node=parent, existing=child) which lets child fields
	// overwrite parent fields — correct child-wins semantics.
	//
	// Two nodes with the same name are only merged when their addresses are
	// compatible (at least one is undefined). If both have distinct non-undefined
	// addresses they represent separate tables and must be kept independent.
	const mergedByName = new Map<string, TableNode>();
	const extras: TableNode[] = [];

	for (let i = nodes.length - 1; i >= 0; i--) {
		const node = nodes[i];
		if (!node) continue;
		const name = node.name?.trim();
		if (!name) continue;

		const existing = mergedByName.get(name);
		if (existing) {
			const existingAddr = existing.address;
			const nodeAddr = node.address;
			// Only merge when addresses are compatible (inheritance pattern).
			// If both have distinct addresses they are separate tables.
			if (
				existingAddr !== undefined &&
				nodeAddr !== undefined &&
				existingAddr !== nodeAddr
			) {
				extras.push(node);
			} else {
				// existing = child (processed first), node = parent
				// mergeTableNodes(parent, child) → child fields win
				mergedByName.set(name, mergeTableNodes(node, existing));
			}
		} else {
			mergedByName.set(name, node);
		}
	}

	return [...Array.from(mergedByName.values()), ...extras];
}

type ScalingNode = {
	name?: string;
	storagetype?: string;
	endian?: string;
	toexpr?: string;
	frexpr?: string;
	units?: string;
};

type Affine = { scale: number; offset: number };

type ScalingTransform = {
	toPhysical: (raw: number) => number;
	toRaw?: (physical: number) => number;
};

function unitFromScaling(scaling: ScalingNode | undefined): Unit | undefined {
	const symbol = scaling?.units;
	if (!symbol) return undefined;
	const name = scaling?.name?.trim();
	return {
		symbol,
		...(name && name !== symbol ? { name } : {}),
		min: Number.NEGATIVE_INFINITY,
		max: Number.POSITIVE_INFINITY,
		step: 1,
		type: "f32",
		order: "le",
		to: (raw) => raw,
		from: (scaled) => scaled,
	};
}

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

function isXmlDefinitionUri(uriOrPath: string): boolean {
	const fsPath = uriToFsPath(uriOrPath);
	return path.extname(fsPath).toLowerCase() === ".xml";
}

function formatIncludeResolutionError(
	includeToken: string,
	parentDefinitionPath: string,
	searchRoots: string[],
): Error {
	return new Error(
		`Failed to resolve include "${includeToken}" referenced by "${parentDefinitionPath}". Searched sibling/relative paths from the selected definition, configured search roots, and the default ECUFlash metadata path. Search roots: ${searchRoots.join(", ")}. Attempted filename and xmlid lookup in discovered XML files. If this definition was selected from an external/manual folder, also add the parent definition directory to the configured definition search paths or select the full definition set root.`,
	);
}

async function fileExists(fsPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(fsPath);
		return stat.isFile();
	} catch {
		return false;
	}
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

function compileScalingExpression(
	expr: string | undefined,
): ((value: number) => number) | null {
	if (!expr) return null;
	const trimmed = expr.trim();
	if (!trimmed) return null;
	if (!/^[0-9xX+\-*/().\s]+$/.test(trimmed)) return null;

	try {
		// eslint-disable-next-line no-new-func
		const fn = new Function(
			"x",
			`"use strict"; return (${trimmed.replaceAll("X", "x")});`,
		) as (value: number) => number;
		// Use non-zero sample points to avoid false negatives for reciprocal
		// expressions like "29241/x" where x=0 is a singularity but the
		// function is otherwise valid.
		const samples = [1, 2, 3].map((value) => fn(value));
		if (!samples.every((value) => Number.isFinite(value))) return null;
		return fn;
	} catch {
		return null;
	}
}

function transformFromScaling(
	scaling: ScalingNode | undefined,
): ScalingTransform | null {
	if (!scaling) return null;
	const affine = affineFromScaling(scaling);
	if (affine) {
		const toRaw =
			affine.scale !== 0
				? (physical: number) => (physical - affine.offset) / affine.scale
				: undefined;
		return {
			toPhysical: (raw) => raw * affine.scale + affine.offset,
			...(toRaw ? { toRaw } : {}),
		};
	}

	const toPhysical = compileScalingExpression(scaling.toexpr);
	if (!toPhysical) return null;
	const toRaw = compileScalingExpression(scaling.frexpr);
	return { toPhysical, ...(toRaw ? { toRaw } : {}) };
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
	const rom = obj.rom;
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

function normalizeLookupToken(value: string): string {
	return value.trim().toLowerCase();
}

async function readRomXmlId(fsPath: string): Promise<string | undefined> {
	try {
		const raw = await fs.readFile(fsPath, "utf8");
		const romidMatch = raw.match(/<romid\b[^>]*>([\s\S]*?)<\/romid>/i);
		if (!romidMatch) return undefined;
		const xmlidMatch = romidMatch[1]?.match(
			/<xmlid\b[^>]*>([\s\S]*?)<\/xmlid>/i,
		);
		const xmlid = xmlidMatch?.[1]?.trim();
		return xmlid ? xmlid : undefined;
	} catch {
		return undefined;
	}
}

function buildScalingIndex(rom: Raw): Map<string, ScalingNode> {
	const scalings = asArray((rom as Raw).scaling as ScalingNode | ScalingNode[]);
	const map = new Map<string, ScalingNode>();
	for (const s of scalings) {
		const name = s?.name;
		if (name) map.set(name, s);
	}
	return map;
}

function mergeScalingIndex(
	...sources: Array<Map<string, ScalingNode>>
): Map<string, ScalingNode> {
	const merged = new Map<string, ScalingNode>();
	for (const source of sources) {
		for (const [name, scaling] of source.entries()) {
			const existing = merged.get(name);
			if (!existing) {
				merged.set(name, scaling);
				continue;
			}
			merged.set(name, {
				...existing,
				...scaling,
				name,
			});
		}
	}
	return merged;
}

type TemplateAxis = {
	role: "x" | "y";
	name: string | undefined;
	elements: number | undefined;
	scaling: string | undefined;
	data: number[] | undefined;
	address: number | undefined;
};

type ParsedChildAxis = Omit<TemplateAxis, "role"> & {
	role?: "x" | "y";
};

type TemplateTable = {
	id: string;
	name: string;
	category: string | undefined;
	type: "1D" | "2D" | "3D" | undefined;
	scaling: string | undefined;
	address: number | undefined;
	swapxy: boolean;
	axes: TemplateAxis[];
};

function parseTemplateTable(node: TableNode): TemplateTable | null {
	if (!node.name) return null;
	const address = parseAddress(node.address);
	const axes: TemplateAxis[] = [];
	const unnamedAxes: ParsedChildAxis[] = [];
	const children = asArray(node.table);
	for (const child of children) {
		const role = child.type?.toLowerCase().includes("x axis")
			? "x"
			: child.type?.toLowerCase().includes("y axis")
				? "y"
				: undefined;
		const parsedAxis: ParsedChildAxis = {
			name: child.name,
			elements: parseNumberish(child.elements) ?? undefined,
			scaling: child.scaling,
			address: parseAddress(child.address),
			data: (() => {
				const values = asArray(child.data)
					.map((d) => Number.parseFloat(String(d)))
					.filter((n) => Number.isFinite(n));
				return values.length ? values : undefined;
			})(),
			...(role ? { role } : {}),
		};
		if (role) {
			axes.push({ ...parsedAxis, role });
			continue;
		}
		unnamedAxes.push(parsedAxis);
	}

	const assignFallbackAxis = (role: "x" | "y") => {
		if (axes.some((axis) => axis.role === role)) return;
		const fallback = unnamedAxes.shift();
		if (!fallback) return;
		axes.push({
			role,
			name: fallback.name,
			elements: fallback.elements,
			scaling: fallback.scaling,
			address: fallback.address,
			data: fallback.data,
		});
	};

	if (children.length === 1) {
		assignFallbackAxis("x");
	}
	if (children.length >= 2) {
		assignFallbackAxis("x");
		assignFallbackAxis("y");
	}

	return {
		id: buildEcuFlashTableId(node.name, address, node.category),
		name: node.name,
		category: node.category,
		type:
			node.type === "1D" || node.type === "2D" || node.type === "3D"
				? node.type
				: undefined,
		scaling: node.scaling,
		address,
		swapxy: node.swapxy === "true",
		axes,
	};
}

function buildEcuFlashTableId(
	name: string,
	address: number | undefined,
	category: string | undefined,
): string {
	const normalizedName = name.trim();
	const normalizedCategory = category?.trim() || "uncategorized";
	const normalizedAddress =
		address !== undefined ? `0x${address.toString(16)}` : "noaddr";
	return `${normalizedName}::${normalizedCategory}::${normalizedAddress}`;
}

function buildParsedTableId(
	tableName: string,
	category: string | undefined,
	address: number | undefined,
	axisIdentity: string | undefined = undefined,
): string {
	const baseId = buildEcuFlashTableId(tableName, address, category);
	return axisIdentity ? `${baseId}::${axisIdentity}` : baseId;
}

function buildAxisIdentity(
	axis: AxisDefinition | undefined,
): string | undefined {
	if (!axis) return undefined;
	if (axis.kind === "dynamic") {
		return `${axis.name}::0x${axis.address.toString(16)}`;
	}
	return `${axis.name}::static::${axis.values.length}`;
}

function buildTableAxisIdentity(
	x: AxisDefinition | undefined,
	y: AxisDefinition | undefined,
): string | undefined {
	const axisParts = [
		x ? `x=${buildAxisIdentity(x)}` : undefined,
		y ? `y=${buildAxisIdentity(y)}` : undefined,
	].filter((value): value is string => Boolean(value));
	return axisParts.length > 0 ? axisParts.join("|") : undefined;
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([a], [b]) => a.localeCompare(b));
		return `{${entries
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function areStructurallyIdenticalTables(
	left: TableDefinition,
	right: TableDefinition,
): boolean {
	return stableSerialize(left) === stableSerialize(right);
}

function collapseExactDuplicateTables(
	tables: TableDefinition[],
): TableDefinition[] {
	const deduped: TableDefinition[] = [];
	const tablesById = new Map<string, TableDefinition[]>();

	for (const table of tables) {
		const existing = tablesById.get(table.id) ?? [];
		const exactDuplicate = existing.find((candidate) =>
			areStructurallyIdenticalTables(candidate, table),
		);
		if (exactDuplicate) {
			continue;
		}
		existing.push(table);
		tablesById.set(table.id, existing);
		deduped.push(table);
	}

	const conflictingDuplicates = [...tablesById.entries()]
		.filter(([, groupedTables]) => groupedTables.length > 1)
		.map(([id, groupedTables]) => `${id} (${groupedTables.length})`)
		.sort((a, b) => a.localeCompare(b));

	if (conflictingDuplicates.length > 0) {
		throw new Error(
			`ECUFlash definition produced conflicting duplicate stable table ids: ${conflictingDuplicates.join(", ")}`,
		);
	}

	return deduped;
}

function buildTemplateIndex(rom: Raw): Map<string, TemplateTable> {
	const out = new Map<string, TemplateTable>();
	const tables = asArray((rom as Raw).table as TableNode | TableNode[]);
	for (const t of tables) {
		const parsed = parseTemplateTable(t);
		if (!parsed) continue;
		const existing = out.get(parsed.name);
		if (!existing) {
			out.set(parsed.name, parsed);
			continue;
		}

		const axesByRole = new Map<TemplateAxis["role"], TemplateAxis>();
		for (const axis of existing.axes) axesByRole.set(axis.role, axis);
		for (const axis of parsed.axes) {
			const current = axesByRole.get(axis.role);
			axesByRole.set(axis.role, {
				role: axis.role,
				name: axis.name ?? current?.name,
				elements: axis.elements ?? current?.elements,
				scaling: axis.scaling ?? current?.scaling,
				address: axis.address ?? current?.address,
				data: axis.data ?? current?.data,
			});
		}

		out.set(parsed.name, {
			id: parsed.id,
			name: parsed.name,
			category: parsed.category ?? existing.category,
			type: parsed.type ?? existing.type,
			scaling: parsed.scaling ?? existing.scaling,
			address: parsed.address ?? existing.address,
			swapxy: parsed.swapxy || existing.swapxy,
			axes: [...axesByRole.values()],
		});
	}
	return out;
}

type TableShape = "scalar" | "1d" | "2d";

function inferShapeFromChildCount(childCount: number): TableShape | undefined {
	if (childCount === 0) return "scalar";
	if (childCount === 1) return "1d";
	if (childCount === 2) return "2d";
	return undefined;
}

function inferNodeShape(node: TableNode | undefined): TableShape | undefined {
	if (!node) return undefined;
	return inferShapeFromChildCount(asArray(node.table).length);
}

function inferTemplateShape(
	template: TemplateTable | undefined,
): TableShape | undefined {
	if (!template) return undefined;
	if (template.axes.length > 0) {
		return inferShapeFromChildCount(template.axes.length);
	}
	if (template.type === "1D") return "scalar";
	if (template.type === "2D") return "1d";
	if (template.type === "3D") return "2d";
	return undefined;
}

function describeShape(shape: TableShape): string {
	switch (shape) {
		case "scalar":
			return "scalar/1x1";
		case "1d":
			return "1D";
		case "2d":
			return "2D";
	}
}

function resolveTableShape(
	node: TableNode,
	template: TemplateTable | undefined,
): TableShape {
	const nodeShape = inferNodeShape(node);
	const templateShape = inferTemplateShape(template);
	const explicitTypeShape = template?.type
		? inferTemplateShape({ ...template, axes: [] })
		: undefined;
	const resolvedShape =
		nodeShape ?? templateShape ?? explicitTypeShape ?? "scalar";

	if (
		nodeShape &&
		templateShape &&
		nodeShape !== templateShape &&
		nodeShape !== "scalar"
	) {
		throw new Error(
			`ECUFlash table "${node.name ?? "<unnamed>"}" has conflicting inherited shape metadata: local child count implies ${describeShape(nodeShape)} but inherited metadata implies ${describeShape(templateShape)}.`,
		);
	}

	return resolvedShape;
}

function axisLength(axis: AxisDefinition | undefined): number | undefined {
	if (!axis) return undefined;
	return axis.kind === "dynamic" ? axis.length : axis.values.length;
}

function hasInheritedAxisMetadata(
	node: TableNode,
	template: TemplateTable | undefined,
): boolean {
	return asArray(node.table).length > 0 || Boolean(template?.axes.length);
}

function assertResolvedAxisLength(
	tableName: string,
	axisRole: "x" | "y",
	axis: AxisDefinition | undefined,
	node: TableNode,
	template: TemplateTable | undefined,
): number {
	const length = axisLength(axis);
	if (length !== undefined) return length;
	if (hasInheritedAxisMetadata(node, template)) {
		throw new Error(
			`ECUFlash inherited table "${tableName}" could not resolve canonical ${axisRole.toUpperCase()}-axis dimensions from local/inherited child metadata.`,
		);
	}
	throw new Error(
		`ECUFlash table "${tableName}" requires a ${axisRole.toUpperCase()} axis but none could be resolved.`,
	);
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
	private includeAliasIndex: Map<string, string> | null = null;

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
		this.includeAliasIndex = null;
	}

	/**
	 * Dispose the provider and clear all internal caches.
	 */
	dispose(): void {
		this.cachedDefinitionUris = null;
		this.includeAliasIndex = null;
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

	canParseDefinitionUri(definitionUri: string): boolean {
		return isXmlDefinitionUri(definitionUri);
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

		const romid = (rom as Raw).romid as Raw | undefined;
		const xmlid = extractText(romid?.xmlid);
		const internalidaddress = extractText(romid?.internalidaddress);
		const internalidhex = extractText(romid?.internalidhex);

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
		const scalingIndex = mergeScalingIndex(
			includes.scalings,
			buildScalingIndex(rom),
		);
		const inheritedRom = {
			...rom,
			table: [
				...asArray(includes.tables),
				...asArray((rom as Raw).table as TableNode | TableNode[]),
			],
		};

		const romid = (rom as Raw).romid as Raw | undefined;
		const platform: ROMDefinition["platform"] = {};
		const make = extractText(romid?.make);
		const model = extractText(romid?.model);
		const submodel = extractText(romid?.submodel);
		const market = extractText(romid?.market);
		const transmission = extractText(romid?.transmission);
		const yearText = extractText(romid?.year);
		const yearNum = yearText ? Number.parseInt(yearText, 10) : NaN;
		if (make) platform.make = make;
		if (model) platform.model = model;
		if (submodel) platform.submodel = submodel;
		if (market) platform.market = market;
		if (transmission) platform.transmission = transmission;
		if (Number.isFinite(yearNum)) platform.year = yearNum;

		const stub = await this.peek(definitionUri);
		const tables = collapseExactDuplicateTables(
			this.parseTablesFromDoc(inheritedRom, templates, scalingIndex),
		);

		// Parse checksum module if present
		const checksumModule = extractText(romid?.checksummodule);
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
		tables: TableNode[];
	}> {
		const rootDefinitionPath = path.resolve(uriToFsPath(definitionUri));
		const parentDirectories: string[] = [];
		let currentDirectory = path.dirname(rootDefinitionPath);
		for (let i = 0; i < 3; i++) {
			parentDirectories.push(currentDirectory);
			const nextDirectory = path.dirname(currentDirectory);
			if (nextDirectory === currentDirectory) {
				break;
			}
			currentDirectory = nextDirectory;
		}

		const searchRoots = [
			...parentDirectories,
			...this.additionalSearchPaths,
			expandWindowsEnv(DEFAULT_WIN_DIR),
		]
			.map((p) => path.resolve(p))
			.filter((p, i, arr) => arr.indexOf(p) === i);

		const templates = new Map<string, TemplateTable>();
		const scalings = new Map<string, ScalingNode>();
		const tables: TableNode[] = [];
		const visited = new Set<string>([rootDefinitionPath]);
		const recursiveFileCache = new Map<string, string[]>();
		const includeXmlIdLookupCache = new Map<string, string | null>();
		const fileXmlIdCache = new Map<string, string | null>();

		const getIncludeAliasIndex = async (): Promise<Map<string, string>> => {
			if (this.includeAliasIndex) return this.includeAliasIndex;
			const index = new Map<string, string>();
			for (const root of searchRoots) {
				const files = await recursiveXmlFilesForRoot(root);
				for (const file of files) {
					const baseName = path.basename(file, ".xml");
					const normalizedBase = normalizeLookupToken(baseName);
					if (normalizedBase && !index.has(normalizedBase)) {
						index.set(normalizedBase, file);
					}
					const dashed = baseName.match(/^(\d{8})\b/);
					if (dashed) {
						const shortId = dashed[1];
						if (!shortId) continue;
						const normalizedShort = normalizeLookupToken(shortId);
						if (normalizedShort && !index.has(normalizedShort)) {
							index.set(normalizedShort, file);
						}
					}
					const fileXmlId = await readRomXmlId(file);
					if (!fileXmlId) continue;
					const normalizedXmlId = normalizeLookupToken(fileXmlId);
					if (normalizedXmlId && !index.has(normalizedXmlId)) {
						index.set(normalizedXmlId, file);
					}
				}
			}
			this.includeAliasIndex = index;
			return index;
		};

		const includeTokensFrom = (parentRom: Raw): string[] =>
			asArray((parentRom as Raw).include as string | string[])
				.map((s) => String(s).trim())
				.filter(Boolean);

		const includePathCandidates = (includeToken: string): string[] => {
			const normalized = path.normalize(includeToken.trim());
			if (!normalized) return [];
			if (path.isAbsolute(normalized)) {
				return normalized.toLowerCase().endsWith(".xml")
					? [normalized]
					: [normalized, `${normalized}.xml`];
			}
			if (normalized.toLowerCase().endsWith(".xml")) return [normalized];
			return [normalized, `${normalized}.xml`];
		};

		const recursiveXmlFilesForRoot = async (
			root: string,
		): Promise<string[]> => {
			const cached = recursiveFileCache.get(root);
			if (cached) return cached;
			const files = await listXmlFilesRecursive(root);
			files.sort((a, b) => a.localeCompare(b));
			recursiveFileCache.set(root, files);
			return files;
		};

		const resolveIncludePath = async (
			parentDefinitionPath: string,
			includeToken: string,
		): Promise<string> => {
			const candidates = includePathCandidates(includeToken);
			const normalizedLookupToken = normalizeLookupToken(includeToken);

			for (const candidate of candidates) {
				const siblingCandidate = path.resolve(
					path.dirname(parentDefinitionPath),
					candidate,
				);
				if (await fileExists(siblingCandidate)) {
					return siblingCandidate;
				}
			}

			for (const root of searchRoots) {
				for (const candidate of candidates) {
					const rootedCandidate = path.resolve(root, candidate);
					if (await fileExists(rootedCandidate)) {
						return rootedCandidate;
					}
				}
			}

			const includeAliasIndex = await getIncludeAliasIndex();
			const aliased = includeAliasIndex.get(normalizedLookupToken);
			if (aliased && (await fileExists(aliased))) {
				includeXmlIdLookupCache.set(normalizedLookupToken, aliased);
				return aliased;
			}

			if (includeXmlIdLookupCache.has(normalizedLookupToken)) {
				const cachedPath = includeXmlIdLookupCache.get(normalizedLookupToken);
				if (cachedPath && (await fileExists(cachedPath))) {
					return cachedPath;
				}
				if (cachedPath === null) {
					throw formatIncludeResolutionError(
						includeToken,
						parentDefinitionPath,
						searchRoots,
					);
				}
			}

			const lowerBasenames = new Set(
				candidates.map((c) => path.basename(c).toLowerCase()),
			);

			for (const root of searchRoots) {
				const files = await recursiveXmlFilesForRoot(root);
				for (const file of files) {
					const base = path.basename(file).toLowerCase();
					if (lowerBasenames.has(base)) {
						return file;
					}
				}
			}

			for (const root of searchRoots) {
				const files = await recursiveXmlFilesForRoot(root);
				for (const file of files) {
					let fileXmlId: string | null;
					if (fileXmlIdCache.has(file)) {
						fileXmlId = fileXmlIdCache.get(file) ?? null;
					} else {
						fileXmlId = (await readRomXmlId(file)) ?? null;
						fileXmlIdCache.set(file, fileXmlId);
					}
					if (!fileXmlId) continue;
					if (normalizeLookupToken(fileXmlId) === normalizedLookupToken) {
						includeXmlIdLookupCache.set(normalizedLookupToken, file);
						return file;
					}
				}
			}

			includeXmlIdLookupCache.set(normalizedLookupToken, null);

			throw formatIncludeResolutionError(
				includeToken,
				parentDefinitionPath,
				searchRoots,
			);
		};

		const visitIncludes = async (
			parentDefinitionPath: string,
			parentRom: Raw,
		): Promise<void> => {
			const tokens = includeTokensFrom(parentRom);
			// Process includes in order.
			for (const includeToken of tokens) {
				if (!includeToken) continue;
				const includePath = path.resolve(
					await resolveIncludePath(parentDefinitionPath, includeToken),
				);
				if (visited.has(includePath)) {
					continue;
				}
				visited.add(includePath);

				const includeDoc = await this.readXml(fsPathToUri(includePath));
				const includeRom = extractRom(includeDoc);
				if (!includeRom) continue;

				await visitIncludes(includePath, includeRom);

				// Push to the FRONT of the array so that parents come BEFORE children
				// in the final allNodes array.
				tables.unshift(
					...asArray((includeRom as Raw).table as TableNode | TableNode[]),
				);

				for (const [k, v] of buildTemplateIndex(includeRom).entries()) {
					if (!templates.has(k)) templates.set(k, v);
				}
				for (const [k, v] of buildScalingIndex(includeRom).entries()) {
					scalings.set(k, v);
				}
			}
		};

		await visitIncludes(rootDefinitionPath, rom);

		return { templates, scalings, tables };
	}

	private parseTablesFromDoc(
		rom: Raw,
		templates: Map<string, TemplateTable>,
		scalings: Map<string, ScalingNode>,
	): TableDefinition[] {
		const out: TableDefinition[] = [];
		const allNodes = asArray((rom as Raw).table as TableNode | TableNode[]);

		// Apply basic inheritance model: merge by name, child overwrites parent
		const nodes = applyInheritance(allNodes);

		for (const node of nodes) {
			try {
				const name = node.name;
				if (!name) continue;
				if (hasLiveTuneOnlyMetadata(node)) continue;

				const tmpl = templates.get(name);
				if (
					tmpl &&
					hasLiveTuneOnlyMetadata(node) &&
					node.address === undefined
				) {
					continue;
				}
				const address = parseAddress(node.address) ?? tmpl?.address;
				if (address === undefined) continue;
				const shape = resolveTableShape(node, tmpl);
				const category = tmpl?.category ?? node.category;
				const scalingName = node.scaling ?? tmpl?.scaling;
				const scaling = scalingName ? scalings.get(scalingName) : undefined;
				const affine = affineFromScaling(scaling);
				const transform = transformFromScaling(scaling);
				const zUnit = unitFromScaling(scaling);

				const z: Table1DDefinition["z"] = {
					id: buildParsedTableId(name, category, address),
					name,
					address,
					dtype: storageTypeToScalarType(scaling?.storagetype),
					endianness: scalingEndianness(scaling?.endian),
					// v0: apply simple affine (linear) scalings when possible, otherwise keep raw.
					scale: affine?.scale ?? 1,
					offset: affine?.offset ?? 0,
					...(transform && !affine
						? {
								transform: transform.toPhysical,
								...(transform.toRaw
									? { inverseTransform: transform.toRaw }
									: {}),
							}
						: {}),
					...(zUnit ? { unit: zUnit } : {}),
				};

				if (shape === "scalar") {
					const def: Table1DDefinition = {
						id: buildParsedTableId(name, category, address),
						kind: "table1d",
						name,
						...(category ? { category } : {}),
						rows: 1,
						z: { ...z, length: 1 },
					};
					out.push(def);
					continue;
				}

				if (shape === "1d") {
					const x = this.buildAxisDefinition(
						node,
						tmpl?.axes.find((a) => a.role === "y") ??
							tmpl?.axes.find((a) => a.role === "x"),
						scalings,
					);
					const rows = assertResolvedAxisLength(name, "x", x, node, tmpl);
					const stableTableId = buildParsedTableId(
						name,
						category,
						address,
						buildTableAxisIdentity(x, undefined),
					);
					const def: Table1DDefinition = {
						id: stableTableId,
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

				// ECUFlash 3D tables are 2D surfaces (X and Y axes), but inherited
				// shape resolution is driven by child-axis count rather than XML type label.
				const swapxy = node.swapxy === "true" || tmpl?.swapxy === true;

				// Build axis definitions WITHOUT swapping
				const x = this.buildAxisDefinition(
					node,
					tmpl?.axes.find((a) => a.role === "x"),
					scalings,
					"x",
				);
				const y = this.buildAxisDefinition(
					node,
					tmpl?.axes.find((a) => a.role === "y"),
					scalings,
					"y",
				);

				// Calculate dimensions
				const cols = assertResolvedAxisLength(name, "x", x, node, tmpl);
				const rows = assertResolvedAxisLength(name, "y", y, node, tmpl);
				const stableTableId = buildParsedTableId(
					name,
					category,
					address,
					buildTableAxisIdentity(x, y),
				);

				// For swapxy, adjust strides to read column-major data
				const elementSize = byteSize(
					storageTypeToScalarType(scaling?.storagetype),
				);
				const colStrideBytes = swapxy ? rows * elementSize : undefined;
				const rowStrideBytes = swapxy ? elementSize : undefined;

				const def: Table2DDefinition = {
					id: stableTableId,
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
			} catch (error) {
				console.warn(
					`[EcuFlashProvider] Skipping table ${JSON.stringify(node.name ?? "<unnamed>")}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return out;
	}

	private buildAxisDefinition(
		node: TableNode,
		template: TemplateAxis | undefined,
		scalings: Map<string, ScalingNode>,
		preferredRole?: "x" | "y",
	): AxisDefinition | undefined {
		// Try to find a child axis table in the definition file.
		const children = asArray(node.table);
		let axisNode: TableNode | undefined;
		if (template?.name) {
			axisNode = children.find((c) => c.name === template.name);
		}
		if (!axisNode && preferredRole) {
			axisNode = children.find((c) =>
				(c.type ?? "").toLowerCase().includes(`${preferredRole} axis`),
			);
		}
		axisNode ??= children[0];
		if (!axisNode && template?.data && template.data.length) {
			const scalingName = template.scaling;
			const scaling = scalingName ? scalings.get(scalingName) : undefined;
			const unit = unitFromScaling(scaling);
			return {
				id: `${template.name ?? "Axis"}::static`,
				kind: "static",
				name: template.name ?? "Axis",
				values: template.data,
				...(unit ? { unit } : {}),
			};
		}
		if (!axisNode) return undefined;

		const axisAddress = parseAddress(axisNode.address);
		const elements =
			parseNumberish(axisNode.elements) ?? template?.elements ?? undefined;
		const scalingName = axisNode.scaling ?? template?.scaling;
		const scaling = scalingName ? scalings.get(scalingName) : undefined;
		const affine = affineFromScaling(scaling);
		const transform = transformFromScaling(scaling);
		const hasUnresolvedNamedScaling = Boolean(scalingName) && !scaling;
		const inheritedAxisAddress = axisAddress ?? template?.address;

		if (inheritedAxisAddress === undefined) {
			const values = asArray(axisNode.data)
				.map((d) => Number.parseFloat(String(d)))
				.filter((n) => Number.isFinite(n));
			const inheritedValues = values.length ? values : template?.data;
			if (!inheritedValues?.length) return undefined;
			const unit = unitFromScaling(scaling);
			return {
				id: `${axisNode.name ?? "Axis"}::static`,
				kind: "static",
				name: axisNode.name ?? "Axis",
				values: inheritedValues,
				...(unit ? { unit } : {}),
			};
		}

		if (!elements) return undefined;
		// Dynamic axes with an unresolved named scaling default to u16 big-endian.
		// This matches observed ECUFlash axis storage for this unresolved-scaling case.
		const inferredDynamicAxisDtype = hasUnresolvedNamedScaling
			? "u16"
			: storageTypeToScalarType(scaling?.storagetype);
		const inferredDynamicAxisEndianness = hasUnresolvedNamedScaling
			? "be"
			: scalingEndianness(scaling?.endian);
		const unit = unitFromScaling(scaling);
		return {
			id: `${axisNode.name ?? template?.name ?? "Axis"}::0x${inheritedAxisAddress.toString(16)}`,
			kind: "dynamic",
			name: axisNode.name ?? template?.name ?? "Axis",
			address: inheritedAxisAddress,
			length: elements,
			dtype: inferredDynamicAxisDtype,
			endianness: inferredDynamicAxisEndianness,
			scale: affine?.scale ?? 1,
			offset: affine?.offset ?? 0,
			...(transform && !affine
				? {
						transform: transform.toPhysical,
						...(transform.toRaw ? { inverseTransform: transform.toRaw } : {}),
					}
				: {}),
			...(unit ? { unit } : {}),
		};
	}
}
