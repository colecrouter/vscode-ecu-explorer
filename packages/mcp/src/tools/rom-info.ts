/**
 * rom_info tool handler for the ECU Explorer MCP server.
 *
 * Returns metadata about a ROM file: matched definition, vehicle info,
 * and checksum validity.
 */

import * as path from "node:path";
import { validateChecksum } from "@ecu-explorer/core";
import type { McpConfig } from "../config.js";
import { toYaml } from "../formatters/yaml-formatter.js";
import { loadRom } from "../rom-loader.js";

/**
 * Handle the rom_info tool call.
 *
 * @param romPath - Path to the ROM binary
 * @param config - MCP server configuration
 * @returns YAML document with ROM metadata
 */
export async function handleRomInfo(
	romPath: string,
	config: McpConfig,
): Promise<string> {
	const loaded = await loadRom(romPath, config.definitionsPaths);
	const { definition, romBytes, fileSizeBytes } = loaded;

	// Check checksum if definition has one
	let checksumAlgorithm: string | null = null;
	let checksumValid: boolean | null = null;

	if (definition.checksum) {
		checksumAlgorithm = definition.checksum.algorithm;
		try {
			const result = validateChecksum(romBytes, definition.checksum);
			checksumValid = result.valid;
		} catch {
			checksumValid = null;
		}
	}

	// Build vehicle description from platform fields
	const platformParts: string[] = [];
	if (definition.platform.year !== undefined)
		platformParts.push(String(definition.platform.year));
	if (definition.platform.make !== undefined)
		platformParts.push(definition.platform.make);
	if (definition.platform.model !== undefined)
		platformParts.push(definition.platform.model);
	if (definition.platform.submodel !== undefined)
		platformParts.push(definition.platform.submodel);
	if (definition.platform.transmission !== undefined)
		platformParts.push(definition.platform.transmission);
	const vehicle = platformParts.length > 0 ? platformParts.join(" ") : null;

	// Build ECU ID from market/other fields if available
	const ecuId: string | null = definition.platform.market ?? null;

	// Build metadata object matching spec output
	const metadata: Record<string, unknown> = {
		file: path.basename(romPath),
		size_kb: Math.round(fileSizeBytes / 1024),
		definition: definition.name ?? null,
		vehicle,
		ecu_id: ecuId,
		checksum_valid: checksumValid,
		checksum_algorithm: checksumAlgorithm,
	};

	return toYaml(metadata);
}
