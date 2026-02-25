/**
 * ISO 14230 K-line framing encoder/decoder
 *
 * Implements the data link layer frame format:
 * [PCI byte][Payload bytes...][Checksum byte]
 *
 * PCI (Protocol Control Information) format:
 * - Bits 7-4: Reserved (0x0)
 * - Bits 3-0: Length of payload (0x0-0xF, max 15 bytes)
 *
 * Checksum: Sum of (PCI + all payload bytes) & 0xFF
 */

import type { Frame } from "./types.js";

/**
 * Maximum single-frame payload size for K-line (7 bytes typical, 15 max per PCI format)
 * For simplicity, we enforce 7-byte limit to match MUT-III single-frame protocol
 */
const MAX_PAYLOAD_LENGTH = 7;

/**
 * Calculate ISO 14230 checksum for a buffer
 * Checksum = (sum of all bytes) & 0xFF
 *
 * @param data - Buffer to calculate checksum for
 * @returns The checksum byte (0x00-0xFF)
 */
export function calculateChecksum(data: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < data.length; i++) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		sum += data[i]!;
	}
	return sum & 0xff;
}

/**
 * Validate checksum of a frame
 *
 * @param frameData - Complete frame data (PCI + payload + checksum)
 * @returns true if checksum is valid, false otherwise
 */
export function validateChecksum(frameData: Uint8Array): boolean {
	if (frameData.length < 2) {
		return false; // Frame too short (need at least PCI + checksum)
	}

	// Calculate expected checksum from all bytes except the last one
	const dataWithoutChecksum = frameData.slice(0, -1);
	const expectedChecksum = calculateChecksum(dataWithoutChecksum);
	const actualChecksum = frameData[frameData.length - 1];

	return expectedChecksum === actualChecksum;
}

/**
 * Encode a payload into an ISO 14230 frame
 *
 * Frame structure: [PCI][Payload...][Checksum]
 * PCI = 0x0N where N is payload length (0x01-0x07)
 * Checksum = sum of (PCI + payload) & 0xFF
 *
 * @param payload - The payload bytes (1-7 bytes)
 * @returns The complete ISO 14230 frame
 * @throws Error if payload length exceeds MAX_PAYLOAD_LENGTH
 */
export function encodeFrame(payload: Uint8Array): Uint8Array {
	if (payload.length === 0) {
		throw new Error("K-line payload cannot be empty");
	}

	if (payload.length > MAX_PAYLOAD_LENGTH) {
		throw new Error(
			`K-line payload exceeds maximum length of ${MAX_PAYLOAD_LENGTH} bytes (got ${payload.length})`,
		);
	}

	// Create frame: [PCI][Payload][Checksum]
	const frame = new Uint8Array(payload.length + 2);

	// PCI byte: 0x0N where N = payload length
	const pci = 0x00 | payload.length;
	frame[0] = pci;

	// Copy payload
	frame.set(payload, 1);

	// Calculate checksum: sum of PCI + payload
	const checksumData = frame.slice(0, -1);
	const checksum = calculateChecksum(checksumData);
	frame[frame.length - 1] = checksum;

	return frame;
}

/**
 * Decode an ISO 14230 frame and extract the payload
 *
 * Frame structure: [PCI][Payload...][Checksum]
 * PCI = 0x0N where N is payload length
 *
 * @param frameData - The complete frame data including PCI, payload, and checksum
 * @returns Object with payload bytes and validity flag
 */
export function decodeFrame(frameData: Uint8Array): Frame {
	// Minimum frame: PCI + at least 1 payload byte + checksum = 3 bytes
	if (frameData.length < 3) {
		return {
			data: frameData,
			payload: new Uint8Array(0),
			isValid: false,
		};
	}

	// Extract PCI byte
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	const pci = frameData[0]!;
	const payloadLength = pci & 0x0f; // Bits 0-3 = length

	// Validate frame length: PCI + payload + checksum
	const expectedFrameLength = 1 + payloadLength + 1;
	if (frameData.length < expectedFrameLength) {
		return {
			data: frameData,
			payload: new Uint8Array(0),
			isValid: false,
		};
	}

	// Extract payload
	const payload = frameData.slice(1, 1 + payloadLength);

	// Validate checksum
	const isValid = validateChecksum(frameData.slice(0, expectedFrameLength));

	return {
		data: frameData.slice(0, expectedFrameLength),
		payload,
		isValid,
	};
}

/**
 * Parse multiple frames from a byte buffer
 * Useful for processing received data that may contain multiple frames or partial frames
 *
 * @param buffer - Buffer that may contain one or more frames
 * @returns Array of parsed frames (only complete, valid frames are returned)
 */
export function parseFrames(buffer: Uint8Array): Frame[] {
	const frames: Frame[] = [];
	let offset = 0;

	while (offset < buffer.length) {
		// Need at least PCI byte to determine frame length
		if (offset >= buffer.length) {
			break;
		}

		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const pci = buffer[offset]!;
		const payloadLength = pci & 0x0f;
		const expectedFrameLength = 1 + payloadLength + 1; // PCI + payload + checksum

		// Check if we have a complete frame
		if (offset + expectedFrameLength > buffer.length) {
			break; // Incomplete frame, stop parsing
		}

		// Extract and validate frame
		const frameData = buffer.slice(offset, offset + expectedFrameLength);
		const frame = decodeFrame(frameData);
		frames.push(frame);

		offset += expectedFrameLength;
	}

	return frames;
}

/**
 * Get the total frame length (including PCI and checksum) from a PCI byte
 *
 * @param pci - The PCI byte (0x0N where N = payload length)
 * @returns Total frame length in bytes
 */
export function getFrameLength(pci: number): number {
	const payloadLength = pci & 0x0f;
	return 1 + payloadLength + 1; // PCI + payload + checksum
}

/**
 * Extract just the payload from an encoded frame without validation
 * Useful for protocol layers that handle their own validation
 *
 * @param frameData - Complete frame data
 * @returns Payload bytes, or empty array if frame is too short
 */
export function extractPayload(frameData: Uint8Array): Uint8Array {
	if (frameData.length < 3) {
		return new Uint8Array(0);
	}

	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	const pci = frameData[0]!;
	const payloadLength = pci & 0x0f;

	if (frameData.length < 1 + payloadLength + 1) {
		return new Uint8Array(0);
	}

	return frameData.slice(1, 1 + payloadLength);
}
