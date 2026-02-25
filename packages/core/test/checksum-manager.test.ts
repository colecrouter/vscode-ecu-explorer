import { describe, expect, it } from "vitest";
import {
	readChecksum,
	recomputeChecksum,
	validateChecksum,
	writeChecksum,
} from "../src/checksum/manager";
import type { ChecksumDefinition } from "../src/definition/rom";

describe("recomputeChecksum", () => {
	it("computes CRC32 for single region", () => {
		const romBytes = new Uint8Array([
			0x01, 0x02, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
		]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 4 }],
			storage: { offset: 4, size: 4 },
		};

		const result = recomputeChecksum(romBytes, checksumDef);
		expect(result).toBe(0xb63cfbcd);
	});

	it("computes sum checksum for single region", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
		};

		const result = recomputeChecksum(romBytes, checksumDef);
		expect(result).toBe(6);
	});

	it("computes XOR checksum for single region", () => {
		const romBytes = new Uint8Array([0xff, 0xaa, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "xor",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 1 },
		};

		const result = recomputeChecksum(romBytes, checksumDef);
		expect(result).toBe(0x55);
	});

	it("computes checksum for multiple regions", () => {
		// Create ROM with two regions: [0x01, 0x02] and [0x03, 0x04]
		const romBytes = new Uint8Array([0x01, 0x02, 0xff, 0x03, 0x04, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [
				{ start: 0, end: 2 },
				{ start: 3, end: 5 },
			],
			storage: { offset: 5, size: 1 },
		};

		// Should sum: 0x01 + 0x02 + 0x03 + 0x04 = 0x0A
		const result = recomputeChecksum(romBytes, checksumDef);
		expect(result).toBe(0x0a);
	});

	it("handles custom checksum function", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "custom",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
			customFunction: (data) => data.length,
		};

		const result = recomputeChecksum(romBytes, checksumDef);
		expect(result).toBe(3);
	});

	it("throws on invalid region (start >= end)", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 2, end: 2 }],
			storage: { offset: 3, size: 1 },
		};

		expect(() => recomputeChecksum(romBytes, checksumDef)).toThrow(
			"start=2 must be less than end=2",
		);
	});

	it("throws on invalid region (out of bounds)", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 10 }],
			storage: { offset: 3, size: 1 },
		};

		expect(() => recomputeChecksum(romBytes, checksumDef)).toThrow(
			"Invalid checksum region",
		);
	});

	it("throws on custom algorithm without function", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "custom",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
		};

		expect(() => recomputeChecksum(romBytes, checksumDef)).toThrow(
			'Custom checksum algorithm requires "customFunction"',
		);
	});
});

describe("writeChecksum", () => {
	it("writes 1-byte checksum", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
		};

		writeChecksum(romBytes, 0x42, checksumDef);
		expect(romBytes[3]).toBe(0x42);
	});

	it("writes 2-byte checksum (little-endian)", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 2, endianness: "le" },
		};

		writeChecksum(romBytes, 0x1234, checksumDef);
		expect(romBytes[2]).toBe(0x34);
		expect(romBytes[3]).toBe(0x12);
	});

	it("writes 2-byte checksum (big-endian)", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 2, endianness: "be" },
		};

		writeChecksum(romBytes, 0x1234, checksumDef);
		expect(romBytes[2]).toBe(0x12);
		expect(romBytes[3]).toBe(0x34);
	});

	it("writes 4-byte checksum (little-endian)", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 4, endianness: "le" },
		};

		writeChecksum(romBytes, 0x12345678, checksumDef);
		expect(romBytes[2]).toBe(0x78);
		expect(romBytes[3]).toBe(0x56);
		expect(romBytes[4]).toBe(0x34);
		expect(romBytes[5]).toBe(0x12);
	});

	it("writes 4-byte checksum (big-endian)", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 4, endianness: "be" },
		};

		writeChecksum(romBytes, 0x12345678, checksumDef);
		expect(romBytes[2]).toBe(0x12);
		expect(romBytes[3]).toBe(0x34);
		expect(romBytes[4]).toBe(0x56);
		expect(romBytes[5]).toBe(0x78);
	});

	it("defaults to little-endian", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 2 },
		};

		writeChecksum(romBytes, 0x1234, checksumDef);
		expect(romBytes[2]).toBe(0x34);
		expect(romBytes[3]).toBe(0x12);
	});

	it("throws on invalid offset", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 10, size: 1 },
		};

		expect(() => writeChecksum(romBytes, 0x42, checksumDef)).toThrow(
			"Invalid checksum storage offset",
		);
	});

	it("handles unsigned values correctly", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 4 },
		};

		writeChecksum(romBytes, 0xffffffff, checksumDef);
		expect(romBytes[2]).toBe(0xff);
		expect(romBytes[3]).toBe(0xff);
		expect(romBytes[4]).toBe(0xff);
		expect(romBytes[5]).toBe(0xff);
	});
});

describe("readChecksum", () => {
	it("reads 1-byte checksum", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x42]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
		};

		const result = readChecksum(romBytes, checksumDef);
		expect(result).toBe(0x42);
	});

	it("reads 2-byte checksum (little-endian)", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x34, 0x12]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 2, endianness: "le" },
		};

		const result = readChecksum(romBytes, checksumDef);
		expect(result).toBe(0x1234);
	});

	it("reads 2-byte checksum (big-endian)", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x12, 0x34]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 2, endianness: "be" },
		};

		const result = readChecksum(romBytes, checksumDef);
		expect(result).toBe(0x1234);
	});

	it("reads 4-byte checksum (little-endian)", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x78, 0x56, 0x34, 0x12]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 4, endianness: "le" },
		};

		const result = readChecksum(romBytes, checksumDef);
		expect(result).toBe(0x12345678);
	});

	it("reads 4-byte checksum (big-endian)", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x12, 0x34, 0x56, 0x78]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 4, endianness: "be" },
		};

		const result = readChecksum(romBytes, checksumDef);
		expect(result).toBe(0x12345678);
	});

	it("defaults to little-endian", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x34, 0x12]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 2 },
		};

		const result = readChecksum(romBytes, checksumDef);
		expect(result).toBe(0x1234);
	});

	it("throws on invalid offset", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 10, size: 1 },
		};

		expect(() => readChecksum(romBytes, checksumDef)).toThrow(
			"Invalid checksum storage offset",
		);
	});

	it("returns unsigned value", () => {
		const romBytes = new Uint8Array([0x00, 0x00, 0xff, 0xff, 0xff, 0xff]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 4 },
		};

		const result = readChecksum(romBytes, checksumDef);
		expect(result).toBe(0xffffffff);
		expect(result).toBeGreaterThanOrEqual(0);
	});
});

describe("validateChecksum", () => {
	it("validates correct checksum", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x06]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
		};

		const result = validateChecksum(romBytes, checksumDef);
		expect(result.valid).toBe(true);
		expect(result.expected).toBe(6);
		expect(result.actual).toBe(6);
		expect(result.algorithm).toBe("sum");
	});

	it("detects incorrect checksum", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x99]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
		};

		const result = validateChecksum(romBytes, checksumDef);
		expect(result.valid).toBe(false);
		expect(result.expected).toBe(6);
		expect(result.actual).toBe(0x99);
		expect(result.algorithm).toBe("sum");
	});

	it("validates CRC32 checksum", () => {
		const romBytes = new Uint8Array([
			0x01, 0x02, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
		]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 4 }],
			storage: { offset: 4, size: 4, endianness: "le" },
		};

		// Write correct checksum
		const expectedChecksum = 0xb63cfbcd;
		romBytes[4] = expectedChecksum & 0xff;
		romBytes[5] = (expectedChecksum >>> 8) & 0xff;
		romBytes[6] = (expectedChecksum >>> 16) & 0xff;
		romBytes[7] = (expectedChecksum >>> 24) & 0xff;

		const result = validateChecksum(romBytes, checksumDef);
		expect(result.valid).toBe(true);
		expect(result.expected).toBe(expectedChecksum);
		expect(result.actual).toBe(expectedChecksum);
	});

	it("validates XOR checksum", () => {
		const romBytes = new Uint8Array([0xff, 0xaa, 0x55]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "xor",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 1 },
		};

		const result = validateChecksum(romBytes, checksumDef);
		expect(result.valid).toBe(true);
		expect(result.expected).toBe(0x55);
		expect(result.actual).toBe(0x55);
	});

	it("validates multi-region checksum", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0xff, 0x03, 0x04, 0x0a]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [
				{ start: 0, end: 2 },
				{ start: 3, end: 5 },
			],
			storage: { offset: 5, size: 1 },
		};

		const result = validateChecksum(romBytes, checksumDef);
		expect(result.valid).toBe(true);
		expect(result.expected).toBe(0x0a);
		expect(result.actual).toBe(0x0a);
	});
});

describe("Integration Tests", () => {
	it("full workflow: compute, write, read, validate", () => {
		const romBytes = new Uint8Array([
			0x01, 0x02, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
		]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 4 }],
			storage: { offset: 4, size: 4, endianness: "le" },
		};

		// Compute checksum
		const checksum = recomputeChecksum(romBytes, checksumDef);
		expect(checksum).toBe(0xb63cfbcd);

		// Write checksum
		writeChecksum(romBytes, checksum, checksumDef);

		// Read checksum
		const readValue = readChecksum(romBytes, checksumDef);
		expect(readValue).toBe(checksum);

		// Validate checksum
		const validation = validateChecksum(romBytes, checksumDef);
		expect(validation.valid).toBe(true);
	});

	it("detects corruption after modification", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x06]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "sum",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
		};

		// Initially valid
		let validation = validateChecksum(romBytes, checksumDef);
		expect(validation.valid).toBe(true);

		// Modify data
		romBytes[0] = 0xff;

		// Now invalid
		validation = validateChecksum(romBytes, checksumDef);
		expect(validation.valid).toBe(false);
	});

	it("handles big-endian storage", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x00, 0x00, 0x00, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "crc32",
			regions: [{ start: 0, end: 2 }],
			storage: { offset: 2, size: 4, endianness: "be" },
		};

		const checksum = recomputeChecksum(romBytes, checksumDef);
		writeChecksum(romBytes, checksum, checksumDef);
		const validation = validateChecksum(romBytes, checksumDef);
		expect(validation.valid).toBe(true);
	});

	it("handles custom checksum function", () => {
		const romBytes = new Uint8Array([0x01, 0x02, 0x03, 0x00]);
		const checksumDef: ChecksumDefinition = {
			algorithm: "custom",
			regions: [{ start: 0, end: 3 }],
			storage: { offset: 3, size: 1 },
			customFunction: (data) => {
				// Custom: sum of all bytes modulo 256
				let sum = 0;
				for (let i = 0; i < data.length; i++) {
					sum += data[i] ?? NaN;
				}
				return sum & 0xff;
			},
		};

		const checksum = recomputeChecksum(romBytes, checksumDef);
		writeChecksum(romBytes, checksum, checksumDef);
		const validation = validateChecksum(romBytes, checksumDef);
		expect(validation.valid).toBe(true);
	});
});
