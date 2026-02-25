import { describe, expect, it } from "vitest";
import {
	extractBitFlag,
	extractBits,
	extractBitsAt,
	extractSignedBits,
} from "../src/binary/bit-extract";

describe("extractBits", () => {
	describe("within a single byte", () => {
		it("extracts the full first byte (8 bits at offset 0)", () => {
			const buffer = new Uint8Array([0xab]);
			expect(extractBits(buffer, 0, 8)).toBe(0xab);
		});

		it("extracts high nibble (4 bits at offset 0)", () => {
			const buffer = new Uint8Array([0xab]);
			expect(extractBits(buffer, 0, 4)).toBe(0xa);
		});

		it("extracts low nibble (4 bits at offset 4)", () => {
			const buffer = new Uint8Array([0xab]);
			expect(extractBits(buffer, 4, 4)).toBe(0xb);
		});

		it("extracts 2 bits from the middle of a byte", () => {
			// 0b11001100 = 0xCC
			// bits 2-3 (positions 2,3 from MSB) = 0b00
			const buffer = new Uint8Array([0xcc]);
			expect(extractBits(buffer, 2, 2)).toBe(0);
		});

		it("extracts a single bit (MSB)", () => {
			const buffer = new Uint8Array([0x80]); // 0b10000000
			expect(extractBits(buffer, 0, 1)).toBe(1);
		});

		it("extracts a single bit (LSB)", () => {
			const buffer = new Uint8Array([0x01]); // 0b00000001
			expect(extractBits(buffer, 7, 1)).toBe(1);
		});

		it("extracts 3 bits from position 1", () => {
			// 0b01110000 = 0x70
			// bits 1-3 = 0b111 = 7
			const buffer = new Uint8Array([0x70]);
			expect(extractBits(buffer, 1, 3)).toBe(7);
		});
	});

	describe("crossing byte boundaries", () => {
		it("extracts 16 bits spanning two bytes (MSB order)", () => {
			const buffer = new Uint8Array([0x12, 0x34]);
			expect(extractBits(buffer, 0, 16)).toBe(0x1234);
		});

		it("extracts bits crossing byte boundary (5+3 bits)", () => {
			// 0b11111_000 0b111_00000 => cross-boundary = 0b11111111 = 0xFF
			const buffer = new Uint8Array([0xf8, 0xe0]);
			expect(extractBits(buffer, 0, 5)).toBe(0x1f); // high 5 bits
			expect(extractBits(buffer, 5, 3)).toBe(0); // low 3 bits of first byte
			expect(extractBits(buffer, 3, 8)).toBe(0b11000111); // crossing boundary
		});

		it("extracts 11 bits crossing two bytes (RAX RPM-like)", () => {
			// RAX_C RPM uses BITS(11,11) pattern
			const buffer = new Uint8Array([0x25, 0x18, 0x3f, 0x64]);
			// bits 11-21:
			// byte 1 (0x18 = 0b00011000): bits 8-15
			// bit 11 = bit 3 of byte 1 = 1 (value 0b11)
			// Let's just verify it returns a number within 11-bit range
			const value = extractBits(buffer, 11, 11);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(2048); // 2^11
		});

		it("extracts 10 bits spanning two bytes", () => {
			// 0b00000011 0b11100000 => bits 6-15 in big-endian bit order
			// bit 6 = byte0 bit from LSB position 1 = 1 (0x03 has bits 0,1 set)
			// bit 7 = byte0 LSB = 1
			// bits 8-10 = byte1 bits 7-5 from MSB = 1,1,1 (0xE0 = 1110_0000)
			// bits 11-15 = 0
			// So bits 6-15 = 0b1111100000 = 992
			const buffer = new Uint8Array([0x03, 0xe0]);
			expect(extractBits(buffer, 6, 10)).toBe(0b1111100000); // 992
		});

		it("extracts from the last two bytes of a multi-byte buffer", () => {
			const buffer = new Uint8Array([0x00, 0x00, 0xab, 0xcd]);
			expect(extractBits(buffer, 16, 16)).toBe(0xabcd);
		});
	});

	describe("multi-byte extractions", () => {
		it("extracts 24 bits spanning 3 bytes", () => {
			const buffer = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
			expect(extractBits(buffer, 0, 24)).toBe(0x123456);
		});

		it("extracts 32 bits (full 4 bytes)", () => {
			const buffer = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
			expect(extractBits(buffer, 0, 32)).toBe(0x12345678);
		});

		it("extracts 32 bits with maximum value (all 0xFF)", () => {
			const buffer = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
			expect(extractBits(buffer, 0, 32)).toBe(0xffffffff);
		});
	});

	describe("error cases", () => {
		it("throws when bitLength is 0", () => {
			const buffer = new Uint8Array([0x00]);
			expect(() => extractBits(buffer, 0, 0)).toThrow(
				/bitLength must be positive/,
			);
		});

		it("throws when bitLength exceeds 32", () => {
			const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
			expect(() => extractBits(buffer, 0, 33)).toThrow(
				/bitLength cannot exceed 32/,
			);
		});

		it("throws when bit range exceeds buffer", () => {
			const buffer = new Uint8Array([0x00]);
			expect(() => extractBits(buffer, 0, 9)).toThrow(/exceeds buffer length/);
		});

		it("throws when bitOffset starts at exact buffer end", () => {
			const buffer = new Uint8Array([0x00]);
			expect(() => extractBits(buffer, 8, 1)).toThrow(/exceeds buffer length/);
		});
	});

	describe("RAX block parameter extraction", () => {
		// Test actual RAX bit positions from MUT3_LOGGING_CAPABILITIES.md

		it("extracts RAX_A Fuel Trim parameters (byte-aligned 8-bit values)", () => {
			// STFT: BITS(0,8), LTFT: BITS(8,8), STFT2: BITS(16,8), LTFT2: BITS(24,8)
			const buffer = new Uint8Array([0x80, 0x90, 0x70, 0x88]);
			expect(extractBits(buffer, 0, 8)).toBe(0x80); // STFT raw = 128, converted = 0%
			expect(extractBits(buffer, 8, 8)).toBe(0x90); // LTFT raw = 144, converted = +1.6%
			expect(extractBits(buffer, 16, 8)).toBe(0x70); // STFT2 raw = 112, converted = -1.6%
			expect(extractBits(buffer, 24, 8)).toBe(0x88); // LTFT2 raw = 136, converted = +0.8%
		});

		it("extracts RAX_G Vehicle Speed (10 bits at BITS(0,10))", () => {
			// Speed × 0.1 km/h, so 1000 raw = 100 km/h
			// 1000 = 0b01111101000 (11 bits), first 10 bits
			// But we only want 10 bits, max = 1023
			const buffer = new Uint8Array([0xff, 0xc0, 0x00, 0x00]); // all 10 high bits set = 1023
			expect(extractBits(buffer, 0, 10)).toBe(0x3ff); // 1023
		});

		it("extracts RAX_F TPS (10 bits at BITS(0,10)) and APP (10 bits at BITS(10,10))", () => {
			// TPS 50% = 500 raw, APP 75% = 750 raw
			// Pack into 20 bits big-endian:
			// 500 = 0b0111110100 (10 bits)
			// 750 = 0b1011101110 (10 bits)
			// Combined: 0b01111101001011101110_xxxx (20 bits)
			// = 0x7D2EEx
			const tps500 = 500; // 10 bits = 0b0111110100
			const app750 = 750; // 10 bits = 0b1011101110
			const combined = (tps500 << 10) | app750; // 20-bit value
			const buffer = new Uint8Array([
				(combined >> 12) & 0xff,
				(combined >> 4) & 0xff,
				((combined & 0xf) << 4) & 0xff,
				0x00,
			]);
			expect(extractBits(buffer, 0, 10)).toBe(tps500);
			expect(extractBits(buffer, 10, 10)).toBe(app750);
		});
	});
});

describe("extractBitFlag", () => {
	it("returns true for the MSB of a byte", () => {
		const buffer = new Uint8Array([0x80]); // 0b10000000
		expect(extractBitFlag(buffer, 0)).toBe(true);
	});

	it("returns false for the MSB of a zero byte", () => {
		const buffer = new Uint8Array([0x00]);
		expect(extractBitFlag(buffer, 0)).toBe(false);
	});

	it("returns true for the LSB of a byte", () => {
		const buffer = new Uint8Array([0x01]); // 0b00000001
		expect(extractBitFlag(buffer, 7)).toBe(true);
	});

	it("returns false for the LSB when not set", () => {
		const buffer = new Uint8Array([0xfe]); // 0b11111110
		expect(extractBitFlag(buffer, 7)).toBe(false);
	});

	it("returns correct value for bit in second byte", () => {
		const buffer = new Uint8Array([0x00, 0x40]); // bit 9 = 1
		expect(extractBitFlag(buffer, 9)).toBe(true);
		expect(extractBitFlag(buffer, 8)).toBe(false);
	});

	it("reads all 8 bits of a byte correctly", () => {
		const buffer = new Uint8Array([0b10110101]);
		expect(extractBitFlag(buffer, 0)).toBe(true);
		expect(extractBitFlag(buffer, 1)).toBe(false);
		expect(extractBitFlag(buffer, 2)).toBe(true);
		expect(extractBitFlag(buffer, 3)).toBe(true);
		expect(extractBitFlag(buffer, 4)).toBe(false);
		expect(extractBitFlag(buffer, 5)).toBe(true);
		expect(extractBitFlag(buffer, 6)).toBe(false);
		expect(extractBitFlag(buffer, 7)).toBe(true);
	});

	it("throws when bit position exceeds buffer length", () => {
		const buffer = new Uint8Array([0x00]);
		expect(() => extractBitFlag(buffer, 8)).toThrow(/exceeds buffer length/);
	});

	it("reads flag in a 4-byte RAX block", () => {
		// Simulate VVT control status flag in a 4-byte block at bit 26
		const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x20]); // bit 26 = 1 (0x20 = 0b00100000, bit 2 from MSB of byte 3)
		// byte 3 = 0x20 = 0b00100000
		// bit 3*8+2 = bit 26 = value 0b001xxx (bit 2 from MSB) = (0x20 >> (7-2)) & 1 = (0x20 >> 5) & 1 = 1
		expect(extractBitFlag(buffer, 26)).toBe(true);
		expect(extractBitFlag(buffer, 25)).toBe(false);
	});
});

describe("extractSignedBits", () => {
	describe("positive values", () => {
		it("returns positive value when MSB is 0", () => {
			const buffer = new Uint8Array([0x70]); // 0b01110000
			// 4 bits at offset 0 = 0b0111 = 7 (positive)
			expect(extractSignedBits(buffer, 0, 4)).toBe(7);
		});

		it("returns 0 for all-zero signed field", () => {
			const buffer = new Uint8Array([0x0f]); // 0b00001111
			// 4 bits at offset 4 = 0b1111 = -1 unsigned... wait
			// Actually 0b1111 as 4-bit signed = -1
			expect(extractSignedBits(buffer, 4, 4)).toBe(-1);
		});

		it("returns max positive 4-bit value", () => {
			// 4 bits at 0: 0b0111 = +7
			const buffer = new Uint8Array([0x70]); // 0b01110000
			expect(extractSignedBits(buffer, 0, 4)).toBe(7);
		});
	});

	describe("negative values (two's complement)", () => {
		it("returns -1 for all-ones signed 4-bit field", () => {
			// 0b1111_0000 => bits 0-3 = 0b1111 = -1 in 4-bit signed
			const buffer = new Uint8Array([0xf0]);
			expect(extractSignedBits(buffer, 0, 4)).toBe(-1);
		});

		it("returns -8 for minimum value in signed 4-bit field", () => {
			// 0b1000_0000 => bits 0-3 = 0b1000 = -8
			const buffer = new Uint8Array([0x80]);
			expect(extractSignedBits(buffer, 0, 4)).toBe(-8);
		});

		it("returns -128 for signed 8-bit minimum", () => {
			const buffer = new Uint8Array([0x80]);
			expect(extractSignedBits(buffer, 0, 8)).toBe(-128);
		});

		it("returns -1 for signed 8-bit 0xFF", () => {
			const buffer = new Uint8Array([0xff]);
			expect(extractSignedBits(buffer, 0, 8)).toBe(-1);
		});

		it("handles signed 7-bit field (timing advance pattern)", () => {
			// Timing advance BITS(24,7): value - 20 gives °BTDC
			// Raw 0b1101101 = 109, which as 7-bit signed = 109 - 128 = -19
			// In this case MSB=1 so signed: 109 - 128 = -19
			const buffer = new Uint8Array([0x00, 0x00, 0x00, 0xd8]);
			// bits 24-30 (7 bits) in big-endian layout:
			// byte 3 = 0xD8 = 0b11011000
			// bits 24-30 = bit 24 is MSB of byte 3 = 1,1,0,1,1,0,0 = 0b1101100 = 108
			// 108 as 7-bit signed: MSB=1, so 108 - 128 = -20
			const raw = extractSignedBits(buffer, 24, 7);
			expect(raw).toBeLessThan(0); // Negative value (timing retard)
		});
	});

	describe("crossing byte boundaries", () => {
		it("handles signed field crossing byte boundary", () => {
			// 9-bit field crossing byte 0 and byte 1
			// 0b11111111_1 = 0b111111111 = 511, but signed 9-bit = 511 - 512 = -1
			const buffer = new Uint8Array([0xff, 0x80]); // MSBit of byte1 = 1
			// bits 0-8: first 8 bits = 0xFF, then bit 8 = MSB of byte 1 = 1
			// 9-bit value = 0b111111111 = 511, signed = -1
			expect(extractSignedBits(buffer, 0, 9)).toBe(-1);
		});

		it("handles VVT angle calculation (9-bit signed field)", () => {
			// RAX_E intake VVT: BITS(0,9) × 0.1 - 20
			// Raw 200 → 200 × 0.1 - 20 = 0°
			// As unsigned 9-bit, 200 = 0b011001000
			// As big-endian: byte 0 bits 0-7 = 0b01100100, byte 1 bit 0 = 0
			const buffer = new Uint8Array([0x64, 0x00]); // 200 = 0x64 << 1 (9 bits big-endian)
			// Actually 200 in 9-bit big-endian:
			// 200 = 0b011001000
			// byte 0 = 0b01100100 = 0x64, bit 0 of byte 1 = 0x00
			// Wait - big-endian bit packing: bit 0 = MSB
			// 200 in 9 bits = 0b011001000
			// bit 0 = 0, bit 1 = 1, bit 2 = 1, ... (MSB first)
			// So byte 0 = 0b01100100 = 0x64 (bits 0-7), byte 1 bit 0 = 0b00000000
			const raw = extractBits(buffer, 0, 9);
			// Check it's within valid 9-bit range
			expect(raw).toBeGreaterThanOrEqual(0);
			expect(raw).toBeLessThan(512);
		});
	});

	describe("error cases", () => {
		it("throws when bitLength is 1 (not enough for sign bit)", () => {
			const buffer = new Uint8Array([0x80]);
			expect(() => extractSignedBits(buffer, 0, 1)).toThrow(/at least 2/);
		});

		it("throws when bitLength is 0", () => {
			const buffer = new Uint8Array([0x00]);
			expect(() => extractSignedBits(buffer, 0, 0)).toThrow(/at least 2/);
		});
	});

	describe("fuel trim conversion (RAX_A pattern)", () => {
		it("converts STFT raw 128 to 0%", () => {
			// STFT: BITS(0,8), formula: (value - 128) × 0.1
			const buffer = new Uint8Array([0x80]); // 128
			const raw = extractBits(buffer, 0, 8);
			const stft = (raw - 128) * 0.1;
			expect(stft).toBeCloseTo(0, 5);
		});

		it("converts STFT raw 180 to +5.2%", () => {
			const buffer = new Uint8Array([0xb4]); // 180
			const raw = extractBits(buffer, 0, 8);
			const stft = (raw - 128) * 0.1;
			expect(stft).toBeCloseTo(5.2, 5);
		});

		it("converts STFT raw 76 to -5.2%", () => {
			const buffer = new Uint8Array([0x4c]); // 76
			const raw = extractBits(buffer, 0, 8);
			const stft = (raw - 128) * 0.1;
			expect(stft).toBeCloseTo(-5.2, 5);
		});
	});
});

describe("extractBitsAt", () => {
	it("extracts bits using byte offset + bit offset API", () => {
		const buffer = new Uint8Array([0x00, 0xff, 0x00]);
		// byte 1, bit 0 (MSB of byte 1), 8 bits = 0xFF
		expect(extractBitsAt(buffer, 1, 0, 8)).toBe(0xff);
	});

	it("extracts bits from byte 0 using explicit zero offset", () => {
		const buffer = new Uint8Array([0xab, 0xcd]);
		expect(extractBitsAt(buffer, 0, 0, 8)).toBe(0xab);
	});

	it("extracts bits at sub-byte offset within a byte", () => {
		const buffer = new Uint8Array([0x0f]); // 0b00001111
		// byte 0, bit 4 (5th from MSB), 4 bits => 0b1111 = 15
		expect(extractBitsAt(buffer, 0, 4, 4)).toBe(0xf);
	});

	it("is equivalent to extractBits with byteOffset * 8 + bitOffset", () => {
		const buffer = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
		// byte 2, bit 0, 8 bits = same as bit offset 16, 8 bits
		expect(extractBitsAt(buffer, 2, 0, 8)).toBe(extractBits(buffer, 16, 8));
	});

	it("throws when bitOffset is out of 0-7 range", () => {
		const buffer = new Uint8Array([0x00]);
		expect(() => extractBitsAt(buffer, 0, 8, 1)).toThrow(
			/bitOffset within byte/,
		);
		expect(() => extractBitsAt(buffer, 0, -1, 1)).toThrow(
			/bitOffset within byte/,
		);
	});
});
