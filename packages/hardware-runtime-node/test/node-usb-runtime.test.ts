import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeUsbRuntime } from "../src/index.js";

const mockGetDeviceList = vi.fn();

vi.mock("usb", () => ({
	getDeviceList: mockGetDeviceList,
}));

function createMockNodeUsbDevice() {
	const writes: Buffer[] = [];
	const usbInterface = {
		endpoints: [
			{
				direction: "in" as const,
				address: 0x81,
				transferType: 2,
				transfer(
					length: number,
					callback: (error: Error | null, result: unknown) => void,
				) {
					callback(null, Buffer.from([0x12, 0x34].slice(0, length)));
				},
			},
			{
				direction: "out" as const,
				address: 0x02,
				transferType: 2,
				transfer(
					data: Buffer | number,
					callback: (error: Error | null, result: unknown) => void,
				) {
					writes.push(Buffer.isBuffer(data) ? data : Buffer.alloc(data));
					callback(null, Buffer.isBuffer(data) ? data.byteLength : data);
				},
			},
		],
		descriptor: {
			bInterfaceNumber: 0,
			bInterfaceClass: 255,
			bInterfaceSubClass: 0,
			bInterfaceProtocol: 0,
		},
		isKernelDriverActive: vi.fn(() => false),
		isClaimed: false,
		claim: vi.fn(() => {
			usbInterface.isClaimed = true;
		}),
		release: vi.fn((callback?: (error: Error | null) => void) => {
			usbInterface.isClaimed = false;
			callback?.(null);
		}),
	};

	const nodeDevice = {
		deviceDescriptor: {
			idVendor: 0x0403,
			idProduct: 0xcc4d,
			bDeviceClass: 0,
			bDeviceSubClass: 0,
			bDeviceProtocol: 0,
		},
		interfaces: [usbInterface],
		busNumber: 1,
		deviceAddress: 7,
		serialNumber: "OP2-123",
		productName: "Tactrix OpenPort 2.0",
		manufacturerName: "Tactrix",
		open: vi.fn(),
		close: vi.fn(),
		interface: vi.fn(() => usbInterface),
	};

	return { nodeDevice, usbInterface, writes };
}

describe("createNodeUsbRuntime", () => {
	beforeEach(() => {
		mockGetDeviceList.mockReset();
	});

	it("wraps node-usb devices with a WebUSB-compatible surface", async () => {
		const { nodeDevice, usbInterface, writes } = createMockNodeUsbDevice();
		mockGetDeviceList.mockReturnValue([nodeDevice]);

		const runtime = await createNodeUsbRuntime();
		const devices = await runtime.getDevices();
		const device = devices[0];

		expect(device).toBeDefined();
		expect(device?.vendorId).toBe(0x0403);
		expect(device?.productId).toBe(0xcc4d);
		expect(device?.serialNumber).toBe("OP2-123");
		expect(device?.productName).toBe("Tactrix OpenPort 2.0");

		await device?.open();
		expect(nodeDevice.open).toHaveBeenCalledOnce();
		expect(device?.opened).toBe(true);

		await device?.claimInterface(0);
		expect(usbInterface.claim).toHaveBeenCalledOnce();

		const input = await device?.transferIn(0x81, 2);
		expect(input?.status).toBe("ok");
		const inputBytes =
			input?.data == null
				? []
				: Array.from(
						new Uint8Array(
							input.data.buffer,
							input.data.byteOffset,
							input.data.byteLength,
						),
					);
		expect(inputBytes).toEqual([0x12, 0x34]);

		const output = await device?.transferOut(
			0x02,
			Uint8Array.from([0xaa, 0xbb]),
		);
		expect(output?.status).toBe("ok");
		expect(output?.bytesWritten).toBe(2);
		expect(writes).toHaveLength(1);
		expect(Array.from(writes[0] ?? Buffer.alloc(0))).toEqual([0xaa, 0xbb]);

		await device?.releaseInterface(0);
		expect(usbInterface.release).toHaveBeenCalledOnce();

		await device?.close();
		expect(nodeDevice.close).toHaveBeenCalledOnce();
		expect(device?.opened).toBe(false);
	});

	it("throws from requestDevice when no USB devices are available", async () => {
		mockGetDeviceList.mockReturnValue([]);

		const runtime = await createNodeUsbRuntime();

		await expect(runtime.requestDevice({ filters: [] })).rejects.toThrow(
			"No USB devices found",
		);
	});
});
