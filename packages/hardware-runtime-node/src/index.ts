import { groupSerialPorts } from "@ecu-explorer/device/hardware-runtime";
import { SerialPort } from "serialport";

const NODE_USB_TRANSFER_TIMEOUT_MS = 500;

export interface NodeSerialPortInfo {
	path: string;
	serialNumber?: string | null;
	manufacturer?: string | null;
	vendorId?: string | null;
	productId?: string | null;
	friendlyName?: string | null;
}

export interface NodeSerialPortSession {
	readonly path: string;
	readonly isOpen: boolean;
	open(): Promise<void>;
	close(): Promise<void>;
	write(data: Uint8Array): Promise<void>;
	read(maxLength: number, timeoutMs: number): Promise<Uint8Array>;
}

export interface NodeSerialRuntime {
	listPorts(): Promise<readonly NodeSerialPortInfo[]>;
	openPort(path: string): Promise<NodeSerialPortSession>;
}

type NodeUsbEndpointLike = {
	direction: "in" | "out";
	address: number;
	transferType?: number;
	timeout?: number;
	transfer?(
		data: Buffer | number,
		callback: (error: Error | null, result: unknown) => void,
	): void;
};

type NodeUsbInterfaceDescriptor = {
	bInterfaceNumber?: number;
	bInterfaceClass?: number;
	bInterfaceSubClass?: number;
	bInterfaceProtocol?: number;
};

type NodeUsbInterfaceLike = {
	endpoints?: readonly NodeUsbEndpointLike[] | undefined;
	descriptor?: NodeUsbInterfaceDescriptor | undefined;
	isKernelDriverActive?(): boolean;
	isClaimed?: boolean | undefined;
	claim(): void;
	release(callback?: (error: Error | null) => void): void;
};

type NodeUsbDeviceLike = {
	deviceDescriptor: {
		idVendor: number;
		idProduct: number;
		bDeviceClass: number;
		bDeviceSubClass: number;
		bDeviceProtocol: number;
	};
	interfaces?: readonly NodeUsbInterfaceLike[] | undefined;
	busNumber: number;
	deviceAddress: number;
	serialNumber?: string | null | undefined;
	productName?: string | null | undefined;
	manufacturerName?: string | null | undefined;
	open(): void;
	close(): void;
	interface(interfaceNumber: number): NodeUsbInterfaceLike;
};

type NodeUsbModule = {
	getDeviceList(): readonly NodeUsbDeviceLike[];
};

type NodeUsbWrappedDevice = USBDevice & {
	readonly interfaces: readonly NodeUsbInterfaceLike[];
	readonly busNumber: number;
	readonly deviceAddress: number;
	readonly portNumber: number;
};

export interface NodeUsbRuntime {
	onconnect: ((this: USB, ev: USBConnectionEvent) => void) | null;
	ondisconnect: ((this: USB, ev: USBConnectionEvent) => void) | null;
	getDevices(): Promise<USBDevice[]>;
	requestDevice(options?: USBDeviceRequestOptions): Promise<USBDevice>;
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	): void;
	dispatchEvent(event: Event): boolean;
}

type BufferedWaiter = {
	resolve: (value: Uint8Array) => void;
	reject: (error: unknown) => void;
	timer: NodeJS.Timeout;
	maxLength: number;
};

function createBufferedReader(port: SerialPort) {
	let buffer = Buffer.alloc(0);
	const waiters: BufferedWaiter[] = [];

	const flushWaiters = () => {
		while (waiters.length > 0 && buffer.length > 0) {
			const waiter = waiters.shift();
			if (waiter == null) {
				return;
			}
			clearTimeout(waiter.timer);
			const size = Math.min(waiter.maxLength, buffer.length);
			const chunk = buffer.subarray(0, size);
			buffer = buffer.subarray(size);
			waiter.resolve(new Uint8Array(chunk));
		}
	};

	port.on("data", (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		flushWaiters();
	});

	port.on("close", () => {
		for (const waiter of waiters.splice(0)) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error("Serial port closed"));
		}
	});

	port.on("error", (error: Error) => {
		for (const waiter of waiters.splice(0)) {
			clearTimeout(waiter.timer);
			waiter.reject(error);
		}
	});

	return {
		async read(maxLength: number, timeoutMs: number): Promise<Uint8Array> {
			if (buffer.length > 0) {
				const size = Math.min(maxLength, buffer.length);
				const chunk = buffer.subarray(0, size);
				buffer = buffer.subarray(size);
				return new Uint8Array(chunk);
			}

			return new Promise<Uint8Array>((resolve, reject) => {
				const timer = setTimeout(() => {
					const index = waiters.findIndex((entry) => entry.timer === timer);
					if (index >= 0) {
						waiters.splice(index, 1);
					}
					reject(new Error(`Serial read timed out after ${timeoutMs}ms`));
				}, timeoutMs);
				waiters.push({ resolve, reject, timer, maxLength });
			});
		},
	};
}

function getNodeUsbSerialNumber(device: NodeUsbDeviceLike): string | null {
	try {
		return device.serialNumber || null;
	} catch {
		return null;
	}
}

function getNodeUsbProductName(device: NodeUsbDeviceLike): string | null {
	try {
		return device.productName || null;
	} catch {
		return null;
	}
}

function getNodeUsbManufacturerName(device: NodeUsbDeviceLike): string | null {
	try {
		return device.manufacturerName || null;
	} catch {
		return null;
	}
}

function describeNodeUsbInterface(
	nodeDevice: NodeUsbDeviceLike,
	interfaceNumber: number,
): string {
	try {
		const usbInterface = nodeDevice.interface(interfaceNumber);
		const descriptor = usbInterface.descriptor || {};
		const kernelActive =
			typeof usbInterface.isKernelDriverActive === "function"
				? usbInterface.isKernelDriverActive()
				: false;
		const endpoints = (usbInterface.endpoints || []).map(
			(endpoint) =>
				`${endpoint.address}:${endpoint.direction}/${endpoint.transferType ?? "unknown"}`,
		);
		return `iface=${descriptor.bInterfaceNumber ?? interfaceNumber} class=${descriptor.bInterfaceClass}/${descriptor.bInterfaceSubClass} proto=${descriptor.bInterfaceProtocol} kernelDriverActive=${kernelActive} endpoints=${endpoints.join(",")}`;
	} catch {
		return `iface=${interfaceNumber}`;
	}
}

function findNodeUsbEndpoint(
	nodeDevice: NodeUsbDeviceLike,
	direction: "in" | "out",
	endpointNumber: number,
): NodeUsbEndpointLike | null {
	const interfaces = nodeDevice.interfaces || [];
	for (const usbInterface of interfaces) {
		const endpoint = (usbInterface.endpoints || []).find(
			(candidate) =>
				candidate.direction === direction &&
				candidate.address === endpointNumber,
		);
		if (endpoint != null) {
			return endpoint;
		}
	}
	return null;
}

function createNodeUsbDevice(nodeDevice: NodeUsbDeviceLike): USBDevice {
	let opened = false;
	let interfaces = nodeDevice.interfaces || [];
	const vendorId = nodeDevice.deviceDescriptor.idVendor;
	const productId = nodeDevice.deviceDescriptor.idProduct;
	const serialNumber = getNodeUsbSerialNumber(nodeDevice);
	const productName = getNodeUsbProductName(nodeDevice);

	const device: NodeUsbWrappedDevice = {
		usbVersionMajor: 2,
		usbVersionMinor: 0,
		usbVersionSubminor: 0,
		deviceClass: nodeDevice.deviceDescriptor.bDeviceClass,
		deviceSubclass: nodeDevice.deviceDescriptor.bDeviceSubClass,
		deviceProtocol: nodeDevice.deviceDescriptor.bDeviceProtocol,
		vendorId,
		productId,
		deviceVersionMajor: 0,
		deviceVersionMinor: 0,
		deviceVersionSubminor: 0,
		manufacturerName: getNodeUsbManufacturerName(nodeDevice),
		productName,
		serialNumber,
		get configuration() {
			return null;
		},
		get configurations() {
			return [];
		},
		get opened() {
			return opened;
		},
		get interfaces() {
			return interfaces;
		},
		busNumber: nodeDevice.busNumber,
		deviceAddress: nodeDevice.deviceAddress,
		portNumber: 0,
		async open() {
			try {
				nodeDevice.open();
				interfaces = nodeDevice.interfaces || [];
				opened = true;
			} catch (error) {
				throw new Error(`Failed to open USB device: ${error}`);
			}
		},
		async close() {
			try {
				nodeDevice.close();
				opened = false;
			} catch (error) {
				throw new Error(`Failed to close USB device: ${error}`);
			}
		},
		async forget() {},
		async selectConfiguration(_configurationValue: number) {},
		async claimInterface(interfaceNumber: number) {
			try {
				nodeDevice.interface(interfaceNumber).claim();
			} catch (error) {
				throw new Error(
					`Failed to claim interface ${interfaceNumber} (${describeNodeUsbInterface(
						nodeDevice,
						interfaceNumber,
					)}): ${error}. This is usually macOS kernel ownership preventing libusb claims. Try WebUSB path or a host OS that can own the interface.`,
				);
			}
		},
		async releaseInterface(interfaceNumber: number) {
			try {
				const usbInterface = nodeDevice.interface(interfaceNumber);
				if (!usbInterface.isClaimed) {
					return;
				}
				await new Promise<void>((resolve, reject) => {
					usbInterface.release((error) => {
						if (error != null) {
							reject(error);
							return;
						}
						resolve();
					});
				});
			} catch {
				// Ignore release errors from partially-opened devices.
			}
		},
		async selectAlternateInterface(
			_interfaceNumber: number,
			_alternateSetting: number,
		) {},
		async controlTransferIn(
			_setup: USBControlTransferParameters,
			_length: number,
		): Promise<USBInTransferResult> {
			throw new Error(
				"controlTransferIn() is not implemented for Node USB runtime",
			);
		},
		async controlTransferOut(
			_setup: USBControlTransferParameters,
			_data?: BufferSource,
		): Promise<USBOutTransferResult> {
			throw new Error(
				"controlTransferOut() is not implemented for Node USB runtime",
			);
		},
		async clearHalt(_direction: USBDirection, _endpointNumber: number) {},
		async transferIn(
			endpointNumber: number,
			length: number,
		): Promise<USBInTransferResult> {
			const endpoint = findNodeUsbEndpoint(nodeDevice, "in", endpointNumber);
			if (endpoint == null) {
				throw new Error(`Endpoint ${endpointNumber} not found`);
			}
			if (typeof endpoint.transfer !== "function") {
				throw new Error(`Endpoint ${endpointNumber} has no transfer() method`);
			}
			endpoint.timeout = NODE_USB_TRANSFER_TIMEOUT_MS;
			return new Promise<USBInTransferResult>((resolve, reject) => {
				endpoint.transfer?.(length, (error, result) => {
					if (error != null) {
						reject(new Error(`Transfer failed: ${error}`));
						return;
					}
					const transferredData = result instanceof Buffer ? result : null;
					const buffer = transferredData ?? Buffer.alloc(0);
					resolve({
						data: new DataView(
							buffer.buffer,
							buffer.byteOffset,
							buffer.byteLength,
						),
						status: "ok",
					});
				});
			});
		},
		async transferOut(
			endpointNumber: number,
			data: BufferSource,
		): Promise<USBOutTransferResult> {
			const endpoint = findNodeUsbEndpoint(nodeDevice, "out", endpointNumber);
			if (endpoint == null) {
				throw new Error(`Endpoint ${endpointNumber} not found`);
			}
			if (typeof endpoint.transfer !== "function") {
				throw new Error(`Endpoint ${endpointNumber} has no transfer() method`);
			}
			endpoint.timeout = NODE_USB_TRANSFER_TIMEOUT_MS;
			const source =
				data instanceof ArrayBuffer
					? new Uint8Array(data)
					: new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			const buffer = Buffer.from(source);
			return new Promise<USBOutTransferResult>((resolve, reject) => {
				endpoint.transfer?.(buffer, (error, result) => {
					if (error != null) {
						reject(new Error(`Transfer failed: ${error}`));
						return;
					}
					resolve({
						bytesWritten: Number(result ?? 0),
						status: "ok",
					});
				});
			});
		},
		async isochronousTransferIn(
			_endpointNumber: number,
			_packetLengths: number[],
		): Promise<USBIsochronousInTransferResult> {
			throw new Error(
				"isochronousTransferIn() is not implemented for Node USB runtime",
			);
		},
		async isochronousTransferOut(
			_endpointNumber: number,
			_data: BufferSource,
			_packetLengths: number[],
		): Promise<USBIsochronousOutTransferResult> {
			throw new Error(
				"isochronousTransferOut() is not implemented for Node USB runtime",
			);
		},
		async reset() {},
	};

	return device;
}

export async function createNodeSerialRuntime(): Promise<NodeSerialRuntime> {
	return {
		async listPorts() {
			const ports = await SerialPort.list();
			return groupSerialPorts(ports).map((port) => ({
				path: port.preferredPath,
				serialNumber: port.serialNumber ?? null,
				manufacturer: port.manufacturer ?? null,
				vendorId: port.vendorId ?? null,
				productId: port.productId ?? null,
				friendlyName: port.friendlyName ?? null,
			}));
		},
		async openPort(path: string) {
			const port = new SerialPort({
				path,
				baudRate: 115200,
				dataBits: 8,
				stopBits: 1,
				parity: "none",
				autoOpen: false,
			});
			const reader = createBufferedReader(port);

			return {
				path,
				get isOpen() {
					return port.isOpen;
				},
				async open() {
					if (port.isOpen) {
						return;
					}
					await new Promise<void>((resolve, reject) => {
						port.open((error) => (error ? reject(error) : resolve()));
					});
				},
				async close() {
					if (!port.isOpen) {
						return;
					}
					await new Promise<void>((resolve, reject) => {
						port.close((error) => (error ? reject(error) : resolve()));
					});
				},
				async write(data: Uint8Array) {
					await new Promise<void>((resolve, reject) => {
						port.write(Buffer.from(data), (error) => {
							if (error != null) {
								reject(error);
								return;
							}
							port.drain((drainError) =>
								drainError ? reject(drainError) : resolve(),
							);
						});
					});
				},
				read(maxLength: number, timeoutMs: number) {
					return reader.read(maxLength, timeoutMs);
				},
			};
		},
	};
}

export async function createNodeUsbRuntime(): Promise<NodeUsbRuntime> {
	const usbModule = (await import("usb")) as NodeUsbModule;
	const eventTarget = new EventTarget();
	const getDevices = async (): Promise<USBDevice[]> => {
		try {
			return usbModule
				.getDeviceList()
				.map((nodeDevice) => createNodeUsbDevice(nodeDevice));
		} catch {
			return [];
		}
	};

	return {
		onconnect: null as ((this: USB, ev: USBConnectionEvent) => void) | null,
		ondisconnect: null as ((this: USB, ev: USBConnectionEvent) => void) | null,
		getDevices,
		async requestDevice(
			_options?: USBDeviceRequestOptions,
		): Promise<USBDevice> {
			const devices = await getDevices();
			const firstDevice = devices[0];
			if (firstDevice == null) {
				throw new Error(
					"No USB devices found. Please connect an OpenPort 2.0 device.",
				);
			}
			return firstDevice;
		},
		addEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | AddEventListenerOptions,
		) {
			eventTarget.addEventListener(type, listener, options);
		},
		removeEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | EventListenerOptions,
		) {
			eventTarget.removeEventListener(type, listener, options);
		},
		dispatchEvent(event: Event) {
			return eventTarget.dispatchEvent(event);
		},
	};
}
