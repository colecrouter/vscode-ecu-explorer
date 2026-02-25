/**
 * ROM Definition Resolver
 *
 * Provides a standalone utility for resolving ROM definitions.
 * Extracted from RomEditorProvider to allow reuse across different code paths
 * (ROM editor, table file system provider, etc.) without requiring a ROM document
 * to be registered as a VSCode custom document.
 */

import type {
	DefinitionProvider,
	ROMDefinition,
	ROMDefinitionStub,
} from "@ecu-explorer/core";
import { scoreRomDefinition } from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { WorkspaceState } from "../workspace-state.js";

/**
 * Resolves a ROM definition for the given ROM file.
 * Checks saved definitions, auto-matches, or prompts the user.
 *
 * @param romUri - URI of the ROM file
 * @param romBytes - ROM file bytes
 * @param providerRegistry - Definition provider registry
 * @param stateManager - Workspace state manager
 * @returns The resolved ROM definition, or undefined if user cancelled
 */
export async function resolveRomDefinition(
	romUri: vscode.Uri,
	romBytes: Uint8Array,
	providerRegistry: { list(): DefinitionProvider[] },
	stateManager: WorkspaceState,
): Promise<ROMDefinition | undefined> {
	// Check if we have a saved definition for this ROM
	const savedDefinitionUri = stateManager.getRomDefinition(romUri.fsPath);

	if (savedDefinitionUri) {
		// Try to load the saved definition
		console.log(
			`[DEBUG] Found saved definition for ROM: ${savedDefinitionUri}`,
		);
		try {
			const provider = providerRegistry.list()[0];
			if (provider) {
				const definition = await provider.parse(savedDefinitionUri);
				return definition;
			}
		} catch (error) {
			console.error(
				"[DEBUG] Failed to load saved definition, will prompt user:",
				error,
			);
			// Clear invalid saved definition
			stateManager.saveRomDefinition(romUri.fsPath, "");
		}
	}

	// If no saved definition or loading failed, find matching definitions
	const candidates: {
		provider: DefinitionProvider;
		peek: ROMDefinitionStub;
		score: number;
	}[] = [];

	for (const p of providerRegistry.list()) {
		// Pass ROM URI to help discover definitions near the ROM file
		const uris = await p.discoverDefinitionUris(romUri.toString());
		for (const u of uris) {
			const peek = await p.peek(u);
			const score = scoreRomDefinition(romBytes, peek);
			if (score > 0) candidates.push({ provider: p, peek, score });
		}
	}

	// Sort by score (highest first)
	candidates.sort((a, b) => b.score - a.score);

	// Determine if we should auto-match or prompt user
	const CONFIDENCE_THRESHOLD = 0.5; // Require at least 50% match confidence

	if (candidates.length > 0) {
		const best = candidates[0];

		// Auto-match if confidence is high enough
		if (best && best.score >= CONFIDENCE_THRESHOLD) {
			const definition = await best.provider.parse(best.peek.uri);
			// Save the auto-matched definition
			stateManager.saveRomDefinition(romUri.fsPath, best.peek.uri);
			console.log(`[DEBUG] Auto-matched definition saved: ${best.peek.uri}`);
			return definition;
		}

		// Low confidence or multiple similar matches - let user choose
		type DefPickItem = vscode.QuickPickItem & {
			provider: DefinitionProvider;
			peek: ROMDefinitionStub;
		};

		const items: DefPickItem[] = candidates.map((c) => ({
			label: c.peek.name,
			description: `${Math.round(c.score * 100)}% match`,
			provider: c.provider,
			peek: c.peek,
		}));

		const picked = await vscode.window.showQuickPick<DefPickItem>(items, {
			placeHolder: "Select ROM definition (auto-match confidence too low)",
			title: `Select definition for ${romUri.fsPath.split(/[\\/]/).pop()}`,
		});

		if (picked) {
			const definition = await picked.provider.parse(picked.peek.uri);
			// Save the user-selected definition
			stateManager.saveRomDefinition(romUri.fsPath, picked.peek.uri);
			console.log(`[DEBUG] User-selected definition saved: ${picked.peek.uri}`);
			return definition;
		}

		return undefined;
	}

	// No candidates found - show all available definitions
	const allDefs: {
		provider: DefinitionProvider;
		peek: ROMDefinitionStub;
	}[] = [];

	for (const p of providerRegistry.list()) {
		// Pass ROM URI to help discover definitions near the ROM file
		const uris = await p.discoverDefinitionUris(romUri.toString());
		for (const u of uris) {
			const peek = await p.peek(u);
			allDefs.push({ provider: p, peek });
		}
	}

	if (allDefs.length > 0) {
		type DefPickItem = vscode.QuickPickItem & {
			provider: DefinitionProvider;
			peek: ROMDefinitionStub;
		};

		const items: DefPickItem[] = allDefs.map((d) => ({
			label: d.peek.name,
			provider: d.provider,
			peek: d.peek,
		}));

		const picked = await vscode.window.showQuickPick<DefPickItem>(items, {
			placeHolder: "No matching definition found - select manually",
			title: `Select definition for ${romUri.fsPath.split(/[\\/]/).pop()}`,
		});

		if (picked) {
			const definition = await picked.provider.parse(picked.peek.uri);
			// Save the user-selected definition
			stateManager.saveRomDefinition(romUri.fsPath, picked.peek.uri);
			console.log(`[DEBUG] User-selected definition saved: ${picked.peek.uri}`);
			return definition;
		}

		return undefined;
	}

	// No definitions found at all - show file picker
	const picked = await vscode.window.showOpenDialog({
		canSelectMany: false,
		filters: { "ROM Definitions": ["xml"] },
		title: "Select ROM Definition File",
		defaultUri: vscode.Uri.joinPath(romUri, ".."),
	});

	if (picked && picked[0]) {
		// Use the first available provider to parse the manually selected file
		const provider = providerRegistry.list()[0];
		if (provider) {
			try {
				const definition = await provider.parse(picked[0].toString());
				// Save the manually selected definition
				stateManager.saveRomDefinition(romUri.fsPath, picked[0].toString());
				console.log(
					`[DEBUG] Manually selected definition saved: ${picked[0].toString()}`,
				);
				return definition;
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to parse definition file: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	return undefined;
}
