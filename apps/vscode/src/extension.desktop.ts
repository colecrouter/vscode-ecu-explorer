import { createNodeSerialRuntime } from "@ecu-explorer/hardware-runtime-node";
import type * as vscode from "vscode";
import {
	activate as activateShared,
	deactivate as deactivateShared,
} from "./extension.js";
import { registerMcpProvider } from "./mcp-provider.js";
import { createOpenPortDesktopRuntime } from "./openport2-desktop-runtime.js";

export async function activate(ctx: vscode.ExtensionContext) {
	const serialRuntime = await createNodeSerialRuntime();
	await activateShared(ctx, {
		hardwareLocality: "extension-host",
		openPortRuntime: await createOpenPortDesktopRuntime(serialRuntime),
		widebandSerialRuntime: serialRuntime,
	});
	registerMcpProvider(ctx);
}

export const deactivate = deactivateShared;
