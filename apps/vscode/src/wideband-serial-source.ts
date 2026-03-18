import {
	groupSerialPorts,
	type HardwareLocality,
	type SerialPortDescriptor,
	type SerialRuntime,
} from "@ecu-explorer/device/hardware-runtime";
import * as vscode from "vscode";
import {
	createHardwareCandidate,
	type HardwareCandidate,
	type HardwarePromptOptions,
	type HardwareRequestAction,
} from "./hardware-selection.js";

export const DEFAULT_WIDEBAND_SELECTION_SLOT = "wideband-primary";

function createWidebandSerialName(port: {
	friendlyName?: string | null | undefined;
	manufacturer?: string | null | undefined;
}): string {
	const label =
		port.friendlyName?.trim() ||
		port.manufacturer?.trim() ||
		"Wideband Serial Device";
	return label.includes("(Serial)") ? label : `${label} (Serial)`;
}

function toWidebandSerialCandidate(
	port: SerialPortDescriptor,
	locality: HardwareLocality,
): HardwareCandidate {
	return createHardwareCandidate(
		{
			id: `wideband-serial:${port.path}`,
			name: createWidebandSerialName(port),
			transportName: "serial",
			connected: false,
		},
		locality,
	);
}

function getWidebandSerialPath(
	candidate: HardwareCandidate,
): string | undefined {
	if (!candidate.device.id.startsWith("wideband-serial:")) {
		return undefined;
	}
	return candidate.device.id.slice("wideband-serial:".length);
}

export class WidebandSerialHardwareSource {
	constructor(
		private readonly runtime: SerialRuntime,
		private readonly locality: HardwareLocality,
	) {}

	async listCandidates(): Promise<readonly HardwareCandidate[]> {
		const ports = await this.runtime.listPorts();
		const grouped = groupSerialPorts(ports);
		return grouped.map((group) =>
			toWidebandSerialCandidate(
				{
					path: group.preferredPath,
					serialNumber: group.serialNumber,
					manufacturer: group.manufacturer,
					vendorId: group.vendorId,
					productId: group.productId,
					friendlyName: group.friendlyName,
				},
				this.locality,
			),
		);
	}

	getRequestActions(): readonly HardwareRequestAction[] {
		if (
			this.locality !== "client-browser" ||
			this.runtime.requestPort == null
		) {
			return [];
		}

		return [
			{
				id: "wideband-serial:request-port",
				label: "$(add) Connect New Serial Device...",
				description: "Wideband via browser serial",
				run: async () => {
					const port = await this.runtime.requestPort?.();
					if (port == null) {
						return undefined;
					}
					return toWidebandSerialCandidate(port, this.locality);
				},
			},
		];
	}

	getPromptOptions(
		onForgot?: (candidate: HardwareCandidate) => void,
	): HardwarePromptOptions {
		if (this.locality !== "client-browser" || this.runtime.forgetPort == null) {
			return {};
		}

		return {
			canForgetCandidate: (candidate) =>
				getWidebandSerialPath(candidate) != null,
			forgetCandidate: async (candidate) => {
				const path = getWidebandSerialPath(candidate);
				if (path == null) {
					throw new Error(
						`Wideband candidate is not backed by browser serial: ${candidate.device.id}`,
					);
				}
				await this.runtime.forgetPort?.(path);
				onForgot?.(candidate);
			},
		};
	}
}

export async function promptForWidebandMode(): Promise<"afr" | "lambda"> {
	const mode = await vscode.window.showQuickPick(
		[
			{
				label: "AFR",
				description: "AEM display is showing air-fuel ratio",
				value: "afr" as const,
			},
			{
				label: "Lambda",
				description: "AEM display is showing lambda",
				value: "lambda" as const,
			},
		],
		{
			title: "Select AEM Wideband Display Mode",
			placeHolder: "Choose the unit the wideband is currently streaming",
		},
	);

	if (mode == null) {
		throw new vscode.CancellationError();
	}

	return mode.value;
}
