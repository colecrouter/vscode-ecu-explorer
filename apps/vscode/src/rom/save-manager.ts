import {
	type ChecksumDefinition,
	recomputeChecksum,
	validateChecksum,
	writeChecksum,
} from "@ecu-explorer/core";
import * as vscode from "vscode";

/**
 * Result of a ROM save operation
 */
export type SaveResult =
	| { ok: true; checksumValid?: boolean }
	| { ok: false; error: string };

/**
 * Options for ROM save operations
 */
export interface SaveOptions {
	/** Path to the ROM file to save */
	romPath: string;
	/** Updated ROM data */
	romData: Uint8Array;
	/** Checksum definition (optional - if provided, checksums will be recomputed) */
	checksumDef?: ChecksumDefinition;
	/**
	 * Optional set of URI strings currently being saved by the extension.
	 * When provided, the ROM file's URI string will be added to this set before
	 * writing and removed (with a 500 ms grace period) after writing completes.
	 * This allows the file watcher to suppress spurious re-reads for self-initiated saves.
	 */
	savingUris?: Set<string>;
	/**
	 * The URI string to add to savingUris (e.g. vscode.Uri.file(romPath).toString()).
	 * Required when savingUris is provided.
	 */
	uriStr?: string;
}

/**
 * Manages ROM save operations with checksum validation
 */
export class RomSaveManager {
	/**
	 * Save ROM data with checksum recomputation
	 *
	 * @param options - Save options
	 * @returns Save result or error
	 *
	 * @example
	 * ```typescript
	 * const manager = new RomSaveManager();
	 * const result = await manager.save({
	 *   romPath: '/path/to/rom.hex',
	 *   romData: updatedBuffer,
	 *   checksumDef: definition,
	 * });
	 * if (result.ok) {
	 * } else {
	 *   console.error(`Save failed: ${result.error}`);
	 * }
	 * ```
	 */
	async save(options: SaveOptions): Promise<SaveResult> {
		const { romPath, romData, checksumDef } = options;

		try {
			// Validate inputs
			if (!romPath) {
				return { ok: false, error: "ROM path is required" };
			}
			if (!romData || romData.length === 0) {
				return { ok: false, error: "ROM data is empty" };
			}

			// Recompute checksums if definition provided
			let finalData = romData;
			if (checksumDef) {
				try {
					// Recompute checksum value
					const checksumValue = recomputeChecksum(romData, checksumDef);
					// Write checksum to ROM data (make a copy first)
					finalData = new Uint8Array(romData); // Ensure we have a mutable copy
					writeChecksum(finalData, checksumValue, checksumDef);
				} catch (error) {
					return {
						ok: false,
						error: `Checksum recomputation failed: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}

			// Mark URI as saving so the file watcher suppresses spurious re-reads
			const { savingUris, uriStr } = options;
			if (savingUris && uriStr) {
				savingUris.add(uriStr);
			}

			// Write directly to file
			let writeError: unknown;
			try {
				await vscode.workspace.fs.writeFile(
					vscode.Uri.file(romPath),
					finalData,
				);
			} catch (error) {
				console.error(
					"[ERROR] RomSaveManager.save: Failed to write file:",
					error,
				);
				writeError = error;
			} finally {
				if (savingUris && uriStr) {
					if (writeError !== undefined) {
						// On write failure, remove immediately — no watcher suppression needed
						savingUris.delete(uriStr);
					} else {
						// On success, keep suppression active for a short grace period
						// because the file watcher may fire slightly after writeFile resolves
						setTimeout(() => {
							if (savingUris && uriStr) {
								savingUris.delete(uriStr);
							}
						}, 500);
					}
				}
			}
			if (writeError !== undefined) {
				return {
					ok: false,
					error: `Failed to save ROM: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
				};
			}

			// Validate checksums after save if definition provided
			let checksumValid: boolean | undefined;
			if (checksumDef) {
				try {
					const savedData = new Uint8Array(
						await vscode.workspace.fs.readFile(vscode.Uri.file(romPath)),
					);
					const validation = validateChecksum(savedData, checksumDef);
					if (!validation.valid) {
						return {
							ok: false,
							error: `Checksum validation failed after save: expected ${validation.expected?.toString(16)}, got ${validation.actual?.toString(16)}`,
						};
					}
					checksumValid = validation.valid;
				} catch (error) {
					return {
						ok: false,
						error: `Checksum validation failed after save: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}

			return {
				ok: true,
				...(checksumValid !== undefined ? { checksumValid } : {}),
			};
		} catch (error) {
			return {
				ok: false,
				error: `Unexpected error during save: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
}
