import type { DeviceInfo } from "@ecu-explorer/device";
import type {
	HardwareLocality,
	HardwareSelectionRecord,
} from "@ecu-explorer/device/hardware-runtime";
import * as vscode from "vscode";
import type { WorkspaceState } from "./workspace-state.js";

export const DEFAULT_HARDWARE_SELECTION_SLOT = "ecu-primary";
export const DEFAULT_HARDWARE_LOCALITY =
	"extension-host" satisfies HardwareLocality;

export interface HardwareCandidate {
	device: DeviceInfo;
	locality: HardwareLocality;
}

export function createHardwareCandidate(
	device: DeviceInfo,
	locality: HardwareLocality = DEFAULT_HARDWARE_LOCALITY,
): HardwareCandidate {
	return { device, locality };
}

export function createHardwareSelectionRecord(
	candidate: HardwareCandidate,
): HardwareSelectionRecord {
	return {
		id: candidate.device.id,
		transportName: candidate.device.transportName,
		name: candidate.device.name,
		locality: candidate.locality,
	};
}

export function findPreferredHardwareCandidate(
	candidates: readonly HardwareCandidate[],
	selection: HardwareSelectionRecord | undefined,
): HardwareCandidate | undefined {
	if (selection == null) {
		return undefined;
	}

	return candidates.find(
		(candidate) =>
			candidate.device.id === selection.id &&
			candidate.device.transportName === selection.transportName &&
			(selection.locality == null || candidate.locality === selection.locality),
	);
}

export class HardwareSelectionService {
	constructor(
		private readonly workspaceState: WorkspaceState,
		private readonly slot = DEFAULT_HARDWARE_SELECTION_SLOT,
	) {}

	getSelection(): HardwareSelectionRecord | undefined {
		return this.workspaceState.getDeviceSelection(this.slot);
	}

	saveCandidate(candidate: HardwareCandidate): void {
		this.workspaceState.saveDeviceSelection(
			this.slot,
			createHardwareSelectionRecord(candidate),
		);
	}

	clearSelection(): void {
		this.workspaceState.clearDeviceSelection(this.slot);
	}

	findPreferredCandidate(
		candidates: readonly HardwareCandidate[],
	): HardwareCandidate | undefined {
		return findPreferredHardwareCandidate(candidates, this.getSelection());
	}
}

export interface HardwareDeviceSelectionStrategy {
	selectDevice(
		candidates: readonly HardwareCandidate[],
	): Promise<HardwareCandidate>;
	rememberCandidate(candidate: HardwareCandidate): void;
}

function formatLocality(locality: HardwareLocality): string {
	return locality === "client-browser" ? "client browser" : "extension host";
}

export async function promptForHardwareCandidate(
	candidates: readonly HardwareCandidate[],
): Promise<HardwareCandidate> {
	if (candidates.length === 0) {
		throw new Error("No device selected");
	}

	if (candidates.length === 1) {
		const candidate = candidates[0];
		if (candidate == null) {
			throw new Error("No device selected");
		}
		return candidate;
	}

	const deviceQuickPicks = candidates.map((candidate, index) => ({
		label: `${candidate.device.name} (${candidate.device.transportName})`,
		description: `${formatLocality(candidate.locality)} · ID: ${candidate.device.id}`,
		index,
	}));
	const selected = await vscode.window.showQuickPick(deviceQuickPicks, {
		placeHolder: "Select a device to connect",
	});
	if (!selected) {
		throw new Error("Device selection cancelled by user");
	}
	const candidate = candidates[selected.index];
	if (!candidate) {
		throw new Error("Selected device index is out of bounds for device list");
	}
	return candidate;
}

export class WorkspaceHardwareSelectionStrategy
	implements HardwareDeviceSelectionStrategy
{
	constructor(private readonly selectionService: HardwareSelectionService) {}

	async selectDevice(
		candidates: readonly HardwareCandidate[],
	): Promise<HardwareCandidate> {
		const preferred = this.selectionService.findPreferredCandidate(candidates);
		if (preferred != null) {
			return preferred;
		}

		return promptForHardwareCandidate(candidates);
	}

	rememberCandidate(candidate: HardwareCandidate): void {
		this.selectionService.saveCandidate(candidate);
	}
}
