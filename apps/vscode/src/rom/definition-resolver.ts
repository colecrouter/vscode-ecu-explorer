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
import {
	planRomDefinitionResolution,
	ROM_DEFINITION_CONFIDENCE_THRESHOLD,
} from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { WorkspaceState } from "../workspace-state.js";

function formatDefinitionParseError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/Failed to resolve include/i.test(message)) {
		return `Failed to load the selected ROM definition because an included parent definition could not be found. ${message}`;
	}
	return `Failed to parse definition file: ${message}`;
}

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
			void vscode.window.showErrorMessage(formatDefinitionParseError(error));
			// Clear invalid saved definition
			stateManager.saveRomDefinition(romUri.fsPath, "");
		}
	}

	const plan = await planRomDefinitionResolution(
		romUri.toString(),
		romBytes,
		providerRegistry.list(),
	);

	if (plan.kind === "auto") {
		stateManager.saveRomDefinition(romUri.fsPath, plan.definitionUri);
		console.log(`[DEBUG] Auto-matched definition saved: ${plan.definitionUri}`);
		return plan.definition;
	}

	if (plan.kind === "prompt-candidate") {
		type DefPickItem = vscode.QuickPickItem & {
			provider: DefinitionProvider;
			peek: ROMDefinitionStub;
		};

		const items: DefPickItem[] = plan.candidates.map(
			(c: {
				provider: DefinitionProvider;
				peek: ROMDefinitionStub;
				score: number;
			}) => ({
				label: c.peek.name,
				description: `${Math.round(c.score * 100)}% match`,
				provider: c.provider,
				peek: c.peek,
			}),
		);

		const picked = await vscode.window.showQuickPick<DefPickItem>(items, {
			placeHolder: `Select ROM definition (auto-match confidence below ${Math.round(ROM_DEFINITION_CONFIDENCE_THRESHOLD * 100)}%)`,
			title: `Select definition for ${romUri.fsPath.split(/[\\/]/).pop()}`,
		});

		if (picked) {
			try {
				const definition = await picked.provider.parse(picked.peek.uri);
				// Save the user-selected definition
				stateManager.saveRomDefinition(romUri.fsPath, picked.peek.uri);
				console.log(
					`[DEBUG] User-selected definition saved: ${picked.peek.uri}`,
				);
				return definition;
			} catch (error) {
				void vscode.window.showErrorMessage(formatDefinitionParseError(error));
				return undefined;
			}
		}

		return undefined;
	}

	if (plan.kind === "prompt-all") {
		type DefPickItem = vscode.QuickPickItem & {
			provider: DefinitionProvider;
			peek: ROMDefinitionStub;
		};

		const items: DefPickItem[] = plan.allDefinitions.map(
			(d: { provider: DefinitionProvider; peek: ROMDefinitionStub }) => ({
				label: d.peek.name,
				provider: d.provider,
				peek: d.peek,
			}),
		);

		const picked = await vscode.window.showQuickPick<DefPickItem>(items, {
			placeHolder: "No matching definition found - select manually",
			title: `Select definition for ${romUri.fsPath.split(/[\\/]/).pop()}`,
		});

		if (picked) {
			try {
				const definition = await picked.provider.parse(picked.peek.uri);
				// Save the user-selected definition
				stateManager.saveRomDefinition(romUri.fsPath, picked.peek.uri);
				console.log(
					`[DEBUG] User-selected definition saved: ${picked.peek.uri}`,
				);
				return definition;
			} catch (error) {
				void vscode.window.showErrorMessage(formatDefinitionParseError(error));
				return undefined;
			}
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

	if (picked?.[0]) {
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
				void vscode.window.showErrorMessage(formatDefinitionParseError(error));
			}
		}
	}

	return undefined;
}
