import { describe, expect, it, vi } from "vitest";
import {
	AemSerialWidebandAdapter,
	AemSerialWidebandSession,
	formatWidebandReading,
	getWidebandSerialPath,
	isAfrReading,
	isLambdaReading,
	parseAemWidebandLine,
	type WidebandReading,
	type WidebandSerialPortSession,
} from "../src/index.js";

describe("@ecu-explorer/wideband", () => {
	it("identifies lambda readings", () => {
		const reading: WidebandReading = {
			kind: "lambda",
			value: 0.98,
			timestamp: 1,
		};

		expect(isLambdaReading(reading)).toBe(true);
		expect(isAfrReading(reading)).toBe(false);
		expect(formatWidebandReading(reading)).toBe("0.98 lambda");
	});

	it("identifies afr readings", () => {
		const reading: WidebandReading = {
			kind: "afr",
			value: 14.7,
			timestamp: 1,
		};

		expect(isAfrReading(reading)).toBe(true);
		expect(isLambdaReading(reading)).toBe(false);
		expect(formatWidebandReading(reading)).toBe("14.70 AFR");
	});

	it("parses AEM serial lines in afr mode", () => {
		expect(parseAemWidebandLine("14.7\r\n", "afr", 123)).toEqual({
			kind: "afr",
			value: 14.7,
			timestamp: 123,
		});
	});

	it("parses AEM serial lines in lambda mode", () => {
		expect(parseAemWidebandLine("0.99\r\n", "lambda", 456)).toEqual({
			kind: "lambda",
			value: 0.99,
			timestamp: 456,
		});
	});

	it("ignores invalid AEM serial lines", () => {
		expect(parseAemWidebandLine("", "afr", 1)).toBeUndefined();
		expect(parseAemWidebandLine("AEM", "afr", 1)).toBeUndefined();
	});

	it("derives the serial path from serial-backed candidates", () => {
		expect(
			getWidebandSerialPath({
				id: "wideband-serial:/dev/cu.usbserial-1",
				name: "AEM Wideband",
				transportName: "serial",
				locality: "extension-host",
			}),
		).toBe("/dev/cu.usbserial-1");
	});

	it("opens AEM serial sessions at 9600 8N1", async () => {
		const port: WidebandSerialPortSession = {
			path: "/dev/cu.usbserial-1",
			isOpen: false,
			open: async () => {},
			close: async () => {},
			write: async () => {},
			read: async () => new Uint8Array(0),
		};
		const runtime = {
			listPorts: vi.fn().mockResolvedValue([]),
			openPort: vi.fn().mockResolvedValue(port),
		};
		const adapter = new AemSerialWidebandAdapter(runtime, "afr");

		await adapter.open({
			id: "wideband-serial:/dev/cu.usbserial-1",
			name: "AEM Wideband",
			transportName: "serial",
			locality: "extension-host",
		});

		expect(runtime.openPort).toHaveBeenCalledWith("/dev/cu.usbserial-1", {
			baudRate: 9600,
			dataBits: 8,
			stopBits: 1,
			parity: "none",
		});
	});

	it("streams parsed readings from an AEM serial session", async () => {
		const reads = [
			new TextEncoder().encode("14."),
			new TextEncoder().encode("7\r\n15.2\r\n"),
		];
		let open = false;
		const port: WidebandSerialPortSession = {
			path: "/dev/cu.usbserial-1",
			get isOpen() {
				return open;
			},
			open: async () => {
				open = true;
			},
			close: async () => {
				open = false;
			},
			write: async () => {},
			read: async () => {
				const next = reads.shift();
				if (next == null) {
					throw new Error("timeout");
				}
				return next;
			},
		};
		const session = new AemSerialWidebandSession(
			"wideband-serial:/dev/cu.usbserial-1",
			"AEM Wideband",
			"afr",
			port,
			() => 1000,
		);
		const readings: WidebandReading[] = [];

		await session.startStream((reading) => {
			readings.push(reading);
			if (readings.length >= 2) {
				void session.stopStream();
			}
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		await session.stopStream();

		expect(readings).toEqual([
			{ kind: "afr", value: 14.7, timestamp: 1000 },
			{ kind: "afr", value: 15.2, timestamp: 1000 },
		]);
	});
});
