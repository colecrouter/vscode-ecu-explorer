import { describe, expect, it } from "vitest";
import { computeChangedSectors } from "../src/diff.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a ROM buffer of the given size filled with a constant value.
 */
function makeRom(size: number, fill = 0x00): Uint8Array {
	return new Uint8Array(size).fill(fill);
}

/**
 * Clone a ROM buffer and modify a single byte at the given offset.
 */
function withByteChanged(
	rom: Uint8Array,
	offset: number,
	value: number,
): Uint8Array {
	const modified = new Uint8Array(rom.buffer.slice(0));
	modified[offset] = value;
	return modified;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeChangedSectors()", () => {
	// ── Identical ROMs ────────────────────────────────────────────────────────

	describe("identical ROMs", () => {
		it("returns empty array when both ROMs are identical", () => {
			const original = makeRom(0x40000, 0xaa); // 256 KB, 4 sectors of 64 KB
			const modified = makeRom(0x40000, 0xaa);
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([]);
		});

		it("returns empty array for single-sector identical ROM", () => {
			const original = makeRom(0x10000, 0xff);
			const modified = makeRom(0x10000, 0xff);
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([]);
		});

		it("returns empty array for 1 MB identical ROM with 64 KB sectors", () => {
			const original = makeRom(0x100000, 0x00);
			const modified = makeRom(0x100000, 0x00);
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([]);
		});
	});

	// ── Single sector changes ─────────────────────────────────────────────────

	describe("single sector changes", () => {
		it("returns [0] when first byte of first sector is changed", () => {
			const original = makeRom(0x40000, 0x00);
			const modified = withByteChanged(original, 0, 0xff);
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([0]);
		});

		it("returns [0] when last byte of first sector is changed", () => {
			const original = makeRom(0x40000, 0x00);
			const modified = withByteChanged(original, 0x0ffff, 0xff);
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([0]);
		});

		it("returns [last sector index] when last byte of last sector is changed", () => {
			const original = makeRom(0x40000, 0x00); // 4 sectors
			const modified = withByteChanged(original, 0x3ffff, 0xff); // last byte
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([3]);
		});

		it("returns [last sector index] when first byte of last sector is changed", () => {
			const original = makeRom(0x40000, 0x00); // 4 sectors
			const modified = withByteChanged(original, 0x30000, 0xff); // first byte of sector 3
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([3]);
		});

		it("returns [1] when a byte in the middle sector is changed (3-sector ROM)", () => {
			const original = makeRom(0x30000, 0x00); // 3 sectors of 64 KB
			const modified = withByteChanged(original, 0x18000, 0xff); // middle of sector 1
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([1]);
		});
	});

	// ── Multiple sector changes ───────────────────────────────────────────────

	describe("multiple sector changes", () => {
		it("returns all changed sector indices in order", () => {
			const original = makeRom(0x40000, 0x00); // 4 sectors
			const modified = makeRom(0x40000, 0x00);
			modified[0x00000] = 0xff; // sector 0
			modified[0x20000] = 0xff; // sector 2
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([
				0, 2,
			]);
		});

		it("returns all sector indices when all sectors are changed", () => {
			const original = makeRom(0x40000, 0x00); // 4 sectors
			const modified = makeRom(0x40000, 0xff); // all bytes different
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([
				0, 1, 2, 3,
			]);
		});

		it("returns correct indices for non-adjacent changed sectors", () => {
			const original = makeRom(0x100000, 0x00); // 16 sectors of 64 KB
			const modified = makeRom(0x100000, 0x00);
			modified[0x20000] = 0x01; // sector 2
			modified[0x70000] = 0x01; // sector 7
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([
				2, 7,
			]);
		});

		it("returns indices for two adjacent changed sectors", () => {
			const original = makeRom(0x40000, 0x00); // 4 sectors
			const modified = makeRom(0x40000, 0x00);
			modified[0x10000] = 0x01; // sector 1
			modified[0x20000] = 0x01; // sector 2
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([
				1, 2,
			]);
		});
	});

	// ── Sector size = 1 (byte-level diff) ────────────────────────────────────

	describe("sector size = 1 (byte-level diff)", () => {
		it("degenerates to byte-level diff when sectorSize = 1", () => {
			const original = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
			const modified = new Uint8Array([0x00, 0xff, 0x00, 0xff]);
			expect(computeChangedSectors(original, modified, 1)).toEqual([1, 3]);
		});

		it("returns empty array when all bytes are identical with sectorSize = 1", () => {
			const original = new Uint8Array([0xaa, 0xbb, 0xcc]);
			const modified = new Uint8Array([0xaa, 0xbb, 0xcc]);
			expect(computeChangedSectors(original, modified, 1)).toEqual([]);
		});
	});

	// ── Error cases ───────────────────────────────────────────────────────────

	describe("error cases", () => {
		it("throws when original and modified have different lengths", () => {
			const original = makeRom(0x10000);
			const modified = makeRom(0x20000);
			expect(() => computeChangedSectors(original, modified, 0x10000)).toThrow(
				/size mismatch/i,
			);
		});

		it("throws when ROM size is not a multiple of sector size", () => {
			const original = makeRom(0x10001); // not a multiple of 0x10000
			const modified = makeRom(0x10001);
			expect(() => computeChangedSectors(original, modified, 0x10000)).toThrow(
				/not a multiple/i,
			);
		});

		it("throws when modified is larger than original", () => {
			const original = makeRom(0x10000);
			const modified = makeRom(0x10001);
			expect(() => computeChangedSectors(original, modified, 0x10000)).toThrow(
				/size mismatch/i,
			);
		});

		it("throws when original is larger than modified", () => {
			const original = makeRom(0x20000);
			const modified = makeRom(0x10000);
			expect(() => computeChangedSectors(original, modified, 0x10000)).toThrow(
				/size mismatch/i,
			);
		});
	});

	// ── Zero-length ROM ───────────────────────────────────────────────────────

	describe("zero-length ROM", () => {
		it("returns empty array for zero-length ROMs (0 sectors)", () => {
			// Zero-length is technically valid: 0 % sectorSize === 0, 0 sectors
			const original = new Uint8Array(0);
			const modified = new Uint8Array(0);
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([]);
		});
	});

	// ── Early exit verification ───────────────────────────────────────────────

	describe("early exit behaviour", () => {
		it("only includes a sector once even if multiple bytes differ within it", () => {
			const original = makeRom(0x20000, 0x00); // 2 sectors
			// Change many bytes in sector 0
			const modified = new Uint8Array(original);
			for (let i = 0; i < 0x10000; i++) {
				modified[i] = 0xff;
			}
			// Sector 0 should appear exactly once
			const result = computeChangedSectors(original, modified, 0x10000);
			expect(result).toEqual([0]);
			expect(result.length).toBe(1);
		});

		it("does not include sector 1 when only sector 0 differs", () => {
			const original = makeRom(0x20000, 0x00); // 2 sectors
			const modified = withByteChanged(original, 0x00000, 0xff); // only sector 0
			const result = computeChangedSectors(original, modified, 0x10000);
			expect(result).toEqual([0]);
			expect(result).not.toContain(1);
		});
	});

	// ── 1 MB ROM with 16 sectors (realistic scenario) ────────────────────────

	describe("realistic 1 MB ROM scenario", () => {
		it("handles 1 MB ROM with 16 sectors of 64 KB each", () => {
			const original = makeRom(0x100000, 0x00);
			const modified = withByteChanged(original, 0x80000, 0x01); // sector 8
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([8]);
		});

		it("returns all 16 sector indices when all sectors differ", () => {
			const original = makeRom(0x100000, 0x00);
			const modified = makeRom(0x100000, 0xff);
			const result = computeChangedSectors(original, modified, 0x10000);
			expect(result).toEqual([
				0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
			]);
		});

		it("returns empty array when 1 MB ROMs are identical", () => {
			const original = makeRom(0x100000, 0xab);
			const modified = makeRom(0x100000, 0xab);
			expect(computeChangedSectors(original, modified, 0x10000)).toEqual([]);
		});
	});
});
