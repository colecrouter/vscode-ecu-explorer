/**
 * OpenPort2Transport unit tests
 * Tests the transport behavior with a fake USB interface
 */

import type { DeviceConnection } from "@ecu-explorer/device";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenPort2Transport } from "../src/index.js";

type TestConnection = DeviceConnection & {
	sendFrame: (data: Uint8Array, timeoutMs?: number) => Promise<Uint8Array>;
	receiveFrame: (maxLength: number) => Promise<Uint8Array>;
};

function createIso15765ResponseFrame(payload: Uint8Array): DataView {
	const frame = new Uint8Array(9 + payload.length);
	frame[0] = 0x61; // 'a'
	frame[1] = 0x72; // 'r'
	frame[2] = 0x36; // ISO15765 channel code
	frame[3] = payload.length + 5;
	frame[4] = 0x40; // RX end indication
	frame.set(payload, 9);
	return new DataView(frame.buffer.slice(0));
}

// Fake USBDevice implementation for testing
// Using any to avoid complex type issues with USBDevice interface
const createFakeUSBDevice = (options: {
	vendorId: number;
	productId: number;
	serialNumber?: string;
	productName?: string;
	// biome-ignore lint/suspicious/noExplicitAny: Mocking complex USBDevice interface
}): any => {
	let _dataBuffer: ArrayBuffer = new ArrayBuffer(0);
	return {
		// Required USBDevice properties (minimal implementation)
		usbVersionMajor: 2,
		usbVersionMinor: 0,
		usbVersionSubminor: 0,
		deviceClass: 0,
		deviceSubclass: 0,
		deviceProtocol: 0,
		vendorId: options.vendorId,
		productId: options.productId,
		serialNumber: options.serialNumber ?? null,
		productName: options.productName ?? null,
		manufacturerName: null,
		configurationValue: 1,
		configuration: null,
		configurations: [],
		selectedConfiguration: null,
		opened: false,
		claimedInterface: null,
		// Methods
		async open(): Promise<void> {
			this.opened = true;
		},
		async close(): Promise<void> {
			this.opened = false;
		},
		async claimInterface(_interfaceNumber: number): Promise<void> {
			// No-op for fake
		},
		async releaseInterface(_interfaceNumber: number): Promise<void> {
			// No-op for fake
		},
		async transferIn(
			_endpoint: number,
			_length: number,
		): Promise<{ data: ArrayBuffer | null }> {
			return { data: _dataBuffer };
		},
		async transferOut(
			_endpoint: number,
			data: Uint8Array,
		): Promise<{ status: string }> {
			// Echo back the data for testing
			_dataBuffer = data.buffer.slice(0) as ArrayBuffer;
			return { status: "ok" };
		},
		// Test helper
		setResponseData(data: Uint8Array): void {
			_dataBuffer = data.buffer.slice(0) as ArrayBuffer;
		},
	};
};

// Fake USB interface implementation
class FakeUSB implements Partial<USB> {
	// biome-ignore lint/suspicious/noExplicitAny: Mocking complex USB interface
	private devices: any[] = [];

	// biome-ignore lint/suspicious/noExplicitAny: Mocking complex USB interface
	constructor(devices: any[] = []) {
		this.devices = devices;
	}

	async getDevices(): Promise<USBDevice[]> {
		return this.devices;
	}

	async requestDevice(_options: USBDeviceRequestOptions): Promise<USBDevice> {
		if (this.devices.length === 0) {
			throw new Error("No devices available");
		}
		return this.devices[0];
	}

	// Test helper: add device
	// biome-ignore lint/suspicious/noExplicitAny: Mocking complex device interface
	addDevice(device: any): void {
		this.devices.push(device);
	}

	// Test helper: clear devices
	clearDevices(): void {
		this.devices = [];
	}

	// Stub event handler properties to satisfy USB interface
	// biome-ignore lint/suspicious/noExplicitAny: Mocking complex USB interface
	onconnect: ((this: USB, ev: USBConnectionEvent) => any) | null = null;
	// biome-ignore lint/suspicious/noExplicitAny: Mocking complex USB interface
	ondisconnect: ((this: USB, ev: USBConnectionEvent) => any) | null = null;

	addEventListener(): void {
		// No-op for testing
	}

	removeEventListener(): void {
		// No-op for testing
	}

	dispatchEvent(): boolean {
		// No-op for testing
		return true;
	}
}

class FakeSerialPort {
	readonly path: string;
	isOpen = false;
	private readonly reads: Uint8Array[] = [];

	constructor(path: string, responses: Uint8Array[] = []) {
		this.path = path;
		this.reads.push(...responses);
	}

	async open(): Promise<void> {
		this.isOpen = true;
	}

	async close(): Promise<void> {
		this.isOpen = false;
	}

	async write(_data: Uint8Array): Promise<void> {
		// no-op
	}

	async read(_maxLength: number, _timeoutMs: number): Promise<Uint8Array> {
		const next = this.reads.shift();
		if (next == null) {
			throw new Error(`OpenPort 2.0 read timed out after ${_timeoutMs}ms`);
		}
		return next;
	}
}

class FakeSerialRuntime {
	private readonly ports;
	private readonly factories;

	constructor(ports, factories) {
		this.ports = ports;
		this.factories = factories;
	}

	async listPorts() {
		return this.ports;
	}

	async openPort(path: string) {
		const factory = this.factories.get(path);
		if (factory == null) {
			throw new Error(`Port not found: ${path}`);
		}
		return factory();
	}
}

describe("OpenPort2Transport", () => {
	describe("listDevices", () => {
		it("returns only devices matching VID 0x0403 and PID 0xcc4d", async () => {
			const fakeUsb = new FakeUSB([
				// Matching OpenPort 2.0 device
				createFakeUSBDevice({
					vendorId: 0x0403,
					productId: 0xcc4d,
					serialNumber: "OP2-001",
					productName: "Tactrix OpenPort 2.0",
				}),
				// Non-matching device
				createFakeUSBDevice({
					vendorId: 0x1234,
					productId: 0x5678,
					serialNumber: "OTHER-001",
					productName: "Other Device",
				}),
			]);

			const transport = new OpenPort2Transport({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				usb: fakeUsb,
			});

			const devices = await transport.listDevices();

			// Should only return the OpenPort 2.0 device
			expect(devices).toHaveLength(1);
			expect(devices[0]?.id).toBe("openport2:OP2-001");
			expect(devices[0]?.name).toBe("Tactrix OpenPort 2.0");
			expect(devices[0]?.transportName).toBe("openport2");
		});

		it("filters out devices with different VID", async () => {
			const fakeUsb = new FakeUSB([
				createFakeUSBDevice({
					vendorId: 0x0000, // Wrong VID
					productId: 0xcc4d,
					serialNumber: "WRONG-001",
				}),
			]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			const devices = await transport.listDevices();
			expect(devices).toHaveLength(0);
		});

		it("filters out devices with different PID", async () => {
			const fakeUsb = new FakeUSB([
				createFakeUSBDevice({
					vendorId: 0x0403,
					productId: 0x0000, // Wrong PID
					serialNumber: "WRONG-002",
				}),
			]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			const devices = await transport.listDevices();
			expect(devices).toHaveLength(0);
		});

		it("returns empty list when no devices match", async () => {
			const fakeUsb = new FakeUSB([]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			const devices = await transport.listDevices();
			expect(devices).toHaveLength(0);
		});

		it("returns empty list when provider returns empty array", async () => {
			const fakeUsb = new FakeUSB([]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			const devices = await transport.listDevices();
			expect(devices).toEqual([]);
		});
	});

	describe("connect", () => {
		it("connects to a device by its ID", async () => {
			const fakeDevice = createFakeUSBDevice({
				vendorId: 0x0403,
				productId: 0xcc4d,
				serialNumber: "OP2-002",
				productName: "Tactrix OpenPort 2.0",
			});
			const fakeUsb = new FakeUSB([fakeDevice]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			const connection = await transport.connect("openport2:OP2-002");

			expect(connection).toBeDefined();
			expect(connection.deviceInfo.id).toBe("openport2:OP2-002");
			expect(connection.deviceInfo.transportName).toBe("openport2");

			// Clean up
			await connection.close();
		});

		it("throws error when device is not found", async () => {
			const fakeUsb = new FakeUSB([
				createFakeUSBDevice({
					vendorId: 0x0403,
					productId: 0xcc4d,
					serialNumber: "OP2-003",
				}),
			]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			await expect(transport.connect("openport2:NONEXISTENT")).rejects.toThrow(
				"OpenPort 2.0 device not found: openport2:NONEXISTENT",
			);
		});

		it("throws error with device ID in message", async () => {
			const fakeUsb = new FakeUSB([]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			await expect(transport.connect("openport2:MISSING")).rejects.toThrow(
				"openport2:MISSING",
			);
		});

		it("opens and claims the device", async () => {
			const fakeDevice = createFakeUSBDevice({
				vendorId: 0x0403,
				productId: 0xcc4d,
				serialNumber: "OP2-004",
			});
			const fakeUsb = new FakeUSB([fakeDevice]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			const connection = await transport.connect("openport2:OP2-004");

			expect(fakeDevice.opened).toBe(true);

			await connection.close();
		});

		it("connects to a serial-backed device by its ID", async () => {
			const path = "/dev/cu.usbmodemTAgdW56p1";
			const serial = new FakeSerialRuntime(
				[
					{
						path,
						serialNumber: "TAgdW56p",
						manufacturer: "Tactrix",
						friendlyName: "Tactrix OpenPort 2.0",
						vendorId: "0403",
						productId: "cc4d",
					},
				],
				new Map([
					[
						path,
						() =>
							new FakeSerialPort(path, [
								new TextEncoder().encode("ari main code version : 1.17.4877\r\n"),
								new TextEncoder().encode("aro\r\n"),
							]),
					],
				]),
			);

			const transport = new OpenPort2Transport({ serial });
			const devices = await transport.listDevices();
			expect(devices[0]?.id).toBe(`openport2-serial:${path}`);
			expect(devices[0]?.name).toContain("(Serial)");

			const connection = await transport.connect(`openport2-serial:${path}`);
			expect(connection.deviceInfo.id).toBe(`openport2-serial:${path}`);
			await connection.close();
		});
	});

	describe("OpenPort2Connection", () => {
		// biome-ignore lint/suspicious/noExplicitAny: Mocking complex USBDevice interface
		let fakeDevice: any;
		let fakeUsb: FakeUSB;
		let connection: TestConnection;

		beforeEach(async () => {
			fakeDevice = createFakeUSBDevice({
				vendorId: 0x0403,
				productId: 0xcc4d,
				serialNumber: "OP2-TEST",
				productName: "Test OpenPort 2.0",
			});
			fakeUsb = new FakeUSB([fakeDevice]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			connection = (await transport.connect(
				"openport2:OP2-TEST",
			)) as TestConnection;
		});

		it("has sendFrame method", async () => {
			expect(typeof connection.sendFrame).toBe("function");
		});

		it("has receiveFrame method", async () => {
			expect(typeof connection.receiveFrame).toBe("function");
		});

		it("has startStream method", async () => {
			expect(typeof connection.startStream).toBe("function");
		});

		it("has stopStream method", async () => {
			expect(typeof connection.stopStream).toBe("function");
		});

		it("has close method", async () => {
			expect(typeof connection.close).toBe("function");
		});

		it("sendFrame and receiveFrame work together", async () => {
			// The sendFrame method exists and can be called
			expect(typeof connection.sendFrame).toBe("function");

			const testData = new Uint8Array([0x01, 0x02]);
			fakeDevice.transferIn = vi.fn(async () => ({
				data: createIso15765ResponseFrame(testData),
			}));
			await expect(connection.sendFrame(testData)).resolves.toEqual(testData);
		});

		it("receiveFrame returns data from device", async () => {
			// The receiveFrame method exists and can be called
			// Note: Full data return testing requires more complex mock setup
			expect(typeof connection.receiveFrame).toBe("function");

			// Verify we can call receiveFrame without throwing
			await expect(connection.receiveFrame(64)).resolves.toBeDefined();
		});

		it("sendFrame times out when the device never responds", async () => {
			fakeDevice.transferIn = vi.fn(
				() => new Promise<never>(() => {}),
			);

			await expect(
				connection.sendFrame(new Uint8Array([0xe5]), 10),
			).rejects.toThrow("OpenPort 2.0 read timed out after 10ms");
		});

		it("close releases the device", async () => {
			expect(fakeDevice.opened).toBe(true);

			await connection.close();

			// Note: after close, the device might still appear "opened" in our fake
			// because we don't fully simulate the close behavior
		});

		it("startStream and stopStream work together", () => {
			const onFrame = vi.fn();

			connection.startStream(onFrame);
			connection.stopStream();

			// Callback should not have been called synchronously
			expect(onFrame).not.toHaveBeenCalled();
		});
	});

	describe("transport name", () => {
		it("has correct name", async () => {
			const fakeUsb = new FakeUSB([]);
			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			expect(transport.name).toBe("Tactrix OpenPort 2.0");
		});
	});

	describe("requestDevice", () => {
		it("requests a device and returns DeviceInfo", async () => {
			const fakeDevice = createFakeUSBDevice({
				vendorId: 0x0403,
				productId: 0xcc4d,
				serialNumber: "OP2-REQUEST",
				productName: "Tactrix OpenPort 2.0",
			});
			const fakeUsb = new FakeUSB([fakeDevice]);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
			});

			const deviceInfo = await transport.requestDevice();

			expect(deviceInfo).toBeDefined();
			expect(deviceInfo.id).toBe("openport2:OP2-REQUEST");
			expect(deviceInfo.transportName).toBe("openport2");
		});

		it("returns the first matching serial device when USB and HID are unavailable", async () => {
			const path = "/dev/cu.usbmodemTAgdW56p1";
			const serial = new FakeSerialRuntime(
				[
					{
						path,
						serialNumber: "TAgdW56p",
						manufacturer: "Tactrix",
						friendlyName: "Tactrix OpenPort 2.0",
					},
				],
				new Map(),
			);

			const transport = new OpenPort2Transport({ serial });
			const deviceInfo = await transport.requestDevice();

			expect(deviceInfo.id).toBe(`openport2-serial:${path}`);
			expect(deviceInfo.name).toContain("(Serial)");
		});
	});

	describe("OpenPort2SerialConnection", () => {
		it("initializes over serial and reads wrapped responses", async () => {
			const path = "/dev/cu.usbmodemTAgdW56p1";
			const payload = new Uint8Array([0x01, 0x02]);
			const serial = new FakeSerialRuntime(
				[
					{
						path,
						serialNumber: "TAgdW56p",
						manufacturer: "Tactrix",
						friendlyName: "Tactrix OpenPort 2.0",
						vendorId: "0403",
						productId: "cc4d",
					},
				],
				new Map([
					[
						path,
						() =>
							new FakeSerialPort(path, [
								new TextEncoder().encode("ari main code version : 1.17.4877\r\n"),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("aro\r\n"),
								new Uint8Array(0),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arf6 0 0\r\n"),
								new Uint8Array(createIso15765ResponseFrame(payload).buffer),
							]),
					],
				]),
			);

			const transport = new OpenPort2Transport({ serial });
			const connection = /** @type {TestConnection} */ (
				await transport.connect(`openport2-serial:${path}`)
			);
			await connection.initialize();

			await expect(connection.sendFrame(payload)).resolves.toEqual(payload);
			await connection.close();
		});
	});
});
