import type { DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	createHardwareCandidate,
	createHardwareSelectionRecord,
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
		const quickPickSpy = vi.spyOn(vscode.window, "showQuickPick");

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

	it("runs a request action from the quick pick when selected", async () => {
		const requestedCandidate = createHardwareCandidate(
			makeDevice({ id: "openport2:web", name: "OpenPort 2.0 WebUSB" }),
			"client-browser",
		);
		const run = vi.fn().mockResolvedValue(requestedCandidate);
		vi.spyOn(vscode.window, "showQuickPick").mockImplementationOnce(
			async (items) => {
				const entries = Array.isArray(items) ? items : await items;
				const requestEntry = entries.find(
					(entry) =>
						"action" in entry &&
						entry.label === "$(add) Connect new USB device...",
				);
				if (requestEntry == null) {
					throw new Error("Missing request quick pick entry");
				}
				return requestEntry;
			},
		);

		const selected = await promptForHardwareCandidate(
			[
				createHardwareCandidate(
					makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0 A" }),
				),
			],
			[
				{
					id: "request-usb",
					label: "$(add) Connect new USB device...",
					description: "Grant browser access to a newly connected device",
					run,
				},
			],
		);

		expect(run).toHaveBeenCalledTimes(1);
		expect(selected).toEqual(requestedCandidate);
	});
});
