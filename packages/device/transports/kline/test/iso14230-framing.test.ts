/**
 * ISO 14230 framing layer tests
 * 40+ tests covering frame encoding/decoding, checksum calculation, and edge cases
 */

import { describe, expect, it } from "vitest";
import {
	calculateChecksum,
	decodeFrame,
	encodeFrame,
	extractPayload,
	getFrameLength,
	parseFrames,
	validateChecksum,
} from "../src/iso14230-framing.js";

describe("calculateChecksum", () => {
	it("calculates checksum for single byte", () => {
		const data = new Uint8Array([0x01]);
		expect(calculateChecksum(data)).toBe(0x01);
	});

	it("calculates checksum for multiple bytes", () => {
		const data = new Uint8Array([0x01, 0x02, 0x03]);
		expect(calculateChecksum(data)).toBe(0x06);
	});

	it("handles checksum overflow (wraps at 0xFF)", () => {
		const data = new Uint8Array([0xff, 0x01]);
		expect(calculateChecksum(data)).toBe(0x00);
	});

	it("handles all zeros", () => {
		const data = new Uint8Array([0x00, 0x00, 0x00]);
		expect(calculateChecksum(data)).toBe(0x00);
	});

	it("handles all 0xFF", () => {
		const data = new Uint8Array([0xff, 0xff]);
		expect(calculateChecksum(data)).toBe(0xfe);
	});

	it("calculates checksum for E0 command example", () => {
		// MUT-III E0 command: set address
		// PCI (0x05) + payload [0xE0, 0x23, 0x80, 0x51, 0xB0]
		const data = new Uint8Array([0x05, 0xe0, 0x23, 0x80, 0x51, 0xb0]);
		const checksum = calculateChecksum(data);
		// 0x05 + 0xE0 + 0x23 + 0x80 + 0x51 + 0xB0 = 0x2A9 = 0xA9 & 0xFF
		expect(checksum).toBe(0x89);
	});

	it("calculates checksum for empty array", () => {
		const data = new Uint8Array([]);
		expect(calculateChecksum(data)).toBe(0x00);
	});
});

describe("validateChecksum", () => {
	it("validates correct checksum", () => {
		// Frame: [PCI=0x01][Payload=0xFF][Checksum]
		// Checksum = (0x01 + 0xFF) & 0xFF = 0x00
		const frame = new Uint8Array([0x01, 0xff, 0x00]);
		expect(validateChecksum(frame)).toBe(true);
	});

	it("rejects incorrect checksum", () => {
		const frame = new Uint8Array([0x01, 0xff, 0x01]); // Wrong checksum
		expect(validateChecksum(frame)).toBe(false);
	});

	it("rejects frame too short (no checksum)", () => {
		const frame = new Uint8Array([0x01]);
		expect(validateChecksum(frame)).toBe(false);
	});

	it("rejects empty frame", () => {
		const frame = new Uint8Array([]);
		expect(validateChecksum(frame)).toBe(false);
	});

	it("validates E0 command with correct checksum", () => {
		// E0 command: [0x05][0xE0][0x23][0x80][0x51][0xB0][0x89]
		const frame = new Uint8Array([0x05, 0xe0, 0x23, 0x80, 0x51, 0xb0, 0x89]);
		expect(validateChecksum(frame)).toBe(true);
	});

	it("rejects E0 command with wrong checksum", () => {
		const frame = new Uint8Array([0x05, 0xe0, 0x23, 0x80, 0x51, 0xb0, 0xa8]); // Wrong checksum
		expect(validateChecksum(frame)).toBe(false);
	});
});

describe("encodeFrame", () => {
	it("encodes single byte payload", () => {
		const payload = new Uint8Array([0x3e]); // Tester present
		const frame = encodeFrame(payload);

		// Expected: [0x01][0x3E][checksum]
		// Checksum = (0x01 + 0x3E) & 0xFF = 0x3F
		expect(frame).toEqual(new Uint8Array([0x01, 0x3e, 0x3f]));
	});

	it("encodes 5-byte payload (E0 command)", () => {
		const payload = new Uint8Array([0xe0, 0x23, 0x80, 0x51, 0xb0]);
		const frame = encodeFrame(payload);

		// PCI = 0x05 (5 bytes)
		// Checksum = (0x05 + 0xE0 + 0x23 + 0x80 + 0x51 + 0xB0) & 0xFF = 0x89
		expect(frame).toEqual(
			new Uint8Array([0x05, 0xe0, 0x23, 0x80, 0x51, 0xb0, 0x89]),
		);
	});

	it("encodes 7-byte payload (maximum)", () => {
		const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
		const frame = encodeFrame(payload);

		// PCI = 0x07 (7 bytes)
		// Length = 1 (PCI) + 7 (payload) + 1 (checksum) = 9
		expect(frame.length).toBe(9);
		expect(frame[0]).toBe(0x07); // PCI
		expect(frame.slice(1, 8)).toEqual(payload);
		expect(validateChecksum(frame)).toBe(true);
	});

	it("throws on empty payload", () => {
		const payload = new Uint8Array([]);
		expect(() => encodeFrame(payload)).toThrow(
			"K-line payload cannot be empty",
		);
	});

	it("throws on oversized payload (>7 bytes)", () => {
		const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(() => encodeFrame(payload)).toThrow(/exceeds maximum length/);
	});

	it("encodes E5 read command", () => {
		const payload = new Uint8Array([0xe5]); // Read word
		const frame = encodeFrame(payload);

		// PCI = 0x01, Payload = 0xE5
		// Checksum = (0x01 + 0xE5) & 0xFF = 0xE6
		expect(frame).toEqual(new Uint8Array([0x01, 0xe5, 0xe6]));
		expect(validateChecksum(frame)).toBe(true);
	});

	it("encodes payload with all 0xFF bytes", () => {
		const payload = new Uint8Array([0xff, 0xff, 0xff]);
		const frame = encodeFrame(payload);

		// PCI = 0x03
		// Checksum = (0x03 + 0xFF + 0xFF + 0xFF) & 0xFF = (3 + 255 + 255 + 255) & 0xFF = 768 & 0xFF = 0x00
		expect(frame).toEqual(new Uint8Array([0x03, 0xff, 0xff, 0xff, 0x00]));
	});

	it("encodes payload crossing checksum boundary", () => {
		const payload = new Uint8Array([0xfe, 0xfe]);
		const frame = encodeFrame(payload);

		// PCI = 0x02
		// Checksum = (0x02 + 0xFE + 0xFE) & 0xFF = 0xFE
		expect(frame).toEqual(new Uint8Array([0x02, 0xfe, 0xfe, 0xfe]));
	});
});

describe("decodeFrame", () => {
	it("decodes single byte payload", () => {
		const frame = new Uint8Array([0x01, 0x3e, 0x3f]);
		const result = decodeFrame(frame);

		expect(result.isValid).toBe(true);
		expect(result.payload).toEqual(new Uint8Array([0x3e]));
		expect(result.data.length).toBe(3);
	});

	it("decodes 5-byte payload (E0 response)", () => {
		// Encode a frame first to get correct checksum
		const payload = new Uint8Array([0xe0, 0x23, 0x80, 0x51, 0xb0]);
		const frame = encodeFrame(payload);
		const result = decodeFrame(frame);

		expect(result.isValid).toBe(true);
		expect(result.payload).toEqual(payload);
	});

	it("rejects frame with bad checksum", () => {
		const frame = new Uint8Array([0x01, 0x3e, 0x40]); // Wrong checksum
		const result = decodeFrame(frame);

		expect(result.isValid).toBe(false);
		expect(result.payload.length).toBe(1);
	});

	it("handles frame too short", () => {
		const frame = new Uint8Array([0x01]); // Only PCI, no payload/checksum
		const result = decodeFrame(frame);

		expect(result.isValid).toBe(false);
		expect(result.payload.length).toBe(0);
	});

	it("handles truncated payload", () => {
		const frame = new Uint8Array([0x05]); // PCI says 5 bytes but only PCI present
		const result = decodeFrame(frame);

		expect(result.isValid).toBe(false);
		expect(result.payload.length).toBe(0);
	});

	it("decodes 7-byte payload", () => {
		const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
		const encoded = encodeFrame(payload);
		const result = decodeFrame(encoded);

		expect(result.isValid).toBe(true);
		expect(result.payload).toEqual(payload);
	});

	it("returns original data in result", () => {
		const frame = new Uint8Array([0x01, 0x3e, 0x3f]);
		const result = decodeFrame(frame);

		expect(result.data).toEqual(frame);
	});

	it("extracts correct length from PCI", () => {
		const frame = new Uint8Array([0x03, 0xaa, 0xbb, 0xcc, 0x6e]);
		const result = decodeFrame(frame);

		expect(result.payload.length).toBe(3);
		expect(result.payload).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
	});

	it("handles frame with max PCI length (0x0F)", () => {
		// PCI 0x07 indicates 7-byte payload
		// Checksum = (0x07 + 1 + 2 + 3 + 4 + 5 + 6 + 7) & 0xFF = (7 + 28) & 0xFF = 0x23
		const frame = new Uint8Array([0x07, 1, 2, 3, 4, 5, 6, 7, 0x23]);
		const result = decodeFrame(frame);

		expect(result.isValid).toBe(true);
		expect(result.payload.length).toBe(7);
	});
});

describe("parseFrames", () => {
	it("parses single frame", () => {
		const buffer = new Uint8Array([0x01, 0x3e, 0x3f]);
		const frames = parseFrames(buffer);

		expect(frames.length).toBe(1);
		expect(frames[0]?.payload).toEqual(new Uint8Array([0x3e]));
	});

	it("parses multiple frames", () => {
		// Two frames: [0x01][0x3E][0x3F] and [0x02][0xAA][0xBB][0xAD]
		const buffer = new Uint8Array([
			0x01,
			0x3e,
			0x3f, // Frame 1
			0x02,
			0xaa,
			0xbb,
			0xad, // Frame 2
		]);
		const frames = parseFrames(buffer);

		expect(frames.length).toBe(2);
		expect(frames[0]?.payload).toEqual(new Uint8Array([0x3e]));
		expect(frames[1]?.payload).toEqual(new Uint8Array([0xaa, 0xbb]));
	});

	it("handles incomplete frame at end", () => {
		// One complete frame and incomplete second frame
		const buffer = new Uint8Array([
			0x01,
			0x3e,
			0x3f, // Complete frame
			0x03,
			0xaa,
			0xbb, // Incomplete (needs 1 more byte for checksum)
		]);
		const frames = parseFrames(buffer);

		expect(frames.length).toBe(1);
		expect(frames[0]?.payload).toEqual(new Uint8Array([0x3e]));
	});

	it("parses empty buffer", () => {
		const buffer = new Uint8Array([]);
		const frames = parseFrames(buffer);

		expect(frames.length).toBe(0);
	});

	it("skips invalid frames but continues parsing", () => {
		// Frame with wrong checksum, then valid frame
		const buffer = new Uint8Array([
			0x01,
			0x3e,
			0x40, // Invalid checksum
			0x01,
			0x3e,
			0x3f, // Valid frame
		]);
		const frames = parseFrames(buffer);

		expect(frames.length).toBe(2);
		expect(frames[0]?.isValid).toBe(false);
		expect(frames[1]?.isValid).toBe(true);
	});

	it("parses three identical frames", () => {
		const singleFrame = new Uint8Array([0x01, 0x3e, 0x3f]);
		const buffer = new Uint8Array([
			...singleFrame,
			...singleFrame,
			...singleFrame,
		]);
		const frames = parseFrames(buffer);

		expect(frames.length).toBe(3);
		frames.forEach((frame) => {
			expect(frame.isValid).toBe(true);
			expect(frame.payload).toEqual(new Uint8Array([0x3e]));
		});
	});

	it("parses frames with mixed sizes", () => {
		const buffer = new Uint8Array([
			0x01,
			0x3e,
			0x3f, // 1-byte payload
			0x03,
			0xaa,
			0xbb,
			0xcc,
			0x66, // 3-byte payload
			0x02,
			0x11,
			0x22,
			0x35, // 2-byte payload
		]);
		const frames = parseFrames(buffer);

		expect(frames.length).toBe(3);
		expect(frames[0]?.payload.length).toBe(1);
		expect(frames[1]?.payload.length).toBe(3);
		expect(frames[2]?.payload.length).toBe(2);
	});
});

describe("getFrameLength", () => {
	it("returns correct length for PCI 0x01", () => {
		// PCI 0x01 = 1 payload + PCI + checksum = 3 bytes total
		expect(getFrameLength(0x01)).toBe(3);
	});

	it("returns correct length for PCI 0x03", () => {
		// PCI 0x03 = 3 payload + PCI + checksum = 5 bytes total
		expect(getFrameLength(0x03)).toBe(5);
	});

	it("returns correct length for PCI 0x07", () => {
		// PCI 0x07 = 7 payload + PCI + checksum = 9 bytes total
		expect(getFrameLength(0x07)).toBe(9);
	});

	it("returns correct length for PCI 0x00", () => {
		// PCI 0x00 = 0 payload + PCI + checksum = 2 bytes total
		expect(getFrameLength(0x00)).toBe(2);
	});

	it("returns correct length for maximum PCI 0x0F", () => {
		// PCI 0x0F = 15 payload + PCI + checksum = 17 bytes total
		expect(getFrameLength(0x0f)).toBe(17);
	});

	it("ignores bits above 0x0F in PCI", () => {
		// PCI with high bits set: uses lower 4 bits only
		expect(getFrameLength(0xf1)).toBe(3); // Same as 0x01
		expect(getFrameLength(0x83)).toBe(5); // Same as 0x03
	});
});

describe("extractPayload", () => {
	it("extracts payload from single-byte frame", () => {
		const frame = new Uint8Array([0x01, 0x3e, 0x3f]);
		const payload = extractPayload(frame);

		expect(payload).toEqual(new Uint8Array([0x3e]));
	});

	it("extracts payload from multi-byte frame", () => {
		const frame = new Uint8Array([0x05, 0xe0, 0x23, 0x80, 0x51, 0xb0, 0xa9]);
		const payload = extractPayload(frame);

		expect(payload).toEqual(new Uint8Array([0xe0, 0x23, 0x80, 0x51, 0xb0]));
	});

	it("returns empty array for frame too short", () => {
		const frame = new Uint8Array([0x01]);
		const payload = extractPayload(frame);

		expect(payload.length).toBe(0);
	});

	it("returns empty array for empty input", () => {
		const frame = new Uint8Array([]);
		const payload = extractPayload(frame);

		expect(payload.length).toBe(0);
	});

	it("returns empty array for 2-byte input (PCI + checksum only)", () => {
		const frame = new Uint8Array([0x01, 0xff]);
		const payload = extractPayload(frame);

		expect(payload.length).toBe(0);
	});

	it("extracts payload without validation (allows invalid frames)", () => {
		// Frame with invalid checksum but valid structure
		const frame = new Uint8Array([0x01, 0x3e, 0x40]); // Wrong checksum
		const payload = extractPayload(frame);

		// Should still extract payload even though checksum is invalid
		expect(payload).toEqual(new Uint8Array([0x3e]));
	});

	it("extracts correct portion even if buffer is longer", () => {
		// Buffer with frame + extra garbage
		const frame = new Uint8Array([0x01, 0x3e, 0x3f, 0xff, 0xff, 0xff]);
		const payload = extractPayload(frame);

		expect(payload).toEqual(new Uint8Array([0x3e]));
	});

	it("extracts 7-byte payload", () => {
		const frame = new Uint8Array([0x07, 1, 2, 3, 4, 5, 6, 7, 0x1d]);
		const payload = extractPayload(frame);

		expect(payload).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
	});
});

describe("Frame round-trip (encode/decode)", () => {
	it("encodes and decodes single byte", () => {
		const original = new Uint8Array([0x3e]);
		const encoded = encodeFrame(original);
		const decoded = decodeFrame(encoded);

		expect(decoded.isValid).toBe(true);
		expect(decoded.payload).toEqual(original);
	});

	it("encodes and decodes 5 bytes", () => {
		const original = new Uint8Array([0xe0, 0x23, 0x80, 0x51, 0xb0]);
		const encoded = encodeFrame(original);
		const decoded = decodeFrame(encoded);

		expect(decoded.isValid).toBe(true);
		expect(decoded.payload).toEqual(original);
	});

	it("encodes and decodes 7 bytes (maximum)", () => {
		const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
		const encoded = encodeFrame(original);
		const decoded = decodeFrame(encoded);

		expect(decoded.isValid).toBe(true);
		expect(decoded.payload).toEqual(original);
	});

	it("round-trip with all 0xFF", () => {
		const original = new Uint8Array([0xff, 0xff, 0xff]);
		const encoded = encodeFrame(original);
		const decoded = decodeFrame(encoded);

		expect(decoded.isValid).toBe(true);
		expect(decoded.payload).toEqual(original);
	});

	it("round-trip multiple frames", () => {
		const payloads = [
			new Uint8Array([0x01]),
			new Uint8Array([0xaa, 0xbb]),
			new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
		];

		for (const original of payloads) {
			const encoded = encodeFrame(original);
			const decoded = decodeFrame(encoded);
			expect(decoded.isValid).toBe(true);
			expect(decoded.payload).toEqual(original);
		}
	});
});
