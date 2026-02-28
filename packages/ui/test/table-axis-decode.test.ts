import type { AxisDefinition } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import { loadAxisValues } from "../src/lib/views/table";

describe("table axis decode behavior", () => {
	it("decodes BE-like 16-bit byte pattern as interleaved values when axis dtype is u8", () => {
		// Pattern represents big-endian 16-bit values: 0x001A, 0x0033, 0x004D, 0x0066.
		const axisBytes = Uint8Array.from([
			0x00, 0x1a, 0x00, 0x33, 0x00, 0x4d, 0x00, 0x66,
		]);

		const axis: AxisDefinition = {
			kind: "dynamic",
			name: "Axis",
			address: 0,
			length: axisBytes.length,
			dtype: "u8",
			endianness: "be",
			scale: 1,
			offset: 0,
		};

		const values = loadAxisValues(axis, axisBytes);

		expect(values).toEqual([0, 26, 0, 51, 0, 77, 0, 102]);
	});

	it("decodes BE u16 axis bytes into contiguous values", () => {
		// Same raw bytes as above, but interpreted as big-endian u16 elements.
		// 0x001A, 0x0033, 0x004D, 0x0066 => 26, 51, 77, 102
		const axisBytes = Uint8Array.from([
			0x00, 0x1a, 0x00, 0x33, 0x00, 0x4d, 0x00, 0x66,
		]);

		const axis: AxisDefinition = {
			kind: "dynamic",
			name: "Axis",
			address: 0,
			length: axisBytes.length / 2,
			dtype: "u16",
			endianness: "be",
			scale: 1,
			offset: 0,
		};

		const values = loadAxisValues(axis, axisBytes);

		expect(values).toEqual([26, 51, 77, 102]);
	});
});
