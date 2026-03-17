import type { DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	createHardwareCandidate,
	createHardwareSelectionRecord,
	doesSelectionMatchCandidate,
	FORGET_HARDWARE_BUTTON,
	findPreferredHardwareCandidate,
	HardwareSelectionService,
	promptForHardwareCandidate,
	WorkspaceHardwareSelectionStrategy,
} from "../src/hardware-selection.js";
import { WorkspaceState } from "../src/workspace-state.js";

function makeDevice(
	overrides: Partial<DeviceInfo> & Pick<DeviceInfo, "id" | "name">,
): DeviceInfo {
	return {
		id: overrides.id,
		name: overrides.name,
		transportName: overrides.transportName ?? "openport2",
		connected: overrides.connected ?? false,
	};
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

describe("hardware-selection", () => {
	function createWorkspaceState() {
		const storage = new Map<string, unknown>();
		return new WorkspaceState({
			get: (key: string) => storage.get(key),
			update: async (key: string, value: unknown) => {
				storage.set(key, value);
			},
			keys: () => Array.from(storage.keys()),
		});
	}

	it("creates a hardware selection record from a device", () => {
		expect(
			createHardwareSelectionRecord(
				createHardwareCandidate(
					makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0" }),
				),
			),
		).toEqual({
			id: "openport2:ABC",
			transportName: "openport2",
			name: "OpenPort 2.0",
			locality: "extension-host",
		});
	});

	it("finds the preferred candidate by transport, id, and locality", () => {
		const preferred = findPreferredHardwareCandidate(
			[
				createHardwareCandidate(
					makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0 A" }),
				),
				createHardwareCandidate(
					makeDevice({ id: "openport2:DEF", name: "OpenPort 2.0 B" }),
					"client-browser",
				),
			],
			{
				id: "openport2:DEF",
				transportName: "openport2",
				name: "OpenPort 2.0 B",
				locality: "client-browser",
			},
		);

		expect(preferred?.device.id).toBe("openport2:DEF");
		expect(preferred?.locality).toBe("client-browser");
	});

	it("falls back to id and transport when older selections have no locality", () => {
		const preferred = findPreferredHardwareCandidate(
			[
				createHardwareCandidate(
					makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0 A" }),
					"client-browser",
				),
			],
			{
				id: "openport2:ABC",
				transportName: "openport2",
				name: "OpenPort 2.0 A",
			},
		);

		expect(preferred?.device.id).toBe("openport2:ABC");
		expect(preferred?.locality).toBe("client-browser");
	});

	it("workspace strategy prefers a saved device without prompting", async () => {
		const workspaceState = createWorkspaceState();
		workspaceState.saveDeviceSelection("ecu-primary", {
			id: "openport2:DEF",
			transportName: "openport2",
			name: "OpenPort 2.0 B",
			locality: "extension-host",
		});
		const strategy = new WorkspaceHardwareSelectionStrategy(
			new HardwareSelectionService(workspaceState),
		);
		const quickPickSpy = vi.spyOn(vscode.window, "createQuickPick");

		const selected = await strategy.selectDevice([
			createHardwareCandidate(
				makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0 A" }),
			),
			createHardwareCandidate(
				makeDevice({ id: "openport2:DEF", name: "OpenPort 2.0 B" }),
			),
		]);

		expect(selected.device.id).toBe("openport2:DEF");
		expect(quickPickSpy).not.toHaveBeenCalled();
	});

	it("matches a saved selection to a candidate", () => {
		expect(
			doesSelectionMatchCandidate(
				{
					id: "openport2:ABC",
					transportName: "openport2",
					name: "OpenPort 2.0",
					locality: "client-browser",
				},
				createHardwareCandidate(
					makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0" }),
					"client-browser",
				),
			),
		).toBe(true);
	});

	it("clears a saved selection when the matching candidate is forgotten", () => {
		const workspaceState = createWorkspaceState();
		const service = new HardwareSelectionService(workspaceState);
		service.saveCandidate(
			createHardwareCandidate(
				makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0" }),
				"client-browser",
			),
		);

		service.forgetCandidate(
			createHardwareCandidate(
				makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0" }),
				"client-browser",
			),
		);

		expect(workspaceState.getDeviceSelection("ecu-primary")).toBeUndefined();
	});

	it("runs a request action from the quick pick when selected", async () => {
		const requestedCandidate = createHardwareCandidate(
			makeDevice({ id: "openport2:web", name: "OpenPort 2.0 WebUSB" }),
			"client-browser",
		);
		const run = vi.fn().mockResolvedValue(requestedCandidate);
		const harness = createQuickPickHarness();
		vi.spyOn(vscode.window, "createQuickPick").mockReturnValueOnce(
			harness.quickPick,
		);

		const selectedPromise = promptForHardwareCandidate(
			[
				createHardwareCandidate(
					makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0 A" }),
				),
			],
			[
				{
					id: "request-usb",
					label: "$(add) Connect New USB Device...",
					description: "Grant browser access to a newly connected device",
					run,
				},
			],
		);
		const requestEntry = harness.quickPick.items.find(
			(entry) =>
				"action" in entry && entry.label === "$(add) Connect New USB Device...",
		);
		if (requestEntry == null) {
			throw new Error("Missing request quick pick entry");
		}
		harness.accept(requestEntry);
		const selected = await selectedPromise;

		expect(run).toHaveBeenCalledTimes(1);
		expect(selected).toEqual(requestedCandidate);
	});

	it("uses human-friendly copy and forget buttons for browser-owned candidates", async () => {
		const harness = createQuickPickHarness();
		vi.spyOn(vscode.window, "createQuickPick").mockReturnValueOnce(
			harness.quickPick,
		);

		const selectionPromise = promptForHardwareCandidate(
			[
				createHardwareCandidate(
					makeDevice({ id: "openport2:web", name: "OpenPort 2.0 WebUSB" }),
					"client-browser",
				),
			],
			[],
			{
				canForgetCandidate: () => true,
				forgetCandidate: async () => {},
			},
		);

		const candidateEntry = harness.quickPick.items[0];
		expect(candidateEntry?.label).toBe("OpenPort 2.0 WebUSB");
		expect(candidateEntry?.description).toBe("USB • Browser");
		expect(candidateEntry?.detail).toBe("ID: openport2:web");
		expect(candidateEntry?.buttons).toEqual([FORGET_HARDWARE_BUTTON]);

		harness.hide();

		await expect(selectionPromise).rejects.toThrow(
			"Device selection cancelled by user",
		);
	});
});
