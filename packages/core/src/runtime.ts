import type { ROMDefinitionProvider } from "./definition/provider";
import type { ROMDefinition } from "./definition/rom";

/** Back-compat alias used by the VS Code extension. */
export type DefinitionProvider = ROMDefinitionProvider;

/**
 * A ROM opened in the extension host.
 *
 * @remarks
 * v0 keeps this in-memory; persistence/reopen is future work.
 */
export interface RomInstance {
	/** Unique id for this opened ROM (provider + ROM URI). */
	id: string;
	romUri: string;
	providerId: string;
	defUri: string;
	bytes: Uint8Array;
	definition: ROMDefinition;
}

/** Persisted association between a ROM and its matched definition. */
export interface RomAssociation {
	romUri: string;
	providerId: string;
	defUri: string;
	lastOpenedAt: number;
}
