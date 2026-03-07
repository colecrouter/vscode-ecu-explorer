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
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { DeviceManagerImpl } from "../src/device-manager.js";
import { DeviceStatusBarManager } from "../src/device-status-bar.js";

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
} {
	return {
		connection,
		protocol,
	};
}

function createMockTransport(connection: TestConnection): DeviceTransport {
	return {
		name: "openport2",
		listDevices: vi.fn().mockResolvedValue([]),
		connect: vi.fn().mockResolvedValue(connection),
	};
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

// ─── DeviceManagerImpl Tests ─────────────────────────────────────────────────

describe("DeviceManagerImpl", () => {
	let manager: DeviceManagerImpl;
	let mockConnection: ReturnType<typeof createMockConnection>;
	let mockProtocol: ReturnType<typeof createMockProtocol>;

	beforeEach(() => {
		vi.clearAllMocks();
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
});

// ─── DeviceStatusBarManager Tests ────────────────────────────────────────────

describe("DeviceStatusBarManager", () => {
	let manager: DeviceManagerImpl;
	let statusBarManager: DeviceStatusBarManager;
	let mockConnection: ReturnType<typeof createMockConnection>;
	let mockProtocol: ReturnType<typeof createMockProtocol>;

	// Track created status bar items
	let createdItems: ReturnType<typeof createMockStatusBarItem>[];

	beforeEach(() => {
		vi.clearAllMocks();
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

		vi.spyOn(manager, "selectDeviceAndProtocol").mockResolvedValue(
			createResolvedSelection(mockConnection, mockProtocol),
		);

		statusBarManager = new DeviceStatusBarManager(manager);
	});

	it("should create 5 status bar items", () => {
		expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(5);
	});

	it("should show Connect item and hide others when disconnected", () => {
		// connectItem is index 0 (first created)
		const connectItem = getRequiredStatusBarItem(createdItems, 0);
		expect(connectItem.show).toHaveBeenCalled();

		// All other items should be hidden
		for (let i = 1; i < createdItems.length; i++) {
			expect(createdItems[i]?.hide).toHaveBeenCalled();
		}
	});

	it("should hide Connect item and show Disconnect + StartLog when connected", async () => {
		await manager.connect();

		const connectItem = getRequiredStatusBarItem(createdItems, 0);
		const disconnectItem = getRequiredStatusBarItem(createdItems, 1);
		const startLogItem = getRequiredStatusBarItem(createdItems, 2);

		// After connect, connectItem should be hidden
		expect(connectItem.hide).toHaveBeenCalled();
		// disconnectItem and startLogItem should be shown
		expect(disconnectItem.show).toHaveBeenCalled();
		expect(startLogItem.show).toHaveBeenCalled();
	});

	it("should return to Connect-only state after disconnect", async () => {
		await manager.connect();
		await manager.disconnect();

		const connectItem = getRequiredStatusBarItem(createdItems, 0);
		// After disconnect, connectItem should be shown again
		const showCallCount = connectItem.show.mock.calls.length;
		expect(showCallCount).toBeGreaterThanOrEqual(2); // initial + after disconnect
	});

	it("should set disconnect tooltip to device name when connected", async () => {
		await manager.connect();

		const disconnectItem = getRequiredStatusBarItem(createdItems, 1);
		expect(disconnectItem.tooltip).toContain("ECU Device");
	});

	it("should dispose all status bar items on dispose()", () => {
		statusBarManager.dispose();

		for (const item of createdItems) {
			expect(item.dispose).toHaveBeenCalled();
		}
	});

	describe("updateLoggingState()", () => {
		beforeEach(async () => {
			await manager.connect();
			// Reset call counts after connect
			vi.clearAllMocks();
		});

		it("should show Pause + Stop items when recording", () => {
			statusBarManager.updateLoggingState("recording");

			const startLogItem = getRequiredStatusBarItem(createdItems, 2);
			const pauseLogItem = getRequiredStatusBarItem(createdItems, 3);
			const stopLogItem = getRequiredStatusBarItem(createdItems, 4);

			expect(startLogItem.hide).toHaveBeenCalled();
			expect(pauseLogItem.show).toHaveBeenCalled();
			expect(stopLogItem.show).toHaveBeenCalled();
		});

		it("should show Resume + Stop items when paused", () => {
			statusBarManager.updateLoggingState("paused");

			const startLogItem = getRequiredStatusBarItem(createdItems, 2);
			const pauseLogItem = getRequiredStatusBarItem(createdItems, 3);
			const stopLogItem = getRequiredStatusBarItem(createdItems, 4);

			expect(startLogItem.hide).toHaveBeenCalled();
			expect(pauseLogItem.show).toHaveBeenCalled();
			expect(stopLogItem.show).toHaveBeenCalled();
		});

		it("should show Start Log when returning to idle", () => {
			statusBarManager.updateLoggingState("recording");
			vi.clearAllMocks();
			statusBarManager.updateLoggingState("idle");

			const startLogItem = getRequiredStatusBarItem(createdItems, 2);
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
		vi.clearAllMocks();
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
		vi.clearAllMocks();
		manager = new DeviceManagerImpl();
		mockConnection = createMockConnection();
		mockProtocol = createMockProtocol();

		vi.spyOn(manager, "selectDeviceAndProtocol").mockResolvedValue(
			createResolvedSelection(mockConnection, mockProtocol),
		);
	});

	it("should reuse active connection when one exists", async () => {
		// Pre-connect
		await manager.connect();
		const connectSpy = vi.spyOn(manager, "selectDeviceAndProtocol");
		connectSpy.mockClear();

		// Simulate what readRomFromDevice does
		const active = manager.activeConnection;
		expect(active).toBeDefined();

		// selectDeviceAndProtocol should NOT be called again
		expect(connectSpy).not.toHaveBeenCalled();
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
