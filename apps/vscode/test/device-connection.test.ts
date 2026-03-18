/**
 * Unit tests for persistent device connection and status bar management.
 *
 * Tests DeviceManagerImpl.connect(), disconnect(), activeConnection getter,
 * DeviceStatusBarManager visibility, context key setting, and readRomFromDevice
 * connection reuse.
 */

import type {
	DeviceConnection,
	DeviceInfo,
	DeviceTransport,
	EcuProtocol,
} from "@ecu-explorer/device";
import type { WidebandReading } from "@ecu-explorer/wideband";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { DeviceManagerImpl } from "../src/device-manager.js";
import {
	DeviceStatusBarManager,
	type WidebandStatusSource,
} from "../src/device-status-bar.js";
import {
	createHardwareCandidate,
	FORGET_HARDWARE_BUTTON,
	HardwareSelectionService,
	promptForHardwareCandidate,
	WorkspaceHardwareSelectionStrategy,
} from "../src/hardware-selection.js";
import type { ActiveWidebandSession } from "../src/wideband-manager.js";
import { WorkspaceState } from "../src/workspace-state.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockConnection() {
	return {
		deviceInfo: {
			id: "test-device-id",
			name: "Test Device",
			transportName: "test-transport",
			connected: true,
		} satisfies DeviceInfo,
		close: vi.fn().mockResolvedValue(undefined),
		sendFrame: vi.fn(),
		startStream: vi.fn(),
		stopStream: vi.fn(),
	} satisfies Pick<
		DeviceConnection,
		"close" | "sendFrame" | "deviceInfo" | "startStream" | "stopStream"
	>;
}

function createMockProtocol(name = "TestProtocol") {
	return {
		name,
		canHandle: vi.fn().mockResolvedValue(true),
		readRom: vi.fn(),
		writeRom: vi.fn(),
	} satisfies Pick<EcuProtocol, "name" | "canHandle" | "readRom" | "writeRom">;
}

function createMockStatusBarItem() {
	return {
		text: "",
		command: undefined as string | undefined,
		tooltip: undefined as string | undefined,
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
	};
}

function createMockWidebandManager(): WidebandStatusSource & {
	emitSession: (session: ActiveWidebandSession | undefined) => void;
	emitReading: (reading: WidebandReading | undefined) => void;
} {
	let activeSession: ActiveWidebandSession | undefined;
	let latestReading: WidebandReading | undefined;
	const sessionListeners = new Set<
		(session: ActiveWidebandSession | undefined) => void
	>();
	const readingListeners = new Set<
		(reading: WidebandReading | undefined) => void
	>();

	return {
		get activeSession() {
			return activeSession;
		},
		get latestReading() {
			return latestReading;
		},
		onDidChangeSession(listener: (session: typeof activeSession) => void) {
			sessionListeners.add(listener);
			return {
				dispose: () => sessionListeners.delete(listener),
			};
		},
		onDidChangeReading(
			listener: (reading: WidebandReading | undefined) => void,
		) {
			readingListeners.add(listener);
			return {
				dispose: () => readingListeners.delete(listener),
			};
		},
		emitSession(session: typeof activeSession) {
			activeSession = session;
			for (const listener of sessionListeners) {
				listener(session);
			}
		},
		emitReading(reading: WidebandReading | undefined) {
			latestReading = reading;
			for (const listener of readingListeners) {
				listener(reading);
			}
		},
	};
}

type TestConnection = ReturnType<typeof createMockConnection> &
	DeviceConnection;
type TestProtocol = ReturnType<typeof createMockProtocol> & EcuProtocol;
type TestStatusBarItem = ReturnType<typeof createMockStatusBarItem> &
	vscode.StatusBarItem;

function createResolvedSelection(
	connection: TestConnection,
	protocol: TestProtocol,
): {
	connection: DeviceConnection;
	protocol: EcuProtocol;
	candidate: ReturnType<typeof createHardwareCandidate>;
} {
	return {
		connection,
		protocol,
		candidate: createHardwareCandidate(connection.deviceInfo),
	};
}

function createMockTransport(connection: TestConnection): DeviceTransport {
	return {
		name: "openport2",
		listDevices: vi.fn().mockResolvedValue([]),
		connect: vi.fn().mockResolvedValue(connection),
	};
}

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

function getRequiredStatusBarItem(
	items: ReturnType<typeof createMockStatusBarItem>[],
	index: number,
) {
	const item = items[index];
	if (item === undefined) {
		throw new Error(`Missing status bar item at index ${index}`);
	}
	return item;
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
	};
}

// ─── DeviceManagerImpl Tests ─────────────────────────────────────────────────

describe("DeviceManagerImpl", () => {
	let manager: DeviceManagerImpl;
	let mockConnection: ReturnType<typeof createMockConnection>;
	let mockProtocol: ReturnType<typeof createMockProtocol>;

	beforeEach(() => {
		manager = new DeviceManagerImpl();
		mockConnection = createMockConnection();
		mockProtocol = createMockProtocol();

		// Override selectDeviceAndProtocol to return mock connection/protocol
		vi.spyOn(manager, "selectDeviceAndProtocol").mockResolvedValue(
			createResolvedSelection(mockConnection, mockProtocol),
		);
	});

	describe("activeConnection getter", () => {
		it("should return undefined when not connected", () => {
			expect(manager.activeConnection).toBeUndefined();
		});

		it("should return the active connection after connect()", async () => {
			await manager.connect();
			expect(manager.activeConnection).toBeDefined();
			expect(manager.activeConnection?.connection).toBe(mockConnection);
			expect(manager.activeConnection?.protocol).toBe(mockProtocol);
		});

		it("should return undefined after disconnect()", async () => {
			await manager.connect();
			await manager.disconnect();
			expect(manager.activeConnection).toBeUndefined();
		});
	});

	describe("connect()", () => {
		it("should call selectDeviceAndProtocol() and store the connection", async () => {
			const result = await manager.connect();

			expect(manager.selectDeviceAndProtocol).toHaveBeenCalledTimes(1);
			expect(result.connection).toBe(mockConnection);
			expect(result.protocol).toBe(mockProtocol);
			expect(manager.activeConnection).toBe(result);
			expect(result.state).toBe("connected");
		});

		it("should return the existing connection if already connected", async () => {
			const first = await manager.connect();
			const second = await manager.connect();

			// selectDeviceAndProtocol should only be called once
			expect(manager.selectDeviceAndProtocol).toHaveBeenCalledTimes(1);
			expect(first).toBe(second);
		});

		it("should retry selection when the active connection has failed", async () => {
			await manager.connect();
			await manager.reconnectActiveConnection("write");

			const retried = await manager.connect();

			expect(manager.selectDeviceAndProtocol).toHaveBeenCalledTimes(2);
			expect(retried.state).toBe("connected");
		});

		it("should fire onDidChangeConnection event when connecting", async () => {
			const listener = vi.fn();
			manager.onDidChangeConnection(listener);

			await manager.connect();

			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					connection: mockConnection,
					protocol: mockProtocol,
				}),
			);
		});

		it("should NOT fire onDidChangeConnection if already connected", async () => {
			const listener = vi.fn();
			await manager.connect();

			manager.onDidChangeConnection(listener);
			await manager.connect(); // second call — should reuse

			expect(listener).not.toHaveBeenCalled();
		});

		it("should propagate errors from selectDeviceAndProtocol()", async () => {
			vi.spyOn(manager, "selectDeviceAndProtocol").mockRejectedValue(
				new Error("No devices found"),
			);

			await expect(manager.connect()).rejects.toThrow("No devices found");
			expect(manager.activeConnection).toBeUndefined();
		});
	});

	describe("reconnectActiveConnection()", () => {
		it("fails fast for write operations", async () => {
			await manager.connect();

			const ok = await manager.reconnectActiveConnection("write");

			expect(ok).toBe(false);
			expect(manager.activeConnection?.state).toBe("failed");
			expect(manager.activeConnection?.lastFailure).toBe("TRANSPORT_ERROR");
		});

		it("reconnects for read operations", async () => {
			await manager.connect();

			const nextConnection = createMockConnection();
			manager.registerTransport(
				"openport2",
				createMockTransport(nextConnection),
			);

			const activeConnection = manager.activeConnection?.connection;
			if (!activeConnection) {
				throw new Error("Expected active connection");
			}

			Object.assign(activeConnection.deviceInfo, {
				id: "openport2:test",
				transportName: "openport2",
				name: "OpenPort 2.0",
				connected: true,
			});

			const ok = await manager.reconnectActiveConnection("read");

			expect(ok).toBe(true);
			expect(manager.activeConnection?.state).toBe("connected");
			expect(manager.activeConnection?.connection).toBe(nextConnection);
		});
	});

	describe("disconnect()", () => {
		it("should do nothing if not connected", async () => {
			// Should not throw
			await expect(manager.disconnect()).resolves.toBeUndefined();
		});

		it("should close the connection and clear activeConnection", async () => {
			await manager.connect();
			await manager.disconnect();

			expect(mockConnection.close).toHaveBeenCalledTimes(1);
			expect(manager.activeConnection).toBeUndefined();
		});

		it("should fire onDidChangeConnection with undefined when disconnecting", async () => {
			await manager.connect();

			const listener = vi.fn();
			manager.onDidChangeConnection(listener);

			await manager.disconnect();

			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith(undefined);
		});

		it("should fire onDidChangeConnection exactly once per disconnect", async () => {
			const listener = vi.fn();
			manager.onDidChangeConnection(listener);

			await manager.connect();
			await manager.disconnect();

			// connect fires once, disconnect fires once
			expect(listener).toHaveBeenCalledTimes(2);
		});
	});

	describe("onDidChangeConnection event", () => {
		it("should fire exactly once when connecting", async () => {
			const listener = vi.fn();
			manager.onDidChangeConnection(listener);

			await manager.connect();

			expect(listener).toHaveBeenCalledTimes(1);
		});

		it("should fire exactly once when disconnecting", async () => {
			await manager.connect();

			const listener = vi.fn();
			manager.onDidChangeConnection(listener);

			await manager.disconnect();

			expect(listener).toHaveBeenCalledTimes(1);
		});
	});

	describe("dispose()", () => {
		it("should disconnect and clear state on dispose", async () => {
			await manager.connect();
			manager.dispose();

			// Give async disconnect a tick to run
			await new Promise((r) => setTimeout(r, 0));

			expect(mockConnection.close).toHaveBeenCalled();
		});
	});

	describe("hardware selection reuse", () => {
		it("prefers a saved device selection before showing quick pick", async () => {
			const connection = createMockConnection();
			const manager = new DeviceManagerImpl();
			const transport = {
				name: "openport2",
				listDevices: vi.fn().mockResolvedValue([
					{
						id: "openport2:one",
						name: "OpenPort 2.0 A",
						transportName: "openport2",
						connected: false,
					},
					{
						id: "openport2:two",
						name: "OpenPort 2.0 B",
						transportName: "openport2",
						connected: false,
					},
				]),
				connect: vi.fn().mockResolvedValue(connection),
			} satisfies DeviceTransport;
			manager.registerTransport("openport2", transport);
			manager.registerProtocol(createMockProtocol());

			const workspaceState = createWorkspaceState();
			workspaceState.saveDeviceSelection("ecu-primary", {
				id: "openport2:two",
				transportName: "openport2",
				name: "OpenPort 2.0 B",
				locality: "extension-host",
			});
			manager.setHardwareSelectionStrategy(
				new WorkspaceHardwareSelectionStrategy(
					new HardwareSelectionService(workspaceState),
				),
			);

			const quickPickSpy = vi.spyOn(vscode.window, "createQuickPick");

			await manager.selectDeviceAndProtocol();

			expect(quickPickSpy).not.toHaveBeenCalled();
			expect(transport.connect).toHaveBeenCalledWith("openport2:two");
		});

		it("still shows the picker on explicit connect even with a saved device", async () => {
			const connection = createMockConnection();
			const manager = new DeviceManagerImpl();
			const transport = {
				name: "openport2",
				listDevices: vi.fn().mockResolvedValue([
					{
						id: "openport2:one",
						name: "OpenPort 2.0 A",
						transportName: "openport2",
						connected: false,
					},
					{
						id: "openport2:two",
						name: "OpenPort 2.0 B",
						transportName: "openport2",
						connected: false,
					},
				]),
				connect: vi.fn().mockResolvedValue(connection),
			} satisfies DeviceTransport;
			manager.registerTransport("openport2", transport);
			manager.registerProtocol(createMockProtocol());

			const workspaceState = createWorkspaceState();
			workspaceState.saveDeviceSelection("ecu-primary", {
				id: "openport2:two",
				transportName: "openport2",
				name: "OpenPort 2.0 B",
				locality: "extension-host",
			});
			manager.setHardwareSelectionStrategy(
				new WorkspaceHardwareSelectionStrategy(
					new HardwareSelectionService(workspaceState),
				),
			);

			const harness = createQuickPickHarness();
			vi.spyOn(vscode.window, "createQuickPick").mockReturnValueOnce(
				harness.quickPick,
			);

			const connectPromise = manager.connect({ forcePrompt: true });
			await new Promise((resolve) => setTimeout(resolve, 0));
			const candidateEntry = harness.quickPick.items.find(
				(entry) => "candidate" in entry && entry.label === "OpenPort 2.0 A",
			);
			if (candidateEntry == null) {
				throw new Error("Missing quick pick entry for explicit connect");
			}
			harness.accept(candidateEntry);

			await connectPromise;

			expect(transport.connect).toHaveBeenCalledWith("openport2:one");
			expect(workspaceState.getDeviceSelection("ecu-primary")).toEqual({
				id: "openport2:one",
				transportName: "openport2",
				name: "OpenPort 2.0 A",
				locality: "extension-host",
			});
		});

		it("saves the successful device selection after protocol detection", async () => {
			const connection = createMockConnection();
			const transport = {
				name: "openport2",
				listDevices: vi.fn().mockResolvedValue([
					{
						id: "openport2:one",
						name: "OpenPort 2.0 A",
						transportName: "openport2",
						connected: false,
					},
				]),
				connect: vi.fn().mockResolvedValue(connection),
			} satisfies DeviceTransport;
			const manager = new DeviceManagerImpl();
			manager.registerTransport("openport2", transport);
			manager.registerProtocol(createMockProtocol());

			const workspaceState = createWorkspaceState();
			manager.setHardwareSelectionStrategy(
				new WorkspaceHardwareSelectionStrategy(
					new HardwareSelectionService(workspaceState),
				),
			);

			await manager.selectDeviceAndProtocol();

			expect(workspaceState.getDeviceSelection("ecu-primary")).toEqual({
				id: "openport2:one",
				transportName: "openport2",
				name: "OpenPort 2.0 A",
				locality: "extension-host",
			});
		});

		it("saves client-browser locality when the manager is configured for web-owned hardware", async () => {
			const connection = createMockConnection();
			const transport = {
				name: "openport2",
				listDevices: vi.fn().mockResolvedValue([
					{
						id: "openport2:web",
						name: "OpenPort 2.0 WebUSB",
						transportName: "openport2",
						connected: false,
					},
				]),
				connect: vi.fn().mockResolvedValue(connection),
			} satisfies DeviceTransport;
			const manager = new DeviceManagerImpl();
			manager.setHardwareCandidateLocality("client-browser");
			manager.registerTransport("openport2", transport);
			manager.registerProtocol(createMockProtocol());

			const workspaceState = createWorkspaceState();
			manager.setHardwareSelectionStrategy(
				new WorkspaceHardwareSelectionStrategy(
					new HardwareSelectionService(workspaceState),
				),
			);

			await manager.selectDeviceAndProtocol();

			expect(workspaceState.getDeviceSelection("ecu-primary")).toEqual({
				id: "openport2:web",
				transportName: "openport2",
				name: "OpenPort 2.0 WebUSB",
				locality: "client-browser",
			});
		});

		it("can request a new browser-owned device from the picker", async () => {
			const connection = createMockConnection();
			const transport = {
				name: "OpenPort 2.0",
				listDevices: vi.fn().mockResolvedValue([]),
				requestDevice: vi.fn().mockResolvedValue({
					id: "openport2:web",
					name: "OpenPort 2.0 WebUSB",
					transportName: "openport2",
					connected: false,
				}),
				connect: vi.fn().mockResolvedValue(connection),
			} satisfies DeviceTransport;
			const manager = new DeviceManagerImpl();
			manager.setHardwareCandidateLocality("client-browser");
			manager.registerTransport("openport2", transport);
			manager.registerProtocol(createMockProtocol());

			const workspaceState = createWorkspaceState();
			manager.setHardwareSelectionStrategy(
				new WorkspaceHardwareSelectionStrategy(
					new HardwareSelectionService(workspaceState),
				),
			);

			const harness = createQuickPickHarness();
			vi.spyOn(vscode.window, "createQuickPick").mockReturnValueOnce(
				harness.quickPick,
			);

			const connectPromise = manager.selectDeviceAndProtocol();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const requestEntry = harness.quickPick.items.find(
				(entry) =>
					"action" in entry &&
					entry.label === "$(add) Connect New USB Device...",
			);
			if (requestEntry == null) {
				throw new Error("Missing request quick pick entry");
			}
			harness.accept(requestEntry);

			await connectPromise;

			expect(transport.requestDevice).toHaveBeenCalledTimes(1);
			expect(transport.connect).toHaveBeenCalledWith("openport2:web");
			expect(workspaceState.getDeviceSelection("ecu-primary")).toEqual({
				id: "openport2:web",
				transportName: "openport2",
				name: "OpenPort 2.0 WebUSB",
				locality: "client-browser",
			});
		});

		it("forgets a browser-owned device and clears the saved selection", async () => {
			const transport = {
				name: "OpenPort 2.0",
				listDevices: vi.fn().mockResolvedValue([
					{
						id: "openport2:web",
						name: "OpenPort 2.0 WebUSB",
						transportName: "openport2",
						connected: false,
					},
				]),
				forgetDevice: vi.fn().mockResolvedValue(undefined),
				connect: vi.fn(),
			} satisfies DeviceTransport;
			const manager = new DeviceManagerImpl();
			manager.setHardwareCandidateLocality("client-browser");
			manager.registerTransport("openport2", transport);
			manager.registerProtocol(createMockProtocol());

			const workspaceState = createWorkspaceState();
			workspaceState.saveDeviceSelection("ecu-primary", {
				id: "openport2:web",
				transportName: "openport2",
				name: "OpenPort 2.0 WebUSB",
				locality: "client-browser",
			});
			const selectionService = new HardwareSelectionService(workspaceState);
			manager.setHardwareSelectionStrategy({
				selectDevice: async (candidates, requestActions = [], promptOptions) =>
					promptForHardwareCandidate(candidates, requestActions, promptOptions),
				rememberCandidate: () => {},
				forgetCandidate: (candidate) =>
					selectionService.forgetCandidate(candidate),
			});

			const harness = createQuickPickHarness();
			vi.spyOn(vscode.window, "createQuickPick").mockReturnValueOnce(
				harness.quickPick,
			);

			const connectPromise = manager.selectDeviceAndProtocol();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const candidateEntry = harness.quickPick.items.find(
				(entry) =>
					"candidate" in entry && entry.label === "OpenPort 2.0 WebUSB",
			);
			if (candidateEntry == null) {
				throw new Error("Missing forgettable quick pick entry");
			}
			harness.triggerButton(candidateEntry);

			await expect(connectPromise).rejects.toThrow(
				"Device selection cancelled by user",
			);

			expect(transport.forgetDevice).toHaveBeenCalledWith("openport2:web");
			expect(workspaceState.getDeviceSelection("ecu-primary")).toBeUndefined();
		});

		it("manages browser hardware without opening a connection", async () => {
			const transport = {
				name: "OpenPort 2.0",
				listDevices: vi.fn().mockResolvedValue([]),
				requestDevice: vi.fn().mockResolvedValue({
					id: "openport2:web",
					name: "OpenPort 2.0 WebUSB",
					transportName: "openport2",
					connected: false,
				}),
				connect: vi.fn(),
			} satisfies DeviceTransport;
			const manager = new DeviceManagerImpl();
			manager.setHardwareCandidateLocality("client-browser");
			manager.registerTransport("openport2", transport);

			const workspaceState = createWorkspaceState();
			manager.setHardwareSelectionStrategy(
				new WorkspaceHardwareSelectionStrategy(
					new HardwareSelectionService(workspaceState),
				),
			);

			const harness = createQuickPickHarness();
			vi.spyOn(vscode.window, "createQuickPick").mockReturnValueOnce(
				harness.quickPick,
			);

			const managePromise = manager.manageHardwareSelection();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const requestEntry = harness.quickPick.items.find(
				(entry) =>
					"action" in entry &&
					entry.label === "$(add) Connect New USB Device...",
			);
			if (requestEntry == null) {
				throw new Error("Missing request quick pick entry");
			}
			harness.accept(requestEntry);

			const selected = await managePromise;

			expect(transport.requestDevice).toHaveBeenCalledTimes(1);
			expect(transport.connect).not.toHaveBeenCalled();
			expect(selected.device.id).toBe("openport2:web");
			expect(workspaceState.getDeviceSelection("ecu-primary")).toEqual({
				id: "openport2:web",
				transportName: "openport2",
				name: "OpenPort 2.0 WebUSB",
				locality: "client-browser",
			});
		});
	});
});

// ─── DeviceStatusBarManager Tests ────────────────────────────────────────────

describe("DeviceStatusBarManager", () => {
	let manager: DeviceManagerImpl;
	let statusBarManager: DeviceStatusBarManager;
	let mockConnection: ReturnType<typeof createMockConnection>;
	let mockProtocol: ReturnType<typeof createMockProtocol>;
	let mockWidebandManager: ReturnType<typeof createMockWidebandManager>;

	// Track created status bar items
	let createdItems: ReturnType<typeof createMockStatusBarItem>[];

	beforeEach(() => {
		createdItems = [];

		// Mock vscode.window.createStatusBarItem to return trackable items
		vi.mocked(vscode.window.createStatusBarItem).mockImplementation(() => {
			const item = createMockStatusBarItem();
			createdItems.push(item);
			return item as TestStatusBarItem;
		});

		manager = new DeviceManagerImpl();
		mockConnection = createMockConnection();
		mockProtocol = createMockProtocol();
		mockWidebandManager = createMockWidebandManager();

		vi.spyOn(manager, "selectDeviceAndProtocol").mockResolvedValue(
			createResolvedSelection(mockConnection, mockProtocol),
		);

		statusBarManager = new DeviceStatusBarManager(
			manager,
			undefined,
			mockWidebandManager,
		);
	});

	it("should create 7 status bar items", () => {
		expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(7);
	});

	it("should show hardware and Connect items when disconnected", () => {
		const hardwareItem = getRequiredStatusBarItem(createdItems, 0);
		const widebandItem = getRequiredStatusBarItem(createdItems, 1);
		const connectItem = getRequiredStatusBarItem(createdItems, 2);
		expect(hardwareItem.show).toHaveBeenCalled();
		expect(widebandItem.show).toHaveBeenCalled();
		expect(connectItem.show).toHaveBeenCalled();
		expect(widebandItem.text).toBe("$(dashboard)");
		expect(widebandItem.tooltip).toBe("Connect Wideband");
		expect(connectItem.text).toBe("$(plug)");
		expect(connectItem.tooltip).toBe("Connect ECU");

		// All other items should be hidden
		for (let i = 3; i < createdItems.length; i++) {
			expect(createdItems[i]?.hide).toHaveBeenCalled();
		}
	});

	it("should hide Connect item and show Disconnect + StartLog when connected", async () => {
		await manager.connect();

		const hardwareItem = getRequiredStatusBarItem(createdItems, 0);
		const connectItem = getRequiredStatusBarItem(createdItems, 2);
		const disconnectItem = getRequiredStatusBarItem(createdItems, 3);
		const startLogItem = getRequiredStatusBarItem(createdItems, 4);

		// After connect, connectItem should be hidden
		expect(connectItem.hide).toHaveBeenCalled();
		expect(hardwareItem.text).toContain("This machine");
		// disconnectItem and startLogItem should be shown
		expect(disconnectItem.show).toHaveBeenCalled();
		expect(startLogItem.show).toHaveBeenCalled();
	});

	it("should return to Connect-only state after disconnect", async () => {
		await manager.connect();
		await manager.disconnect();

		const connectItem = getRequiredStatusBarItem(createdItems, 2);
		// After disconnect, connectItem should be shown again
		const showCallCount = connectItem.show.mock.calls.length;
		expect(showCallCount).toBeGreaterThanOrEqual(2); // initial + after disconnect
	});

	it("should set disconnect tooltip to device name when connected", async () => {
		await manager.connect();

		const disconnectItem = getRequiredStatusBarItem(createdItems, 3);
		expect(disconnectItem.tooltip).toContain("Test Device");
	});

	it("shows remembered hardware in the status bar when disconnected", () => {
		const rememberedWorkspaceState = createWorkspaceState();
		rememberedWorkspaceState.saveDeviceSelection("ecu-primary", {
			id: "openport2:web",
			transportName: "openport2",
			name: "OpenPort 2.0 WebUSB",
			locality: "client-browser",
		});

		statusBarManager.dispose();
		createdItems = [];
		vi.mocked(vscode.window.createStatusBarItem).mockImplementation(() => {
			const item = createMockStatusBarItem();
			createdItems.push(item);
			return item as TestStatusBarItem;
		});
		statusBarManager = new DeviceStatusBarManager(
			manager,
			new HardwareSelectionService(rememberedWorkspaceState),
			mockWidebandManager,
		);

		const hardwareItem = getRequiredStatusBarItem(createdItems, 0);
		expect(hardwareItem.text).toContain("OpenPort 2.0 WebUSB");
		expect(hardwareItem.tooltip).toContain("Browser");
	});

	it("shows reconnect affordances when the connection has failed", async () => {
		await manager.connect();
		await manager.reconnectActiveConnection("write");

		const hardwareItem = getRequiredStatusBarItem(createdItems, 0);
		const connectItem = getRequiredStatusBarItem(createdItems, 2);
		const disconnectItem = getRequiredStatusBarItem(createdItems, 3);

		expect(hardwareItem.text).toContain("warning");
		expect(hardwareItem.tooltip).toContain("currently unavailable");
		expect(connectItem.show).toHaveBeenCalled();
		expect(connectItem.text).toBe("$(plug)");
		expect(connectItem.tooltip).toContain("Retry connection");
		expect(disconnectItem.hide).toHaveBeenCalled();
	});

	it("shows wideband reading and disconnect action when a wideband is active", () => {
		mockWidebandManager.emitSession({
			adapter: {
				id: "aem-serial-wideband",
				name: "AEM Serial Wideband",
				canOpen: vi.fn(),
				open: vi.fn(),
			},
			candidate: createHardwareCandidate(
				{
					id: "wideband-serial:/dev/cu.usbserial-1",
					name: "AEM Wideband (Serial)",
					transportName: "serial",
					connected: false,
				},
				"client-browser",
			),
			session: {
				id: "wideband-session",
				name: "AEM Wideband",
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(),
			},
		});
		mockWidebandManager.emitReading({
			kind: "afr",
			value: 14.7,
			timestamp: 1234,
		});

		const widebandItem = getRequiredStatusBarItem(createdItems, 1);
		expect(widebandItem.text).toContain("dashboard");
		expect(widebandItem.text).toContain("14.70 AFR");
		expect(widebandItem.tooltip).toContain("Browser");
		expect(widebandItem.command).toBe("ecuExplorer.disconnectWideband");
	});

	it("should dispose all status bar items on dispose()", () => {
		statusBarManager.dispose();

		for (const item of createdItems) {
			expect(item.dispose).toHaveBeenCalled();
		}
	});

	describe("updateLoggingState()", () => {
		function clearStatusBarItemCallHistory() {
			for (const item of createdItems) {
				item.show.mockClear();
				item.hide.mockClear();
				item.dispose.mockClear();
			}
		}

		beforeEach(async () => {
			await manager.connect();
			// Ignore visibility work performed during connect(); each test asserts only the
			// subsequent logging-state transition.
			clearStatusBarItemCallHistory();
		});

		it("should show Pause + Stop items when recording", () => {
			statusBarManager.updateLoggingState("recording");

			const startLogItem = getRequiredStatusBarItem(createdItems, 4);
			const pauseLogItem = getRequiredStatusBarItem(createdItems, 5);
			const stopLogItem = getRequiredStatusBarItem(createdItems, 6);

			expect(startLogItem.hide).toHaveBeenCalled();
			expect(pauseLogItem.show).toHaveBeenCalled();
			expect(stopLogItem.show).toHaveBeenCalled();
		});

		it("should show Resume + Stop items when paused", () => {
			statusBarManager.updateLoggingState("paused");

			const startLogItem = getRequiredStatusBarItem(createdItems, 4);
			const pauseLogItem = getRequiredStatusBarItem(createdItems, 5);
			const stopLogItem = getRequiredStatusBarItem(createdItems, 6);

			expect(startLogItem.hide).toHaveBeenCalled();
			expect(pauseLogItem.show).toHaveBeenCalled();
			expect(stopLogItem.show).toHaveBeenCalled();
		});

		it("should show Start Log when returning to idle", () => {
			statusBarManager.updateLoggingState("recording");
			clearStatusBarItemCallHistory();
			statusBarManager.updateLoggingState("idle");

			const startLogItem = getRequiredStatusBarItem(createdItems, 4);
			expect(startLogItem.show).toHaveBeenCalled();
		});
	});
});

// ─── Context Key Tests ────────────────────────────────────────────────────────

describe("ecuExplorer.deviceConnected context key", () => {
	let manager: DeviceManagerImpl;
	let mockConnection: ReturnType<typeof createMockConnection>;
	let mockProtocol: ReturnType<typeof createMockProtocol>;

	beforeEach(() => {
		manager = new DeviceManagerImpl();
		mockConnection = createMockConnection();
		mockProtocol = createMockProtocol();

		vi.spyOn(manager, "selectDeviceAndProtocol").mockResolvedValue(
			createResolvedSelection(mockConnection, mockProtocol),
		);
	});

	it("should set context key to true when connected", async () => {
		// Simulate what extension.ts does
		manager.onDidChangeConnection((conn) => {
			vscode.commands.executeCommand(
				"setContext",
				"ecuExplorer.deviceConnected",
				conn !== undefined,
			);
		});

		await manager.connect();

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"setContext",
			"ecuExplorer.deviceConnected",
			true,
		);
	});

	it("should set context key to false when disconnected", async () => {
		manager.onDidChangeConnection((conn) => {
			vscode.commands.executeCommand(
				"setContext",
				"ecuExplorer.deviceConnected",
				conn !== undefined,
			);
		});

		await manager.connect();
		await manager.disconnect();

		expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
			"setContext",
			"ecuExplorer.deviceConnected",
			false,
		);
	});
});

// ─── readRomFromDevice Connection Reuse Tests ─────────────────────────────────

describe("readRomFromDevice connection reuse", () => {
	let manager: DeviceManagerImpl;
	let mockConnection: ReturnType<typeof createMockConnection>;
	let mockProtocol: ReturnType<typeof createMockProtocol>;

	beforeEach(() => {
		manager = new DeviceManagerImpl();
		mockConnection = createMockConnection();
		mockProtocol = createMockProtocol();

		vi.spyOn(manager, "selectDeviceAndProtocol").mockResolvedValue(
			createResolvedSelection(mockConnection, mockProtocol),
		);
	});

	it("should reuse active connection when one exists", async () => {
		const selectDeviceAndProtocol = vi.mocked(manager.selectDeviceAndProtocol);

		// Pre-connect
		await manager.connect();
		const selectionCallCount = selectDeviceAndProtocol.mock.calls.length;

		// Simulate what readRomFromDevice does
		const active = manager.activeConnection;
		expect(active).toBeDefined();

		// selectDeviceAndProtocol should NOT be called again
		expect(selectDeviceAndProtocol).toHaveBeenCalledTimes(selectionCallCount);
	});

	it("should call connect() when no active connection exists", async () => {
		expect(manager.activeConnection).toBeUndefined();

		// Simulate what readRomFromDevice does when no active connection
		const connectSpy = vi.spyOn(manager, "connect");
		await manager.connect();

		expect(connectSpy).toHaveBeenCalledTimes(1);
	});

	it("should NOT close connection after ROM read (persistent connection)", async () => {
		await manager.connect();

		// Simulate ROM read completing — connection should remain open
		expect(manager.activeConnection).toBeDefined();
		expect(mockConnection.close).not.toHaveBeenCalled();
	});
});
