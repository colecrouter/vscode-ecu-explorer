/**
 * ROM loader for the ECU Explorer MCP server.
 *
 * Loads ROM files from disk, resolves their definitions using the ECUFlash
 * provider, and caches results by file path + mtime to avoid re-parsing
 * on every tool call.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { ROMDefinition } from "@ecu-explorer/core";
import { scoreRomDefinition } from "@ecu-explorer/core";
import { EcuFlashProvider } from "@ecu-explorer/definitions-ecuflash";

export interface LoadedRom {
	/** ROM file path */
	romPath: string;
	/** ROM bytes */
	romBytes: Uint8Array;
	/** Matched ROM definition */
	definition: ROMDefinition;
	/** File size in bytes */
	fileSizeBytes: number;
	/** File modification time (for cache invalidation) */
	mtime: number;
}

interface CacheEntry {
	mtime: number;
	loaded: LoadedRom;
}

const cache = new Map<string, CacheEntry>();

/**
 * Load a ROM file and resolve its definition.
 *
 * Uses a cache keyed by file path + mtime to avoid re-parsing on every call.
 *
 * @param romPath - Absolute or relative path to the ROM binary
 * @param definitionsPaths - Additional paths to search for definition files
 * @returns Loaded ROM with matched definition
 * @throws Error if ROM cannot be read or no definition matches
 */
export async function loadRom(
	romPath: string,
	definitionsPaths: string[] = [],
): Promise<LoadedRom> {
	const absolutePath = path.isAbsolute(romPath)
		? romPath
		: path.resolve(process.cwd(), romPath);

	// Check cache
	const stat = await fs.stat(absolutePath);
	const mtime = stat.mtimeMs;
	const cached = cache.get(absolutePath);
	if (cached && cached.mtime === mtime) {
		return cached.loaded;
	}

	// Read ROM bytes
	const buffer = await fs.readFile(absolutePath);
	const romBytes = new Uint8Array(buffer);

	// Resolve definition
	const provider = new EcuFlashProvider(definitionsPaths);
	const romUri = pathToFileURL(absolutePath).toString();

	// Discover definition URIs (search near ROM file + additional paths)
	const definitionUris = await provider.discoverDefinitionUris(romUri);

	if (definitionUris.length === 0) {
		throw new Error(
			`No definition files found for ROM: ${absolutePath}. ` +
				`Set ECU_DEFINITIONS_PATH or --definitions-path to point to your ECUFlash XML definitions directory.`,
		);
	}

	// Score all definitions and find the best match
	let bestScore = 0;
	let bestDefinition: ROMDefinition | null = null;

	for (const uri of definitionUris) {
		try {
			const stub = await provider.peek(uri);
			if (stub.fingerprints.length === 0) continue;

			const score = scoreRomDefinition(romBytes, stub);
			if (score > bestScore) {
				bestScore = score;
				// Lazily parse the full definition only for the best match
				bestDefinition = await provider.parse(uri);
			}
		} catch {
			// Skip definitions that fail to parse
		}
	}

	if (!bestDefinition || bestScore === 0) {
		throw new Error(
			`No matching definition found for ROM: ${absolutePath}. ` +
				`Searched ${definitionUris.length} definition file(s). ` +
				`Ensure the correct ECUFlash XML definitions are available.`,
		);
	}

	const loaded: LoadedRom = {
		romPath: absolutePath,
		romBytes,
		definition: bestDefinition,
		fileSizeBytes: stat.size,
		mtime,
	};

	cache.set(absolutePath, { mtime, loaded });
	return loaded;
}

/**
 * Invalidate the ROM cache for a specific file path.
 *
 * @param romPath - Path to invalidate
 */
export function invalidateRomCache(romPath: string): void {
	const absolutePath = path.isAbsolute(romPath)
		? romPath
		: path.resolve(process.cwd(), romPath);
	cache.delete(absolutePath);
}

/**
 * Clear the entire ROM cache.
 */
export function clearRomCache(): void {
	cache.clear();
}
