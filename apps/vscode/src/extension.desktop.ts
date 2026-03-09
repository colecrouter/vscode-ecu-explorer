import type * as vscode from "vscode";
import {
	activate as activateShared,
	deactivate as deactivateShared,
} from "./extension.js";
import { registerMcpProvider } from "./mcp-provider.js";
import { createOpenPortDesktopRuntime } from "./openport2-desktop-runtime.js";

export async function activate(ctx: vscode.ExtensionContext) {
	await activateShared(ctx, {
		openPortRuntime: await createOpenPortDesktopRuntime(),
	});
	registerMcpProvider(ctx);
}

export const deactivate = deactivateShared;
