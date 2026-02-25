import type { DeviceConnection } from "@ecu-explorer/device";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Obd2Protocol, STANDARD_PIDS } from "../src/index.js";

function createMockConnection(
	responseMap: Map<string, Uint8Array>,
): DeviceConnection {
	return {
		deviceInfo: {
			id: "test-device",
			name: "Test Device",
			transportName: "test",
			connected: true,
		},
		sendFrame: vi.fn(async (data: Uint8Array) => {
			const key = Array.from(data).join(",");
			return responseMap.get(key) ?? new Uint8Array([0x7f, data[0] ?? 0, 0x11]);
		}),
		startStream: vi.fn(),
		stopStream: vi.fn(),
		close: vi.fn(async () => {}),
	};
}

describe("Obd2Protocol", () => {
	let protocol: Obd2Protocol;

	beforeEach(() => {
		protocol = new Obd2Protocol();
	});

	describe("name", () => {
		it("should have the correct name", () => {
			expect(protocol.name).toBe("OBD-II (Generic)");
		});
	});

	describe("canHandle", () => {
		it("should return true when ECU responds to Mode 01 PID 00", async () => {
			const responseMap = new Map<string, Uint8Array>();
			// Mode 01 PID 00 request: [0x01, 0x00]
			responseMap.set(
				"1,0",
				new Uint8Array([0x41, 0x00, 0xbe, 0x3e, 0xb8, 0x11]),
			);
			const connection = createMockConnection(responseMap);

			const result = await protocol.canHandle(connection);
			expect(result).toBe(true);
		});

		it("should return false when ECU does not respond correctly", async () => {
			const responseMap = new Map<string, Uint8Array>();
			// Return a negative response
			responseMap.set("1,0", new Uint8Array([0x7f, 0x01, 0x11]));
			const connection = createMockConnection(responseMap);

			const result = await protocol.canHandle(connection);
			expect(result).toBe(false);
		});

		it("should return false when connection throws", async () => {
			const connection: DeviceConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(async () => {
					throw new Error("Connection failed");
				}),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};

			const result = await protocol.canHandle(connection);
			expect(result).toBe(false);
		});
	});

	describe("getSupportedPids", () => {
		it("should return the standard PIDs", async () => {
			const connection = createMockConnection(new Map());
			const pids = await protocol.getSupportedPids(connection);

			expect(pids).toEqual(STANDARD_PIDS);
			expect(pids.length).toBeGreaterThan(0);
		});

		it("should include RPM PID", async () => {
			const connection = createMockConnection(new Map());
			const pids = await protocol.getSupportedPids(connection);

			const rpmPid = pids.find((p) => p.pid === 0x0c);
			expect(rpmPid).toBeDefined();
			expect(rpmPid?.name).toBe("Engine RPM");
			expect(rpmPid?.unit).toBe("rpm");
		});

		it("should include Speed PID", async () => {
			const connection = createMockConnection(new Map());
			const pids = await protocol.getSupportedPids(connection);

			const speedPid = pids.find((p) => p.pid === 0x0d);
			expect(speedPid).toBeDefined();
			expect(speedPid?.name).toBe("Vehicle Speed");
			expect(speedPid?.unit).toBe("km/h");
		});
	});

	describe("streamLiveData", () => {
		it("should return a session with a stop method", () => {
			const connection = createMockConnection(new Map());
			const onFrame = vi.fn();

			const session = protocol.streamLiveData(connection, [0x0c], onFrame);

			expect(session).toBeDefined();
			expect(typeof session.stop).toBe("function");
		});

		it("should call onFrame with decoded RPM data", async () => {
			const responseMap = new Map<string, Uint8Array>();
			// RPM request: [0x01, 0x0c], response: [0x41, 0x0c, A, B] where RPM = (A*256+B)/4
			// For RPM = 1000: A*256+B = 4000, A=15, B=160
			responseMap.set("1,12", new Uint8Array([0x41, 0x0c, 15, 160]));
			const connection = createMockConnection(responseMap);
			const onFrame = vi.fn();

			const session = protocol.streamLiveData(connection, [0x0c], onFrame);

			// Wait for at least one frame
			await new Promise((resolve) => setTimeout(resolve, 100));
			session.stop();

			expect(onFrame).toHaveBeenCalled();
			const frame = onFrame.mock.calls[0]?.[0];
			expect(frame?.pid).toBe(0x0c);
			expect(frame?.value).toBe(1000); // (15*256+160)/4 = 4000/4 = 1000
			expect(frame?.unit).toBe("rpm");
		});

		it("should call onFrame with decoded speed data", async () => {
			const responseMap = new Map<string, Uint8Array>();
			// Speed request: [0x01, 0x0d], response: [0x41, 0x0d, 80] where speed = A
			responseMap.set("1,13", new Uint8Array([0x41, 0x0d, 80]));
			const connection = createMockConnection(responseMap);
			const onFrame = vi.fn();

			const session = protocol.streamLiveData(connection, [0x0d], onFrame);

			await new Promise((resolve) => setTimeout(resolve, 100));
			session.stop();

			expect(onFrame).toHaveBeenCalled();
			const frame = onFrame.mock.calls[0]?.[0];
			expect(frame?.pid).toBe(0x0d);
			expect(frame?.value).toBe(80);
			expect(frame?.unit).toBe("km/h");
		});

		it("should stop streaming when stop() is called", async () => {
			const responseMap = new Map<string, Uint8Array>();
			responseMap.set("1,12", new Uint8Array([0x41, 0x0c, 0, 0]));
			const connection = createMockConnection(responseMap);
			const onFrame = vi.fn();

			const session = protocol.streamLiveData(connection, [0x0c], onFrame);
			session.stop();

			// Wait a bit to ensure no more frames are received
			const callCountAfterStop = onFrame.mock.calls.length;
			await new Promise((resolve) => setTimeout(resolve, 100));
			const callCountAfterWait = onFrame.mock.calls.length;

			// Should not have received significantly more frames after stop
			expect(callCountAfterWait - callCountAfterStop).toBeLessThanOrEqual(1);
		});
	});

	describe("PID decoding", () => {
		it("should decode engine load correctly", async () => {
			const responseMap = new Map<string, Uint8Array>();
			// Load: A*100/255, for A=128: 128*100/255 ≈ 50.2
			responseMap.set("1,4", new Uint8Array([0x41, 0x04, 128]));
			const connection = createMockConnection(responseMap);
			const onFrame = vi.fn();

			const session = protocol.streamLiveData(connection, [0x04], onFrame);
			await new Promise((resolve) => setTimeout(resolve, 100));
			session.stop();

			const frame = onFrame.mock.calls[0]?.[0];
			expect(frame?.pid).toBe(0x04);
			expect(frame?.value).toBeCloseTo(50.2, 0);
		});

		it("should decode coolant temperature correctly", async () => {
			const responseMap = new Map<string, Uint8Array>();
			// Temp: A-40, for A=100: 100-40 = 60°C
			responseMap.set("1,5", new Uint8Array([0x41, 0x05, 100]));
			const connection = createMockConnection(responseMap);
			const onFrame = vi.fn();

			const session = protocol.streamLiveData(connection, [0x05], onFrame);
			await new Promise((resolve) => setTimeout(resolve, 100));
			session.stop();

			const frame = onFrame.mock.calls[0]?.[0];
			expect(frame?.pid).toBe(0x05);
			expect(frame?.value).toBe(60);
		});

		it("should decode MAF correctly", async () => {
			const responseMap = new Map<string, Uint8Array>();
			// MAF: (A*256+B)/100, for A=1, B=244: (256+244)/100 = 5.0 g/s
			responseMap.set("1,16", new Uint8Array([0x41, 0x10, 1, 244]));
			const connection = createMockConnection(responseMap);
			const onFrame = vi.fn();

			const session = protocol.streamLiveData(connection, [0x10], onFrame);
			await new Promise((resolve) => setTimeout(resolve, 100));
			session.stop();

			const frame = onFrame.mock.calls[0]?.[0];
			expect(frame?.pid).toBe(0x10);
			expect(frame?.value).toBe(5.0);
		});
	});
});
