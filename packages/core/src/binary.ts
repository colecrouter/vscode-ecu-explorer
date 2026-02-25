/**
 * Endianness for multi-byte values
 * - "le" = little-endian (least significant byte first)
 * - "be" = big-endian (most significant byte first)
 */
export type Endianness = "le" | "be";

/**
 * Scalar data types supported for ROM values
 * - "u8" = unsigned 8-bit integer (0-255)
 * - "i8" = signed 8-bit integer (-128 to 127)
 * - "u16" = unsigned 16-bit integer (0-65535)
 * - "i16" = signed 16-bit integer (-32768 to 32767)
 * - "u32" = unsigned 32-bit integer (0-4294967295)
 * - "i32" = signed 32-bit integer (-2147483648 to 2147483647)
 * - "f32" = 32-bit floating point
 */
export type ScalarType = "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32";

/**
 * Options for scalar decoding
 */
export interface DecodeScalarOptions {
	/** Endianness for multi-byte values @default "le" */
	endian?: Endianness;
	/** Scale factor to apply to raw value @default 1 */
	scale?: number;
	/** Offset to apply after scaling @default 0 */
	offset?: number;
}

/**
 * Decode a scalar value from a buffer at the given offset
 *
 * @param buffer - The buffer to read from
 * @param offset - Byte offset in the buffer
 * @param type - The scalar type to decode
 * @param options - Decoding options (endianness, scale, offset)
 * @returns The decoded value, optionally scaled and offset
 * @throws Error if offset is out of bounds or type is invalid
 *
 * @example
 * const buffer = new Uint8Array([0x12, 0x34]);
 * const value = decodeScalar(buffer, 0, "u16", { endian: "be" }); // 0x1234
 */
export function decodeScalar(
	buffer: Uint8Array,
	offset: number,
	type: ScalarType,
	options: DecodeScalarOptions = {},
): number {
	const { endian = "le", scale = 1, offset: valueOffset = 0 } = options;

	// Validate offset
	if (offset < 0) {
		throw new Error(`Offset cannot be negative: ${offset}`);
	}

	let rawValue: number;

	switch (type) {
		case "u8": {
			if (offset >= buffer.length) {
				throw new Error(
					`Offset ${offset} out of bounds for buffer of length ${buffer.length}`,
				);
			}
			rawValue = buffer[offset] as number;
			break;
		}

		case "i8": {
			if (offset >= buffer.length) {
				throw new Error(
					`Offset ${offset} out of bounds for buffer of length ${buffer.length}`,
				);
			}
			const byte = buffer[offset] as number;
			// Convert to signed 8-bit
			rawValue = byte > 127 ? byte - 256 : byte;
			break;
		}

		case "u16": {
			if (offset + 1 >= buffer.length) {
				throw new Error(
					`Offset ${offset} out of bounds for buffer of length ${buffer.length}`,
				);
			}
			if (endian === "le") {
				rawValue =
					(buffer[offset] as number) | ((buffer[offset + 1] as number) << 8);
			} else {
				rawValue =
					((buffer[offset] as number) << 8) | (buffer[offset + 1] as number);
			}
			break;
		}

		case "i16": {
			if (offset + 1 >= buffer.length) {
				throw new Error(
					`Offset ${offset} out of bounds for buffer of length ${buffer.length}`,
				);
			}
			let word: number;
			if (endian === "le") {
				word =
					(buffer[offset] as number) | ((buffer[offset + 1] as number) << 8);
			} else {
				word =
					((buffer[offset] as number) << 8) | (buffer[offset + 1] as number);
			}
			// Convert to signed 16-bit
			rawValue = word > 32767 ? word - 65536 : word;
			break;
		}

		case "u32": {
			if (offset + 3 >= buffer.length) {
				throw new Error(
					`Offset ${offset} out of bounds for buffer of length ${buffer.length}`,
				);
			}
			if (endian === "le") {
				rawValue =
					(buffer[offset] as number) |
					((buffer[offset + 1] as number) << 8) |
					((buffer[offset + 2] as number) << 16) |
					((buffer[offset + 3] as number) << 24);
			} else {
				rawValue =
					((buffer[offset] as number) << 24) |
					((buffer[offset + 1] as number) << 16) |
					((buffer[offset + 2] as number) << 8) |
					(buffer[offset + 3] as number);
			}
			// Ensure unsigned
			rawValue = rawValue >>> 0;
			break;
		}

		case "i32": {
			if (offset + 3 >= buffer.length) {
				throw new Error(
					`Offset ${offset} out of bounds for buffer of length ${buffer.length}`,
				);
			}
			if (endian === "le") {
				rawValue =
					(buffer[offset] as number) |
					((buffer[offset + 1] as number) << 8) |
					((buffer[offset + 2] as number) << 16) |
					((buffer[offset + 3] as number) << 24);
			} else {
				rawValue =
					((buffer[offset] as number) << 24) |
					((buffer[offset + 1] as number) << 16) |
					((buffer[offset + 2] as number) << 8) |
					(buffer[offset + 3] as number);
			}
			// Convert to signed 32-bit
			rawValue = rawValue | 0;
			break;
		}

		case "f32": {
			if (offset + 3 >= buffer.length) {
				throw new Error(
					`Offset ${offset} out of bounds for buffer of length ${buffer.length}`,
				);
			}
			const view = new DataView(
				buffer.buffer,
				buffer.byteOffset,
				buffer.byteLength,
			);
			rawValue = view.getFloat32(offset, endian === "le");
			break;
		}

		default: {
			const _exhaustive: never = type;
			throw new Error(`Unknown scalar type: ${_exhaustive}`);
		}
	}

	// Apply scaling and offset
	return rawValue * scale + valueOffset;
}

/**
 * Decode a scalar value from a byte array (simpler version without offset)
 *
 * @param bytes - The bytes to decode
 * @param type - The scalar type to decode
 * @param endianness - Byte order ("le" or "be")
 * @returns The decoded value
 *
 * @example
 * const bytes = new Uint8Array([0x12, 0x34]);
 * const value = decodeScalarBytes(bytes, "u16", "be"); // 0x1234
 */
export function decodeScalarBytes(
	bytes: Uint8Array,
	type: ScalarType,
	endianness: Endianness,
): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const littleEndian = endianness === "le";

	switch (type) {
		case "u8":
			return view.getUint8(0);
		case "i8":
			return view.getInt8(0);
		case "u16":
			return view.getUint16(0, littleEndian);
		case "i16":
			return view.getInt16(0, littleEndian);
		case "u32":
			return view.getUint32(0, littleEndian);
		case "i32":
			return view.getInt32(0, littleEndian);
		case "f32":
			return view.getFloat32(0, littleEndian);
		default: {
			const _exhaustive: never = type;
			throw new Error(`Unknown scalar type: ${_exhaustive}`);
		}
	}
}

/**
 * Get the byte size of a scalar type
 *
 * @param dtype - The scalar data type
 * @returns Size in bytes
 *
 * @example
 * sizeOf("u16"); // 2
 * sizeOf("f32"); // 4
 */
export function sizeOf(dtype: ScalarType): number {
	switch (dtype) {
		case "u8":
		case "i8":
			return 1;
		case "u16":
		case "i16":
			return 2;
		case "u32":
		case "i32":
		case "f32":
			return 4;
	}
}

/**
 * Encode a numeric value to a byte array
 *
 * Values are clamped to the valid range for the data type before encoding.
 * For floating-point types, clamping is not applied.
 *
 * @param value - The numeric value to encode
 * @param dtype - The scalar data type to encode to
 * @param endianness - Byte order ("le" for little-endian, "be" for big-endian)
 * @returns Encoded bytes
 *
 * @example
 * const bytes = encodeScalar(0x1234, "u16", "be"); // Uint8Array([0x12, 0x34])
 */
export function encodeScalar(
	value: number,
	dtype: ScalarType,
	endianness: Endianness = "le",
): Uint8Array {
	const size = sizeOf(dtype);
	const buffer = new ArrayBuffer(size);
	const view = new DataView(buffer);
	const littleEndian = endianness === "le";

	switch (dtype) {
		case "u8":
			view.setUint8(0, Math.max(0, Math.min(0xff, Math.round(value))));
			break;
		case "i8":
			view.setInt8(0, Math.max(-0x80, Math.min(0x7f, Math.round(value))));
			break;
		case "u16":
			view.setUint16(
				0,
				Math.max(0, Math.min(0xffff, Math.round(value))),
				littleEndian,
			);
			break;
		case "i16":
			view.setInt16(
				0,
				Math.max(-0x8000, Math.min(0x7fff, Math.round(value))),
				littleEndian,
			);
			break;
		case "u32":
			view.setUint32(
				0,
				Math.max(0, Math.min(0xffffffff, Math.round(value))),
				littleEndian,
			);
			break;
		case "i32":
			view.setInt32(
				0,
				Math.max(-0x80000000, Math.min(0x7fffffff, Math.round(value))),
				littleEndian,
			);
			break;
		case "f32":
			view.setFloat32(0, value, littleEndian);
			break;
	}

	return new Uint8Array(buffer);
}
