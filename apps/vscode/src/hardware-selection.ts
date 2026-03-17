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

export interface HardwareRequestAction {
	id: string;
	label: string;
	description?: string;
	run(): Promise<HardwareCandidate | undefined>;
}

interface HardwareCandidateQuickPickItem extends vscode.QuickPickItem {
	candidate: HardwareCandidate;
}

interface HardwareRequestQuickPickItem extends vscode.QuickPickItem {
	action: HardwareRequestAction;
}

export interface HardwarePromptOptions {
	canForgetCandidate?(candidate: HardwareCandidate): boolean;
	forgetCandidate?(candidate: HardwareCandidate): Promise<void>;
}

export const FORGET_HARDWARE_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon("close"),
	tooltip: "Forget device",
};

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

export function doesSelectionMatchCandidate(
	selection: HardwareSelectionRecord | undefined,
	candidate: HardwareCandidate,
): boolean {
	if (selection == null) {
		return false;
	}

	return (
		candidate.device.id === selection.id &&
		candidate.device.transportName === selection.transportName &&
		(selection.locality == null || candidate.locality === selection.locality)
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

	forgetCandidate(candidate: HardwareCandidate): void {
		if (doesSelectionMatchCandidate(this.getSelection(), candidate)) {
			this.clearSelection();
		}
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
		requestActions?: readonly HardwareRequestAction[],
		promptOptions?: HardwarePromptOptions,
	): Promise<HardwareCandidate>;
	rememberCandidate(candidate: HardwareCandidate): void;
	forgetCandidate?(candidate: HardwareCandidate): void;
}

function formatLocality(locality: HardwareLocality): string {
	return locality === "client-browser" ? "Browser" : "This machine";
}

function formatTransport(transportName: string): string {
	switch (transportName) {
		case "openport2":
			return "USB";
		default:
			return transportName;
	}
}

export async function promptForHardwareCandidate(
	candidates: readonly HardwareCandidate[],
	requestActions: readonly HardwareRequestAction[] = [],
	options: HardwarePromptOptions = {},
): Promise<HardwareCandidate> {
	if (candidates.length === 0 && requestActions.length === 0) {
		throw new Error("No device selected");
	}

	if (candidates.length === 1 && requestActions.length === 0) {
		const candidate = candidates[0];
		if (candidate == null) {
			throw new Error("No device selected");
		}
		if (options.canForgetCandidate?.(candidate) === true) {
			// Fall through to the picker so the user can manage the candidate.
		} else {
			return candidate;
		}
	}

	const deviceQuickPicks: HardwareCandidateQuickPickItem[] = candidates.map(
		(candidate) => ({
			label: candidate.device.name,
			description: `${formatTransport(candidate.device.transportName)} • ${formatLocality(candidate.locality)}`,
			detail: `ID: ${candidate.device.id}`,
			...(options.canForgetCandidate?.(candidate)
				? { buttons: [FORGET_HARDWARE_BUTTON] }
				: {}),
			candidate,
		}),
	);
	const actionQuickPicks: HardwareRequestQuickPickItem[] = requestActions.map(
		(action) => ({
			label: action.label,
			...(action.description != null
				? { description: action.description }
				: {}),
			action,
		}),
	);
	return new Promise<HardwareCandidate>((resolve, reject) => {
		const quickPick = vscode.window.createQuickPick<
			HardwareCandidateQuickPickItem | HardwareRequestQuickPickItem
		>();
		let settled = false;

		const updateItems = (
			nextCandidates: readonly HardwareCandidateQuickPickItem[],
		): void => {
			quickPick.items = [...nextCandidates, ...actionQuickPicks];
		};

		const settle = (
			fn: (value?: HardwareCandidate | Error) => void,
			value?: HardwareCandidate | Error,
		): void => {
			if (settled) {
				return;
			}
			settled = true;
			disposeAll();
			quickPick.dispose();
			fn(value);
		};

		const disposables = [
			quickPick.onDidAccept(() => {
				const selected = quickPick.selectedItems[0];
				if (selected == null) {
					return;
				}

				if ("action" in selected) {
					void selected.action
						.run()
						.then((candidate) => {
							if (candidate == null) {
								return;
							}
							settle(
								(resolved) => resolve(resolved as HardwareCandidate),
								candidate,
							);
						})
						.catch((error: unknown) => {
							settle(
								(rejected) => reject(rejected as Error),
								error instanceof Error ? error : new Error(String(error)),
							);
						});
					return;
				}

				settle(
					(resolved) => resolve(resolved as HardwareCandidate),
					selected.candidate,
				);
			}),
			quickPick.onDidHide(() => {
				settle(
					(rejected) => reject(rejected as Error),
					new Error("Device selection cancelled by user"),
				);
			}),
			quickPick.onDidTriggerItemButton((event) => {
				if (!("candidate" in event.item)) {
					return;
				}
				if (event.button !== FORGET_HARDWARE_BUTTON) {
					return;
				}
				if (options.forgetCandidate == null) {
					return;
				}
				const candidate = event.item.candidate;

				void options.forgetCandidate(candidate).then(() => {
					const nextCandidates = deviceQuickPicks.filter(
						(item) => item.candidate.device.id !== candidate.device.id,
					);
					deviceQuickPicks.splice(
						0,
						deviceQuickPicks.length,
						...nextCandidates,
					);
					updateItems(deviceQuickPicks);
					if (quickPick.items.length === 0) {
						quickPick.hide();
					}
				});
			}),
		];

		const disposeAll = (): void => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		};

		quickPick.title = "Connect Hardware";
		quickPick.placeholder = "Select hardware to connect";
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;
		updateItems(deviceQuickPicks);
		quickPick.show();
	});
}

export class WorkspaceHardwareSelectionStrategy
	implements HardwareDeviceSelectionStrategy
{
	constructor(private readonly selectionService: HardwareSelectionService) {}

	async selectDevice(
		candidates: readonly HardwareCandidate[],
		requestActions: readonly HardwareRequestAction[] = [],
		promptOptions: HardwarePromptOptions = {},
	): Promise<HardwareCandidate> {
		const preferred = this.selectionService.findPreferredCandidate(candidates);
		if (preferred != null && requestActions.length === 0) {
			return preferred;
		}

		return promptForHardwareCandidate(
			candidates,
			requestActions,
			promptOptions,
		);
	}

	rememberCandidate(candidate: HardwareCandidate): void {
		this.selectionService.saveCandidate(candidate);
	}

	forgetCandidate(candidate: HardwareCandidate): void {
		this.selectionService.forgetCandidate(candidate);
	}
}
