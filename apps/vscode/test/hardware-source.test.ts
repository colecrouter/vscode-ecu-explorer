import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	createHardwareCandidate,
	FORGET_HARDWARE_BUTTON,
	type HardwareCandidate,
} from "../src/hardware-selection.js";
import {
	createAggregatedHardwareSelection,
	type HardwareCandidateSource,
	selectHardwareCandidateFromSource,
} from "../src/hardware-source.js";

function makeCandidate(
	id: string,
	name: string,
	transportName = "openport2",
	locality: "extension-host" | "client-browser" = "extension-host",
): HardwareCandidate {
	return createHardwareCandidate(
		{
			id,
			name,
			transportName,
			connected: false,
		},
		locality,
	);
}

function createQuickPickHarness() {
	let acceptHandler: (() => void) | undefined;
	let hideHandler: (() => void) | undefined;
	let itemButtonHandler:
		| ((event: {
				item: vscode.QuickPickItem;
				button: vscode.QuickInputButton;
		  }) => void)
		| undefined;
	const quickPick: vscode.QuickPick<vscode.QuickPickItem> = {
		value: "",
		items: [] as vscode.QuickPickItem[],
		selectedItems: [] as vscode.QuickPickItem[],
		activeItems: [] as vscode.QuickPickItem[],
		title: "",
		step: undefined,
		totalSteps: undefined,
		placeholder: "",
		enabled: true,
		busy: false,
		ignoreFocusOut: false,
		buttons: [],
		canSelectMany: false,
		matchOnDescription: false,
		matchOnDetail: false,
		keepScrollPosition: false,
		show: vi.fn(),
		hide: vi.fn(() => {
			hideHandler?.();
		}),
		dispose: vi.fn(),
		onDidChangeValue: () => ({ dispose: vi.fn() }),
		onDidAccept: (handler: () => void) => {
			acceptHandler = handler;
			return { dispose: vi.fn() };
		},
		onDidTriggerButton: () => ({ dispose: vi.fn() }),
		onDidHide: (handler: () => void) => {
			hideHandler = handler;
			return { dispose: vi.fn() };
		},
		onDidChangeActive: () => ({ dispose: vi.fn() }),
		onDidChangeSelection: () => ({ dispose: vi.fn() }),
		onDidTriggerItemButton: (
			handler: (event: {
				item: vscode.QuickPickItem;
				button: vscode.QuickInputButton;
			}) => void,
		) => {
			itemButtonHandler = handler;
			return { dispose: vi.fn() };
		},
	};

	return {
		quickPick,
		accept(item: vscode.QuickPickItem) {
			quickPick.selectedItems = [item];
			acceptHandler?.();
		},
		triggerButton(
			item: vscode.QuickPickItem,
			button: vscode.QuickInputButton = FORGET_HARDWARE_BUTTON,
		) {
			itemButtonHandler?.({ item, button });
		},
		hide() {
			hideHandler?.();
		},
	};
}

describe("createAggregatedHardwareSelection", () => {
	it("combines candidates and request actions across sources", async () => {
		const ecuCandidate = makeCandidate("openport2:usb", "OpenPort 2.0");
		const widebandCandidate = makeCandidate(
			"wideband-serial:/dev/cu.usbserial-1",
			"AEM Wideband (Serial)",
			"serial",
		);
		const selection = await createAggregatedHardwareSelection([
			{
				source: {
					listCandidates: vi.fn(async () => [ecuCandidate]),
					getRequestActions: () => [
						{
							id: "request-usb",
							label: "$(add) Connect New USB Device...",
							run: vi.fn(async () => undefined),
						},
					],
				},
			},
			{
				source: {
					listCandidates: vi.fn(async () => [widebandCandidate]),
					getRequestActions: () => [
						{
							id: "request-serial",
							label: "$(add) Connect New Serial Device...",
							run: vi.fn(async () => undefined),
						},
					],
				},
			},
		]);

		expect(selection.candidates).toEqual([ecuCandidate, widebandCandidate]);
		expect(selection.requestActions.map((action) => action.id)).toEqual([
			"request-usb",
			"request-serial",
		]);
	});

	it("remembers requested candidates using the owning strategy", async () => {
		const rememberEcu = vi.fn();
		const rememberWideband = vi.fn();
		const requestedWideband = makeCandidate(
			"wideband-serial:browser:1",
			"AEM Wideband (Serial)",
			"serial",
			"client-browser",
		);
		const selection = await createAggregatedHardwareSelection([
			{
				source: {
					listCandidates: vi.fn(async () => []),
					getRequestActions: () => [
						{
							id: "request-usb",
							label: "$(add) Connect New USB Device...",
							run: vi.fn(async () => undefined),
						},
					],
				},
				strategy: {
					selectDevice: vi.fn(),
					rememberCandidate: rememberEcu,
				},
			},
			{
				source: {
					listCandidates: vi.fn(async () => []),
					getRequestActions: () => [
						{
							id: "request-wideband",
							label: "$(add) Connect New Serial Device...",
							run: vi.fn(async () => requestedWideband),
						},
					],
				},
				strategy: {
					selectDevice: vi.fn(),
					rememberCandidate: rememberWideband,
				},
			},
		]);

		const requestedCandidate = await selection.requestActions[1]?.run();
		if (requestedCandidate == null) {
			throw new Error("Expected requested candidate");
		}
		selection.rememberCandidate(requestedCandidate);

		expect(rememberWideband).toHaveBeenCalledWith(requestedWideband);
		expect(rememberEcu).not.toHaveBeenCalled();
	});

	it("forgets candidates using the matching source prompt options", async () => {
		const forgottenEcu = vi.fn();
		const forgottenWideband = vi.fn();
		const ecuCandidate = makeCandidate(
			"openport2:web",
			"OpenPort 2.0",
			"openport2",
		);
		const widebandCandidate = makeCandidate(
			"wideband-serial:browser:1",
			"AEM Wideband (Serial)",
			"serial",
			"client-browser",
		);
		const selection = await createAggregatedHardwareSelection([
			{
				source: {
					listCandidates: vi.fn(async () => [ecuCandidate]),
					getPromptOptions: (onForgot) => ({
						canForgetCandidate: (candidate) =>
							candidate.device.id === ecuCandidate.device.id,
						forgetCandidate: async (candidate) => {
							onForgot?.(candidate);
						},
					}),
				} satisfies HardwareCandidateSource,
				strategy: {
					selectDevice: vi.fn(),
					rememberCandidate: vi.fn(),
					forgetCandidate: forgottenEcu,
				},
			},
			{
				source: {
					listCandidates: vi.fn(async () => [widebandCandidate]),
					getPromptOptions: (onForgot) => ({
						canForgetCandidate: (candidate) =>
							candidate.device.id === widebandCandidate.device.id,
						forgetCandidate: async (candidate) => {
							onForgot?.(candidate);
						},
					}),
				} satisfies HardwareCandidateSource,
				strategy: {
					selectDevice: vi.fn(),
					rememberCandidate: vi.fn(),
					forgetCandidate: forgottenWideband,
				},
			},
		]);

		expect(selection.promptOptions.canForgetCandidate?.(ecuCandidate)).toBe(
			true,
		);
		expect(
			selection.promptOptions.canForgetCandidate?.(widebandCandidate),
		).toBe(true);

		await selection.promptOptions.forgetCandidate?.(widebandCandidate);

		expect(forgottenWideband).toHaveBeenCalledWith(widebandCandidate);
		expect(forgottenEcu).not.toHaveBeenCalled();
	});

	it("forces a prompt even when a selection strategy would auto-pick", async () => {
		const preferred = makeCandidate("openport2:two", "OpenPort 2.0 B");
		const alternate = makeCandidate("openport2:one", "OpenPort 2.0 A");
		const harness = createQuickPickHarness();
		vi.spyOn(vscode.window, "createQuickPick").mockReturnValueOnce(
			harness.quickPick,
		);

		const selectedPromise = selectHardwareCandidateFromSource({
			source: {
				listCandidates: vi.fn(async () => [alternate, preferred]),
			},
			strategy: {
				selectDevice: vi.fn(async () => preferred),
				rememberCandidate: vi.fn(),
			},
			emptyMessage: "No hardware found",
			forcePrompt: true,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const candidateEntry = harness.quickPick.items.find(
			(entry) => "candidate" in entry && entry.label === "OpenPort 2.0 A",
		);
		if (candidateEntry == null) {
			throw new Error("Missing quick pick entry for forced prompt");
		}
		harness.accept(candidateEntry);

		await expect(selectedPromise).resolves.toEqual(alternate);
	});
});
