import type * as vscode from "vscode";
import {
	activate as activateShared,
	deactivate as deactivateShared,
} from "./extension.js";

export async function activate(ctx: vscode.ExtensionContext) {
	await activateShared(ctx, {
		hardwareLocality: "client-browser",
	});
}

export const deactivate = deactivateShared;
