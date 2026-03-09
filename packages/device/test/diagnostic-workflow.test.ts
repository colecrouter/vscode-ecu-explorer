import { describe, expect, it, vi } from "vitest";
import {
	DiagnosticStage,
	DiagnosticStatus,
	runDiagnostic,
} from "../src/diagnostic-workflow.js";
import type { DeviceInfo } from "../src/index.js";

describe("Diagnostic Workflow", () => {
	const mockDevice: DeviceInfo = {
		id: "test-device",
		name: "Test Device",
		transportName: "test-transport",
		connected: false,
	};

	const createMockTransport = (devices: DeviceInfo[] = [mockDevice]) => {
		const connection = {
			deviceInfo: mockDevice,
			close: vi.fn().mockResolvedValue(undefined),
			sendFrame: vi.fn().mockResolvedValue(new Uint8Array()),
			startStream: vi.fn(),
			stopStream: vi.fn(),
			// biome-ignore lint/suspicious/noExplicitAny: Mocking complex connection interface
		} as any;

		return {
			name: "test-transport",
			listDevices: vi.fn().mockResolvedValue(devices),
			connect: vi.fn().mockResolvedValue(connection),
			// biome-ignore lint/suspicious/noExplicitAny: Mocking complex transport interface
		} as any;
	};

	const createMockProtocol = (name: string, canHandle: boolean) => {
		return {
			name,
			canHandle: vi.fn().mockResolvedValue(canHandle),
			// biome-ignore lint/suspicious/noExplicitAny: Mocking complex protocol interface
		} as any;
	};

	const createMockProtocolWithStream = (name: string, canHandle: boolean) => {
		return {
			name,
			canHandle: vi.fn().mockResolvedValue(canHandle),
			streamLiveData: vi.fn(),
			dryRunWrite: vi.fn(),
			// biome-ignore lint/suspicious/noExplicitAny: Mocking complex protocol interface
		} as any;
	};

	it("successfully runs connect-only diagnostics", async () => {
		const transport = createMockTransport();
		const result = await runDiagnostic(transport, { protocols: [] });

		expect(result.device).toEqual(mockDevice);
		expect(result.connection).toBeDefined();
		expect(result.error).toBeUndefined();

		// Verify events
		const enumerateSuccess = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.ENUMERATE &&
				e.status === DiagnosticStatus.SUCCESS,
		);
		const connectSuccess = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.CONNECT &&
				e.status === DiagnosticStatus.SUCCESS,
		);

		expect(enumerateSuccess).toBeDefined();
		expect(connectSuccess).toBeDefined();
	});

	it("protocol probing finds the first matching protocol", async () => {
		const transport = createMockTransport();
		const p1 = createMockProtocol("P1", false);
		const p2 = createMockProtocol("P2", true);
		const p3 = createMockProtocol("P3", true);

		const result = await runDiagnostic(transport, {
			protocols: [p1, p2, p3],
		});

		expect(result.protocol?.name).toBe("P2");
		expect(p1.canHandle).toHaveBeenCalled();
		expect(p2.canHandle).toHaveBeenCalled();
		expect(p3.canHandle).not.toHaveBeenCalled();

		const probeSuccess = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.PROBE &&
				e.status === DiagnosticStatus.SUCCESS &&
				e.summary.includes("P2"),
		);
		expect(probeSuccess).toBeDefined();
	});

	it("probe failure across all protocols is summarized cleanly", async () => {
		const transport = createMockTransport();
		const p1 = createMockProtocol("P1", false);
		const p2 = createMockProtocol("P2", false);

		const result = await runDiagnostic(transport, {
			protocols: [p1, p2],
		});

		expect(result.protocol).toBeNull();
		const probeFailure = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.PROBE &&
				e.status === DiagnosticStatus.FAILURE &&
				e.summary.includes("No matching protocol found"),
		);
		expect(probeFailure).toBeDefined();
	});

	it("operation failures report the correct failing stage", async () => {
		const transport = createMockTransport();
		const error = new Error("Connection failed");
		vi.mocked(transport.connect).mockRejectedValue(error);

		const result = await runDiagnostic(transport, { protocols: [] });

		expect(result.connection).toBeNull();
		expect(result.error).toBe(error);

		const connectFailure = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.CONNECT &&
				e.status === DiagnosticStatus.FAILURE,
		);
		expect(connectFailure).toBeDefined();
		expect(connectFailure?.summary).toContain("Connection failed");
	});

	it("handles empty device list", async () => {
		const transport = createMockTransport([]);
		const result = await runDiagnostic(transport, { protocols: [] });

		expect(result.device).toBeNull();
		expect(result.error?.message).toBe("No devices available");

		const enumFailure = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.ENUMERATE &&
				e.status === DiagnosticStatus.FAILURE,
		);
		expect(enumFailure).toBeDefined();
	});

	it("runs log operation when requested and protocol matches", async () => {
		const transport = createMockTransport();
		const protocol = createMockProtocolWithStream("P1", true);
		const stopMock = vi.fn();
		protocol.streamLiveData = vi.fn().mockReturnValue({ stop: stopMock });

		const result = await runDiagnostic(transport, {
			protocols: [protocol],
			operation: "log",
			logDuration: 10,
		});

		expect(protocol.streamLiveData).toHaveBeenCalled();
		expect(stopMock).toHaveBeenCalled();

		const opSuccess = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.OPERATION &&
				e.status === DiagnosticStatus.SUCCESS &&
				e.summary.includes("Log probe completed"),
		);
		expect(opSuccess).toBeDefined();
	});

	it("runs read-rom dry run when requested", async () => {
		const transport = createMockTransport();
		const protocol = createMockProtocolWithStream("P1", true);
		protocol.dryRunWrite = vi.fn().mockResolvedValue(undefined);

		const result = await runDiagnostic(transport, {
			protocols: [protocol],
			operation: "read-rom",
			readRomDryRun: true,
		});

		expect(protocol.dryRunWrite).toHaveBeenCalled();
		expect(result.operationResult?.type).toBe("read-rom");
		expect(result.operationResult?.data.type).toBe("read-rom");
		expect(result.operationResult?.data.dryRun).toBe(true);

		const opSuccess = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.OPERATION &&
				e.status === DiagnosticStatus.SUCCESS &&
				e.summary.includes("ROM dry-run"),
		);
		expect(opSuccess).toBeDefined();
	});

	it("reads ROM when dry-run is disabled", async () => {
		const transport = createMockTransport();
		const protocol = createMockProtocolWithStream("P1", true);
		protocol.readRom = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await runDiagnostic(transport, {
			protocols: [protocol],
			operation: "read-rom",
			readRomDryRun: false,
		});

		expect(protocol.readRom).toHaveBeenCalled();
		expect(result.operationResult?.type).toBe("read-rom");
		expect(result.operationResult?.rom).toEqual(new Uint8Array([1, 2, 3]));

		const opSuccess = result.events.find(
			(e) =>
				e.stage === DiagnosticStage.OPERATION &&
				e.status === DiagnosticStatus.SUCCESS &&
				e.summary.includes("ROM read completed"),
		);
		expect(opSuccess).toBeDefined();
	});
});
