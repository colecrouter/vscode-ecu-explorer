import {
	type BrowserSerialLike,
	createBrowserSerialRuntime,
} from "@ecu-explorer/device/browser-serial-runtime";
import type * as vscode from "vscode";
import {
	activate as activateShared,
	deactivate as deactivateShared,
} from "./extension.js";

export async function activate(ctx: vscode.ExtensionContext) {
	const browserSerial = (
		globalThis.navigator as Navigator & { serial?: BrowserSerialLike }
	).serial;
	const widebandSerialRuntime = createBrowserSerialRuntime(browserSerial, {
		idPrefix: "wideband-webserial",
		friendlyName: "Wideband Serial Device",
		defaultOpenOptions: {
			baudRate: 9600,
			dataBits: 8,
			stopBits: 1,
			parity: "none",
		},
	});
	await activateShared(ctx, {
		hardwareLocality: "client-browser",
		...(widebandSerialRuntime != null ? { widebandSerialRuntime } : {}),
	});
}

export const deactivate = deactivateShared;
