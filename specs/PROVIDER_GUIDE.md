# Provider Guide

## Overview

The provider system enables the ECU Explorer to support multiple definition file formats and sources. Providers are pluggable implementations that discover, peek at, and parse ROM definition files.

### Why Providers Are Pluggable

- **Format diversity**: Different tuning tools use different definition formats (ECUFlash XML, TunerPro XDF, WinOLS ODX, etc.)
- **Source flexibility**: Definitions may come from local directories, cloud services, or embedded resources
- **Extensibility**: New providers can be added without modifying core code
- **Isolation**: Each provider handles its own parsing logic and error handling

### Current Providers

- **ECUFlash** (`ecuflash`): Parses ECUFlash XML definition files with support for includes and templates

### Future Providers

- **TunerPro** (`tunerpro`): XDF format support
- **WinOLS** (`winoils`): ODX format support
- **Custom** (`custom`): User-defined JSON definitions

---

## Provider Interface Specification

All providers must implement the [`ROMDefinitionProvider`](../packages/core/src/definition/provider.ts) interface:

```typescript
export interface ROMDefinitionProvider {
	/**
	 * Internal ID
	 *
	 * @example "ecuflash" | "cobb" | "hptuners"
	 */
	id: string;
	/** Human-readable label */
	label: string;

	/**
	 * Discover candidate definition files for this provider.
	 *
	 * @remarks
	 * This returns file URIs as strings so that it works in Node (VS Code extension host)
	 * and can be persisted in workspace state.
	 */
	discoverDefinitionUris(): Promise<string[]>;

	/** Quickly preview minimal metadata and fingerprints without full parse */
	peek(definitionUri: string): Promise<ROMDefinitionStub>;

	/** Parse a definition file into a normalized schema */
	parse(definitionUri: string): Promise<ROMDefinition>;
}
```

### Required Methods

#### `discoverDefinitionUris(): Promise<string[]>`

**Purpose**: Find all available definition files for this provider.

**Returns**: Array of file URIs (e.g., `file:///path/to/definition.xml`)

**Behavior**:
- Search default directories (e.g., ECUFlash installation folder)
- Search user-configured paths from workspace settings
- Return empty array if no definitions found
- May cache results for performance

**Example**:
```typescript
async discoverDefinitionUris(): Promise<string[]> {
	const rootDir = expandWindowsEnv(DEFAULT_WIN_DIR);
	const files = await listXmlFilesRecursive(rootDir);
	return files.map(fsPathToUri);
}
```

#### `peek(definitionUri: string): Promise<ROMDefinitionStub>`

**Purpose**: Quickly extract metadata and fingerprints without full parsing.

**Returns**: [`ROMDefinitionStub`](../packages/core/src/definition/rom.ts) with:
- `uri`: The definition file URI
- `name`: Human-readable name (e.g., "2011 Lancer Evo X")
- `fingerprints`: Array of [`ROMFingerprint`](../packages/core/src/definition/rom.ts) objects

**Behavior**:
- Read only metadata section (avoid parsing full table definitions)
- Extract fingerprints for ROM matching
- Return minimal data for quick UI responsiveness
- Handle missing/malformed files gracefully

**Example**:
```typescript
async peek(definitionUri: string): Promise<ROMDefinitionStub> {
	const doc = await this.readXml(definitionUri);
	const rom = extractRom(doc);
	
	const fingerprints: ROMFingerprint[] = [];
	if (internalidaddress && internalidhex) {
		fingerprints.push({
			reads: [{ address: addr, length: expected.length / 2 }],
			expectedHex: [expected],
			description: `internalidhex at 0x${addr.toString(16)}`,
		});
	}
	
	return { uri: definitionUri, name, fingerprints };
}
```

#### `parse(definitionUri: string): Promise<ROMDefinition>`

**Purpose**: Fully parse a definition file into normalized schema.

**Returns**: [`ROMDefinition`](../packages/core/src/definition/rom.ts) with:
- All fields from `ROMDefinitionStub`
- `platform`: Vehicle metadata (make, model, year, etc.)
- `tables`: Array of [`TableDefinition`](../packages/core/src/definition/table.ts) objects

**Behavior**:
- Parse all table, axis, and scaling definitions
- Resolve includes and templates
- Convert to normalized schema
- Validate addresses and data types
- Handle errors gracefully (return partial definitions if needed)

**Example**:
```typescript
async parse(definitionUri: string): Promise<ROMDefinition> {
	const doc = await this.readXml(definitionUri);
	const rom = extractRom(doc);
	
	const includes = await this.loadIncludes(definitionUri, rom);
	const templates = includes.templates;
	const scalingIndex = new Map([
		...includes.scalings.entries(),
		...buildScalingIndex(rom).entries(),
	]);
	
	const tables = this.parseTablesFromDoc(rom, templates, scalingIndex);
	
	return {
		uri: definitionUri,
		name,
		fingerprints,
		platform,
		tables,
	};
}
```

---

## ECUFlash Provider Walkthrough

The ECUFlash provider is the reference implementation. Study it to understand provider patterns.

### Discovery

ECUFlash definitions are XML files in the ECUFlash installation directory:

```typescript
const DEFAULT_WIN_DIR = "%ProgramFiles(x86)%\\OpenECU\\EcuFlash\\rommetadata";

async discoverDefinitionUris(): Promise<string[]> {
	const rootDir = expandWindowsEnv(DEFAULT_WIN_DIR);
	const files = await listXmlFilesRecursive(rootDir);
	this.cachedDefinitionUris = files.map(fsPathToUri);
	return this.cachedDefinitionUris;
}
```

**Key points**:
- Expands Windows environment variables (`%ProgramFiles(x86)%`)
- Recursively walks directory tree
- Caches results for performance
- Converts file paths to URIs for portability

### Peeking

The peek method extracts ROM ID and fingerprints from the `<romid>` section:

```typescript
async peek(definitionUri: string): Promise<ROMDefinitionStub> {
	const doc = await this.readXml(definitionUri);
	const rom = extractRom(doc);
	
	const romid = rom["romid"] as Raw | undefined;
	const xmlid = extractText(romid?.["xmlid"]);
	const internalidaddress = extractText(romid?.["internalidaddress"]);
	const internalidhex = extractText(romid?.["internalidhex"]);
	
	const fingerprints: ROMFingerprint[] = [];
	if (internalidaddress && internalidhex) {
		const addr = parseNumberish(internalidaddress) ?? 0;
		const expected = normalizeHex(internalidhex);
		fingerprints.push({
			reads: [{ address: addr, length: expected.length / 2 }],
			expectedHex: [expected],
			description: `internalidhex ${expected} at 0x${addr.toString(16)}`,
		});
	}
	
	return { uri: definitionUri, name: xmlid ?? internalidhex ?? "ECUFlash Definition", fingerprints };
}
```

**Key points**:
- Reads XML without full parsing
- Extracts `<romid>` metadata
- Creates fingerprints from internal ID address and hex
- Returns quickly for UI responsiveness

### Parsing with Includes and Templates

ECUFlash definitions use `<include>` to reference base files and `<table>` templates:

```typescript
async parse(definitionUri: string): Promise<ROMDefinition> {
	const doc = await this.readXml(definitionUri);
	const rom = extractRom(doc);
	
	// Load included base/template files
	const includes = await this.loadIncludes(definitionUri, rom);
	const templates = includes.templates;
	
	// Merge scalings from includes and main file
	const scalingIndex = new Map<string, ScalingNode>([
		...includes.scalings.entries(),
		...buildScalingIndex(rom).entries(),
	]);
	
	// Parse tables using merged templates and scalings
	const tables = this.parseTablesFromDoc(rom, templates, scalingIndex);
	
	return { ...stub, platform, tables };
}
```

**Include resolution**:
```typescript
private async loadIncludes(
	definitionUri: string,
	rom: Raw,
): Promise<{ templates: Map<string, TemplateTable>; scalings: Map<string, ScalingNode> }> {
	const includes = asArray(rom["include"] as unknown as string | string[])
		.map((s) => String(s).trim())
		.filter(Boolean);
	
	const currentDir = path.dirname(uriToFsPath(definitionUri));
	const templates = new Map<string, TemplateTable>();
	const scalings = new Map<string, ScalingNode>();
	
	for (const inc of includes) {
		const candidate = path.join(currentDir, `${inc}.xml`);
		try {
			const doc = await this.readXml(fsPathToUri(candidate));
			const baseRom = extractRom(doc);
			if (!baseRom) continue;
			
			// Merge templates and scalings (first occurrence wins)
			for (const [k, v] of buildTemplateIndex(baseRom).entries()) {
				if (!templates.has(k)) templates.set(k, v);
			}
			for (const [k, v] of buildScalingIndex(baseRom).entries()) {
				if (!scalings.has(k)) scalings.set(k, v);
			}
		} catch {
			// Continue if include file not found
		}
	}
	
	return { templates, scalings };
}
```

**Key points**:
- Resolves includes relative to definition file directory
- Merges templates and scalings (first occurrence wins)
- Continues gracefully if includes are missing
- Prevents infinite loops by not re-including already-loaded files

### Key Implementation Details

**Affine scaling parsing**:
```typescript
function tryParseAffineToExpr(toexpr: string | undefined): Affine | null {
	if (!toexpr) return null;
	
	// v0: only accept linear expressions (no non-linear functions)
	if (!/^[0-9xX+\-*/().\s]+$/.test(toexpr)) return null;
	
	let fn: ((x: number) => number) | null = null;
	try {
		fn = new Function("x", `"use strict"; return (${toexpr.replaceAll("X", "x")});`);
	} catch {
		return null;
	}
	
	// Verify linearity at x=0, x=1, x=2
	const f0 = fn(0);
	const f1 = fn(1);
	const f2 = fn(2);
	if (![f0, f1, f2].every((n) => Number.isFinite(n))) return null;
	
	const scale = f1 - f0;
	const offset = f0;
	const expected2 = offset + scale * 2;
	if (Math.abs(f2 - expected2) > 1e-6) return null;
	
	return { scale, offset };
}
```

**Storage type mapping**:
```typescript
function storageTypeToScalarType(storage?: string): ScalarType {
	switch (storage?.toLowerCase()) {
		case "uint8": return "u8";
		case "int8": return "i8";
		case "uint16": return "u16";
		case "int16": return "i16";
		case "uint32": return "u32";
		case "int32": return "i32";
		case "float":
		case "float32": return "f32";
		default: return "u8"; // Default for unknown types
	}
}
```

---

## Step-by-Step Guide to Implement a New Provider

### 1. Create Package Structure

```bash
mkdir -p packages/providers/[name]/src
mkdir -p packages/providers/[name]/test
```

Create `packages/providers/[name]/package.json`:
```json
{
	"name": "@repo/providers-[name]",
	"version": "0.0.1",
	"type": "module",
	"exports": {
		".": "./dist/index.js"
	},
	"files": ["dist"],
	"dependencies": {
		"@repo/core": "workspace:*"
	},
	"devDependencies": {
		"@types/node": "^20",
		"typescript": "^5",
		"vitest": "^1"
	}
}
```

Create `packages/providers/[name]/tsconfig.json`:
```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src"
	},
	"include": ["src"],
	"references": [{ "path": "../../packages/core" }]
}
```

### 2. Implement the Provider Interface

Create `packages/providers/[name]/src/index.ts`:

```typescript
import type {
	ROMDefinitionProvider,
	ROMDefinitionStub,
	ROMDefinition,
} from "@repo/core";

export class [Name]Provider implements ROMDefinitionProvider {
	id = "[name]";
	label = "[Human-Readable Name]";

	async discoverDefinitionUris(): Promise<string[]> {
		// TODO: Implement discovery logic
		// Return array of definition file URIs
		return [];
	}

	async peek(definitionUri: string): Promise<ROMDefinitionStub> {
		// TODO: Implement peeking logic
		// Extract metadata and fingerprints quickly
		return {
			uri: definitionUri,
			name: "Definition Name",
			fingerprints: [],
		};
	}

	async parse(definitionUri: string): Promise<ROMDefinition> {
		// TODO: Implement full parsing logic
		// Return complete definition with tables
		const stub = await this.peek(definitionUri);
		return {
			...stub,
			platform: {},
			tables: [],
		};
	}
}
```

### 3. Handle Discovery

Implement `discoverDefinitionUris()` to find definition files:

```typescript
async discoverDefinitionUris(): Promise<string[]> {
	const searchPaths = [
		// Default installation directory
		"/path/to/default/definitions",
		// User-configured paths from settings
		...this.getUserConfiguredPaths(),
	];

	const uris: string[] = [];
	for (const dir of searchPaths) {
		try {
			const files = await this.listDefinitionFiles(dir);
			uris.push(...files);
		} catch {
			// Continue if directory doesn't exist
		}
	}

	return uris;
}

private async listDefinitionFiles(dir: string): Promise<string[]> {
	// Recursively find definition files in directory
	// Convert file paths to URIs
	// Return array of URIs
}

private getUserConfiguredPaths(): string[] {
	// Read from workspace settings
	// Return array of user-configured paths
}
```

### 4. Implement Peeking

Extract minimal metadata without full parsing:

```typescript
async peek(definitionUri: string): Promise<ROMDefinitionStub> {
	const content = await this.readDefinitionFile(definitionUri);
	
	// Extract metadata section only
	const metadata = this.extractMetadata(content);
	const fingerprints = this.extractFingerprints(content);
	
	return {
		uri: definitionUri,
		name: metadata.name ?? "Definition",
		fingerprints,
	};
}

private extractMetadata(content: string): { name?: string } {
	// Parse only metadata section
	// Avoid parsing full table definitions
}

private extractFingerprints(content: string): ROMFingerprint[] {
	// Extract ROM identification data
	// Return array of fingerprints
}
```

### 5. Implement Parsing

Parse the full definition file:

```typescript
async parse(definitionUri: string): Promise<ROMDefinition> {
	const content = await this.readDefinitionFile(definitionUri);
	
	// Parse metadata
	const metadata = this.parseMetadata(content);
	
	// Parse tables and axes
	const tables = this.parseTables(content);
	
	// Get fingerprints from peek
	const stub = await this.peek(definitionUri);
	
	return {
		uri: definitionUri,
		name: stub.name,
		fingerprints: stub.fingerprints,
		platform: metadata.platform ?? {},
		tables,
	};
}

private parseMetadata(content: string): { platform?: ROMDefinition["platform"] } {
	// Extract vehicle metadata (make, model, year, etc.)
}

private parseTables(content: string): TableDefinition[] {
	// Parse all table definitions
	// Convert to normalized schema
	// Return array of TableDefinition objects
}
```

### 6. Register Provider in Extension

Update [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts):

```typescript
import { [Name]Provider } from "@repo/providers-[name]";

export async function activate(ctx: vscode.ExtensionContext) {
	registry.register(new EcuFlashProvider());
	registry.register(new [Name]Provider()); // Add new provider
	
	// ... rest of activation
}
```

---

## Testing Patterns for Providers

### Unit Tests for Parsing Logic

Create `packages/providers/[name]/test/[name]-provider.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { [Name]Provider } from "../src/index";

describe("[Name]Provider", () => {
	it("discovers definition files", async () => {
		const provider = new [Name]Provider();
		const uris = await provider.discoverDefinitionUris();
		expect(Array.isArray(uris)).toBe(true);
	});

	it("peeks at definition metadata", async () => {
		const provider = new [Name]Provider();
		const stub = await provider.peek(definitionUri);
		
		expect(stub.uri).toBe(definitionUri);
		expect(stub.name).toBeTruthy();
		expect(Array.isArray(stub.fingerprints)).toBe(true);
	});

	it("parses complete definition", async () => {
		const provider = new [Name]Provider();
		const def = await provider.parse(definitionUri);
		
		expect(def.uri).toBe(definitionUri);
		expect(def.name).toBeTruthy();
		expect(Array.isArray(def.tables)).toBe(true);
		expect(def.platform).toBeDefined();
	});
});
```

### Fixtures for Test Data

Create test definition files in `packages/providers/[name]/test/fixtures/`:

```
test/fixtures/
├── simple-definition.[ext]
├── complex-definition.[ext]
└── malformed-definition.[ext]
```

Use temporary directories for tests:

```typescript
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

it("parses definition with includes", async () => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "provider-test-"));
	try {
		// Write test files to tmpDir
		// Test parsing
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true });
	}
});
```

### Error Handling Tests

```typescript
it("handles missing files gracefully", async () => {
	const provider = new [Name]Provider();
	const result = await provider.peek("file:///nonexistent/file.ext");
	
	expect(result.fingerprints).toEqual([]);
	expect(result.name).toBeTruthy();
});

it("handles malformed definitions", async () => {
	const provider = new [Name]Provider();
	const result = await provider.parse(malformedUri);
	
	expect(result.tables).toEqual([]);
	expect(result.platform).toBeDefined();
});

it("validates fingerprint data", async () => {
	const provider = new [Name]Provider();
	const stub = await provider.peek(definitionUri);
	
	for (const fp of stub.fingerprints) {
		expect(fp.reads.length).toBe(fp.expectedHex.length);
		for (const read of fp.reads) {
			expect(read.address).toBeGreaterThanOrEqual(0);
			expect(read.length).toBeGreaterThan(0);
		}
	}
});
```

### Example from ECUFlash Provider

See [`packages/providers/ecuflash/test/ecuflash-provider.test.ts`](../packages/providers/ecuflash/test/ecuflash-provider.test.ts) for a complete example:

```typescript
it("parses included scalings + honors swapxy", async () => {
	const provider = new EcuFlashProvider();
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-test-"));
	
	try {
		// Write base and ROM XML files
		const baseXmlPath = path.join(tmpDir, "evo10base.xml");
		const romXmlPath = path.join(tmpDir, "56890009.xml");
		
		await fs.writeFile(baseXmlPath, baseXml, "utf8");
		await fs.writeFile(romXmlPath, romXml, "utf8");
		
		const defUri = pathToFileURL(romXmlPath).toString();
		const def = await provider.parse(defUri);
		
		// Verify parsing results
		const t = def.tables.find((x) => x.name === "Boost Target Engine Load #1A");
		expect(t?.kind).toBe("table2d");
		expect(t?.rows).toBe(9);
		expect(t?.cols).toBe(18);
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true });
	}
});
```

---

## Common Pitfalls and Solutions

### Handling Missing Files

**Problem**: Include files or referenced resources don't exist.

**Solution**:
```typescript
try {
	const doc = await this.readFile(path);
	// Process file
} catch {
	// Continue gracefully; return partial definition
	console.warn(`Could not load ${path}; continuing with available data`);
}
```

### Parsing Errors

**Problem**: Malformed definition files cause parsing to fail.

**Solution**:
```typescript
try {
	const parsed = this.parseDefinition(content);
	return parsed;
} catch (error) {
	console.error(`Failed to parse definition: ${error}`);
	// Return stub with empty tables
	return {
		uri: definitionUri,
		name: "Unparseable Definition",
		fingerprints: [],
		platform: {},
		tables: [],
	};
}
```

### Performance Optimization

**Problem**: Parsing large definition files is slow.

**Solution**:
- Implement `peek()` to avoid full parsing during discovery
- Cache parsed definitions in memory
- Use lazy loading for table definitions
- Stream large files instead of loading entirely

```typescript
private cache = new Map<string, ROMDefinition>();

async parse(definitionUri: string): Promise<ROMDefinition> {
	if (this.cache.has(definitionUri)) {
		return this.cache.get(definitionUri)!;
	}
	
	const def = await this.doParse(definitionUri);
	this.cache.set(definitionUri, def);
	return def;
}
```

### Memory Management

**Problem**: Large ROM definitions consume excessive memory.

**Solution**:
- Don't load entire files into memory; use streaming
- Parse incrementally
- Release parsed data after use
- Limit cache size

```typescript
private maxCacheSize = 10;

async parse(definitionUri: string): Promise<ROMDefinition> {
	if (this.cache.size >= this.maxCacheSize) {
		// Remove oldest entry
		const firstKey = this.cache.keys().next().value;
		this.cache.delete(firstKey);
	}
	
	// ... rest of parsing
}
```

### Circular Includes

**Problem**: Definition files include each other, causing infinite loops.

**Solution**:
```typescript
private async loadIncludes(
	definitionUri: string,
	rom: Raw,
	visited = new Set<string>(),
): Promise<{ templates: Map<string, TemplateTable>; scalings: Map<string, ScalingNode> }> {
	if (visited.has(definitionUri)) {
		return { templates: new Map(), scalings: new Map() };
	}
	visited.add(definitionUri);
	
	// ... rest of include loading
}
```

---

## Summary

To implement a new provider:

1. Create package in `packages/providers/[name]/`
2. Implement `ROMDefinitionProvider` interface
3. Handle discovery, peeking, and parsing
4. Register provider in extension
5. Write comprehensive tests
6. Handle errors gracefully
7. Optimize for performance and memory

Refer to the ECUFlash provider as a reference implementation for all patterns.
