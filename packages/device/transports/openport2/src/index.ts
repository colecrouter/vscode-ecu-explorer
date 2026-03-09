import type {
	DeviceConnection,
	DeviceInfo,
	DeviceTransport,
} from "@ecu-explorer/device";

// USBDevice and USBDeviceRequestOptions are available globally from @types/w3c-web-usb
// HID types are available via DOM lib.

// Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L1
// USB vendor/product IDs for OpenPort 2.0
const VENDOR_ID = 0x0403;
const PRODUCT_ID = 0xcc4d;

// Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L310
// USB bulk transfer endpoint defaults
const DEFAULT_ENDPOINT_IN = 0x81;
const DEFAULT_ENDPOINT_OUT = 0x02;
const DEFAULT_FRAME_TIMEOUT_MS = 500;
const ADAPTER_DRAIN_TIMEOUT_MS = 25;
const ADAPTER_DRAIN_MAX_READS = 8;
const ADAPTER_COMMAND_TIMEOUT_MS = 2000;
const ISO15765_PROTOCOL_ID = 6;
const ISO15765_CHANNEL_CODE = 0x36;
const ISO15765_DEFAULT_FLAGS = 0;
const ISO15765_DEFAULT_BAUD = 500000;
const ISO15765_FLOW_CONTROL_FILTER = 3;
const CAN_ID_MASK_11BIT = 0x7ff;
const DEFAULT_TESTER_CAN_ID = 0x7e0;
const DEFAULT_ECU_CAN_ID = 0x7e8;
const PACKET_NORMAL = 0x00;
const PACKET_TX_DONE = 0x10;
const PACKET_RX_END = 0x40;
const PACKET_NORMAL_START = 0x80;

interface EndpointDescriptor {
	interfaceNumber: number;
	endpointIn: number;
	endpointOut: number;
}

type TransportSource = "usb" | "hid" | "serial";

interface DeviceInfoWithSource extends DeviceInfo {
	source: TransportSource;
}

interface HidInputReportEventLike {
	data: DataView;
}

interface HidCollectionOutputReport {
	reportId: number;
}

interface HidCollection {
	outputReports?: readonly HidCollectionOutputReport[];
}

interface HidDeviceLike {
	vendorId: number;
	productId: number;
	serialNumber?: string | null;
	productName?: string | null;
	opened: boolean;
	collections?: readonly HidCollection[];
	open(): Promise<void>;
	close(): Promise<void>;
	sendReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
	addEventListener(
		type: "inputreport",
		listener: (event: HidInputReportEventLike) => void,
	): void;
	removeEventListener(
		type: "inputreport",
		listener: (event: HidInputReportEventLike) => void,
	): void;
}

interface HidFilter {
	vendorId: number;
	productId: number;
}

interface HidLike {
	getDevices(): Promise<readonly HidDeviceLike[]>;
	requestDevice(options: {
		filters: readonly HidFilter[];
	}): Promise<readonly HidDeviceLike[]>;
}

interface SerialPortInfoLike {
	path: string;
	serialNumber?: string | null;
	manufacturer?: string | null;
	friendlyName?: string | null;
	vendorId?: number | string | null;
	productId?: number | string | null;
}

interface SerialPortLike {
	readonly path: string;
	readonly isOpen: boolean;
	open(): Promise<void>;
	close(): Promise<void>;
	write(data: Uint8Array): Promise<void>;
	read(maxLength: number, timeoutMs: number): Promise<Uint8Array>;
}

interface SerialLike {
	listPorts(): Promise<readonly SerialPortInfoLike[]>;
	openPort(path: string): Promise<SerialPortLike>;
}

interface NodeLikeUsbEndpoint {
	direction: "in" | "out";
	address?: number;
}

interface NodeLikeUsbInterface {
	interfaceNumber?: number;
	endpoints?: readonly NodeLikeUsbEndpoint[];
}

type NodeLikeUsbDevice = USBDevice & {
	interfaces?: readonly NodeLikeUsbInterface[];
};

interface WebUsbEndpoint {
	direction?: "in" | "out";
	endpointNumber?: number;
}

interface WebUsbInterfaceDescriptor {
	interfaceNumber: number;
	alternate?: { endpoints?: readonly WebUsbEndpoint[] };
	alternateSettings?: readonly { endpoints?: readonly WebUsbEndpoint[] }[];
}

/**
 * Options for OpenPort2Transport constructor.
 */
export interface OpenPort2TransportOptions {
	/** Optional USB interface. Defaults to navigator.usb in browser environments. */
	usb?: USB;
	/** Optional HID interface. Defaults to navigator.hid in browser environments. */
	hid?: HidLike;
	/** Optional serial interface for desktop Node runtimes. */
	serial?: SerialLike;
}

/**
 * Ensure a Uint8Array is backed by a plain ArrayBuffer (not SharedArrayBuffer).
 * Required because USBDevice.transferOut() only accepts ArrayBufferView<ArrayBuffer>.
 */
function toPlainArrayBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
	if (data.buffer instanceof ArrayBuffer) {
		return data as Uint8Array<ArrayBuffer>;
	}
	// Copy into a fresh ArrayBuffer
	const copy = new Uint8Array(data.length);
	copy.set(data);
	return copy;
}

/**
 * Race an async operation against a timeout.
 */
function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	errorMessage: string,
): Promise<T> {
	if (timeoutMs <= 0) {
		return promise;
	}

	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(errorMessage));
		}, timeoutMs);

		void promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * Converts a USBDevice to a DeviceInfo object.
 */
function usbDeviceToInfo(device: USBDevice): DeviceInfoWithSource {
	const serial = device.serialNumber ?? "unknown";
	return {
		id: `openport2:${serial}`,
		name: device.productName ?? "Tactrix OpenPort 2.0",
		transportName: "openport2",
		connected: device.opened,
		source: "usb",
	};
}

/**
 * Converts a HID-like device to a DeviceInfo object.
 */
function hidDeviceToInfo(device: HidDeviceLike): DeviceInfoWithSource {
	const serial = device.serialNumber ?? "unknown";
	return {
		id: `openport2:${serial}`,
		name: device.productName ?? "Tactrix OpenPort 2.0",
		transportName: "openport2",
		connected: device.opened,
		source: "hid",
	};
}

function normalizeUsbIdentifier(
	value: number | string | null | undefined,
): number | null {
	if (typeof value === "number") {
		return value;
	}
	if (typeof value !== "string" || value.length === 0) {
		return null;
	}
	const trimmed = value.trim().toLowerCase();
	const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
	const parsed = Number.parseInt(normalized, 16);
	return Number.isNaN(parsed) ? null : parsed;
}

function isMatchingSerialPort(port: SerialPortInfoLike): boolean {
	const vendorId = normalizeUsbIdentifier(port.vendorId);
	const productId = normalizeUsbIdentifier(port.productId);
	if (vendorId === VENDOR_ID && productId === PRODUCT_ID) {
		return true;
	}

	const haystack = [
		port.path,
		port.serialNumber,
		port.manufacturer,
		port.friendlyName,
	]
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();

	return (
		haystack.includes("openport") ||
		haystack.includes("tactrix") ||
		haystack.includes("usbmodem")
	);
}

function serialPortToInfo(port: SerialPortInfoLike): DeviceInfoWithSource {
	return {
		id: `openport2-serial:${port.path}`,
		name: `${port.friendlyName ?? "Tactrix OpenPort 2.0"} (Serial)`,
		transportName: "openport2",
		connected: false,
		source: "serial",
	};
}

function compareSerialPortPreference(
	left: SerialPortInfoLike,
	right: SerialPortInfoLike,
): number {
	const leftIsCallout = left.path.includes("/dev/cu.");
	const rightIsCallout = right.path.includes("/dev/cu.");
	if (leftIsCallout !== rightIsCallout) {
		return leftIsCallout ? -1 : 1;
	}
	return left.path.localeCompare(right.path);
}

function encodeCanId(canId: number): Uint8Array {
	return Uint8Array.of(
		(canId >>> 24) & 0xff,
		(canId >>> 16) & 0xff,
		(canId >>> 8) & 0xff,
		canId & 0xff,
	);
}

function decodeCanIdHeader(data: Uint8Array): number | null {
	if (data.length < 4) {
		return null;
	}
	return (
		((data[0] ?? 0) << 24) |
		((data[1] ?? 0) << 16) |
		((data[2] ?? 0) << 8) |
		(data[3] ?? 0)
	);
}

function hasKnownCanHeader(data: Uint8Array): boolean {
	const canId = decodeCanIdHeader(data);
	return canId === DEFAULT_TESTER_CAN_ID || canId === DEFAULT_ECU_CAN_ID;
}

function wrapIso15765Payload(data: Uint8Array): Uint8Array {
	if (hasKnownCanHeader(data)) {
		return data;
	}
	const header = encodeCanId(DEFAULT_TESTER_CAN_ID);
	const wrapped = new Uint8Array(header.length + data.length);
	wrapped.set(header, 0);
	wrapped.set(data, header.length);
	return wrapped;
}

function unwrapIso15765Payload(data: Uint8Array): Uint8Array {
	if (!hasKnownCanHeader(data)) {
		return data;
	}
	return data.slice(4);
}

/**
 * An open, active connection to a Tactrix OpenPort 2.0 device.
 * Extends DeviceConnection with OpenPort 2.0-specific AT command methods.
 */
export class OpenPort2Connection implements DeviceConnection {
	readonly deviceInfo: DeviceInfo;
	private readonly interfaceNumber: number;
	private readonly endpointIn: number;
	private readonly endpointOut: number;

	private readonly device: USBDevice;
	private channelId: number | null = null;
	private streamActive = false;
	private streamAbortController: AbortController | null = null;

	constructor(
		device: USBDevice,
		deviceInfo: DeviceInfo,
		interfaceInfo: EndpointDescriptor,
	) {
		this.device = device;
		this.deviceInfo = deviceInfo;
		this.interfaceNumber = interfaceInfo.interfaceNumber;
		this.endpointIn = interfaceInfo.endpointIn;
		this.endpointOut = interfaceInfo.endpointOut;
	}

	/**
	 * Write raw bytes to the device via bulk OUT endpoint, then read a response.
	 *
	 * @param data      - Raw bytes to send
	 * @param timeoutMs - Read timeout in milliseconds
	 */
	async sendFrame(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
		const effectiveTimeout = timeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
		const channelId = this.channelId ?? ISO15765_PROTOCOL_ID;
		await this.writeMessage(channelId, wrapIso15765Payload(data), 0);
		const response = await this.readProtocolMessage(effectiveTimeout);
		return unwrapIso15765Payload(response);
	}

	/**
	 * Read a single USB packet from the device.
	 */
	private async readUsbPacket(timeoutMs: number, maxLength = 64): Promise<Uint8Array> {
		const result = await withTimeout(
			this.device.transferIn(this.endpointIn, maxLength),
			timeoutMs,
			`OpenPort 2.0 read timed out after ${timeoutMs}ms`,
		);
		if (result.data == null) {
			return new Uint8Array(0);
		}
		return new Uint8Array(result.data.buffer);
	}

	/**
	 * Read a single frame from the device via bulk IN endpoint.
	 *
	 * @param maxLength - Maximum number of bytes to read
	 */
	async receiveFrame(maxLength: number): Promise<Uint8Array> {
		return this.readUsbPacket(DEFAULT_FRAME_TIMEOUT_MS, maxLength);
	}

	/**
	 * Start receiving frames asynchronously until stopStream() is called.
	 *
	 * @param onFrame - Callback invoked for each received frame
	 */
	startStream(onFrame: (frame: Uint8Array) => void): void {
		this.streamActive = true;
		this.streamAbortController = new AbortController();
		const signal = this.streamAbortController.signal;

		const poll = async (): Promise<void> => {
			while (this.streamActive && !signal.aborted) {
				try {
					const frame = await this.receiveFrame(512);
					if (frame.length > 0) {
						onFrame(frame);
					}
				} catch {
					// Stop streaming on error
					this.streamActive = false;
				}
			}
		};

		void poll();
	}

	/** Stop the active stream started by startStream(). */
	stopStream(): void {
		this.streamActive = false;
		this.streamAbortController?.abort();
		this.streamAbortController = null;
	}

	/**
	 * Send an AT command string encoded as UTF-8.
	 *
	 * @param cmd - AT command string (e.g. "ati\r\n")
	 */
	async sendAtCommand(cmd: string): Promise<void> {
		const encoder = new TextEncoder();
		const data = encoder.encode(cmd);
		await this.device.transferOut(this.endpointOut, data);
	}

	/**
	 * Send an adapter command and wait for either an explicit token or generic
	 * `aro\r\n` acknowledgement, matching the reference J2534 implementation.
	 */
	private async sendExpect(
		cmd: string,
		expect: string | null,
		timeoutMs = ADAPTER_COMMAND_TIMEOUT_MS,
	): Promise<string> {
		await this.sendAtCommand(cmd);

		const decoder = new TextDecoder();
		let response = "";
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const remaining = Math.max(1, deadline - Date.now());
			const chunk = await this.readUsbPacket(remaining);
			if (chunk.length === 0) {
				continue;
			}
			response += decoder.decode(chunk);
			if (expect != null) {
				if (response.includes(expect)) {
					return response;
				}
			} else if (response.includes("aro\r\n")) {
				return response;
			}
		}

		throw new Error(
			expect != null
				? `OpenPort 2.0 did not return expected response: ${expect}`
				: "OpenPort 2.0 command acknowledgement timed out",
		);
	}

	/**
	 * Drain any pending adapter console output emitted during AT initialization.
	 */
	private async drainPendingInput(): Promise<void> {
		for (let i = 0; i < ADAPTER_DRAIN_MAX_READS; i += 1) {
			try {
				const result = await withTimeout(
					this.device.transferIn(this.endpointIn, 64),
					ADAPTER_DRAIN_TIMEOUT_MS,
					"adapter drain timeout",
				);
				if (result.data == null || result.data.byteLength === 0) {
					return;
				}
			} catch {
				return;
			}
		}
	}

	/**
	 * Initialize the OpenPort 2.0 device by sending identification and
	 * connect AT commands.
	 *
	 * Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L470
	 */
	async initialize(): Promise<void> {
		await this.sendExpect("\r\n\r\nati\r\n", "ari ");
		await this.sendExpect("ata\r\n", null);
		await this.drainPendingInput();
		this.channelId = await this.openChannel(
			ISO15765_PROTOCOL_ID,
			ISO15765_DEFAULT_FLAGS,
			ISO15765_DEFAULT_BAUD,
		);
		await this.startMessageFilter(
			this.channelId,
			ISO15765_FLOW_CONTROL_FILTER,
			encodeCanId(CAN_ID_MASK_11BIT),
			encodeCanId(DEFAULT_ECU_CAN_ID),
			encodeCanId(DEFAULT_TESTER_CAN_ID),
		);
	}

	/**
	 * Open a J2534 channel on the device.
	 *
	 * Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L540
	 *
	 * @param protocol - J2534 protocol ID (e.g. 6 for ISO15765)
	 * @param flags    - Protocol-specific flags
	 * @param baud     - Baud rate (e.g. 500000)
	 * @returns The assigned channel ID
	 */
	async openChannel(
		protocol: number,
		flags: number,
		baud: number,
	): Promise<number> {
		await this.sendExpect(`ato${protocol} ${flags} ${baud} 0\r\n`, null);
		return protocol;
	}

	async startMessageFilter(
		channelId: number,
		filterType: number,
		mask: Uint8Array,
		pattern: Uint8Array,
		flowControl: Uint8Array,
	): Promise<void> {
		const encoder = new TextEncoder();
		const header = encoder.encode(
			`atf${channelId} ${filterType} 0 ${mask.length}\r\n`,
		);
		const combined = new Uint8Array(
			header.length + mask.length + pattern.length + flowControl.length,
		);
		let offset = 0;
		combined.set(header, offset);
		offset += header.length;
		combined.set(mask, offset);
		offset += mask.length;
		combined.set(pattern, offset);
		offset += pattern.length;
		combined.set(flowControl, offset);

		await this.device.transferOut(this.endpointOut, combined);

		const decoder = new TextDecoder();
		let response = "";
		const deadline = Date.now() + ADAPTER_COMMAND_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const remaining = Math.max(1, deadline - Date.now());
			const chunk = await this.readUsbPacket(remaining);
			if (chunk.length === 0) {
				continue;
			}
			response += decoder.decode(chunk);
			if (response.includes("arf")) {
				return;
			}
		}
		throw new Error("OpenPort 2.0 filter configuration timed out");
	}

	/**
	 * Write a message to an open channel.
	 *
	 * Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L700
	 *
	 * @param channelId - Channel ID returned by openChannel()
	 * @param data      - Message payload bytes
	 * @param flags     - Message flags
	 */
	async writeMessage(
		channelId: number,
		data: Uint8Array,
		flags: number,
	): Promise<void> {
		const encoder = new TextEncoder();
		const header = encoder.encode(
			`att${channelId} ${data.length} ${flags}\r\n`,
		);
		// Combine header and data into a single plain ArrayBuffer-backed Uint8Array
		const combined = new Uint8Array(header.length + data.length);
		combined.set(header, 0);
		combined.set(data, header.length);
		await this.device.transferOut(this.endpointOut, combined);
	}

	/**
	 * Read and decode protocol messages wrapped in the adapter's `AR...` format.
	 * This is a minimal ISO15765 parser based on the reference J2534 source.
	 */
	private async readProtocolMessage(timeoutMs: number): Promise<Uint8Array> {
		const startedAt = Date.now();
		let payload = new Uint8Array(0);

		while (Date.now() - startedAt < timeoutMs) {
			const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
			const chunk = await this.readUsbPacket(remaining);
			if (chunk.length === 0) {
				continue;
			}

			let offset = 0;
			while (offset + 5 <= chunk.length) {
				if (chunk[offset] !== 0x61 || chunk[offset + 1] !== 0x72) {
					offset += 1;
					continue;
				}

				const channelCode = chunk[offset + 2];
				const packetLength = chunk[offset + 3] ?? 0;
				const packetType = chunk[offset + 4] ?? 0;
				const packetTotalLength = packetLength + 4;
				if (packetTotalLength <= 0 || offset + packetTotalLength > chunk.length) {
					break;
				}

				if (channelCode === 0x6f) {
					offset += 5;
					continue;
				}

				if (channelCode !== ISO15765_CHANNEL_CODE) {
					offset += packetTotalLength;
					continue;
				}

				const packetPayloadLength = Math.max(0, packetLength - 5);
				const payloadStart = offset + 9;
				const payloadEnd = Math.min(
					payloadStart + packetPayloadLength,
					offset + packetTotalLength,
				);
				const packetPayload = chunk.slice(payloadStart, payloadEnd);

				if (
					packetType === PACKET_NORMAL_START ||
					packetType === PACKET_NORMAL ||
					packetType === PACKET_RX_END
				) {
					const combined = new Uint8Array(payload.length + packetPayload.length);
					combined.set(payload, 0);
					combined.set(packetPayload, payload.length);
					payload = combined;
				}

				offset += packetTotalLength;

				if (packetType === PACKET_RX_END) {
					return payload;
				}
				if (packetType === PACKET_TX_DONE && payload.length === 0) {
					continue;
				}
			}
		}

		throw new Error(`OpenPort 2.0 read timed out after ${timeoutMs}ms`);
	}

	/**
	 * Release the USB interface and close the device.
	 */
	async disconnect(): Promise<void> {
		this.stopStream();
		if (this.channelId != null) {
			try {
				await this.sendExpect(`atc${this.channelId}\r\n`, null);
			} catch {
				// Ignore channel-close failures during shutdown.
			}
			this.channelId = null;
		}
		await this.device.releaseInterface(this.interfaceNumber);
		await this.device.close();
	}

	/** Alias for disconnect() to satisfy DeviceConnection interface. */
	async close(): Promise<void> {
		await this.disconnect();
	}
}

/**
 * An open, active connection to a Tactrix OpenPort 2.0 device using WebHID.
 */
class OpenPort2HidConnection implements DeviceConnection {
	readonly deviceInfo: DeviceInfo;
	private readonly device: HidDeviceLike;
	private readonly outputReportId: number;
	private streamAbortController: AbortController | null = null;
	private closed = false;
	private readonly frameQueue: Uint8Array[] = [];
	private readonly frameWaiters: Array<{
		resolve: (frame: Uint8Array) => void;
		reject: (error: unknown) => void;
	}> = [];
	private readonly inputReportListener = (
		event: HidInputReportEventLike,
	): void => {
		const payload = new Uint8Array(
			event.data.buffer,
			event.data.byteOffset,
			event.data.byteLength,
		);
		this.enqueueFrame(new Uint8Array(payload));
	};

	constructor(device: HidDeviceLike, deviceInfo: DeviceInfo) {
		this.device = device;
		this.deviceInfo = deviceInfo;
		this.outputReportId = this.resolveOutputReportId(device);
		this.device.addEventListener("inputreport", this.inputReportListener);
	}

	private resolveOutputReportId(device: HidDeviceLike): number {
		for (const collection of device.collections ?? []) {
			const reportId = collection.outputReports?.[0]?.reportId;
			if (reportId != null) {
				return reportId;
			}
		}
		return 0;
	}

	private enqueueFrame(frame: Uint8Array): void {
		const nextReader = this.frameWaiters.shift();
		if (nextReader != null) {
			nextReader.resolve(frame);
			return;
		}
		this.frameQueue.push(frame);
	}

	private popNextFrame(): Promise<Uint8Array> {
		if (this.frameQueue.length > 0) {
			return Promise.resolve(this.frameQueue.shift() ?? new Uint8Array(0));
		}

		return new Promise((resolve, reject) => {
			this.frameWaiters.push({ resolve, reject });
		});
	}

	/**
	 * Write raw bytes to the device via HID output report, then read a response.
	 */
	async sendFrame(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
		if (this.closed) {
			throw new Error("Device connection is closed");
		}
		const effectiveTimeout = timeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
		await this.device.sendReport(
			this.outputReportId,
			toPlainArrayBuffer(wrapIso15765Payload(data)),
		);
		return withTimeout(
			this.receiveFrame(64).then((frame) => unwrapIso15765Payload(frame)),
			effectiveTimeout,
			`OpenPort 2.0 HID read timed out after ${effectiveTimeout}ms`,
		);
	}

	/**
	 * Read a single frame from the device from the HID input-report queue.
	 */
	async receiveFrame(maxLength: number): Promise<Uint8Array> {
		if (this.closed) {
			throw new Error("Device connection is closed");
		}
		if (maxLength <= 0) {
			return new Uint8Array(0);
		}
		const frame = await this.popNextFrame();
		return frame.length > maxLength ? frame.slice(0, maxLength) : frame;
	}

	/**
	 * Start receiving frames asynchronously until stopStream() is called.
	 *
	 * @param onFrame - Callback invoked for each received frame
	 */
	startStream(onFrame: (frame: Uint8Array) => void): void {
		if (this.closed || this.streamAbortController != null) {
			return;
		}
		this.streamAbortController = new AbortController();
		const signal = this.streamAbortController.signal;

		const poll = async (): Promise<void> => {
			while (!signal.aborted) {
				try {
					const frame = await this.receiveFrame(512);
					if (frame.length > 0) {
						onFrame(frame);
					}
				} catch {
					return;
				}
			}
		};

		void poll();
	}

	/** Stop the active stream started by startStream(). */
	stopStream(): void {
		this.streamAbortController?.abort();
		this.streamAbortController = null;
	}

	/**
	 * Release the HID device and close it.
	 */
	async disconnect(): Promise<void> {
		this.closed = true;
		this.stopStream();
		for (const waiter of this.frameWaiters) {
			waiter.reject(new Error("Device connection closed"));
		}
		this.frameWaiters.length = 0;
		this.device.removeEventListener("inputreport", this.inputReportListener);
		await this.device.close();
	}

	/** Alias for disconnect() to satisfy DeviceConnection interface. */
	async close(): Promise<void> {
		await this.disconnect();
	}
}

class OpenPort2SerialConnection implements DeviceConnection {
	readonly deviceInfo: DeviceInfo;
	private readonly port: SerialPortLike;
	private channelId: number | null = null;
	private streamActive = false;
	private streamAbortController: AbortController | null = null;

	constructor(port: SerialPortLike, deviceInfo: DeviceInfo) {
		this.port = port;
		this.deviceInfo = deviceInfo;
	}

	async sendFrame(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
		const effectiveTimeout = timeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
		const channelId = this.channelId ?? ISO15765_PROTOCOL_ID;
		await this.writeMessage(channelId, wrapIso15765Payload(data), 0);
		const response = await this.readProtocolMessage(effectiveTimeout);
		return unwrapIso15765Payload(response);
	}

	async receiveFrame(maxLength: number): Promise<Uint8Array> {
		return this.port.read(maxLength, DEFAULT_FRAME_TIMEOUT_MS);
	}

	startStream(onFrame: (frame: Uint8Array) => void): void {
		this.streamActive = true;
		this.streamAbortController = new AbortController();
		const signal = this.streamAbortController.signal;

		const poll = async (): Promise<void> => {
			while (this.streamActive && !signal.aborted) {
				try {
					const frame = await this.receiveFrame(512);
					if (frame.length > 0) {
						onFrame(frame);
					}
				} catch {
					this.streamActive = false;
				}
			}
		};

		void poll();
	}

	stopStream(): void {
		this.streamActive = false;
		this.streamAbortController?.abort();
		this.streamAbortController = null;
	}

	async sendAtCommand(cmd: string): Promise<void> {
		const encoder = new TextEncoder();
		await this.port.write(encoder.encode(cmd));
	}

	private async sendExpect(
		cmd: string,
		expect: string | null,
		timeoutMs = ADAPTER_COMMAND_TIMEOUT_MS,
	): Promise<string> {
		await this.sendAtCommand(cmd);

		const decoder = new TextDecoder();
		let response = "";
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const remaining = Math.max(1, deadline - Date.now());
			const chunk = await this.port.read(256, remaining);
			if (chunk.length === 0) {
				continue;
			}
			response += decoder.decode(chunk);
			if (expect != null) {
				if (response.includes(expect)) {
					return response;
				}
			} else if (response.includes("aro\r\n")) {
				return response;
			}
		}

		throw new Error(
			expect != null
				? `OpenPort 2.0 did not return expected response: ${expect}`
				: "OpenPort 2.0 command acknowledgement timed out",
		);
	}

	private async drainPendingInput(): Promise<void> {
		for (let i = 0; i < ADAPTER_DRAIN_MAX_READS; i += 1) {
			try {
				const chunk = await this.port.read(64, ADAPTER_DRAIN_TIMEOUT_MS);
				if (chunk.length === 0) {
					return;
				}
			} catch {
				return;
			}
		}
	}

	async initialize(): Promise<void> {
		await this.sendExpect("\r\n\r\nati\r\n", "ari ");
		await this.sendExpect("ata\r\n", null);
		await this.drainPendingInput();
		this.channelId = await this.openChannel(
			ISO15765_PROTOCOL_ID,
			ISO15765_DEFAULT_FLAGS,
			ISO15765_DEFAULT_BAUD,
		);
		await this.startMessageFilter(
			this.channelId,
			ISO15765_FLOW_CONTROL_FILTER,
			encodeCanId(CAN_ID_MASK_11BIT),
			encodeCanId(DEFAULT_ECU_CAN_ID),
			encodeCanId(DEFAULT_TESTER_CAN_ID),
		);
	}

	async openChannel(
		protocol: number,
		flags: number,
		baud: number,
	): Promise<number> {
		await this.sendExpect(`ato${protocol} ${flags} ${baud} 0\r\n`, null);
		return protocol;
	}

	async startMessageFilter(
		channelId: number,
		filterType: number,
		mask: Uint8Array,
		pattern: Uint8Array,
		flowControl: Uint8Array,
	): Promise<void> {
		const encoder = new TextEncoder();
		const header = encoder.encode(
			`atf${channelId} ${filterType} 0 ${mask.length}\r\n`,
		);
		const combined = new Uint8Array(
			header.length + mask.length + pattern.length + flowControl.length,
		);
		let offset = 0;
		combined.set(header, offset);
		offset += header.length;
		combined.set(mask, offset);
		offset += mask.length;
		combined.set(pattern, offset);
		offset += pattern.length;
		combined.set(flowControl, offset);

		await this.port.write(combined);

		const decoder = new TextDecoder();
		let response = "";
		const deadline = Date.now() + ADAPTER_COMMAND_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const remaining = Math.max(1, deadline - Date.now());
			const chunk = await this.port.read(256, remaining);
			if (chunk.length === 0) {
				continue;
			}
			response += decoder.decode(chunk);
			if (response.includes("arf")) {
				return;
			}
		}
		throw new Error("OpenPort 2.0 filter configuration timed out");
	}

	async writeMessage(
		channelId: number,
		data: Uint8Array,
		flags: number,
	): Promise<void> {
		const encoder = new TextEncoder();
		const header = encoder.encode(
			`att${channelId} ${data.length} ${flags}\r\n`,
		);
		const combined = new Uint8Array(header.length + data.length);
		combined.set(header, 0);
		combined.set(data, header.length);
		await this.port.write(combined);
	}

	private async readProtocolMessage(timeoutMs: number): Promise<Uint8Array> {
		const startedAt = Date.now();
		let payload = new Uint8Array(0);

		while (Date.now() - startedAt < timeoutMs) {
			const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
			const chunk = await this.port.read(256, remaining);
			if (chunk.length === 0) {
				continue;
			}

			let offset = 0;
			while (offset + 5 <= chunk.length) {
				if (chunk[offset] !== 0x61 || chunk[offset + 1] !== 0x72) {
					offset += 1;
					continue;
				}

				const channelCode = chunk[offset + 2];
				const packetLength = chunk[offset + 3] ?? 0;
				const packetType = chunk[offset + 4] ?? 0;
				const packetTotalLength = packetLength + 4;
				if (packetTotalLength <= 0 || offset + packetTotalLength > chunk.length) {
					break;
				}

				if (channelCode === 0x6f) {
					offset += 5;
					continue;
				}

				if (channelCode !== ISO15765_CHANNEL_CODE) {
					offset += packetTotalLength;
					continue;
				}

				const packetPayloadLength = Math.max(0, packetLength - 5);
				const payloadStart = offset + 9;
				const payloadEnd = Math.min(
					payloadStart + packetPayloadLength,
					offset + packetTotalLength,
				);
				const packetPayload = chunk.slice(payloadStart, payloadEnd);

				if (
					packetType === PACKET_NORMAL_START ||
					packetType === PACKET_NORMAL ||
					packetType === PACKET_RX_END
				) {
					const combined = new Uint8Array(payload.length + packetPayload.length);
					combined.set(payload, 0);
					combined.set(packetPayload, payload.length);
					payload = combined;
				}

				offset += packetTotalLength;

				if (packetType === PACKET_RX_END) {
					return payload;
				}
				if (packetType === PACKET_TX_DONE && payload.length === 0) {
					continue;
				}
			}
		}

		throw new Error(`OpenPort 2.0 read timed out after ${timeoutMs}ms`);
	}

	async disconnect(): Promise<void> {
		this.stopStream();
		if (this.channelId != null) {
			try {
				await this.sendExpect(`atc${this.channelId}\r\n`, null);
			} catch {
				// Ignore channel-close failures during shutdown.
			}
			this.channelId = null;
		}
		await this.port.close();
	}

	async close(): Promise<void> {
		await this.disconnect();
	}
}

/**
 * DeviceTransport implementation for the Tactrix OpenPort 2.0 USB interface.
 * Uses WebUSB first and falls back to WebHID for environments where USB claims
 * are blocked by host ownership.
 *
 * Supports injecting custom USB/HID interfaces for non-browser environments.
 */
export class OpenPort2Transport implements DeviceTransport {
	readonly name = "Tactrix OpenPort 2.0";
	private readonly usb: USB | undefined;
	private readonly hid: HidLike | undefined;
	private readonly serial: SerialLike | undefined;

	/**
	 * Creates a new OpenPort2Transport.
	 *
	 * @param options - Optional configuration options
	 * @param options.usb - Custom USB interface. Defaults to navigator.usb.
	 * @param options.hid - Custom HID interface. Defaults to navigator.hid.
	 */
	constructor(options?: OpenPort2TransportOptions) {
		const navigatorRef: { usb?: USB; hid?: HidLike } | undefined =
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
			globalThis.navigator;
		this.usb = options?.usb ?? navigatorRef?.usb;
		this.hid = options?.hid ?? navigatorRef?.hid;
		this.serial = options?.serial;
	}

	/**
	 * Return all previously-granted OpenPort 2.0 devices from USB and HID.
	 * Does NOT trigger browser pickers.
	 */
	async listDevices(): Promise<DeviceInfo[]> {
		const seen = new Set<string>();
		const devices: DeviceInfoWithSource[] = [];

		if (this.usb?.getDevices != null) {
			const usbDevices = await this.usb.getDevices();
			for (const device of usbDevices) {
				if (device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID) {
					const info = usbDeviceToInfo(device);
					if (!seen.has(info.id)) {
						seen.add(info.id);
						devices.push(info);
					}
				}
			}
		}

		if (this.hid?.getDevices != null) {
			const hidDevices = await this.hid.getDevices();
			for (const device of hidDevices) {
				if (device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID) {
					const info = hidDeviceToInfo(device);
					if (!seen.has(info.id)) {
						seen.add(info.id);
						devices.push(info);
					}
				}
			}
		}

		if (this.serial != null) {
			const serialPorts = [...(await this.serial.listPorts())].sort(
				compareSerialPortPreference,
			);
			for (const port of serialPorts) {
				if (!isMatchingSerialPort(port)) {
					continue;
				}
				const info = serialPortToInfo(port);
				if (!seen.has(info.id)) {
					seen.add(info.id);
					devices.push(info);
				}
			}
		}

		return devices.map((entry) => {
			const { source: _source, ...deviceInfo } = entry;
			return deviceInfo;
		});
	}

	/**
	 * Trigger WebUSB picker (if available), otherwise WebHID picker.
	 * Returns the DeviceInfo for the selected device.
	 */
	async requestDevice(): Promise<DeviceInfo> {
		if (this.usb?.requestDevice != null) {
			try {
				const device = await this.usb.requestDevice({
					filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }],
				});
				return usbDeviceToInfo(device);
			} catch {
				// Fall back to WebHID selector
			}
		}

		if (this.hid?.requestDevice != null) {
			const devices = await this.hid.requestDevice({
				filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }],
			});
			const device = devices.at(0);
			if (device == null) {
				throw new Error("No OpenPort 2.0 HID device selected");
			}
			return hidDeviceToInfo(device);
		}

		if (this.serial != null) {
			const serialPorts = [...(await this.serial.listPorts())].sort(
				compareSerialPortPreference,
			);
			const port = serialPorts.find((entry) => isMatchingSerialPort(entry));
			if (port != null) {
				const info = serialPortToInfo(port);
				const { source: _source, ...deviceInfo } = info;
				return deviceInfo;
			}
		}

		throw new Error("No USB or HID transport APIs available");
	}

	/**
	 * Open a connection to the device identified by deviceId.
	 * Claims USB interface 0 and returns a transport connection. If that fails due
	 * host ownership, falls back to WebHID when possible.
	 *
	 * @param deviceId - The id field from DeviceInfo (format: "openport2:<serial>")
	 */
	async connect(deviceId: string): Promise<DeviceConnection> {
		if (deviceId.startsWith("openport2-serial:")) {
			const serialConnection = await this.connectViaSerial(deviceId);
			if (serialConnection != null) {
				return serialConnection;
			}
			throw new Error(`OpenPort 2.0 device not found: ${deviceId}`);
		}

		let usbError: unknown = null;

		if (this.usb?.getDevices != null) {
			try {
				const usbDevices = await this.usb.getDevices();
				const device = usbDevices.find(
					(d) =>
						d.vendorId === VENDOR_ID &&
						d.productId === PRODUCT_ID &&
						usbDeviceToInfo(d).id === deviceId,
				);

				if (device != null) {
					await device.open();
					const interfaceInfo = this.findInterface(device);
					await device.claimInterface(interfaceInfo.interfaceNumber);
					const deviceInfo = usbDeviceToInfo(device);
					return new OpenPort2Connection(device, deviceInfo, interfaceInfo);
				}
			} catch (error) {
				usbError = error;
			}
		}

		if (this.hid?.getDevices != null) {
			const hidConnection = await this.connectViaHid(deviceId);
			if (hidConnection != null) {
				return hidConnection;
			}
		}

		if (this.serial != null) {
			const serialConnection = await this.connectViaSerial(deviceId);
			if (serialConnection != null) {
				return serialConnection;
			}
		}

		if (usbError != null) {
			throw usbError;
		}

		throw new Error(`OpenPort 2.0 device not found: ${deviceId}`);
	}

	/**
	 * Attempt to connect with the WebHID API using the same device ID.
	 */
	private async connectViaHid(
		deviceId: string,
	): Promise<DeviceConnection | null> {
		if (this.hid == null) {
			return null;
		}

		const hidDevices = await this.hid.getDevices();
		const hidDevice = hidDevices.find(
			(d) =>
				d.vendorId === VENDOR_ID &&
				d.productId === PRODUCT_ID &&
				hidDeviceToInfo(d).id === deviceId,
		);
		if (hidDevice == null) {
			return null;
		}

		if (!hidDevice.opened) {
			await hidDevice.open();
		}
		return new OpenPort2HidConnection(hidDevice, hidDeviceToInfo(hidDevice));
	}

	private async connectViaSerial(
		deviceId: string,
	): Promise<DeviceConnection | null> {
		if (this.serial == null) {
			return null;
		}

		const serialPorts = [...(await this.serial.listPorts())].sort(
			compareSerialPortPreference,
		);
		const portInfo = serialPorts.find(
			(entry) =>
				isMatchingSerialPort(entry) && serialPortToInfo(entry).id === deviceId,
		);
		if (portInfo == null) {
			return null;
		}

		const port = await this.serial.openPort(portInfo.path);
		if (!port.isOpen) {
			await port.open();
		}
		return new OpenPort2SerialConnection(port, serialPortToInfo(portInfo));
	}

	/**
	 * Detect the USB interface and endpoints used for OpenPort 2.0 bulk transfer.
	 *
	 * @param device - OpenPort USB device
	 */
	private findInterface(device: USBDevice): EndpointDescriptor {
		const nodeLikeDevice = device as NodeLikeUsbDevice;
		const nodeLikeInterfaces = nodeLikeDevice.interfaces;
		if (Array.isArray(nodeLikeInterfaces) && nodeLikeInterfaces.length > 0) {
			for (const intf of nodeLikeInterfaces) {
				const endpoints = intf.endpoints ?? [];
				const inEndpoint = endpoints.find(
					(e: NodeLikeUsbEndpoint) => e.direction === "in",
				);
				const outEndpoint = endpoints.find(
					(e: NodeLikeUsbEndpoint) => e.direction === "out",
				);
				if (inEndpoint != null && outEndpoint != null) {
					return {
						interfaceNumber: intf.interfaceNumber ?? 0,
						endpointIn: Number(inEndpoint.address),
						endpointOut: Number(outEndpoint.address),
					};
				}
			}
		}

		const configured = device.configuration;
		const webUsbInterfaces = configured?.interfaces;
		if (!Array.isArray(webUsbInterfaces)) {
			return {
				interfaceNumber: 0,
				endpointIn: DEFAULT_ENDPOINT_IN,
				endpointOut: DEFAULT_ENDPOINT_OUT,
			};
		}

		for (const iface of webUsbInterfaces as readonly WebUsbInterfaceDescriptor[]) {
			const alt = iface.alternate ?? iface.alternateSettings?.at(0);
			if (alt == null) {
				continue;
			}
			const inEndpoint = alt.endpoints?.find((e) => e.direction === "in");
			const outEndpoint = alt.endpoints?.find((e) => e.direction === "out");
			if (inEndpoint != null && outEndpoint != null) {
				return {
					interfaceNumber: iface.interfaceNumber,
					endpointIn: Number(inEndpoint.endpointNumber),
					endpointOut: Number(outEndpoint.endpointNumber),
				};
			}
		}

		return {
			interfaceNumber: 0,
			endpointIn: DEFAULT_ENDPOINT_IN,
			endpointOut: DEFAULT_ENDPOINT_OUT,
		};
	}
}
