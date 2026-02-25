import type * as vscode from "vscode";
import {
	activate as activateShared,
	deactivate as deactivateShared,
} from "./extension";
import { registerMcpProvider } from "./mcp-provider";

export async function activate(ctx: vscode.ExtensionContext) {
	await activateShared(ctx);
	registerMcpProvider(ctx);
}

export const deactivate = deactivateShared;
