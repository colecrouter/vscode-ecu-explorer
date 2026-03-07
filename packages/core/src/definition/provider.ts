import type { ROMDefinition, ROMDefinitionStub } from "./rom.js";

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
	 * @param romUri - Optional URI of the ROM file being opened. If provided, the provider
	 *                 should search for definitions near the ROM file (same directory, parent directories, etc.)
	 *
	 * @remarks
	 * This returns file URIs as strings so that it works in Node (VS Code extension host)
	 * and can be persisted in workspace state.
	 */
	discoverDefinitionUris(romUri?: string): Promise<string[]>;

	/**
	 * Determine whether this provider owns or can parse a persisted definition URI.
	 *
	 * @remarks
	 * This should be cheap and avoid full parsing. It is used to route saved definition
	 * URIs back to the correct provider in multi-provider environments.
	 */
	canParseDefinitionUri(definitionUri: string): boolean | Promise<boolean>;

	/** Quickly preview minimal metadata and fingerprints without full parse */
	peek(definitionUri: string): Promise<ROMDefinitionStub>;

	/** Parse a definition file into a normalized schema */
	parse(definitionUri: string): Promise<ROMDefinition>;
}
