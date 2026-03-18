import type { SerialRuntime } from "@ecu-explorer/device/hardware-runtime";
import { describe, expect, it, vi } from "vitest";
import {
	AutoReconnectController,
	canReconnectToPreferredWideband,
	hasRememberedHardwareSelection,
	reconnectPreferredWideband,
} from "../src/auto-reconnect.js";
import {
	createHardwareCandidate,
	HardwareSelectionService,
} from "../src/hardware-selection.js";
import { WidebandManager } from "../src/wideband-manager.js";
import { WorkspaceState } from "../src/workspace-state.js";

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

describe("AutoReconnectController", () => {
	it("attempts immediately and on interval while unsuppressed", async () => {
		vi.useFakeTimers();
		const shouldAttempt = vi.fn().mockResolvedValue(true);
		const attempt = vi.fn().mockResolvedValue(true);
		const controller = new AutoReconnectController(
			shouldAttempt,
			attempt,
			1000,
		);

		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(1000);

		expect(attempt).toHaveBeenCalledTimes(2);

		controller.dispose();
		vi.useRealTimers();
	});

	it("does not attempt while suppressed", async () => {
		vi.useFakeTimers();
		const attempt = vi.fn().mockResolvedValue(true);
		const controller = new AutoReconnectController(
			async () => true,
			attempt,
			1000,
		);
		await Promise.resolve();
		controller.suppress();

		await vi.advanceTimersByTimeAsync(1000);

		expect(attempt).toHaveBeenCalledTimes(1);

		controller.dispose();
		vi.useRealTimers();
	});
});

describe("wideband reconnect helpers", () => {
	it("detects when a remembered wideband can reconnect", () => {
		const workspaceState = createWorkspaceState();
		const selectionService = new HardwareSelectionService(
			workspaceState,
			"wideband-primary",
		);
		selectionService.saveCandidate(
			createHardwareCandidate(
				{
					id: "wideband-serial:COM4",
					name: "AEM Wideband (Serial)",
					transportName: "serial",
					connected: false,
				},
				"extension-host",
			),
		);
		const manager = {
			activeSession: undefined,
		} as WidebandManager;

		expect(hasRememberedHardwareSelection(selectionService)).toBe(true);
		expect(
			canReconnectToPreferredWideband({
				manager,
				selectionService,
				mode: "afr",
			}),
		).toBe(true);
	});

	it("reconnects the preferred wideband candidate using the saved mode", async () => {
		const workspaceState = createWorkspaceState();
		const selectionService = new HardwareSelectionService(
			workspaceState,
			"wideband-primary",
		);
		const preferredCandidate = createHardwareCandidate(
			{
				id: "wideband-serial:COM4",
				name: "AEM Wideband (Serial)",
				transportName: "serial",
				connected: false,
			},
			"extension-host",
		);
		selectionService.saveCandidate(preferredCandidate);

		const manager = new WidebandManager(async () => [preferredCandidate]);
		const openCandidate = vi.spyOn(manager, "openCandidate").mockResolvedValue({
			adapter: {
				id: "aem-serial-wideband",
				name: "AEM Serial Wideband",
				canOpen: vi.fn(),
				open: vi.fn(),
			},
			candidate: preferredCandidate,
			session: {
				id: "session-1",
				name: "AEM Wideband",
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(),
			},
		});
		const setAdapters = vi.spyOn(manager, "setAdapters");
		const runtime: SerialRuntime = {
			listPorts: vi.fn(async () => []),
			openPort: vi.fn(),
		};

		const result = await reconnectPreferredWideband({
			manager,
			selectionService,
			runtime,
			mode: "lambda",
		});

		expect(result).toBe(true);
		expect(setAdapters).toHaveBeenCalledTimes(1);
		expect(openCandidate).toHaveBeenCalledWith(preferredCandidate);
	});
});
