import { describe, expect, it } from "vitest";
import { decodeScalar, decodeScalarBytes } from "../src/binary";

describe("Binary Scalar Decoding", () => {
	describe("u8 (unsigned 8-bit)", () => {
		it("should decode u8 values correctly", () => {
			const buffer = new Uint8Array([0, 127, 255]);
			expect(decodeScalar(buffer, 0, "u8")).toBe(0);
			expect(decodeScalar(buffer, 1, "u8")).toBe(127);
			expect(decodeScalar(buffer, 2, "u8")).toBe(255);
		});

		it("should handle u8 with scaling", () => {
			const buffer = new Uint8Array([100]);
			const result = decodeScalar(buffer, 0, "u8", { scale: 0.5, offset: 10 });
			expect(result).toBe(60); // (100 * 0.5) + 10
		});
	});

	describe("i8 (signed 8-bit)", () => {
		it("should decode i8 values correctly", () => {
			const buffer = new Uint8Array([0, 127, 128, 255]);
			expect(decodeScalar(buffer, 0, "i8")).toBe(0);
			expect(decodeScalar(buffer, 1, "i8")).toBe(127);
			expect(decodeScalar(buffer, 2, "i8")).toBe(-128);
			expect(decodeScalar(buffer, 3, "i8")).toBe(-1);
		});

		it("should handle i8 with scaling", () => {
			const buffer = new Uint8Array([50]);
			const result = decodeScalar(buffer, 0, "i8", { scale: 2, offset: -5 });
			expect(result).toBe(95); // (50 * 2) - 5
		});
	});

	describe("u16 (unsigned 16-bit)", () => {
		it("should decode u16 little-endian", () => {
			const buffer = new Uint8Array([0x00, 0x00, 0xff, 0x00, 0xff, 0xff]);
			expect(decodeScalar(buffer, 0, "u16", { endian: "le" })).toBe(0);
			expect(decodeScalar(buffer, 2, "u16", { endian: "le" })).toBe(255);
			expect(decodeScalar(buffer, 4, "u16", { endian: "le" })).toBe(65535);
		});

		it("should decode u16 big-endian", () => {
			const buffer = new Uint8Array([0x00, 0x00, 0x00, 0xff, 0xff, 0xff]);
			expect(decodeScalar(buffer, 0, "u16", { endian: "be" })).toBe(0);
			expect(decodeScalar(buffer, 2, "u16", { endian: "be" })).toBe(255);
			expect(decodeScalar(buffer, 4, "u16", { endian: "be" })).toBe(65535);
		});
	});

	describe("i16 (signed 16-bit)", () => {
		it("should decode i16 little-endian", () => {
			const buffer = new Uint8Array([
				0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0xff, 0xff,
			]);
			expect(decodeScalar(buffer, 0, "i16", { endian: "le" })).toBe(0);
			expect(decodeScalar(buffer, 2, "i16", { endian: "le" })).toBe(32767);
			expect(decodeScalar(buffer, 4, "i16", { endian: "le" })).toBe(-32768);
			expect(decodeScalar(buffer, 6, "i16", { endian: "le" })).toBe(-1);
		});

		it("should decode i16 big-endian", () => {
			const buffer = new Uint8Array([
				0x00, 0x00, 0x7f, 0xff, 0x80, 0x00, 0xff, 0xff,
			]);
			expect(decodeScalar(buffer, 0, "i16", { endian: "be" })).toBe(0);
			expect(decodeScalar(buffer, 2, "i16", { endian: "be" })).toBe(32767);
			expect(decodeScalar(buffer, 4, "i16", { endian: "be" })).toBe(-32768);
			expect(decodeScalar(buffer, 6, "i16", { endian: "be" })).toBe(-1);
		});
	});

	describe("u32 (unsigned 32-bit)", () => {
		it("should decode u32 little-endian", () => {
			const buffer = new Uint8Array([
				0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
			]);
			expect(decodeScalar(buffer, 0, "u32", { endian: "le" })).toBe(0);
			expect(decodeScalar(buffer, 4, "u32", { endian: "le" })).toBe(255);
			expect(decodeScalar(buffer, 8, "u32", { endian: "le" })).toBe(4294967295);
		});

		it("should decode u32 big-endian", () => {
			const buffer = new Uint8Array([
				0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff,
			]);
			expect(decodeScalar(buffer, 0, "u32", { endian: "be" })).toBe(0);
			expect(decodeScalar(buffer, 4, "u32", { endian: "be" })).toBe(255);
			expect(decodeScalar(buffer, 8, "u32", { endian: "be" })).toBe(4294967295);
		});
	});

	describe("i32 (signed 32-bit)", () => {
		it("should decode i32 little-endian", () => {
			const buffer = new Uint8Array([
				0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x7f, 0x00, 0x00, 0x00, 0x80,
				0xff, 0xff, 0xff, 0xff,
			]);
			expect(decodeScalar(buffer, 0, "i32", { endian: "le" })).toBe(0);
			expect(decodeScalar(buffer, 4, "i32", { endian: "le" })).toBe(2147483647);
			expect(decodeScalar(buffer, 8, "i32", { endian: "le" })).toBe(
				-2147483648,
			);
			expect(decodeScalar(buffer, 12, "i32", { endian: "le" })).toBe(-1);
		});

		it("should decode i32 big-endian", () => {
			const buffer = new Uint8Array([
				0x00, 0x00, 0x00, 0x00, 0x7f, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00,
				0xff, 0xff, 0xff, 0xff,
			]);
			expect(decodeScalar(buffer, 0, "i32", { endian: "be" })).toBe(0);
			expect(decodeScalar(buffer, 4, "i32", { endian: "be" })).toBe(2147483647);
			expect(decodeScalar(buffer, 8, "i32", { endian: "be" })).toBe(
				-2147483648,
			);
			expect(decodeScalar(buffer, 12, "i32", { endian: "be" })).toBe(-1);
		});
	});

	describe("f32 (32-bit float)", () => {
		it("should decode f32 little-endian", () => {
			const buffer = new Uint8Array(12);
			const view = new DataView(buffer.buffer);
			view.setFloat32(0, 0, true);
			view.setFloat32(4, 3.14, true);
			view.setFloat32(8, -2.71, true);

			expect(decodeScalar(buffer, 0, "f32", { endian: "le" })).toBe(0);
			expect(decodeScalar(buffer, 4, "f32", { endian: "le" })).toBeCloseTo(
				3.14,
				2,
			);
			expect(decodeScalar(buffer, 8, "f32", { endian: "le" })).toBeCloseTo(
				-2.71,
				2,
			);
		});

		it("should decode f32 big-endian", () => {
			const buffer = new Uint8Array(12);
			const view = new DataView(buffer.buffer);
			view.setFloat32(0, 0, false);
			view.setFloat32(4, 3.14, false);
			view.setFloat32(8, -2.71, false);

			expect(decodeScalar(buffer, 0, "f32", { endian: "be" })).toBe(0);
			expect(decodeScalar(buffer, 4, "f32", { endian: "be" })).toBeCloseTo(
				3.14,
				2,
			);
			expect(decodeScalar(buffer, 8, "f32", { endian: "be" })).toBeCloseTo(
				-2.71,
				2,
			);
		});
	});

	describe("Edge cases", () => {
		it("should handle min/max values for u8", () => {
			const buffer = new Uint8Array([0, 255]);
			expect(decodeScalar(buffer, 0, "u8")).toBe(0);
			expect(decodeScalar(buffer, 1, "u8")).toBe(255);
		});

		it("should handle min/max values for i8", () => {
			const buffer = new Uint8Array([128, 127]);
			expect(decodeScalar(buffer, 0, "i8")).toBe(-128);
			expect(decodeScalar(buffer, 1, "i8")).toBe(127);
		});

		it("should handle zero values", () => {
			const buffer = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
			expect(decodeScalar(buffer, 0, "u8")).toBe(0);
			expect(decodeScalar(buffer, 0, "i8")).toBe(0);
			expect(decodeScalar(buffer, 0, "u16", { endian: "le" })).toBe(0);
			expect(decodeScalar(buffer, 0, "i16", { endian: "le" })).toBe(0);
		});

		it("should handle negative numbers with i8", () => {
			const buffer = new Uint8Array([255, 254, 128]);
			expect(decodeScalar(buffer, 0, "i8")).toBe(-1);
			expect(decodeScalar(buffer, 1, "i8")).toBe(-2);
			expect(decodeScalar(buffer, 2, "i8")).toBe(-128);
		});
	});

	describe("Scaling and offset", () => {
		it("should apply scale and offset correctly", () => {
			const buffer = new Uint8Array([100]);
			const result = decodeScalar(buffer, 0, "u8", { scale: 0.1, offset: 20 });
			expect(result).toBe(30); // (100 * 0.1) + 20
		});

		it("should handle negative offset", () => {
			const buffer = new Uint8Array([50]);
			const result = decodeScalar(buffer, 0, "u8", { scale: 2, offset: -100 });
			expect(result).toBe(0); // (50 * 2) - 100
		});

		it("should handle zero scale", () => {
			const buffer = new Uint8Array([100]);
			const result = decodeScalar(buffer, 0, "u8", { scale: 0, offset: 42 });
			expect(result).toBe(42); // (100 * 0) + 42
		});
	});

	describe("Invalid inputs", () => {
		it("should throw on out of bounds access for u16", () => {
			const buffer = new Uint8Array([0x00, 0x00]);
			expect(() => decodeScalar(buffer, 1, "u16", { endian: "le" })).toThrow();
			expect(() => decodeScalar(buffer, 1, "u16", { endian: "be" })).toThrow();
		});

		it("should throw on out of bounds access for i16", () => {
			const buffer = new Uint8Array([0x00, 0x00]);
			expect(() => decodeScalar(buffer, 1, "i16", { endian: "le" })).toThrow();
			expect(() => decodeScalar(buffer, 1, "i16", { endian: "be" })).toThrow();
		});

		it("should throw on out of bounds access for u32", () => {
			const buffer = new Uint8Array([0x00, 0x00, 0x00]);
			expect(() => decodeScalar(buffer, 0, "u32", { endian: "le" })).toThrow();
			expect(() => decodeScalar(buffer, 0, "u32", { endian: "be" })).toThrow();
		});

		it("should throw on out of bounds access for i32", () => {
			const buffer = new Uint8Array([0x00, 0x00, 0x00]);
			expect(() => decodeScalar(buffer, 0, "i32", { endian: "le" })).toThrow();
			expect(() => decodeScalar(buffer, 0, "i32", { endian: "be" })).toThrow();
		});

		it("should throw on out of bounds access for f32", () => {
			const buffer = new Uint8Array([0x00, 0x00, 0x00]);
			expect(() => decodeScalar(buffer, 0, "f32", { endian: "le" })).toThrow();
			expect(() => decodeScalar(buffer, 0, "f32", { endian: "be" })).toThrow();
		});

		it("should throw on out of bounds access for u8", () => {
			const buffer = new Uint8Array([0x00]);
			expect(() => decodeScalar(buffer, 1, "u8")).toThrow();
		});

		it("should throw on out of bounds access for i8", () => {
			const buffer = new Uint8Array([0x00]);
			expect(() => decodeScalar(buffer, 1, "i8")).toThrow();
		});

		it("should throw on negative offset", () => {
			const buffer = new Uint8Array([0x00, 0x00]);
			expect(() => decodeScalar(buffer, -1, "u8")).toThrow();
		});

		it("should throw on invalid type", () => {
			const buffer = new Uint8Array([0x00]);
			expect(() => decodeScalar(buffer, 0, "invalid" as any)).toThrow();
		});
	});
});

describe("decodeScalarBytes", () => {
	describe("u8 (unsigned 8-bit)", () => {
		it("should decode u8 values correctly", () => {
			expect(decodeScalarBytes(new Uint8Array([0]), "u8", "le")).toBe(0);
			expect(decodeScalarBytes(new Uint8Array([127]), "u8", "le")).toBe(127);
			expect(decodeScalarBytes(new Uint8Array([255]), "u8", "le")).toBe(255);
		});
	});

	describe("i8 (signed 8-bit)", () => {
		it("should decode i8 values correctly", () => {
			expect(decodeScalarBytes(new Uint8Array([0]), "i8", "le")).toBe(0);
			expect(decodeScalarBytes(new Uint8Array([127]), "i8", "le")).toBe(127);
			expect(decodeScalarBytes(new Uint8Array([128]), "i8", "le")).toBe(-128);
			expect(decodeScalarBytes(new Uint8Array([255]), "i8", "le")).toBe(-1);
		});
	});

	describe("u16 (unsigned 16-bit)", () => {
		it("should decode u16 little-endian", () => {
			expect(decodeScalarBytes(new Uint8Array([0x00, 0x00]), "u16", "le")).toBe(
				0,
			);
			expect(decodeScalarBytes(new Uint8Array([0xff, 0x00]), "u16", "le")).toBe(
				255,
			);
			expect(decodeScalarBytes(new Uint8Array([0xff, 0xff]), "u16", "le")).toBe(
				65535,
			);
			expect(decodeScalarBytes(new Uint8Array([0x34, 0x12]), "u16", "le")).toBe(
				0x1234,
			);
		});

		it("should decode u16 big-endian", () => {
			expect(decodeScalarBytes(new Uint8Array([0x00, 0x00]), "u16", "be")).toBe(
				0,
			);
			expect(decodeScalarBytes(new Uint8Array([0x00, 0xff]), "u16", "be")).toBe(
				255,
			);
			expect(decodeScalarBytes(new Uint8Array([0xff, 0xff]), "u16", "be")).toBe(
				65535,
			);
			expect(decodeScalarBytes(new Uint8Array([0x12, 0x34]), "u16", "be")).toBe(
				0x1234,
			);
		});
	});

	describe("i16 (signed 16-bit)", () => {
		it("should decode i16 little-endian", () => {
			expect(decodeScalarBytes(new Uint8Array([0x00, 0x00]), "i16", "le")).toBe(
				0,
			);
			expect(decodeScalarBytes(new Uint8Array([0xff, 0x7f]), "i16", "le")).toBe(
				32767,
			);
			expect(decodeScalarBytes(new Uint8Array([0x00, 0x80]), "i16", "le")).toBe(
				-32768,
			);
			expect(decodeScalarBytes(new Uint8Array([0xff, 0xff]), "i16", "le")).toBe(
				-1,
			);
		});

		it("should decode i16 big-endian", () => {
			expect(decodeScalarBytes(new Uint8Array([0x00, 0x00]), "i16", "be")).toBe(
				0,
			);
			expect(decodeScalarBytes(new Uint8Array([0x7f, 0xff]), "i16", "be")).toBe(
				32767,
			);
			expect(decodeScalarBytes(new Uint8Array([0x80, 0x00]), "i16", "be")).toBe(
				-32768,
			);
			expect(decodeScalarBytes(new Uint8Array([0xff, 0xff]), "i16", "be")).toBe(
				-1,
			);
		});
	});

	describe("u32 (unsigned 32-bit)", () => {
		it("should decode u32 little-endian", () => {
			expect(
				decodeScalarBytes(
					new Uint8Array([0x00, 0x00, 0x00, 0x00]),
					"u32",
					"le",
				),
			).toBe(0);
			expect(
				decodeScalarBytes(
					new Uint8Array([0xff, 0x00, 0x00, 0x00]),
					"u32",
					"le",
				),
			).toBe(255);
			expect(
				decodeScalarBytes(
					new Uint8Array([0xff, 0xff, 0xff, 0xff]),
					"u32",
					"le",
				),
			).toBe(4294967295);
			expect(
				decodeScalarBytes(
					new Uint8Array([0x78, 0x56, 0x34, 0x12]),
					"u32",
					"le",
				),
			).toBe(0x12345678);
		});

		it("should decode u32 big-endian", () => {
			expect(
				decodeScalarBytes(
					new Uint8Array([0x00, 0x00, 0x00, 0x00]),
					"u32",
					"be",
				),
			).toBe(0);
			expect(
				decodeScalarBytes(
					new Uint8Array([0x00, 0x00, 0x00, 0xff]),
					"u32",
					"be",
				),
			).toBe(255);
			expect(
				decodeScalarBytes(
					new Uint8Array([0xff, 0xff, 0xff, 0xff]),
					"u32",
					"be",
				),
			).toBe(4294967295);
			expect(
				decodeScalarBytes(
					new Uint8Array([0x12, 0x34, 0x56, 0x78]),
					"u32",
					"be",
				),
			).toBe(0x12345678);
		});
	});

	describe("i32 (signed 32-bit)", () => {
		it("should decode i32 little-endian", () => {
			expect(
				decodeScalarBytes(
					new Uint8Array([0x00, 0x00, 0x00, 0x00]),
					"i32",
					"le",
				),
			).toBe(0);
			expect(
				decodeScalarBytes(
					new Uint8Array([0xff, 0xff, 0xff, 0x7f]),
					"i32",
					"le",
				),
			).toBe(2147483647);
			expect(
				decodeScalarBytes(
					new Uint8Array([0x00, 0x00, 0x00, 0x80]),
					"i32",
					"le",
				),
			).toBe(-2147483648);
			expect(
				decodeScalarBytes(
					new Uint8Array([0xff, 0xff, 0xff, 0xff]),
					"i32",
					"le",
				),
			).toBe(-1);
		});

		it("should decode i32 big-endian", () => {
			expect(
				decodeScalarBytes(
					new Uint8Array([0x00, 0x00, 0x00, 0x00]),
					"i32",
					"be",
				),
			).toBe(0);
			expect(
				decodeScalarBytes(
					new Uint8Array([0x7f, 0xff, 0xff, 0xff]),
					"i32",
					"be",
				),
			).toBe(2147483647);
			expect(
				decodeScalarBytes(
					new Uint8Array([0x80, 0x00, 0x00, 0x00]),
					"i32",
					"be",
				),
			).toBe(-2147483648);
			expect(
				decodeScalarBytes(
					new Uint8Array([0xff, 0xff, 0xff, 0xff]),
					"i32",
					"be",
				),
			).toBe(-1);
		});
	});

	describe("f32 (32-bit float)", () => {
		it("should decode f32 little-endian", () => {
			const buffer1 = new Uint8Array(4);
			new DataView(buffer1.buffer).setFloat32(0, 0, true);
			expect(decodeScalarBytes(buffer1, "f32", "le")).toBe(0);

			const buffer2 = new Uint8Array(4);
			new DataView(buffer2.buffer).setFloat32(0, 3.14, true);
			expect(decodeScalarBytes(buffer2, "f32", "le")).toBeCloseTo(3.14, 2);

			const buffer3 = new Uint8Array(4);
			new DataView(buffer3.buffer).setFloat32(0, -2.71, true);
			expect(decodeScalarBytes(buffer3, "f32", "le")).toBeCloseTo(-2.71, 2);
		});

		it("should decode f32 big-endian", () => {
			const buffer1 = new Uint8Array(4);
			new DataView(buffer1.buffer).setFloat32(0, 0, false);
			expect(decodeScalarBytes(buffer1, "f32", "be")).toBe(0);

			const buffer2 = new Uint8Array(4);
			new DataView(buffer2.buffer).setFloat32(0, 3.14, false);
			expect(decodeScalarBytes(buffer2, "f32", "be")).toBeCloseTo(3.14, 2);

			const buffer3 = new Uint8Array(4);
			new DataView(buffer3.buffer).setFloat32(0, -2.71, false);
			expect(decodeScalarBytes(buffer3, "f32", "be")).toBeCloseTo(-2.71, 2);
		});
	});

	describe("Edge cases", () => {
		it("should handle min/max values for all types", () => {
			// u8
			expect(decodeScalarBytes(new Uint8Array([0]), "u8", "le")).toBe(0);
			expect(decodeScalarBytes(new Uint8Array([255]), "u8", "le")).toBe(255);

			// i8
			expect(decodeScalarBytes(new Uint8Array([128]), "i8", "le")).toBe(-128);
			expect(decodeScalarBytes(new Uint8Array([127]), "i8", "le")).toBe(127);

			// u16
			expect(decodeScalarBytes(new Uint8Array([0, 0]), "u16", "le")).toBe(0);
			expect(decodeScalarBytes(new Uint8Array([0xff, 0xff]), "u16", "le")).toBe(
				65535,
			);

			// i16
			expect(decodeScalarBytes(new Uint8Array([0x00, 0x80]), "i16", "le")).toBe(
				-32768,
			);
			expect(decodeScalarBytes(new Uint8Array([0xff, 0x7f]), "i16", "le")).toBe(
				32767,
			);
		});

		it("should throw on invalid type", () => {
			const bytes = new Uint8Array([0x00]);
			expect(() => decodeScalarBytes(bytes, "invalid" as any, "le")).toThrow();
		});
	});
});
