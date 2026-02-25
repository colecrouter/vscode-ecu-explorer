import * as vscode from "vscode";

/**
 * Handle ROM open flow
 *
 * Opens a ROM file using the CustomEditor, which enables native dirty marker support.
 * The CustomEditor will handle definition matching and table selection.
 *
 * @param _ctx - Extension context (unused)
 */
export async function openRomFlow(
	_ctx: vscode.ExtensionContext,
): Promise<void> {
	const pick = await vscode.window.showOpenDialog({
		canSelectMany: false,
		filters: { ROM: ["bin", "rom", "hex"] },
		openLabel: "Open ROM",
	});
	const romUri = pick?.at(0);
	if (!romUri) return;

	// Open with CustomEditor instead of creating WebviewPanel directly
	// This enables native dirty marker (●) in tabs
	await vscode.commands.executeCommand(
		"vscode.openWith",
		romUri,
		"romViewer.editor",
	);
}
