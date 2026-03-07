import type * as vscode from "vscode";
import {
	activate as activateShared,
	deactivate as deactivateShared,
} from "./extension.js";
import { registerMcpProvider } from "./mcp-provider.js";

export async function activate(ctx: vscode.ExtensionContext) {
	await activateShared(ctx);
	registerMcpProvider(ctx);
}

export const deactivate = deactivateShared;
