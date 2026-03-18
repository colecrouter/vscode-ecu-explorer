import type {
	WidebandAdapter,
	WidebandReading,
	WidebandSession,
} from "@ecu-explorer/wideband";
import { describe, expect, it, vi } from "vitest";
import {
	createHardwareCandidate,
	type HardwareCandidate,
} from "../src/hardware-selection.js";
import {
	toWidebandHardwareCandidate,
	WidebandManager,
} from "../src/wideband-manager.js";

function createCandidate(
	overrides: Partial<HardwareCandidate["device"]> & {
		id: string;
		name: string;
	},
	locality: HardwareCandidate["locality"] = "extension-host",
): HardwareCandidate {
	return createHardwareCandidate(
		{
			id: overrides.id,
			name: overrides.name,
			transportName: overrides.transportName ?? "openport2",
			connected: overrides.connected ?? false,
		},
		locality,
	);
}

function createSession(name = "Test Wideband"): WidebandSession {
	return {
		id: "session-1",
		name,
		startStream: vi
			.fn<(onReading: (reading: WidebandReading) => void) => Promise<void>>()
			.mockResolvedValue(undefined),
		stopStream: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
		close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
	};
}

describe("WidebandManager", () => {
	it("converts shared hardware candidates into wideband hardware candidates", () => {
		const candidate = createCandidate(
			{ id: "openport2:web", name: "OpenPort 2.0 WebUSB" },
			"client-browser",
		);

		expect(toWidebandHardwareCandidate(candidate)).toEqual({
			id: "openport2:web",
			name: "OpenPort 2.0 WebUSB",
			transportName: "openport2",
			locality: "client-browser",
		});
	});

	it("lists only candidates supported by registered adapters", async () => {
		const supportedCandidate = createCandidate({
			id: "wideband-1",
			name: "Wideband Serial",
			transportName: "serial",
		});
		const unsupportedCandidate = createCandidate({
			id: "ecu-1",
			name: "OpenPort 2.0",
		});
		const adapter: WidebandAdapter = {
			id: "test-wideband",
			name: "Test Wideband",
			canOpen: vi
				.fn<WidebandAdapter["canOpen"]>()
				.mockImplementation(async (candidate) => candidate.id === "wideband-1"),
			open: vi.fn<WidebandAdapter["open"]>(),
		};
		const manager = new WidebandManager(async () => [
			supportedCandidate,
			unsupportedCandidate,
		]);
		manager.registerAdapter(adapter);

		const candidates = await manager.listCandidates();

		expect(candidates).toEqual([supportedCandidate]);
	});

	it("opens and tracks the active wideband session", async () => {
		const candidate = createCandidate({
			id: "wideband-1",
			name: "Wideband Serial",
			transportName: "serial",
		});
		const session = createSession();
		const adapter: WidebandAdapter = {
			id: "test-wideband",
			name: "Test Wideband",
			canOpen: vi.fn<WidebandAdapter["canOpen"]>().mockResolvedValue(true),
			open: vi.fn<WidebandAdapter["open"]>().mockResolvedValue(session),
		};
		const manager = new WidebandManager(async () => [candidate]);
		manager.registerAdapter(adapter);

		const activeSession = await manager.openCandidate(candidate);

		expect(adapter.open).toHaveBeenCalledWith({
			id: "wideband-1",
			name: "Wideband Serial",
			transportName: "serial",
			locality: "extension-host",
		});
		expect(activeSession.session).toBe(session);
		expect(manager.activeSession).toBe(activeSession);
		expect(session.startStream).toHaveBeenCalledTimes(1);
	});

	it("closes the previous session when replacing the active wideband", async () => {
		const firstCandidate = createCandidate({
			id: "wideband-1",
			name: "Wideband One",
			transportName: "serial",
		});
		const secondCandidate = createCandidate({
			id: "wideband-2",
			name: "Wideband Two",
			transportName: "serial",
		});
		const firstSession = createSession("Wideband One");
		const secondSession = createSession("Wideband Two");
		const adapter: WidebandAdapter = {
			id: "test-wideband",
			name: "Test Wideband",
			canOpen: vi.fn<WidebandAdapter["canOpen"]>().mockResolvedValue(true),
			open: vi
				.fn<WidebandAdapter["open"]>()
				.mockResolvedValueOnce(firstSession)
				.mockResolvedValueOnce(secondSession),
		};
		const manager = new WidebandManager(async () => [
			firstCandidate,
			secondCandidate,
		]);
		manager.registerAdapter(adapter);

		await manager.openCandidate(firstCandidate);
		await manager.openCandidate(secondCandidate);

		expect(firstSession.close).toHaveBeenCalledTimes(1);
		expect(manager.activeSession?.session).toBe(secondSession);
	});

	it("emits readings from the active wideband session", async () => {
		const candidate = createCandidate({
			id: "wideband-1",
			name: "Wideband Serial",
			transportName: "serial",
		});
		const session = createSession();
		vi.mocked(session.startStream).mockImplementation(async (onReading) => {
			onReading({
				kind: "afr",
				value: 14.7,
				timestamp: 1234,
			});
		});
		const adapter: WidebandAdapter = {
			id: "test-wideband",
			name: "Test Wideband",
			canOpen: vi.fn<WidebandAdapter["canOpen"]>().mockResolvedValue(true),
			open: vi.fn<WidebandAdapter["open"]>().mockResolvedValue(session),
		};
		const manager = new WidebandManager(async () => [candidate]);
		manager.registerAdapter(adapter);
		const readings: WidebandReading[] = [];
		manager.onDidRead((reading) => readings.push(reading));

		await manager.openCandidate(candidate);

		expect(readings).toEqual([
			{
				kind: "afr",
				value: 14.7,
				timestamp: 1234,
			},
		]);
		expect(manager.latestReading).toEqual(readings[0]);
	});
});
