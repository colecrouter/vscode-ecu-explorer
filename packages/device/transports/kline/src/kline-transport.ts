/**
 * K-line (ISO 14230 / KWP2000) transport for ECU communication
 * Implements DeviceTransport interface with ISO 14230 framing and flow control
 */

import type {
	DeviceConnection,
	DeviceInfo,
	DeviceTransport,
} from "@ecu-explorer/device";
import { FlowControlManager } from "./flow-control.js";
import { decodeFrame, encodeFrame } from "./iso14230-framing.js";
import type { FlowControlConfig, KLineHealth } from "./types.js";
import { FlowControlState } from "./types.js";

/**
 * Mock serial port for testing (in real implementation, use serial API or OpenPort J2534)
 */
interface MockSerialPort {
	write(data: Uint8Array): Promise<void>;
	read(maxLength: number): Promise<Uint8Array>;
	close(): Promise<void>;
	isOpen(): boolean;
}

/**
 * Mock serial device info
 */
interface MockSerialDeviceInfo {
	portPath: string;
	baudRate: number;
}

/**
 * K-line connection implementing DeviceConnection interface
 * Handles ISO 14230 framing, flow control, and error recovery
 */
export class KLineConnection implements DeviceConnection {
	readonly deviceInfo: DeviceInfo;

	private port: MockSerialPort | null = null;
	private flowControl: FlowControlManager;
	private receiveQueue: Uint8Array[] = [];
	private streamActive = false;
	private streamAbortController: AbortController | null = null;

	// Health tracking
	private health: KLineHealth = {
		framesSent: 0,
		framesReceived: 0,
		checksumErrors: 0,
		timeoutErrors: 0,
		retries: 0,
	};

	constructor(
		deviceInfo: DeviceInfo,
		port: MockSerialPort,
		flowControlConfig?: Partial<FlowControlConfig>,
	) {
		this.deviceInfo = deviceInfo;
		this.port = port;
		this.flowControl = new FlowControlManager(flowControlConfig);
	}

	/**
	 * Send a frame with ISO 14230 framing and flow control
	 * Handles CTS handshake, retries on timeout/checksum error
	 *
	 * @param data - Payload to send (1-7 bytes)
	 * @param timeoutMs - Override timeout in milliseconds
	 * @returns Response payload from ECU
	 */
	async sendFrame(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
		if (!this.port || !this.port.isOpen()) {
			throw new Error("K-line port not open");
		}

		if (data.length === 0 || data.length > 7) {
			throw new Error("K-line payload must be 1-7 bytes");
		}

		const effectiveTimeout = timeoutMs ?? 500;
		const maxRetries = this.flowControl.getMaxRetries();

		while (this.flowControl.getRetryCount() < maxRetries) {
			try {
				// Encode frame with PCI and checksum
				const frame = encodeFrame(data);

				// Send frame to K-line
				await this.port.write(frame);
				this.health.framesSent++;

				// Wait for CTS (0x00) byte
				const ctsResponse = await this.readWithTimeout(1, 100);
				if (ctsResponse.length === 0) {
					// CTS timeout
					this.health.timeoutErrors++;
					if (!this.flowControl.handleTimeout()) {
						throw new Error("CTS timeout - max retries exceeded");
					}
					continue;
				}

				if (ctsResponse[0] === 0x00) {
					this.flowControl.receivedCts();
				}

				// Now read the response frame
				const responseData = await this.readWithTimeout(64, effectiveTimeout);
				if (responseData.length === 0) {
					// Response timeout
					this.health.timeoutErrors++;
					if (!this.flowControl.handleTimeout()) {
						throw new Error("Response timeout - max retries exceeded");
					}
					continue;
				}

				// Decode response frame
				const decodedResponse = decodeFrame(responseData);
				if (!decodedResponse.isValid) {
					this.health.checksumErrors++;
					if (!this.flowControl.handleTimeout()) {
						throw new Error("Invalid checksum - max retries exceeded");
					}
					continue;
				}

				// Success - extract payload and return
				this.health.framesReceived++;
				this.flowControl.transitionToIdle();
				return decodedResponse.payload;
			} catch (error) {
				this.health.retries++;
				this.flowControl.error();

				if (this.flowControl.getRetryCount() >= maxRetries) {
					throw error;
				}

				// Reset for next attempt
				if (this.flowControl.retry()) {
					continue;
				}

				throw error;
			}
		}

		throw new Error("K-line transaction failed - max retries exceeded");
	}

	/**
	 * Start streaming frames asynchronously
	 * Not fully implemented for Phase 1 - placeholder for Phase 2
	 *
	 * @param onFrame - Callback for each received frame
	 */
	startStream(onFrame: (frame: Uint8Array) => void): void {
		this.streamActive = true;
		this.streamAbortController = new AbortController();
		const signal = this.streamAbortController.signal;

		const poll = async (): Promise<void> => {
			while (this.streamActive && !signal.aborted) {
				try {
					if (this.receiveQueue.length > 0) {
						const frame = this.receiveQueue.shift();
						if (frame) {
							onFrame(frame);
						}
					}

					// Sleep to avoid busy-waiting
					await new Promise((resolve) => setTimeout(resolve, 10));
				} catch {
					this.streamActive = false;
				}
			}
		};

		void poll();
	}

	/** Stop the active stream */
	stopStream(): void {
		this.streamActive = false;
		this.streamAbortController?.abort();
		this.streamAbortController = null;
	}

	/**
	 * Close the K-line connection
	 */
	async close(): Promise<void> {
		this.stopStream();
		this.flowControl.dispose();

		if (this.port && this.port.isOpen()) {
			await this.port.close();
		}

		this.port = null;
	}

	/**
	 * Get health statistics
	 */
	getHealth(): KLineHealth {
		return { ...this.health };
	}

	/**
	 * Reset health statistics
	 */
	resetHealth(): void {
		this.health = {
			framesSent: 0,
			framesReceived: 0,
			checksumErrors: 0,
			timeoutErrors: 0,
			retries: 0,
		};
	}

	/**
	 * Read from port with timeout
	 *
	 * @param maxLength - Maximum bytes to read
	 * @param timeoutMs - Timeout in milliseconds
	 * @returns Data read, or empty array on timeout
	 */
	private async readWithTimeout(
		maxLength: number,
		timeoutMs: number,
	): Promise<Uint8Array> {
		if (!this.port) {
			return new Uint8Array(0);
		}

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				resolve(new Uint8Array(0)); // Timeout
			}, timeoutMs);

			this.port!.read(maxLength)
				.then((data) => {
					clearTimeout(timer);
					resolve(data);
				})
				.catch(() => {
					clearTimeout(timer);
					resolve(new Uint8Array(0));
				});
		});
	}
}

/**
 * K-line transport implementing DeviceTransport interface
 * Provides device enumeration and connection management for ISO 14230 K-line
 *
 * Note: In Phase 1, this uses mock serial ports. Phase 2 will integrate with:
 * - OpenPort 2.0 USB via J2534 API
 * - Native serial port (for Linux/Mac)
 * - WebUSB API (for browser-based extensions)
 */
export class KLineTransport implements DeviceTransport {
	readonly name = "K-Line (ISO 14230)";

	/** Mock devices for testing (in real implementation, enumerate from hardware) */
	private mockDevices: Map<string, MockSerialDeviceInfo> = new Map();

	constructor() {
		// Register a mock device for testing
		// In production, this would scan actual hardware
		this.mockDevices.set("kline:mock:01", {
			portPath: "/dev/ttyUSB0",
			baudRate: 10400, // ISO 14230 standard baud rate
		});
	}

	/**
	 * List available K-line devices
	 * In Phase 1, returns mock device. Phase 2 will scan real hardware.
	 */
	async listDevices(): Promise<DeviceInfo[]> {
		const devices: DeviceInfo[] = [];

		this.mockDevices.forEach((info, id) => {
			devices.push({
				id,
				name: `K-Line Device (${info.portPath} @ ${info.baudRate} baud)`,
				transportName: "k-line",
				connected: true, // Mock devices are always "connected" for testing
			});
		});

		return devices;
	}

	/**
	 * Connect to a K-line device
	 * In Phase 1, creates a mock connection. Phase 2 will use real hardware.
	 *
	 * @param deviceId - Device ID from listDevices()
	 * @returns Open K-line connection
	 */
	async connect(deviceId: string): Promise<KLineConnection> {
		const deviceInfo = this.mockDevices.get(deviceId);
		if (!deviceInfo) {
			throw new Error(`K-line device not found: ${deviceId}`);
		}

		// Create mock serial port
		const mockPort: MockSerialPort = {
			async write(_data: Uint8Array): Promise<void> {
				// Mock: just store the data for testing
				// In real implementation, writes to USB/serial port
			},
			async read(_maxLength: number): Promise<Uint8Array> {
				// Mock: return empty data
				// In real implementation, reads from USB/serial port
				return new Uint8Array(0);
			},
			async close(): Promise<void> {
				// Mock: no-op
			},
			isOpen(): boolean {
				return true; // Mock is always open
			},
		};

		// Create connection with mock port
		const deviceInfoObj: DeviceInfo = {
			id: deviceId,
			name: `K-Line Device (${deviceInfo.portPath})`,
			transportName: "k-line",
			connected: true,
		};

		return new KLineConnection(deviceInfoObj, mockPort);
	}

	/**
	 * Add a mock device for testing
	 * (Testing utility, not part of production API)
	 */
	addMockDevice(id: string, portPath: string, baudRate: number = 10400): void {
		this.mockDevices.set(id, { portPath, baudRate });
	}

	/**
	 * Remove a mock device
	 * (Testing utility, not part of production API)
	 */
	removeMockDevice(id: string): void {
		this.mockDevices.delete(id);
	}

	/**
	 * Get mock device info
	 * (Testing utility, not part of production API)
	 */
	getMockDevice(id: string): MockSerialDeviceInfo | undefined {
		return this.mockDevices.get(id);
	}
}

/** Export types for external use */
export type { KLineHealth };
export { FlowControlState };
