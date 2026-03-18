import type { SerialRuntime } from "@ecu-explorer/device/hardware-runtime";
import {
	AemSerialWidebandAdapter,
	type AemWidebandMode,
} from "@ecu-explorer/wideband";
import type * as vscode from "vscode";
import type { HardwareSelectionService } from "./hardware-selection.js";
import type { WidebandManager } from "./wideband-manager.js";

export class AutoReconnectController implements vscode.Disposable {
	private timer: ReturnType<typeof setInterval> | undefined;
	private suppressed = false;
	private attempting = false;

	constructor(
		private readonly shouldAttempt: () => boolean | Promise<boolean>,
		private readonly attempt: () => Promise<boolean>,
		private readonly intervalMs = 3000,
	) {
		this.timer = setInterval(() => {
			void this.tick();
		}, this.intervalMs);
		void this.tick();
	}

	suppress(): void {
		this.suppressed = true;
	}

	resume(triggerImmediately = true): void {
		this.suppressed = false;
		if (triggerImmediately) {
			void this.tick();
		}
	}

	dispose(): void {
		if (this.timer != null) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private async tick(): Promise<void> {
		if (this.suppressed || this.attempting) {
			return;
		}
		if (!(await this.shouldAttempt())) {
			return;
		}

		this.attempting = true;
		try {
			await this.attempt();
		} finally {
			this.attempting = false;
		}
	}
}

export async function reconnectPreferredWideband(options: {
	manager: WidebandManager;
	selectionService: HardwareSelectionService;
	runtime: SerialRuntime;
	mode: AemWidebandMode;
}): Promise<boolean> {
	options.manager.setAdapters([
		new AemSerialWidebandAdapter(options.runtime, options.mode),
	]);
	const candidates = await options.manager.listCandidates();
	const preferredCandidate =
		options.selectionService.findPreferredCandidate(candidates);
	if (preferredCandidate == null) {
		return false;
	}

	await options.manager.openCandidate(preferredCandidate);
	return true;
}

export function hasRememberedHardwareSelection(
	selectionService: HardwareSelectionService,
): boolean {
	return selectionService.getSelection() != null;
}

export function canReconnectToPreferredWideband(options: {
	manager: WidebandManager;
	selectionService: HardwareSelectionService;
	mode: AemWidebandMode | undefined;
}): boolean {
	return (
		options.manager.activeSession == null &&
		options.selectionService.getSelection() != null &&
		options.mode != null
	);
}
