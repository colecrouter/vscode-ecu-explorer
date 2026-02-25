import type {
	DeviceConnection,
	DeviceInfo,
	DeviceTransport,
} from "@ecu-explorer/device";

// Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L1
// USB vendor/product IDs for OpenPort 2.0
const VENDOR_ID = 0x0403;
const PRODUCT_ID = 0xcc4d;

// Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L310
// USB bulk transfer endpoint addresses
const ENDPOINT_IN = 0x81;
const ENDPOINT_OUT = 0x02;

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
 * Converts a USBDevice to a DeviceInfo object.
 */
function usbDeviceToInfo(device: USBDevice): DeviceInfo {
	const serial = device.serialNumber ?? "unknown";
	return {
		id: `openport2:${serial}`,
		name: device.productName ?? "Tactrix OpenPort 2.0",
		transportName: "openport2",
		connected: device.opened,
	};
}

/**
 * An open, active connection to a Tactrix OpenPort 2.0 device.
 * Extends DeviceConnection with OpenPort 2.0-specific AT command methods.
 */
export class OpenPort2Connection implements DeviceConnection {
	readonly deviceInfo: DeviceInfo;

	private readonly device: USBDevice;
	private streamActive = false;
	private streamAbortController: AbortController | null = null;

	constructor(device: USBDevice, deviceInfo: DeviceInfo) {
		this.device = device;
		this.deviceInfo = deviceInfo;
	}

	/**
	 * Write raw bytes to the device via bulk OUT endpoint, then read a response.
	 *
	 * @param data      - Raw bytes to send
	 * @param _timeoutMs - Unused; reserved for future timeout support
	 */
	async sendFrame(data: Uint8Array, _timeoutMs?: number): Promise<Uint8Array> {
		await this.device.transferOut(ENDPOINT_OUT, toPlainArrayBuffer(data));
		// After sending, read the response
		const result = await this.device.transferIn(ENDPOINT_IN, 64);
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
		const result = await this.device.transferIn(ENDPOINT_IN, maxLength);
		if (result.data == null) {
			return new Uint8Array(0);
		}
		return new Uint8Array(result.data.buffer);
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
		await this.device.transferOut(ENDPOINT_OUT, data);
	}

	/**
	 * Initialize the OpenPort 2.0 device by sending identification and
	 * connect AT commands.
	 *
	 * Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L470
	 */
	async initialize(): Promise<void> {
		await this.sendAtCommand("ati\r\n");
		await this.sendAtCommand("ata\r\n");
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
		await this.sendAtCommand(`oto${protocol} ${flags} ${baud}\r\n`);
		// Read back the channel ID from the device response
		const response = await this.receiveFrame(64);
		const text = new TextDecoder().decode(response).trim();
		const channelId = parseInt(text, 10);
		return isNaN(channelId) ? 0 : channelId;
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
		await this.device.transferOut(ENDPOINT_OUT, combined);
	}

	/**
	 * Release the USB interface and close the device.
	 */
	async disconnect(): Promise<void> {
		this.stopStream();
		await this.device.releaseInterface(0);
		await this.device.close();
	}

	/** Alias for disconnect() to satisfy DeviceConnection interface. */
	async close(): Promise<void> {
		await this.disconnect();
	}
}

/**
 * DeviceTransport implementation for the Tactrix OpenPort 2.0 USB interface.
 * Uses the WebUSB API (navigator.usb) to enumerate and connect to devices.
 */
export class OpenPort2Transport implements DeviceTransport {
	readonly name = "Tactrix OpenPort 2.0";

	/**
	 * Return all previously-granted OpenPort 2.0 devices.
	 * Does NOT trigger the browser USB picker.
	 */
	async listDevices(): Promise<DeviceInfo[]> {
		const devices = await navigator.usb.getDevices();
		return devices
			.filter((d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID)
			.map(usbDeviceToInfo);
	}

	/**
	 * Trigger the browser USB device picker filtered to OpenPort 2.0 devices.
	 * Returns the DeviceInfo for the selected device.
	 */
	async requestDevice(): Promise<DeviceInfo> {
		const device = await navigator.usb.requestDevice({
			filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }],
		});
		return usbDeviceToInfo(device);
	}

	/**
	 * Open a connection to the device identified by deviceId.
	 * Claims interface 0 and returns an OpenPort2Connection.
	 *
	 * @param deviceId - The id field from DeviceInfo (format: "openport2:<serial>")
	 */
	async connect(deviceId: string): Promise<OpenPort2Connection> {
		const devices = await navigator.usb.getDevices();
		const device = devices.find(
			(d) =>
				d.vendorId === VENDOR_ID &&
				d.productId === PRODUCT_ID &&
				usbDeviceToInfo(d).id === deviceId,
		);

		if (device == null) {
			throw new Error(`OpenPort 2.0 device not found: ${deviceId}`);
		}

		await device.open();
		await device.claimInterface(0);

		const deviceInfo = usbDeviceToInfo(device);
		return new OpenPort2Connection(device, deviceInfo);
	}
}
