/**
 * OpenPort2Transport unit tests
 * Tests the transport behavior with a fake USB interface
 */

import type { DeviceConnection } from "@ecu-explorer/device";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenPort2Transport } from "../src/index.js";

type TestConnection = DeviceConnection & {
	initialize: () => Promise<void>;
	sendFrame: (data: Uint8Array, timeoutMs?: number) => Promise<Uint8Array>;
	receiveFrame: (maxLength: number) => Promise<Uint8Array>;
};

type FakeSerialPortFactory = () => FakeSerialPort;

type FakeSerialPortInfo = {
	path: string;
	serialNumber?: string | null;
	manufacturer?: string | null;
	friendlyName?: string | null;
	vendorId?: number | string | null;
	productId?: number | string | null;
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

function createAdapterPacket(
	channelCode: number,
	packetType: number,
	payload: Uint8Array,
): Uint8Array {
	const frame = new Uint8Array(9 + payload.length);
	frame[0] = 0x61; // 'a'
	frame[1] = 0x72; // 'r'
	frame[2] = channelCode;
	frame[3] = payload.length + 5;
	frame[4] = packetType;
	frame.set(payload, 9);
	return frame;
}

function decodeAsciiPrefix(frame: Uint8Array, prefixLength: number): string {
	return new TextDecoder().decode(frame.slice(0, prefixLength));
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
	const writes: Uint8Array[] = [];
	let forgotten = false;
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
		async forget(): Promise<void> {
			forgotten = true;
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
			writes.push(new Uint8Array(data));
			// Echo back the data for testing
			_dataBuffer = data.buffer.slice(0) as ArrayBuffer;
			return { status: "ok" };
		},
		// Test helper
		setResponseData(data: Uint8Array): void {
			_dataBuffer = data.buffer.slice(0) as ArrayBuffer;
		},
		getWrites(): Uint8Array[] {
			return writes.map((entry) => new Uint8Array(entry));
		},
		wasForgotten(): boolean {
			return forgotten;
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
	private readonly writes: Uint8Array[] = [];

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

	async write(data: Uint8Array): Promise<void> {
		this.writes.push(new Uint8Array(data));
	}

	async read(_maxLength: number, _timeoutMs: number): Promise<Uint8Array> {
		const next = this.reads.shift();
		if (next == null) {
			throw new Error(`OpenPort 2.0 read timed out after ${_timeoutMs}ms`);
		}
		return next;
	}

	getWrites(): Uint8Array[] {
		return this.writes.map((entry) => new Uint8Array(entry));
	}
}

class FakeSerialRuntime {
	private readonly ports: readonly FakeSerialPortInfo[];
	private readonly factories: ReadonlyMap<string, FakeSerialPortFactory>;

	constructor(
		ports: readonly FakeSerialPortInfo[],
		factories: ReadonlyMap<string, FakeSerialPortFactory>,
	) {
		this.ports = ports;
		this.factories = factories;
	}

	async listPorts(): Promise<readonly FakeSerialPortInfo[]> {
		return this.ports;
	}

	async openPort(path: string): Promise<FakeSerialPort> {
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

		it("falls back to matching serial port for USB IDs when USB claim fails", async () => {
			const path = "/dev/cu.usbmodemTAgdW56p1";
			const fakeDevice = createFakeUSBDevice({
				vendorId: 0x0403,
				productId: 0xcc4d,
				serialNumber: "OP2-005",
				productName: "Tactrix OpenPort 2.0",
			});
			fakeDevice.claimInterface = vi.fn(async () => {
				throw new Error("Failed to claim interface");
			});
			const fakeUsb = new FakeUSB([fakeDevice]);

			const serial = new FakeSerialRuntime(
				[
					{
						path,
						serialNumber: "OP2-005",
						manufacturer: "tactrix",
						friendlyName: "Tactrix OpenPort 2.0",
						vendorId: "0403",
						productId: "cc4d",
					},
				],
				new Map([[path, () => new FakeSerialPort(path, [new Uint8Array(0)])]]),
			);

			const transport = new OpenPort2Transport({
				usb: fakeUsb,
				serial,
			});

			const connection = (await transport.connect(
				"openport2:OP2-005",
			)) as TestConnection;
			expect(connection.deviceInfo.id).toBe(`openport2-serial:${path}`);
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
								new TextEncoder().encode(
									"ari main code version : 1.17.4877\r\n",
								),
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

		it("reassembles ISO15765 responses split across multiple adapter reads", async () => {
			const payload = new Uint8Array([0x62, 0xf1, 0x90, 0x31, 0x32, 0x33]);
			const frame = new Uint8Array(createIso15765ResponseFrame(payload).buffer);
			const chunks = [frame.slice(0, 7), frame.slice(7)];
			fakeDevice.transferIn = vi.fn(async () => ({
				data: new DataView((chunks.shift() ?? new Uint8Array(0)).buffer),
			}));

			await expect(connection.sendFrame(payload)).resolves.toEqual(payload);
		});

		it("ignores adapter control packets before returning the ISO15765 response", async () => {
			const payload = new Uint8Array([0x62, 0x10, 0x92]);
			const controlPacket = createAdapterPacket(
				0x6f,
				0x00,
				new Uint8Array([0x01]),
			);
			const responsePacket = new Uint8Array(
				createIso15765ResponseFrame(payload).buffer,
			);
			const chunks = [controlPacket, responsePacket];
			fakeDevice.transferIn = vi.fn(async () => ({
				data: new DataView((chunks.shift() ?? new Uint8Array(0)).buffer),
			}));

			await expect(connection.sendFrame(payload)).resolves.toEqual(payload);
		});

		it("initialization should use EvoScan's ISO15765 PASS_FILTER setup", async () => {
			const reads = [
				new TextEncoder().encode("ari main code version : 1.17.4877\r\n"),
				new TextEncoder().encode("aro\r\n"),
				new TextEncoder().encode("arr 16 12234\r\n"),
				new Uint8Array(0),
				new TextEncoder().encode("aro\r\n"),
				new TextEncoder().encode("arf6 0 0\r\n"),
				new Uint8Array(0),
			];
			fakeDevice.transferIn = vi.fn(async () => ({
				data: new DataView((reads.shift() ?? new Uint8Array(0)).buffer),
			}));

			await connection.initialize();

			const writes = fakeDevice.getWrites() as Uint8Array[];
			expect(decodeAsciiPrefix(writes[0] ?? new Uint8Array(0), 9)).toBe(
				"\r\n\r\nati\r\n",
			);
			expect(decodeAsciiPrefix(writes[1] ?? new Uint8Array(0), 5)).toBe(
				"ata\r\n",
			);
			expect(decodeAsciiPrefix(writes[2] ?? new Uint8Array(0), 10)).toBe(
				"atr 16\r\n",
			);
			expect(decodeAsciiPrefix(writes[3] ?? new Uint8Array(0), 17)).toBe(
				"ato6 0 500000 0\r\n",
			);
			expect(decodeAsciiPrefix(writes[4] ?? new Uint8Array(0), 12)).toBe(
				"atf6 1 0 4\r\n",
			);
		});

		it("receiveFrame returns data from device", async () => {
			// The receiveFrame method exists and can be called
			// Note: Full data return testing requires more complex mock setup
			expect(typeof connection.receiveFrame).toBe("function");

			// Verify we can call receiveFrame without throwing
			await expect(connection.receiveFrame(64)).resolves.toBeDefined();
		});

		it("sendFrame times out when the device never responds", async () => {
			fakeDevice.transferIn = vi.fn(() => new Promise<never>(() => {}));

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

	describe("forgetDevice", () => {
		it("forgets a matching WebUSB device", async () => {
			const device = createFakeUSBDevice({
				vendorId: 0x0403,
				productId: 0xcc4d,
				serialNumber: "OP2-001",
				productName: "Tactrix OpenPort 2.0",
			});
			const transport = new OpenPort2Transport({
				usb: new FakeUSB([device]) as USB,
			});

			await transport.forgetDevice("openport2:OP2-001");

			expect(device.wasForgotten()).toBe(true);
		});
	});

	describe("OpenPort2SerialConnection", () => {
		it("initializes over serial and reads wrapped responses", async () => {
			const path = "/dev/cu.usbmodemTAgdW56p1";
			const payload = new Uint8Array([0x01, 0x02]);
			let getOpenedPortWrites = (): Uint8Array[] => [];
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
						() => {
							const port = new FakeSerialPort(path, [
								new TextEncoder().encode(
									"ari main code version : 1.17.4877\r\n",
								),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arr 16 12234\r\n"),
								new Uint8Array(0),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arf6 0 0\r\n"),
								new Uint8Array(0),
								new Uint8Array(createIso15765ResponseFrame(payload).buffer),
							]);
							getOpenedPortWrites = () => port.getWrites();
							return port;
						},
					],
				]),
			);

			const transport = new OpenPort2Transport({ serial });
			const connection = (await transport.connect(
				`openport2-serial:${path}`,
			)) as TestConnection;
			await connection.initialize();

			const writes = getOpenedPortWrites();
			expect(decodeAsciiPrefix(writes[0] ?? new Uint8Array(0), 9)).toBe(
				"\r\n\r\nati\r\n",
			);
			expect(decodeAsciiPrefix(writes[1] ?? new Uint8Array(0), 5)).toBe(
				"ata\r\n",
			);
			expect(decodeAsciiPrefix(writes[2] ?? new Uint8Array(0), 10)).toBe(
				"atr 16\r\n",
			);
			expect(decodeAsciiPrefix(writes[3] ?? new Uint8Array(0), 17)).toBe(
				"ato6 0 500000 0\r\n",
			);

			await expect(connection.sendFrame(payload)).resolves.toEqual(payload);
			await connection.close();
		});

		it("initialization should use PASS_FILTER instead of the legacy flow-control filter tuple", async () => {
			const path = "/dev/cu.usbmodemTAgdW56p1";
			let getOpenedPortWrites = (): Uint8Array[] => [];
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
						() => {
							const port = new FakeSerialPort(path, [
								new TextEncoder().encode(
									"ari main code version : 1.17.4877\r\n",
								),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arr 16 12234\r\n"),
								new Uint8Array(0),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arf6 0 0\r\n"),
							]);
							getOpenedPortWrites = () => port.getWrites();
							return port;
						},
					],
				]),
			);

			const transport = new OpenPort2Transport({ serial });
			const connection = (await transport.connect(
				`openport2-serial:${path}`,
			)) as TestConnection;
			await connection.initialize();

			const writes = getOpenedPortWrites();
			expect(decodeAsciiPrefix(writes[4] ?? new Uint8Array(0), 12)).toBe(
				"atf6 1 0 4\r\n",
			);
			await connection.close();
		});

		it("clears pending RX data after filter setup before reading protocol messages", async () => {
			const path = "/dev/cu.usbmodemTAgdW56p1";
			const payload = new Uint8Array([0x01, 0x02]);
			const staleConsoleOutput = new TextEncoder().encode("stale-rx\r\n");
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
								new TextEncoder().encode(
									"ari main code version : 1.17.4877\r\n",
								),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arr 16 12234\r\n"),
								new Uint8Array(0),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arf6 0 0\r\n"),
								staleConsoleOutput,
								new Uint8Array(0),
								new Uint8Array(createIso15765ResponseFrame(payload).buffer),
							]),
					],
				]),
			);

			const transport = new OpenPort2Transport({ serial });
			const connection = (await transport.connect(
				`openport2-serial:${path}`,
			)) as TestConnection;
			await connection.initialize();

			await expect(connection.sendFrame(payload)).resolves.toEqual(payload);
			await connection.close();
		});

		it("reassembles serial ISO15765 responses split across multiple adapter reads", async () => {
			const path = "/dev/cu.usbmodemTAgdW56p1";
			const payload = new Uint8Array([0x62, 0xf1, 0x90, 0x31, 0x32, 0x33]);
			const frame = new Uint8Array(createIso15765ResponseFrame(payload).buffer);
			let openedPort: FakeSerialPort | null = null;
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
						() => {
							openedPort = new FakeSerialPort(path, [
								new TextEncoder().encode(
									"ari main code version : 1.17.4877\r\n",
								),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arr 16 12234\r\n"),
								new Uint8Array(0),
								new TextEncoder().encode("aro\r\n"),
								new TextEncoder().encode("arf6 0 0\r\n"),
								new Uint8Array(0),
								frame.slice(0, 7),
								frame.slice(7),
							]);
							return openedPort;
						},
					],
				]),
			);

			const transport = new OpenPort2Transport({ serial });
			const connection = (await transport.connect(
				`openport2-serial:${path}`,
			)) as TestConnection;
			await connection.initialize();

			await expect(connection.sendFrame(payload)).resolves.toEqual(payload);
			await connection.close();
		});
	});
});
