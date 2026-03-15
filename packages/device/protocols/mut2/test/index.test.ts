import type { DeviceConnection } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import { MUT2_MODULES, Mut2Protocol } from "../src/index.js";

function createMockConnection(
	transportName: string,
	responseMap: Map<string, Uint8Array>,
): DeviceConnection {
	return {
		deviceInfo: {
			id: "test-device",
			name: "Test Device",
			transportName,
			connected: true,
		},
		sendFrame: vi.fn(async (data: Uint8Array) => {
			const key = Array.from(data).join(",");
			const response = responseMap.get(key);
			if (response == null) {
				throw new Error(`No mock response for ${key}`);
			}
			return response;
		}),
		startStream: vi.fn(),
		stopStream: vi.fn(),
		close: vi.fn(async () => {}),
	};
}

describe("Mut2Protocol", () => {
	it("has the expected human-readable name", () => {
		expect(new Mut2Protocol().name).toBe("MUT-II (Mitsubishi)");
	});

	it("exports concrete MUT-II module profiles", () => {
		expect(MUT2_MODULES.map((profile) => profile.id)).toEqual(
			expect.arrayContaining([
				"efi-obdi",
				"efi-ceddymod",
				"abs-1g-dsm",
				"tcu-1g-dsm",
				"ayc-evo4-6",
				"acd-evo7-9",
			]),
		);
	});

	it("returns false for non-kline transports", async () => {
		const protocol = new Mut2Protocol();
		const connection = createMockConnection("openport2", new Map());
		await expect(protocol.canHandle(connection)).resolves.toBe(false);
	});

	it("detects the EFI OBDI profile from its probe requests", async () => {
		const protocol = new Mut2Protocol();
		const responses = new Map<string, Uint8Array>([
			["20", new Uint8Array([190])],
			["23", new Uint8Array([64])],
		]);
		const connection = createMockConnection("kline", responses);

		await expect(protocol.canHandle(connection)).resolves.toBe(true);
		const pids = await protocol.getSupportedPids(connection);
		expect(pids.map((pid) => pid.name)).toContain("Battery Level");
		expect(pids.map((pid) => pid.name)).toContain("Engine RPM");
	});

	it("prefers CeddyMod over generic EFI when Ceddy probes succeed", async () => {
		const protocol = new Mut2Protocol();
		const responses = new Map<string, Uint8Array>([
			["148", new Uint8Array([10])],
			["149", new Uint8Array([100])],
		]);
		const connection = createMockConnection("kline", responses);

		await expect(protocol.canHandle(connection)).resolves.toBe(true);
		const pids = await protocol.getSupportedPids(connection);
		expect(pids.map((pid) => pid.name)).toContain("2Byte RPM");
	});

	it("returns false when no known MUT-II module responds", async () => {
		const protocol = new Mut2Protocol();
		const connection = createMockConnection("kline", new Map());
		await expect(protocol.canHandle(connection)).resolves.toBe(false);
	});

	it("streams decoded values for single-byte and paired-byte metrics", async () => {
		const protocol = new Mut2Protocol();
		const responses = new Map<string, Uint8Array>([
			["148", new Uint8Array([10])],
			["149", new Uint8Array([100])],
			["23", new Uint8Array([64])],
			["2", new Uint8Array([32])],
			["3", new Uint8Array([0])],
		]);
		const connection = createMockConnection("kline", responses);
		const pids = await protocol.getSupportedPids(connection);
		const rpmPid = pids.find((pid) => pid.name === "2Byte RPM");
		const vePid = pids.find((pid) => pid.name === "Throttle Position");
		expect(rpmPid).toBeDefined();
		expect(vePid).toBeDefined();

		const onFrame = vi.fn();
		const session = protocol.streamLiveData(
			connection,
			[rpmPid?.pid ?? -1, vePid?.pid ?? -1],
			onFrame,
		);
		await new Promise((resolve) => setTimeout(resolve, 140));
		session.stop();

		expect(onFrame).toHaveBeenCalled();
		const emittedNames = new Set<number>(
			onFrame.mock.calls.map((call) => call[0]?.pid),
		);
		expect(emittedNames.has(rpmPid?.pid ?? -1)).toBe(true);
		expect(emittedNames.has(vePid?.pid ?? -1)).toBe(true);
	});

	it("sends FC when clearing DTCs on a supported module", async () => {
		const protocol = new Mut2Protocol();
		const responses = new Map<string, Uint8Array>([
			["166", new Uint8Array([140])],
			["167", new Uint8Array([128])],
			["252", new Uint8Array([0])],
		]);
		const connection = createMockConnection("kline", responses);

		await expect(protocol.clearDtcs(connection)).resolves.toBeUndefined();
		expect(connection.sendFrame).toHaveBeenCalledWith(new Uint8Array([0xfc]));
	});

	it("throws when readDtcs is requested", async () => {
		const protocol = new Mut2Protocol();
		const connection = createMockConnection("kline", new Map());
		await expect(protocol.readDtcs(connection)).rejects.toThrow(
			"not implemented",
		);
	});
});
