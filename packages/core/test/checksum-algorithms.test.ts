import { describe, expect, it } from "vitest";
import {
	computeNissanAlt2Checksum,
	computeNissanStdChecksum,
	computeSubaruDensoChecksum,
	crc32,
	mitsucanChecksum,
	ncsChecksum,
	ncsCrc16,
	readSubaruDensoChecksumTable,
	SUBARU_DENSO_CHECK_TOTAL,
	ssmChecksum,
	sumChecksum,
	updateNissanAlt2Checksum,
	updateNissanStdChecksum,
	updateSubaruDensoChecksums,
	validateMitsucanChecksum,
	validateNissanAlt2Checksum,
	validateNissanStdChecksum,
	validateSubaruDensoChecksum,
	validateSubaruDensoChecksums,
	xorChecksum,
} from "../src/checksum/algorithms";

describe("CRC32", () => {
	it("computes CRC32 for known test vector", () => {
		// Standard test vector: "123456789" should produce 0xCBF43926
		const data = new TextEncoder().encode("123456789");
		const result = crc32(data);
		expect(result).toBe(0xcbf43926);
	});

	it("computes CRC32 for empty data", () => {
		const data = new Uint8Array([]);
		const result = crc32(data);
		expect(result).toBe(0x00000000);
	});

	it("computes CRC32 for single byte", () => {
		const data = new Uint8Array([0x00]);
		const result = crc32(data);
		expect(result).toBe(0xd202ef8d);
	});

	it("computes CRC32 for all zeros", () => {
		const data = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const result = crc32(data);
		expect(result).toBe(0x2144df1c);
	});

	it("computes CRC32 for all ones", () => {
		const data = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
		const result = crc32(data);
		expect(result).toBe(0xffffffff);
	});

	it("computes CRC32 for sequential bytes", () => {
		const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
		const result = crc32(data);
		expect(result).toBe(0xb63cfbcd);
	});
});

describe("Sum Checksum", () => {
	it("computes sum for simple data", () => {
		const data = new Uint8Array([0x01, 0x02, 0x03]);
		const result = sumChecksum(data);
		expect(result).toBe(6);
	});

	it("computes sum for empty data", () => {
		const data = new Uint8Array([]);
		const result = sumChecksum(data);
		expect(result).toBe(0);
	});

	it("wraps at 8-bit boundary", () => {
		// 0xFF + 0x02 = 0x101, should wrap to 0x01
		const data = new Uint8Array([0xff, 0x02]);
		const result = sumChecksum(data);
		expect(result).toBe(0x01);
	});

	it("wraps multiple times", () => {
		// 0xFF + 0xFF + 0xFF = 0x2FD, should wrap to 0xFD
		const data = new Uint8Array([0xff, 0xff, 0xff]);
		const result = sumChecksum(data);
		expect(result).toBe(0xfd);
	});

	it("handles all zeros", () => {
		const data = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const result = sumChecksum(data);
		expect(result).toBe(0);
	});

	it("handles all ones", () => {
		const data = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
		const result = sumChecksum(data);
		expect(result).toBe(0xfc);
	});

	it("handles maximum single byte", () => {
		const data = new Uint8Array([0xff]);
		const result = sumChecksum(data);
		expect(result).toBe(0xff);
	});
});

describe("XOR Checksum", () => {
	it("computes XOR for simple data", () => {
		// 0x01 ^ 0x02 ^ 0x03 = 0x00
		const data = new Uint8Array([0x01, 0x02, 0x03]);
		const result = xorChecksum(data);
		expect(result).toBe(0x00);
	});

	it("computes XOR for empty data", () => {
		const data = new Uint8Array([]);
		const result = xorChecksum(data);
		expect(result).toBe(0);
	});

	it("computes XOR for single byte", () => {
		const data = new Uint8Array([0x42]);
		const result = xorChecksum(data);
		expect(result).toBe(0x42);
	});

	it("handles all zeros", () => {
		const data = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
		const result = xorChecksum(data);
		expect(result).toBe(0);
	});

	it("handles all ones", () => {
		// 0xFF ^ 0xFF ^ 0xFF ^ 0xFF = 0x00
		const data = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
		const result = xorChecksum(data);
		expect(result).toBe(0x00);
	});

	it("handles odd number of 0xFF", () => {
		// 0xFF ^ 0xFF ^ 0xFF = 0xFF
		const data = new Uint8Array([0xff, 0xff, 0xff]);
		const result = xorChecksum(data);
		expect(result).toBe(0xff);
	});

	it("XOR is commutative", () => {
		const data1 = new Uint8Array([0x01, 0x02, 0x03]);
		const data2 = new Uint8Array([0x03, 0x02, 0x01]);
		expect(xorChecksum(data1)).toBe(xorChecksum(data2));
	});

	it("XOR with self is zero", () => {
		const data = new Uint8Array([0x42, 0x42]);
		const result = xorChecksum(data);
		expect(result).toBe(0x00);
	});

	it("computes known XOR value", () => {
		// 0xFF ^ 0xAA = 0x55
		const data = new Uint8Array([0xff, 0xaa]);
		const result = xorChecksum(data);
		expect(result).toBe(0x55);
	});
});

describe("mitsucanChecksum", () => {
	const FIXUP_OFFSET = 0x0bfff0;
	const ROM_SIZE = 0x100000; // 1MB

	it("all-zero ROM returns correct fixup (0x5AA55AA5)", () => {
		// All-zero ROM: sum of all 32-bit BE words (fixup zeroed) = 0
		// fixup = (0x5AA55AA5 - 0) >>> 0 = 0x5AA55AA5
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);
		const fixup = mitsucanChecksum(rom);
		expect(fixup).toBe(0x5aa55aa5);
	});

	it("all-0xFF ROM returns correct fixup (0x5AA95AA4)", () => {
		// 1MB ROM of all 0xFF: the fixup location (0x0BFFF0) is skipped (treated as 0),
		// so we sum 262143 words of 0xFFFFFFFF.
		// Sum = 262143 × 0xFFFFFFFF mod 2^32 = (2^32 - 262143) = 0xFFFC0001
		// fixup = (0x5AA55AA5 - 0xFFFC0001) >>> 0 = 0x5AA95AA4
		const rom = new Uint8Array(ROM_SIZE).fill(0xff);
		const fixup = mitsucanChecksum(rom);
		expect(fixup).toBe(0x5aa95aa4);
	});

	it("stock ROM 56890009: word32_sum_BE (fixup zeroed) = 0x5AA55AA6, fixup = 0xFFFFFFFF", () => {
		// Confirmed against real ROM 56890009 (stock):
		// word32_sum_BE (fixup zeroed) = 0x5AA55AA6
		// fixup = (0x5AA55AA5 - 0x5AA55AA6) >>> 0 = 0xFFFFFFFF
		// Simulate: create a 1MB ROM where the 32-bit BE word sum (fixup zeroed) = 0x5AA55AA6
		// We do this by setting the first word to 0x5AA55AA6 (all other words are 0)
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);
		// Write 0x5AA55AA6 as big-endian at offset 0
		rom[0] = 0x5a;
		rom[1] = 0xa5;
		rom[2] = 0x5a;
		rom[3] = 0xa6;
		const fixup = mitsucanChecksum(rom);
		expect(fixup).toBe(0xffffffff);
	});

	it("throws on ROM smaller than FIXUP_OFFSET + 4 bytes", () => {
		const tooSmall = new Uint8Array(FIXUP_OFFSET + 3); // 3 bytes short
		expect(() => mitsucanChecksum(tooSmall)).toThrow(
			/ROM too small for mitsucan checksum/,
		);
	});

	it("throws on empty ROM", () => {
		const empty = new Uint8Array(0);
		expect(() => mitsucanChecksum(empty)).toThrow(
			/ROM too small for mitsucan checksum/,
		);
	});

	it("throws on non-32-bit-aligned ROM size", () => {
		// ROM_SIZE + 1 is not divisible by 4
		const nonAligned = new Uint8Array(ROM_SIZE + 1);
		expect(() => mitsucanChecksum(nonAligned)).toThrow(
			/ROM size must be 32-bit aligned/,
		);
	});
});

describe("validateMitsucanChecksum", () => {
	const FIXUP_OFFSET = 0x0bfff0;
	const ROM_SIZE = 0x100000; // 1MB

	it("returns true for valid ROM (all-zero with correct fixup written BE)", () => {
		// All-zero ROM: fixup = 0x5AA55AA5, written big-endian at 0x0BFFF0
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);
		const fixup = 0x5aa55aa5;
		rom[FIXUP_OFFSET] = (fixup >>> 24) & 0xff;
		rom[FIXUP_OFFSET + 1] = (fixup >>> 16) & 0xff;
		rom[FIXUP_OFFSET + 2] = (fixup >>> 8) & 0xff;
		rom[FIXUP_OFFSET + 3] = fixup & 0xff;
		expect(validateMitsucanChecksum(rom)).toBe(true);
	});

	it("returns false for ROM with incorrect fixup value", () => {
		// All-zero ROM with wrong fixup (0x00000000 instead of 0x5AA55AA5)
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);
		// fixup bytes remain 0x00000000 (wrong)
		expect(validateMitsucanChecksum(rom)).toBe(false);
	});

	it("returns false for ROM smaller than minimum size", () => {
		const tooSmall = new Uint8Array(FIXUP_OFFSET + 3); // not enough for 4-byte fixup
		expect(validateMitsucanChecksum(tooSmall)).toBe(false);
	});

	it("returns false for empty ROM", () => {
		const empty = new Uint8Array(0);
		expect(validateMitsucanChecksum(empty)).toBe(false);
	});

	it("returns false for non-32-bit-aligned ROM size", () => {
		const nonAligned = new Uint8Array(ROM_SIZE + 1);
		expect(validateMitsucanChecksum(nonAligned)).toBe(false);
	});

	it("round-trip: compute fixup then validate", () => {
		// Create a ROM with arbitrary data, compute fixup, write it BE, then validate
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);
		// Set some non-zero words
		rom[0x1000] = 0xab;
		rom[0x5000] = 0xcd;
		rom[0xa0000] = 0xef;
		// Compute fixup
		const fixup = mitsucanChecksum(rom);
		// Write fixup big-endian at 0x0BFFF0
		rom[FIXUP_OFFSET] = (fixup >>> 24) & 0xff;
		rom[FIXUP_OFFSET + 1] = (fixup >>> 16) & 0xff;
		rom[FIXUP_OFFSET + 2] = (fixup >>> 8) & 0xff;
		rom[FIXUP_OFFSET + 3] = fixup & 0xff;
		// Validate
		expect(validateMitsucanChecksum(rom)).toBe(true);
	});

	it("returns false for ROM with off-by-one fixup", () => {
		// All-zero ROM: correct fixup = 0x5AA55AA5
		// Write 0x5AA55AA4 (off by one) — should fail
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);
		const wrongFixup = 0x5aa55aa4;
		rom[FIXUP_OFFSET] = (wrongFixup >>> 24) & 0xff;
		rom[FIXUP_OFFSET + 1] = (wrongFixup >>> 16) & 0xff;
		rom[FIXUP_OFFSET + 2] = (wrongFixup >>> 8) & 0xff;
		rom[FIXUP_OFFSET + 3] = wrongFixup & 0xff;
		expect(validateMitsucanChecksum(rom)).toBe(false);
	});

	it("stock ROM 56890009 simulation: fixup=0xFFFFFFFF validates correctly", () => {
		// Simulate stock ROM 56890009: word32_sum_BE (fixup zeroed) = 0x5AA55AA6
		// fixup = 0xFFFFFFFF, total sum = 0x5AA55AA6 + 0xFFFFFFFF = 0x5AA55AA5 ✓
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);
		// Set first word to 0x5AA55AA6 (big-endian)
		rom[0] = 0x5a;
		rom[1] = 0xa5;
		rom[2] = 0x5a;
		rom[3] = 0xa6;
		// Write fixup 0xFFFFFFFF big-endian at 0x0BFFF0
		rom[FIXUP_OFFSET] = 0xff;
		rom[FIXUP_OFFSET + 1] = 0xff;
		rom[FIXUP_OFFSET + 2] = 0xff;
		rom[FIXUP_OFFSET + 3] = 0xff;
		expect(validateMitsucanChecksum(rom)).toBe(true);
	});

	it("round-trip with non-trivial data: compute then validate", () => {
		const rom = new Uint8Array(ROM_SIZE);
		// Fill with a pattern
		for (let i = 0; i < ROM_SIZE; i++) {
			rom[i] = (i * 7 + 13) & 0xff;
		}
		// Zero out fixup location before computing
		rom[FIXUP_OFFSET] = 0;
		rom[FIXUP_OFFSET + 1] = 0;
		rom[FIXUP_OFFSET + 2] = 0;
		rom[FIXUP_OFFSET + 3] = 0;
		const fixup = mitsucanChecksum(rom);
		// Write fixup big-endian
		rom[FIXUP_OFFSET] = (fixup >>> 24) & 0xff;
		rom[FIXUP_OFFSET + 1] = (fixup >>> 16) & 0xff;
		rom[FIXUP_OFFSET + 2] = (fixup >>> 8) & 0xff;
		rom[FIXUP_OFFSET + 3] = fixup & 0xff;
		expect(validateMitsucanChecksum(rom)).toBe(true);
	});
});

// ============================================================================
// Subaru/Denso ROM Checksum Tests
// Ported from: https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java
// ============================================================================

describe("SUBARU_DENSO_CHECK_TOTAL", () => {
	it("has the correct value 0x5AA5A55A", () => {
		// Ported from RomRaider Settings.java: CHECK_TOTAL = 0x5AA5A55A
		// Note: distinct from Mitsubishi target 0x5AA55AA5 (middle bytes swapped)
		expect(SUBARU_DENSO_CHECK_TOTAL).toBe(0x5aa5a55a);
	});
});

describe("computeSubaruDensoChecksum", () => {
	it("all-zero region returns CHECK_TOTAL", () => {
		// Region of all zeros: byteSum = 0, checksum = CHECK_TOTAL - 0 = CHECK_TOTAL
		const rom = new Uint8Array(0x100).fill(0x00);
		const checksum = computeSubaruDensoChecksum(rom, 0x00, 0x100);
		expect(checksum).toBe(SUBARU_DENSO_CHECK_TOTAL);
	});

	it("single word region: checksum = CHECK_TOTAL - word", () => {
		// Region [0x00, 0x04) containing word 0x12345678
		// byteSum = 0x12345678
		// checksum = (0x5AA5A55A - 0x12345678) >>> 0 = 0x48714EE2
		const rom = new Uint8Array(0x10).fill(0x00);
		rom[0] = 0x12;
		rom[1] = 0x34;
		rom[2] = 0x56;
		rom[3] = 0x78;
		const checksum = computeSubaruDensoChecksum(rom, 0x00, 0x04);
		expect(checksum).toBe((0x5aa5a55a - 0x12345678) >>> 0);
	});

	it("two-word region: checksum = CHECK_TOTAL - sum of both words", () => {
		// Region [0x00, 0x08) containing words 0x00000001 and 0x00000002
		// byteSum = 3
		// checksum = (0x5AA5A55A - 3) >>> 0 = 0x5AA5A557
		const rom = new Uint8Array(0x10).fill(0x00);
		rom[3] = 0x01; // word at 0x00 = 0x00000001
		rom[7] = 0x02; // word at 0x04 = 0x00000002
		const checksum = computeSubaruDensoChecksum(rom, 0x00, 0x08);
		expect(checksum).toBe(0x5aa5a557);
	});

	it("round-trip: computed checksum validates correctly", () => {
		// Compute checksum for a region, then validate it
		const rom = new Uint8Array(0x100).fill(0x00);
		// Write some data
		rom[0x00] = 0xde;
		rom[0x01] = 0xad;
		rom[0x02] = 0xbe;
		rom[0x03] = 0xef;
		rom[0x10] = 0xca;
		rom[0x11] = 0xfe;
		rom[0x12] = 0xba;
		rom[0x13] = 0xbe;
		const checksum = computeSubaruDensoChecksum(rom, 0x00, 0x100);
		expect(validateSubaruDensoChecksum(rom, 0x00, 0x100, checksum)).toBe(true);
	});

	it("throws on empty region (start >= end)", () => {
		const rom = new Uint8Array(0x100);
		expect(() => computeSubaruDensoChecksum(rom, 0x10, 0x10)).toThrow(
			/out of bounds or empty/,
		);
	});

	it("handles 32-bit overflow in sum correctly", () => {
		// Fill region with 0xFFFFFFFF words to force overflow
		// 4 words of 0xFFFFFFFF: sum = 4 * 0xFFFFFFFF mod 2^32 = 0xFFFFFFFC
		// checksum = (0x5AA5A55A - 0xFFFFFFFC) >>> 0 = 0x5AA5A55E
		const rom = new Uint8Array(0x10).fill(0xff);
		const checksum = computeSubaruDensoChecksum(rom, 0x00, 0x10);
		// 4 * 0xFFFFFFFF mod 2^32 = 0xFFFFFFFC
		// (0x5AA5A55A - 0xFFFFFFFC) >>> 0 = 0x5AA5A55E
		expect(checksum).toBe((0x5aa5a55a - 0xfffffffc) >>> 0);
	});
});

describe("validateSubaruDensoChecksum", () => {
	it("returns true for correct checksum", () => {
		// All-zero region: correct checksum = CHECK_TOTAL
		const rom = new Uint8Array(0x100).fill(0x00);
		expect(
			validateSubaruDensoChecksum(rom, 0x00, 0x100, SUBARU_DENSO_CHECK_TOTAL),
		).toBe(true);
	});

	it("returns false for incorrect checksum", () => {
		const rom = new Uint8Array(0x100).fill(0x00);
		// Wrong checksum (off by one)
		expect(
			validateSubaruDensoChecksum(
				rom,
				0x00,
				0x100,
				SUBARU_DENSO_CHECK_TOTAL - 1,
			),
		).toBe(false);
	});

	it("returns false for zero checksum on non-zero region", () => {
		const rom = new Uint8Array(0x100).fill(0x00);
		rom[0] = 0x01; // non-zero data
		expect(validateSubaruDensoChecksum(rom, 0x00, 0x100, 0)).toBe(false);
	});

	it("returns false for non-aligned addresses", () => {
		const rom = new Uint8Array(0x100);
		expect(validateSubaruDensoChecksum(rom, 0x01, 0x100, 0)).toBe(false);
	});

	it("returns false for out-of-bounds region", () => {
		const rom = new Uint8Array(0x100);
		expect(validateSubaruDensoChecksum(rom, 0x00, 0x200, 0)).toBe(false);
	});

	it("round-trip: compute then validate", () => {
		const rom = new Uint8Array(0x200).fill(0x00);
		// Write a pattern
		for (let i = 0; i < 0x200; i += 4) {
			rom[i] = (i >> 8) & 0xff;
			rom[i + 1] = i & 0xff;
			rom[i + 2] = 0xab;
			rom[i + 3] = 0xcd;
		}
		const checksum = computeSubaruDensoChecksum(rom, 0x00, 0x200);
		expect(validateSubaruDensoChecksum(rom, 0x00, 0x200, checksum)).toBe(true);
	});
});

describe("readSubaruDensoChecksumTable", () => {
	it("reads a single-entry table correctly", () => {
		// Build a 12-byte table entry: start=0x00001000, end=0x00008000, checksum=0xDEADBEEF
		const rom = new Uint8Array(0x100).fill(0x00);
		const TABLE_OFFSET = 0x10;
		// startAddr = 0x00001000 (big-endian)
		rom[TABLE_OFFSET + 0] = 0x00;
		rom[TABLE_OFFSET + 1] = 0x00;
		rom[TABLE_OFFSET + 2] = 0x10;
		rom[TABLE_OFFSET + 3] = 0x00;
		// endAddr = 0x00008000 (big-endian)
		rom[TABLE_OFFSET + 4] = 0x00;
		rom[TABLE_OFFSET + 5] = 0x00;
		rom[TABLE_OFFSET + 6] = 0x80;
		rom[TABLE_OFFSET + 7] = 0x00;
		// checksum = 0xDEADBEEF (big-endian)
		rom[TABLE_OFFSET + 8] = 0xde;
		rom[TABLE_OFFSET + 9] = 0xad;
		rom[TABLE_OFFSET + 10] = 0xbe;
		rom[TABLE_OFFSET + 11] = 0xef;

		const entries = readSubaruDensoChecksumTable(rom, TABLE_OFFSET, 12);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.startAddr).toBe(0x00001000);
		expect(entries[0]?.endAddr).toBe(0x00008000);
		expect(entries[0]?.checksum).toBe(0xdeadbeef);
	});

	it("reads a two-entry table correctly", () => {
		const rom = new Uint8Array(0x100).fill(0x00);
		const TABLE_OFFSET = 0x00;
		// Entry 0: start=0x1000, end=0x2000, checksum=0x11111111
		rom[0] = 0x00;
		rom[1] = 0x00;
		rom[2] = 0x10;
		rom[3] = 0x00;
		rom[4] = 0x00;
		rom[5] = 0x00;
		rom[6] = 0x20;
		rom[7] = 0x00;
		rom[8] = 0x11;
		rom[9] = 0x11;
		rom[10] = 0x11;
		rom[11] = 0x11;
		// Entry 1: start=0x2000, end=0x4000, checksum=0x22222222
		rom[12] = 0x00;
		rom[13] = 0x00;
		rom[14] = 0x20;
		rom[15] = 0x00;
		rom[16] = 0x00;
		rom[17] = 0x00;
		rom[18] = 0x40;
		rom[19] = 0x00;
		rom[20] = 0x22;
		rom[21] = 0x22;
		rom[22] = 0x22;
		rom[23] = 0x22;

		const entries = readSubaruDensoChecksumTable(rom, TABLE_OFFSET, 24);
		expect(entries).toHaveLength(2);
		expect(entries[0]?.startAddr).toBe(0x1000);
		expect(entries[0]?.endAddr).toBe(0x2000);
		expect(entries[0]?.checksum).toBe(0x11111111);
		expect(entries[1]?.startAddr).toBe(0x2000);
		expect(entries[1]?.endAddr).toBe(0x4000);
		expect(entries[1]?.checksum).toBe(0x22222222);
	});

	it("throws on non-multiple-of-12 table size", () => {
		const rom = new Uint8Array(0x100);
		expect(() => readSubaruDensoChecksumTable(rom, 0, 13)).toThrow(
			/multiple of 12/,
		);
	});

	it("throws on out-of-bounds table", () => {
		const rom = new Uint8Array(0x10);
		expect(() => readSubaruDensoChecksumTable(rom, 0x08, 12)).toThrow(
			/out of bounds/,
		);
	});
});

describe("updateSubaruDensoChecksums", () => {
	it("updates a single-entry table in-place", () => {
		// ROM with a 12-byte checksum table at offset 0x80
		// Region: [0x00, 0x80) — all zeros
		// Expected checksum: CHECK_TOTAL (since byteSum = 0)
		const TABLE_OFFSET = 0x80;
		const ROM_SIZE = 0x100;
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);

		// Write table entry: start=0x00, end=0x80, checksum=0x00000000 (wrong)
		rom[TABLE_OFFSET + 0] = 0x00;
		rom[TABLE_OFFSET + 1] = 0x00;
		rom[TABLE_OFFSET + 2] = 0x00;
		rom[TABLE_OFFSET + 3] = 0x00; // startAddr = 0x00000000
		rom[TABLE_OFFSET + 4] = 0x00;
		rom[TABLE_OFFSET + 5] = 0x00;
		rom[TABLE_OFFSET + 6] = 0x00;
		rom[TABLE_OFFSET + 7] = 0x80; // endAddr = 0x00000080
		// checksum bytes remain 0x00000000 (wrong)

		updateSubaruDensoChecksums(rom, TABLE_OFFSET, 12);

		// Read back the updated checksum
		const updatedChecksum =
			(((rom[TABLE_OFFSET + 8] ?? 0) << 24) |
				((rom[TABLE_OFFSET + 9] ?? 0) << 16) |
				((rom[TABLE_OFFSET + 10] ?? 0) << 8) |
				(rom[TABLE_OFFSET + 11] ?? 0)) >>>
			0;

		// Region [0x00, 0x80) is all zeros, so byteSum = 0
		// checksum = CHECK_TOTAL - 0 = CHECK_TOTAL
		expect(updatedChecksum).toBe(SUBARU_DENSO_CHECK_TOTAL);
	});

	it("skips disabled sentinel entries (startAddr=0, endAddr=0)", () => {
		// A disabled entry has startAddr=0, endAddr=0, checksum=CHECK_TOTAL
		const TABLE_OFFSET = 0x00;
		const rom = new Uint8Array(0x100).fill(0x00);

		// Write sentinel: start=0, end=0, checksum=CHECK_TOTAL
		rom[8] = (SUBARU_DENSO_CHECK_TOTAL >>> 24) & 0xff;
		rom[9] = (SUBARU_DENSO_CHECK_TOTAL >>> 16) & 0xff;
		rom[10] = (SUBARU_DENSO_CHECK_TOTAL >>> 8) & 0xff;
		rom[11] = SUBARU_DENSO_CHECK_TOTAL & 0xff;

		// Update should not modify the sentinel
		updateSubaruDensoChecksums(rom, TABLE_OFFSET, 12);

		// Checksum bytes should remain CHECK_TOTAL
		const checksum =
			(((rom[8] ?? 0) << 24) |
				((rom[9] ?? 0) << 16) |
				((rom[10] ?? 0) << 8) |
				(rom[11] ?? 0)) >>>
			0;
		expect(checksum).toBe(SUBARU_DENSO_CHECK_TOTAL);
	});

	it("round-trip: update then validate returns 0 (all valid)", () => {
		// Build a ROM with a 2-entry checksum table
		// Region 1: [0x00, 0x40) — some data
		// Region 2: [0x40, 0x80) — some data
		// Table at 0x80
		const TABLE_OFFSET = 0x80;
		const ROM_SIZE = 0x100;
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);

		// Write some data in the regions
		rom[0x00] = 0xaa;
		rom[0x01] = 0xbb;
		rom[0x02] = 0xcc;
		rom[0x03] = 0xdd;
		rom[0x40] = 0x11;
		rom[0x41] = 0x22;
		rom[0x42] = 0x33;
		rom[0x43] = 0x44;

		// Write table entries (checksums initially wrong = 0)
		// Entry 0: start=0x00, end=0x40
		rom[TABLE_OFFSET + 0] = 0x00;
		rom[TABLE_OFFSET + 1] = 0x00;
		rom[TABLE_OFFSET + 2] = 0x00;
		rom[TABLE_OFFSET + 3] = 0x00;
		rom[TABLE_OFFSET + 4] = 0x00;
		rom[TABLE_OFFSET + 5] = 0x00;
		rom[TABLE_OFFSET + 6] = 0x00;
		rom[TABLE_OFFSET + 7] = 0x40;
		// Entry 1: start=0x40, end=0x80
		rom[TABLE_OFFSET + 12] = 0x00;
		rom[TABLE_OFFSET + 13] = 0x00;
		rom[TABLE_OFFSET + 14] = 0x00;
		rom[TABLE_OFFSET + 15] = 0x40;
		rom[TABLE_OFFSET + 16] = 0x00;
		rom[TABLE_OFFSET + 17] = 0x00;
		rom[TABLE_OFFSET + 18] = 0x00;
		rom[TABLE_OFFSET + 19] = 0x80;

		// Update checksums
		updateSubaruDensoChecksums(rom, TABLE_OFFSET, 24);

		// Validate — should return 0 (all valid)
		const result = validateSubaruDensoChecksums(rom, TABLE_OFFSET, 24);
		expect(result).toBe(0);
	});

	it("throws on non-multiple-of-12 table size", () => {
		const rom = new Uint8Array(0x100);
		expect(() => updateSubaruDensoChecksums(rom, 0, 13)).toThrow(
			/multiple of 12/,
		);
	});
});

describe("validateSubaruDensoChecksums", () => {
	it("returns 0 when all checksums are valid", () => {
		// Single-entry table with correct checksum
		const TABLE_OFFSET = 0x80;
		const ROM_SIZE = 0x100;
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);

		// Region [0x00, 0x80) all zeros → checksum = CHECK_TOTAL
		rom[TABLE_OFFSET + 0] = 0x00;
		rom[TABLE_OFFSET + 1] = 0x00;
		rom[TABLE_OFFSET + 2] = 0x00;
		rom[TABLE_OFFSET + 3] = 0x00; // startAddr = 0
		rom[TABLE_OFFSET + 4] = 0x00;
		rom[TABLE_OFFSET + 5] = 0x00;
		rom[TABLE_OFFSET + 6] = 0x00;
		rom[TABLE_OFFSET + 7] = 0x80; // endAddr = 0x80
		// Write correct checksum
		rom[TABLE_OFFSET + 8] = (SUBARU_DENSO_CHECK_TOTAL >>> 24) & 0xff;
		rom[TABLE_OFFSET + 9] = (SUBARU_DENSO_CHECK_TOTAL >>> 16) & 0xff;
		rom[TABLE_OFFSET + 10] = (SUBARU_DENSO_CHECK_TOTAL >>> 8) & 0xff;
		rom[TABLE_OFFSET + 11] = SUBARU_DENSO_CHECK_TOTAL & 0xff;

		expect(validateSubaruDensoChecksums(rom, TABLE_OFFSET, 12)).toBe(0);
	});

	it("returns 1 when first checksum is invalid", () => {
		const TABLE_OFFSET = 0x80;
		const ROM_SIZE = 0x100;
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);

		// Region [0x00, 0x80) all zeros → correct checksum = CHECK_TOTAL
		// But we write wrong checksum = 0x00000000
		rom[TABLE_OFFSET + 0] = 0x00;
		rom[TABLE_OFFSET + 1] = 0x00;
		rom[TABLE_OFFSET + 2] = 0x00;
		rom[TABLE_OFFSET + 3] = 0x00;
		rom[TABLE_OFFSET + 4] = 0x00;
		rom[TABLE_OFFSET + 5] = 0x00;
		rom[TABLE_OFFSET + 6] = 0x00;
		rom[TABLE_OFFSET + 7] = 0x80;
		// checksum bytes remain 0x00000000 (wrong)

		expect(validateSubaruDensoChecksums(rom, TABLE_OFFSET, 12)).toBe(1);
	});

	it("returns -1 when all checksums are disabled (sentinel entry)", () => {
		// Sentinel: startAddr=0, endAddr=0, checksum=CHECK_TOTAL
		const TABLE_OFFSET = 0x00;
		const rom = new Uint8Array(0x100).fill(0x00);

		// Write sentinel
		rom[8] = (SUBARU_DENSO_CHECK_TOTAL >>> 24) & 0xff;
		rom[9] = (SUBARU_DENSO_CHECK_TOTAL >>> 16) & 0xff;
		rom[10] = (SUBARU_DENSO_CHECK_TOTAL >>> 8) & 0xff;
		rom[11] = SUBARU_DENSO_CHECK_TOTAL & 0xff;

		expect(validateSubaruDensoChecksums(rom, TABLE_OFFSET, 12)).toBe(-1);
	});

	it("returns 2 when second of two checksums is invalid", () => {
		const TABLE_OFFSET = 0x80;
		const ROM_SIZE = 0x100;
		const rom = new Uint8Array(ROM_SIZE).fill(0x00);

		// Entry 0: region [0x00, 0x40) — correct checksum = CHECK_TOTAL (all zeros)
		rom[TABLE_OFFSET + 0] = 0x00;
		rom[TABLE_OFFSET + 1] = 0x00;
		rom[TABLE_OFFSET + 2] = 0x00;
		rom[TABLE_OFFSET + 3] = 0x00;
		rom[TABLE_OFFSET + 4] = 0x00;
		rom[TABLE_OFFSET + 5] = 0x00;
		rom[TABLE_OFFSET + 6] = 0x00;
		rom[TABLE_OFFSET + 7] = 0x40;
		rom[TABLE_OFFSET + 8] = (SUBARU_DENSO_CHECK_TOTAL >>> 24) & 0xff;
		rom[TABLE_OFFSET + 9] = (SUBARU_DENSO_CHECK_TOTAL >>> 16) & 0xff;
		rom[TABLE_OFFSET + 10] = (SUBARU_DENSO_CHECK_TOTAL >>> 8) & 0xff;
		rom[TABLE_OFFSET + 11] = SUBARU_DENSO_CHECK_TOTAL & 0xff;

		// Entry 1: region [0x40, 0x80) — wrong checksum = 0x00000000
		rom[TABLE_OFFSET + 12] = 0x00;
		rom[TABLE_OFFSET + 13] = 0x00;
		rom[TABLE_OFFSET + 14] = 0x00;
		rom[TABLE_OFFSET + 15] = 0x40;
		rom[TABLE_OFFSET + 16] = 0x00;
		rom[TABLE_OFFSET + 17] = 0x00;
		rom[TABLE_OFFSET + 18] = 0x00;
		rom[TABLE_OFFSET + 19] = 0x80;
		// checksum bytes remain 0x00000000 (wrong)

		expect(validateSubaruDensoChecksums(rom, TABLE_OFFSET, 24)).toBe(2);
	});

	it("throws on non-multiple-of-12 table size", () => {
		const rom = new Uint8Array(0x100);
		expect(() => validateSubaruDensoChecksums(rom, 0, 13)).toThrow(
			/multiple of 12/,
		);
	});

	it("throws on out-of-bounds table", () => {
		const rom = new Uint8Array(0x10);
		expect(() => validateSubaruDensoChecksums(rom, 0x08, 12)).toThrow(
			/out of bounds/,
		);
	});
});

// ============================================================================
// SSM Protocol Checksum Tests
// Ported from: https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ssm/iso9141/SSMChecksumCalculator.java
// ============================================================================

describe("ssmChecksum", () => {
	it("computes checksum for a known SSM packet", () => {
		// SSM init request: [0x80, 0x10, 0xF0, 0x01, 0xBF, 0x00]
		// Sum of bytes 0..4: 0x80 + 0x10 + 0xF0 + 0x01 + 0xBF
		//   = 128 + 16 + 240 + 1 + 191 = 576 = 0x240
		// 0x240 & 0xFF = 0x40
		const packet = new Uint8Array([0x80, 0x10, 0xf0, 0x01, 0xbf, 0x00]);
		const checksum = ssmChecksum(packet);
		expect(checksum).toBe(0x40);
	});

	it("computes checksum for a single-byte packet (only checksum byte)", () => {
		// Packet with only the checksum placeholder: sum of 0 bytes = 0
		const packet = new Uint8Array([0x00]);
		const checksum = ssmChecksum(packet);
		expect(checksum).toBe(0x00);
	});

	it("computes checksum for a two-byte packet", () => {
		// Packet [0x42, 0x00]: sum of byte 0 = 0x42
		const packet = new Uint8Array([0x42, 0x00]);
		const checksum = ssmChecksum(packet);
		expect(checksum).toBe(0x42);
	});

	it("wraps at 8-bit boundary", () => {
		// Packet [0xFF, 0xFF, 0x00]: sum = 0xFF + 0xFF = 0x1FE, & 0xFF = 0xFE
		const packet = new Uint8Array([0xff, 0xff, 0x00]);
		const checksum = ssmChecksum(packet);
		expect(checksum).toBe(0xfe);
	});

	it("handles large sum with 16-bit overflow", () => {
		// 256 bytes of 0xFF followed by checksum placeholder
		// Sum = 256 * 0xFF = 0xFF00
		// 0xFF00 & 0xFF = 0x00
		const packet = new Uint8Array(257).fill(0xff);
		packet[256] = 0x00; // checksum placeholder
		const checksum = ssmChecksum(packet);
		expect(checksum).toBe(0x00);
	});

	it("all-zero packet (except checksum byte) returns 0", () => {
		const packet = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
		const checksum = ssmChecksum(packet);
		expect(checksum).toBe(0x00);
	});
});

// ============================================================================
// Nissan Checksum Algorithm Tests
// Ported from:
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateSTD.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateALT2.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ncs/iso14230/NCSChecksumCalculator.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NcsCoDec.java
// ============================================================================

describe("Nissan Checksum Algorithms", () => {
	// -------------------------------------------------------------------------
	// computeNissanStdChecksum
	// -------------------------------------------------------------------------
	describe("computeNissanStdChecksum", () => {
		it("all-zero region returns sumt=0 and xort=0", () => {
			// Region of all zeros (excluding sumloc/xorloc which are also zero):
			// All DWORDs are 0x00000000, so sum=0 and XOR=0.
			const rom = new Uint8Array(0x20).fill(0x00);
			// start=0x00, end=0x20, sumloc=0x10, xorloc=0x14
			const result = computeNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14);
			expect(result.sumt).toBe(0);
			expect(result.xort).toBe(0);
		});

		it("single DWORD region (not sumloc/xorloc) contributes to sum and XOR", () => {
			// ROM: [0x12345678, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000]
			// start=0x00, end=0x20, sumloc=0x10, xorloc=0x14
			// Only DWORD at 0x00 (0x12345678) contributes; sumloc/xorloc are skipped.
			const rom = new Uint8Array(0x20).fill(0x00);
			rom[0] = 0x12;
			rom[1] = 0x34;
			rom[2] = 0x56;
			rom[3] = 0x78;
			const result = computeNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14);
			expect(result.sumt).toBe(0x12345678);
			expect(result.xort).toBe(0x12345678);
		});

		it("sumloc and xorloc DWORDs are skipped", () => {
			// Place non-zero values at sumloc and xorloc — they must be skipped.
			const rom = new Uint8Array(0x20).fill(0x00);
			// Write 0xDEADBEEF at sumloc=0x10
			rom[0x10] = 0xde;
			rom[0x11] = 0xad;
			rom[0x12] = 0xbe;
			rom[0x13] = 0xef;
			// Write 0xCAFEBABE at xorloc=0x14
			rom[0x14] = 0xca;
			rom[0x15] = 0xfe;
			rom[0x16] = 0xba;
			rom[0x17] = 0xbe;
			// All other DWORDs are zero, so sum=0 and XOR=0 (sumloc/xorloc skipped)
			const result = computeNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14);
			expect(result.sumt).toBe(0);
			expect(result.xort).toBe(0);
		});

		it("two DWORDs: sum and XOR computed correctly", () => {
			// DWORDs at 0x00=0x00000001 and 0x04=0x00000002; sumloc=0x08, xorloc=0x0C
			// sum = 1 + 2 = 3; XOR = 1 ^ 2 = 3
			const rom = new Uint8Array(0x10).fill(0x00);
			rom[3] = 0x01; // DWORD at 0x00 = 0x00000001
			rom[7] = 0x02; // DWORD at 0x04 = 0x00000002
			const result = computeNissanStdChecksum(rom, 0x00, 0x10, 0x08, 0x0c);
			expect(result.sumt).toBe(3);
			expect(result.xort).toBe(3);
		});

		it("XOR of identical DWORDs is zero", () => {
			// Two identical DWORDs: XOR = A ^ A = 0
			const rom = new Uint8Array(0x10).fill(0x00);
			rom[0] = 0xab;
			rom[1] = 0xcd;
			rom[2] = 0xef;
			rom[3] = 0x01;
			rom[4] = 0xab;
			rom[5] = 0xcd;
			rom[6] = 0xef;
			rom[7] = 0x01;
			// sumloc=0x08, xorloc=0x0C
			const result = computeNissanStdChecksum(rom, 0x00, 0x10, 0x08, 0x0c);
			expect(result.xort).toBe(0);
			expect(result.sumt).toBe((0xabcdef01 * 2) >>> 0);
		});

		it("32-bit sum overflow wraps correctly", () => {
			// Two DWORDs of 0xFFFFFFFF: sum = 0xFFFFFFFF + 0xFFFFFFFF mod 2^32 = 0xFFFFFFFE
			const rom = new Uint8Array(0x10).fill(0xff);
			// sumloc=0x08, xorloc=0x0C (filled with 0xFF but skipped)
			const result = computeNissanStdChecksum(rom, 0x00, 0x10, 0x08, 0x0c);
			// DWORDs at 0x00 and 0x04 are 0xFFFFFFFF each (sumloc/xorloc skipped)
			// sum = 0xFFFFFFFF + 0xFFFFFFFF = 0x1FFFFFFFE mod 2^32 = 0xFFFFFFFE
			expect(result.sumt).toBe(0xfffffffe);
			// XOR = 0xFFFFFFFF ^ 0xFFFFFFFF = 0
			expect(result.xort).toBe(0);
		});

		it("throws on empty region (start >= end)", () => {
			const rom = new Uint8Array(0x20);
			expect(() =>
				computeNissanStdChecksum(rom, 0x10, 0x10, 0x10, 0x14),
			).toThrow(/out of bounds or empty/);
		});

		it("throws when sumloc is outside region", () => {
			const rom = new Uint8Array(0x20);
			expect(() =>
				computeNissanStdChecksum(rom, 0x00, 0x10, 0x10, 0x04),
			).toThrow(/sumloc out of region/);
		});

		it("throws when xorloc is outside region", () => {
			const rom = new Uint8Array(0x20);
			expect(() =>
				computeNissanStdChecksum(rom, 0x00, 0x10, 0x04, 0x10),
			).toThrow(/xorloc out of region/);
		});
	});

	// -------------------------------------------------------------------------
	// validateNissanStdChecksum
	// -------------------------------------------------------------------------
	describe("validateNissanStdChecksum", () => {
		it("returns 2 when both checksums are valid", () => {
			// Build a ROM, compute checksums, write them, then validate
			const rom = new Uint8Array(0x20).fill(0x00);
			rom[0] = 0x12;
			rom[1] = 0x34;
			rom[2] = 0x56;
			rom[3] = 0x78;
			const result = computeNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14);
			// Write sumt big-endian at 0x10
			rom[0x10] = (result.sumt >>> 24) & 0xff;
			rom[0x11] = (result.sumt >>> 16) & 0xff;
			rom[0x12] = (result.sumt >>> 8) & 0xff;
			rom[0x13] = result.sumt & 0xff;
			// Write xort big-endian at 0x14
			rom[0x14] = (result.xort >>> 24) & 0xff;
			rom[0x15] = (result.xort >>> 16) & 0xff;
			rom[0x16] = (result.xort >>> 8) & 0xff;
			rom[0x17] = result.xort & 0xff;
			expect(validateNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14)).toBe(2);
		});

		it("returns 0 when both checksums are wrong", () => {
			const rom = new Uint8Array(0x20).fill(0x00);
			// sumloc and xorloc remain 0x00000000 (wrong for non-zero data)
			rom[0] = 0x12;
			rom[1] = 0x34;
			rom[2] = 0x56;
			rom[3] = 0x78;
			expect(validateNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14)).toBe(0);
		});

		it("returns 1 when only sum is valid", () => {
			const rom = new Uint8Array(0x20).fill(0x00);
			rom[0] = 0x00;
			rom[1] = 0x00;
			rom[2] = 0x00;
			rom[3] = 0x01; // DWORD at 0x00 = 1
			// Correct sumt = 1, correct xort = 1
			// Write correct sumt but wrong xort
			rom[0x10] = 0x00;
			rom[0x11] = 0x00;
			rom[0x12] = 0x00;
			rom[0x13] = 0x01; // sumt = 1 (correct)
			// xort remains 0x00000000 (wrong, should be 1)
			expect(validateNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14)).toBe(1);
		});

		it("round-trip: updateNissanStdChecksum then validate returns 2", () => {
			const rom = new Uint8Array(0x20).fill(0x00);
			rom[0] = 0xde;
			rom[1] = 0xad;
			rom[2] = 0xbe;
			rom[3] = 0xef;
			updateNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14);
			expect(validateNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14)).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// updateNissanStdChecksum
	// -------------------------------------------------------------------------
	describe("updateNissanStdChecksum", () => {
		it("writes sumt and xort big-endian to ROM", () => {
			const rom = new Uint8Array(0x20).fill(0x00);
			// DWORD at 0x00 = 0x12345678
			rom[0] = 0x12;
			rom[1] = 0x34;
			rom[2] = 0x56;
			rom[3] = 0x78;
			const result = updateNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14);

			// Verify returned result
			expect(result.sumt).toBe(0x12345678);
			expect(result.xort).toBe(0x12345678);

			// Verify written bytes at sumloc=0x10
			expect(rom[0x10]).toBe(0x12);
			expect(rom[0x11]).toBe(0x34);
			expect(rom[0x12]).toBe(0x56);
			expect(rom[0x13]).toBe(0x78);

			// Verify written bytes at xorloc=0x14
			expect(rom[0x14]).toBe(0x12);
			expect(rom[0x15]).toBe(0x34);
			expect(rom[0x16]).toBe(0x56);
			expect(rom[0x17]).toBe(0x78);
		});

		it("all-zero ROM: writes 0x00000000 at sumloc and xorloc", () => {
			const rom = new Uint8Array(0x20).fill(0x00);
			updateNissanStdChecksum(rom, 0x00, 0x20, 0x10, 0x14);
			// sumt and xort should both be 0
			expect(rom[0x10]).toBe(0x00);
			expect(rom[0x11]).toBe(0x00);
			expect(rom[0x12]).toBe(0x00);
			expect(rom[0x13]).toBe(0x00);
			expect(rom[0x14]).toBe(0x00);
			expect(rom[0x15]).toBe(0x00);
			expect(rom[0x16]).toBe(0x00);
			expect(rom[0x17]).toBe(0x00);
		});

		it("round-trip: update then validate returns 2", () => {
			const rom = new Uint8Array(0x40).fill(0x00);
			// Write some data
			for (let i = 0; i < 0x10; i += 4) {
				rom[i] = (i * 7) & 0xff;
				rom[i + 1] = (i * 13) & 0xff;
				rom[i + 2] = (i * 17) & 0xff;
				rom[i + 3] = (i * 23) & 0xff;
			}
			updateNissanStdChecksum(rom, 0x00, 0x40, 0x30, 0x34);
			expect(validateNissanStdChecksum(rom, 0x00, 0x40, 0x30, 0x34)).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// computeNissanAlt2Checksum
	// -------------------------------------------------------------------------
	describe("computeNissanAlt2Checksum", () => {
		// Build a minimal ROM for ALT2 testing:
		// start=0x00, end=0x40, sumloc=0x18, xorloc=0x1C, skiploc=0x20
		// Region layout:
		//   [0x00..0x04) = calSum storage (2 bytes used)
		//   [0x04..0x20) = calibration region (32-bit checksums + 16-bit calSum)
		//   [0x20..0x40) = code region (16-bit codeSum)

		it("all-zero ROM: all four checksums are 0", () => {
			const rom = new Uint8Array(0x40).fill(0x00);
			const result = computeNissanAlt2Checksum(
				rom,
				0x00,
				0x40,
				0x18,
				0x1c,
				0x20,
			);
			expect(result.sumt).toBe(0);
			expect(result.xort).toBe(0);
			expect(result.calSum).toBe(0);
			expect(result.codeSum).toBe(0);
		});

		it("32-bit iteration starts at start+4 (not start)", () => {
			// Place a non-zero DWORD at start (0x00) — it must NOT be included in sumt/xort
			const rom = new Uint8Array(0x40).fill(0x00);
			rom[0] = 0xff;
			rom[1] = 0xff;
			rom[2] = 0xff;
			rom[3] = 0xff; // DWORD at start=0x00 — should be skipped
			rom[4] = 0x00;
			rom[5] = 0x00;
			rom[6] = 0x00;
			rom[7] = 0x01; // DWORD at start+4=0x04 — should be included
			const result = computeNissanAlt2Checksum(
				rom,
				0x00,
				0x40,
				0x18,
				0x1c,
				0x20,
			);
			// sumt should include DWORD at 0x04 (=1) but not at 0x00 (=0xFFFFFFFF)
			expect(result.sumt).toBe(1);
			expect(result.xort).toBe(1);
		});

		it("skiploc DWORD is skipped in 32-bit iteration", () => {
			// Place a non-zero DWORD at skiploc — it must be skipped
			const rom = new Uint8Array(0x40).fill(0x00);
			rom[0x20] = 0xde;
			rom[0x21] = 0xad;
			rom[0x22] = 0xbe;
			rom[0x23] = 0xef; // DWORD at skiploc=0x20 — should be skipped
			const result = computeNissanAlt2Checksum(
				rom,
				0x00,
				0x40,
				0x18,
				0x1c,
				0x20,
			);
			expect(result.sumt).toBe(0);
			expect(result.xort).toBe(0);
		});

		it("16-bit calSum includes sumt and xort inline when encountered", () => {
			// Set up a ROM where sumt and xort will be non-zero, and verify
			// that calSum includes them as two 16-bit halves each.
			// Use a simple case: one DWORD at 0x04 = 0x00010002
			// sumt = 0x00010002, xort = 0x00010002
			// calSum iterates from start+2=0x02 to skiploc=0x20 in 16-bit steps:
			//   0x02: word = 0x0000 (from ROM)
			//   0x04: word = 0x0001 (high half of DWORD at 0x04)
			//   0x06: word = 0x0002 (low half of DWORD at 0x04)
			//   0x08..0x17: all zeros
			//   0x18: sumloc — include sumt (0x00010002) as two halves: 0x0001 + 0x0002
			//   0x1C: xorloc — include xort (0x00010002) as two halves: 0x0001 + 0x0002
			// calSum = 0x0001 + 0x0002 + 0x0001 + 0x0002 + 0x0001 + 0x0002 = 0x0009
			const rom = new Uint8Array(0x40).fill(0x00);
			rom[4] = 0x00;
			rom[5] = 0x01;
			rom[6] = 0x00;
			rom[7] = 0x02; // DWORD at 0x04 = 0x00010002
			const result = computeNissanAlt2Checksum(
				rom,
				0x00,
				0x40,
				0x18,
				0x1c,
				0x20,
			);
			expect(result.sumt).toBe(0x00010002);
			expect(result.xort).toBe(0x00010002);
			// calSum: 0x0001 + 0x0002 (from DWORD at 0x04) + 0x0001 + 0x0002 (sumt halves) + 0x0001 + 0x0002 (xort halves) = 9
			expect(result.calSum).toBe(9);
		});

		it("16-bit codeSum covers skiploc+2 to end", () => {
			// Place a 16-bit word at skiploc+2=0x22 and verify it's included in codeSum
			const rom = new Uint8Array(0x40).fill(0x00);
			rom[0x22] = 0x00;
			rom[0x23] = 0x42; // word at 0x22 = 0x0042
			const result = computeNissanAlt2Checksum(
				rom,
				0x00,
				0x40,
				0x18,
				0x1c,
				0x20,
			);
			expect(result.codeSum).toBe(0x42);
		});

		it("skiploc word (at skiploc itself) is NOT included in codeSum", () => {
			// codeSum starts at skiploc+2, so the word at skiploc is not included
			const rom = new Uint8Array(0x40).fill(0x00);
			rom[0x20] = 0xff;
			rom[0x21] = 0xff; // word at skiploc=0x20 — should NOT be in codeSum
			rom[0x22] = 0x00;
			rom[0x23] = 0x01; // word at skiploc+2=0x22 — should be in codeSum
			const result = computeNissanAlt2Checksum(
				rom,
				0x00,
				0x40,
				0x18,
				0x1c,
				0x20,
			);
			expect(result.codeSum).toBe(0x0001);
		});

		it("default skiploc is 0x20000", () => {
			// Build a ROM large enough for the default skiploc
			const rom = new Uint8Array(0x40000).fill(0x00);
			// Should not throw with default skiploc
			expect(() =>
				computeNissanAlt2Checksum(rom, 0x00, 0x40000, 0x1fff8, 0x1fffc),
			).not.toThrow();
		});

		it("throws when skiploc equals start", () => {
			const rom = new Uint8Array(0x40);
			expect(() =>
				computeNissanAlt2Checksum(rom, 0x00, 0x40, 0x18, 0x1c, 0x00),
			).toThrow(/skiploc must be within region/);
		});

		it("returns unsigned 16-bit values for calSum and codeSum", () => {
			// Fill with 0xFF to force overflow
			const rom = new Uint8Array(0x40).fill(0xff);
			const result = computeNissanAlt2Checksum(
				rom,
				0x00,
				0x40,
				0x18,
				0x1c,
				0x20,
			);
			expect(result.calSum).toBeGreaterThanOrEqual(0);
			expect(result.calSum).toBeLessThanOrEqual(0xffff);
			expect(result.codeSum).toBeGreaterThanOrEqual(0);
			expect(result.codeSum).toBeLessThanOrEqual(0xffff);
		});
	});

	// -------------------------------------------------------------------------
	// validateNissanAlt2Checksum
	// -------------------------------------------------------------------------
	describe("validateNissanAlt2Checksum", () => {
		it("returns 4 when all checksums are valid", () => {
			const rom = new Uint8Array(0x40).fill(0x00);
			rom[4] = 0x00;
			rom[5] = 0x00;
			rom[6] = 0x00;
			rom[7] = 0x05; // DWORD at 0x04 = 5
			updateNissanAlt2Checksum(rom, 0x00, 0x40, 0x18, 0x1c, 0x20);
			expect(
				validateNissanAlt2Checksum(rom, 0x00, 0x40, 0x18, 0x1c, 0x20),
			).toBe(4);
		});

		it("returns 0 when all checksums are wrong", () => {
			const rom = new Uint8Array(0x40).fill(0x00);
			// Write non-zero data in both calibration and code regions
			// so that none of the checksums happen to be 0 by coincidence.
			// codeSum iterates from skiploc+2=0x22 to end=0x40, so put data there.
			rom[4] = 0x00;
			rom[5] = 0x00;
			rom[6] = 0x00;
			rom[7] = 0x05; // DWORD at 0x04 = 5 (in calibration region)
			rom[0x22] = 0x00;
			rom[0x23] = 0x07; // word at 0x22 = 7 (in code region, so codeSum != 0)
			// Don't update checksums — they remain 0 (wrong for all four)
			expect(
				validateNissanAlt2Checksum(rom, 0x00, 0x40, 0x18, 0x1c, 0x20),
			).toBe(0);
		});

		it("round-trip: update then validate returns 4", () => {
			const rom = new Uint8Array(0x40).fill(0x00);
			// Write some data
			for (let i = 4; i < 0x18; i += 4) {
				rom[i] = (i * 3) & 0xff;
				rom[i + 1] = (i * 5) & 0xff;
				rom[i + 2] = (i * 7) & 0xff;
				rom[i + 3] = (i * 11) & 0xff;
			}
			updateNissanAlt2Checksum(rom, 0x00, 0x40, 0x18, 0x1c, 0x20);
			expect(
				validateNissanAlt2Checksum(rom, 0x00, 0x40, 0x18, 0x1c, 0x20),
			).toBe(4);
		});
	});

	// -------------------------------------------------------------------------
	// updateNissanAlt2Checksum
	// -------------------------------------------------------------------------
	describe("updateNissanAlt2Checksum", () => {
		it("writes all four checksums to correct locations", () => {
			const rom = new Uint8Array(0x40).fill(0x00);
			rom[4] = 0x00;
			rom[5] = 0x00;
			rom[6] = 0x00;
			rom[7] = 0x01; // DWORD at 0x04 = 1
			const result = updateNissanAlt2Checksum(
				rom,
				0x00,
				0x40,
				0x18,
				0x1c,
				0x20,
			);

			// Verify sumt written big-endian at sumloc=0x18
			const writtenSumt =
				(((rom[0x18] ?? 0) << 24) |
					((rom[0x19] ?? 0) << 16) |
					((rom[0x1a] ?? 0) << 8) |
					(rom[0x1b] ?? 0)) >>>
				0;
			expect(writtenSumt).toBe(result.sumt);

			// Verify xort written big-endian at xorloc=0x1C
			const writtenXort =
				(((rom[0x1c] ?? 0) << 24) |
					((rom[0x1d] ?? 0) << 16) |
					((rom[0x1e] ?? 0) << 8) |
					(rom[0x1f] ?? 0)) >>>
				0;
			expect(writtenXort).toBe(result.xort);

			// Verify calSum written big-endian at start=0x00
			const writtenCalSum =
				(((rom[0x00] ?? 0) << 8) | (rom[0x01] ?? 0)) & 0xffff;
			expect(writtenCalSum).toBe(result.calSum);

			// Verify codeSum written big-endian at skiploc=0x20
			const writtenCodeSum =
				(((rom[0x20] ?? 0) << 8) | (rom[0x21] ?? 0)) & 0xffff;
			expect(writtenCodeSum).toBe(result.codeSum);
		});

		it("round-trip: update then validate returns 4", () => {
			const rom = new Uint8Array(0x40).fill(0x00);
			for (let i = 4; i < 0x18; i += 4) {
				rom[i + 3] = i & 0xff;
			}
			updateNissanAlt2Checksum(rom, 0x00, 0x40, 0x18, 0x1c, 0x20);
			expect(
				validateNissanAlt2Checksum(rom, 0x00, 0x40, 0x18, 0x1c, 0x20),
			).toBe(4);
		});

		it("uses default skiploc=0x20000 when not specified", () => {
			const rom = new Uint8Array(0x40000).fill(0x00);
			expect(() =>
				updateNissanAlt2Checksum(rom, 0x00, 0x40000, 0x1fff8, 0x1fffc),
			).not.toThrow();
			expect(
				validateNissanAlt2Checksum(rom, 0x00, 0x40000, 0x1fff8, 0x1fffc),
			).toBe(4);
		});
	});

	// -------------------------------------------------------------------------
	// ncsChecksum
	// -------------------------------------------------------------------------
	describe("ncsChecksum", () => {
		it("computes checksum for a known NCS packet", () => {
			// NCS packet: [0x80, 0x10, 0xF1, 0x01, 0x3E, 0x00]
			// sum = 0x80 + 0x10 + 0xF1 + 0x01 + 0x3E
			//     = 128  + 16   + 241  + 1    + 62  = 448 = 0x1C0
			// checksum = 0x1C0 & 0xFF = 0xC0
			const packet = new Uint8Array([0x80, 0x10, 0xf1, 0x01, 0x3e, 0x00]);
			expect(ncsChecksum(packet)).toBe(0xc0);
		});

		it("computes checksum for a single-byte packet (only checksum byte)", () => {
			// Packet with only the checksum placeholder: sum of 0 bytes = 0
			const packet = new Uint8Array([0x00]);
			expect(ncsChecksum(packet)).toBe(0x00);
		});

		it("computes checksum for a two-byte packet", () => {
			// Packet [0x42, 0x00]: sum of byte 0 = 0x42
			const packet = new Uint8Array([0x42, 0x00]);
			expect(ncsChecksum(packet)).toBe(0x42);
		});

		it("wraps at 8-bit boundary", () => {
			// Packet [0xFF, 0xFF, 0x00]: sum = 0xFF + 0xFF = 0x1FE, & 0xFF = 0xFE
			const packet = new Uint8Array([0xff, 0xff, 0x00]);
			expect(ncsChecksum(packet)).toBe(0xfe);
		});

		it("handles large sum with overflow", () => {
			// 256 bytes of 0xFF followed by checksum placeholder
			// Sum = 256 * 0xFF = 0xFF00, & 0xFF = 0x00
			const packet = new Uint8Array(257).fill(0xff);
			packet[256] = 0x00; // checksum placeholder
			expect(ncsChecksum(packet)).toBe(0x00);
		});

		it("all-zero packet (except checksum byte) returns 0", () => {
			const packet = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
			expect(ncsChecksum(packet)).toBe(0x00);
		});

		it("is structurally identical to ssmChecksum for same input", () => {
			// Both algorithms are the same: sum of all bytes except last, & 0xFF
			const packet = new Uint8Array([0x80, 0x10, 0xf0, 0x01, 0xbf, 0x00]);
			expect(ncsChecksum(packet)).toBe(ssmChecksum(packet));
		});
	});

	// -------------------------------------------------------------------------
	// ncsCrc16
	// -------------------------------------------------------------------------
	describe("ncsCrc16", () => {
		it("computes CRC-16 for standard test vector '123456789' = 0x6F91", () => {
			// This algorithm is CRC-16/IBM-SDLC without the final XOR (xorout=0x0000).
			// Parameters: poly=0x8408 (reversed 0x1021), init=0xFFFF, refin=true, refout=true, xorout=0x0000.
			// The standard CRC-16/IBM-SDLC check value (with xorout=0xFFFF) is 0x906E.
			// Without the final XOR: 0x906E ^ 0xFFFF = 0x6F91.
			const data = new TextEncoder().encode("123456789");
			expect(ncsCrc16(data)).toBe(0x6f91);
		});

		it("computes CRC-16 for empty data = 0xFFFF (initial value)", () => {
			// Empty data: CRC = initial value = 0xFFFF (no bytes processed)
			const data = new Uint8Array(0);
			expect(ncsCrc16(data)).toBe(0xffff);
		});

		it("computes CRC-16 for single zero byte", () => {
			// CRC-16 of [0x00] with init=0xFFFF, poly=0x8408:
			// Process 8 bits of 0x00 (all bits are 0):
			//   Each iteration: r5&1=0, so XOR only when crc&1=1
			// Computed value: 0x0F87
			const data = new Uint8Array([0x00]);
			const crc = ncsCrc16(data);
			expect(crc).toBeGreaterThanOrEqual(0);
			expect(crc).toBeLessThanOrEqual(0xffff);
			expect(crc).toBe(0x0f87);
		});

		it("computes CRC-16 for single 0xFF byte", () => {
			// CRC-16 of [0xFF] with init=0xFFFF, poly=0x8408:
			// Process 8 bits of 0xFF (all bits are 1):
			//   Each iteration: r5&1=1, so XOR only when crc&1=0
			// Computed value: 0x00FF
			const data = new Uint8Array([0xff]);
			const crc = ncsCrc16(data);
			expect(crc).toBeGreaterThanOrEqual(0);
			expect(crc).toBeLessThanOrEqual(0xffff);
			expect(crc).toBe(0x00ff);
		});

		it("all-0xFF data: CRC is deterministic", () => {
			const data = new Uint8Array(4).fill(0xff);
			const crc = ncsCrc16(data);
			expect(crc).toBeGreaterThanOrEqual(0);
			expect(crc).toBeLessThanOrEqual(0xffff);
			expect(ncsCrc16(data)).toBe(crc);
		});
	});
});
