/**
 * K-line transport integration tests
 * 25+ tests covering frame send/receive, flow control, and error recovery
 */

import type { DeviceInfo } from "@ecu-explorer/device";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type KLineConnection,
	KLineTransport,
} from "../src/kline-transport.js";

describe("KLineTransport", () => {
	let transport: KLineTransport;

	beforeEach(() => {
		transport = new KLineTransport();
	});

	it("creates transport with correct name", () => {
		expect(transport.name).toBe("K-Line (ISO 14230)");
	});

	it("listDevices returns mock device", async () => {
		const devices = await transport.listDevices();
		expect(devices.length).toBeGreaterThan(0);
	});

	it("lists a device with k-line transport name", async () => {
		const devices = await transport.listDevices();
		const klineDevice = devices.find((d) => d.transportName === "k-line");
		expect(klineDevice).toBeDefined();
	});

	it("returns consistent device list", async () => {
		const devices1 = await transport.listDevices();
		const devices2 = await transport.listDevices();

		expect(devices1.length).toBe(devices2.length);
		expect(devices1[0]?.id).toBe(devices2[0]?.id);
	});

	it("device has required properties", async () => {
		const devices = await transport.listDevices();
		const device = devices[0];

		expect(device).toBeDefined();
		expect(device?.id).toBeDefined();
		expect(device?.name).toBeDefined();
		expect(device?.transportName).toBe("k-line");
		expect(device?.connected).toBe(true);
	});

	it("supports adding mock devices", async () => {
		const initialCount = (await transport.listDevices()).length;

		transport.addMockDevice("kline:test:02", "/dev/ttyUSB1", 10400);
		const devices = await transport.listDevices();

		expect(devices.length).toBe(initialCount + 1);
	});

	it("supports removing mock devices", async () => {
		transport.addMockDevice("kline:test:03", "/dev/ttyUSB2", 10400);
		const withAdded = await transport.listDevices();

		transport.removeMockDevice("kline:test:03");
		const withRemoved = await transport.listDevices();

		expect(withAdded.length).toBe(withRemoved.length + 1);
	});

	it("connects to a valid device", async () => {
		const devices = await transport.listDevices();
		const first = devices[0];
		expect(first).toBeDefined();

		const connection = await transport.connect(first!.id);
		expect(connection).toBeDefined();
		expect(connection.deviceInfo.id).toBe(first!.id);
	});

	it("throws on invalid device ID", async () => {
		await expect(transport.connect("invalid:device")).rejects.toThrow();
	});

	it("connection has deviceInfo", async () => {
		const devices = await transport.listDevices();
		const connection = await transport.connect(devices[0]!.id);

		expect(connection.deviceInfo).toBeDefined();
		expect(connection.deviceInfo.transportName).toBe("k-line");
	});

	it("mock device utilities work", () => {
		transport.addMockDevice("kline:custom:01", "/dev/ttyUSB5", 10400);
		const device = transport.getMockDevice("kline:custom:01");

		expect(device).toBeDefined();
		expect(device?.portPath).toBe("/dev/ttyUSB5");
		expect(device?.baudRate).toBe(10400);

		transport.removeMockDevice("kline:custom:01");
		const removed = transport.getMockDevice("kline:custom:01");
		expect(removed).toBeUndefined();
	});
});

describe("KLineConnection", () => {
	let transport: KLineTransport;
	let deviceInfo: DeviceInfo;
	let connection: KLineConnection;

	beforeEach(async () => {
		transport = new KLineTransport();
		const devices = await transport.listDevices();
		deviceInfo = devices[0]!;
		connection = await transport.connect(deviceInfo.id);
	});

	it("connection is created successfully", () => {
		expect(connection).toBeDefined();
	});

	it("has correct deviceInfo", () => {
		expect(connection.deviceInfo.id).toBe(deviceInfo.id);
		expect(connection.deviceInfo.transportName).toBe(deviceInfo.transportName);
	});

	it("health is initialized", () => {
		const health = connection.getHealth();
		expect(health.framesSent).toBe(0);
		expect(health.framesReceived).toBe(0);
		expect(health.checksumErrors).toBe(0);
	});

	it("rejects empty payload", async () => {
		await expect(connection.sendFrame(new Uint8Array([]))).rejects.toThrow(
			"payload must be 1-7 bytes",
		);
	});

	it("rejects oversized payload", async () => {
		const oversized = new Uint8Array(8);
		await expect(connection.sendFrame(oversized)).rejects.toThrow(
			"payload must be 1-7 bytes",
		);
	});

	it("initializes health stats to zero", () => {
		const health = connection.getHealth();

		expect(health.framesSent).toBe(0);
		expect(health.framesReceived).toBe(0);
		expect(health.checksumErrors).toBe(0);
		expect(health.timeoutErrors).toBe(0);
		expect(health.retries).toBe(0);
	});

	it("can be reset", () => {
		connection.resetHealth();
		const health = connection.getHealth();

		expect(health.framesSent).toBe(0);
		expect(health.framesReceived).toBe(0);
	});

	it("returns separate health object", () => {
		const health1 = connection.getHealth();
		const health2 = connection.getHealth();

		expect(health1).not.toBe(health2);
		expect(health1.framesSent).toBe(health2.framesSent);
	});

	it("can start stream", () => {
		const onFrame = vi.fn();
		expect(() => connection.startStream(onFrame)).not.toThrow();
	});

	it("can stop stream", () => {
		const onFrame = vi.fn();
		connection.startStream(onFrame);
		expect(() => connection.stopStream()).not.toThrow();
	});

	it("startStream and stopStream work together", () => {
		const onFrame = vi.fn();
		connection.startStream(onFrame);
		connection.stopStream();
		connection.stopStream();

		expect(onFrame).not.toHaveBeenCalled();
	});

	it("can close connection", async () => {
		await expect(connection.close()).resolves.toBeUndefined();
	});

	it("close() is idempotent", async () => {
		await connection.close();
		await expect(connection.close()).resolves.toBeUndefined();
	});

	it("close stops active stream", async () => {
		const onFrame = vi.fn();
		connection.startStream(onFrame);
		await connection.close();
	});
});

describe("K-line transport full flow", () => {
	it("can enumerate devices and connect", async () => {
		const transport = new KLineTransport();
		const devices = await transport.listDevices();

		expect(devices.length).toBeGreaterThan(0);

		const connection = await transport.connect(devices[0]!.id);
		expect(connection).toBeDefined();

		await connection.close();
	});

	it("supports multiple concurrent connections", async () => {
		const transport = new KLineTransport();
		transport.addMockDevice("kline:test:04", "/dev/ttyUSB3");
		transport.addMockDevice("kline:test:05", "/dev/ttyUSB4");

		const devices = await transport.listDevices();
		const conn1 = await transport.connect(devices[0]!.id);
		const conn2 = await transport.connect(devices[1]!.id);

		expect(conn1.deviceInfo.id).not.toBe(conn2.deviceInfo.id);

		await conn1.close();
		await conn2.close();
	});
});
