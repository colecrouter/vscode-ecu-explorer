import type {
	SerialOpenOptions,
	SerialPortDescriptor,
	SerialRuntime,
} from "./hardware-runtime.js";

interface BrowserSerialPortInfoLike {
	usbVendorId?: number;
	usbProductId?: number;
}

interface BrowserSerialReadableStreamReader {
	read(): Promise<{ value?: Uint8Array; done: boolean }>;
	releaseLock(): void;
	cancel(): Promise<void>;
}

interface BrowserSerialReadableStreamLike {
	getReader(): BrowserSerialReadableStreamReader;
}

interface BrowserSerialWritableStreamWriter {
	write(data: Uint8Array): Promise<void>;
	releaseLock(): void;
}

interface BrowserSerialWritableStreamLike {
	getWriter(): BrowserSerialWritableStreamWriter;
}

export interface BrowserSerialPortLike {
	readable?: BrowserSerialReadableStreamLike | null;
	writable?: BrowserSerialWritableStreamLike | null;
	open(options: {
		baudRate: number;
		dataBits?: number;
		stopBits?: 1 | 2;
		parity?: "none" | "even" | "odd";
	}): Promise<void>;
	close(): Promise<void>;
	getInfo(): BrowserSerialPortInfoLike;
	forget?(): Promise<void>;
}

export interface BrowserSerialLike {
	getPorts(): Promise<readonly BrowserSerialPortLike[]>;
	requestPort(options?: {
		filters?: readonly {
			usbVendorId?: number;
			usbProductId?: number;
		}[];
	}): Promise<BrowserSerialPortLike>;
}

export interface BrowserSerialRuntimeOptions {
	idPrefix?: string;
	friendlyName?: string;
	requestFilters?: readonly {
		usbVendorId?: number;
		usbProductId?: number;
	}[];
	defaultOpenOptions?: SerialOpenOptions;
}

function normalizeIdentifier(value?: number): string {
	return value?.toString(16) ?? "unknown";
}

function copyBytes(
	value: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(new ArrayBuffer(value.length));
	copy.set(value);
	return copy;
}

export function createBrowserSerialRuntime(
	browserSerial: BrowserSerialLike | undefined,
	options: BrowserSerialRuntimeOptions = {},
): SerialRuntime | undefined {
	if (browserSerial == null) {
		return undefined;
	}

	const knownPorts = new Map<string, BrowserSerialPortLike>();
	const idPrefix = options.idPrefix ?? "webserial";
	const requestFilters = options.requestFilters;
	const defaultOpenOptions = options.defaultOpenOptions;

	const buildPortPath = (
		port: BrowserSerialPortLike,
		index: number,
	): string => {
		const info = port.getInfo();
		const vendorId = normalizeIdentifier(info.usbVendorId);
		const productId = normalizeIdentifier(info.usbProductId);
		return `${idPrefix}:${vendorId}:${productId}:${index}`;
	};

	const toPortInfo = (
		port: BrowserSerialPortLike,
		index: number,
	): SerialPortDescriptor => {
		const info = port.getInfo();
		const path = buildPortPath(port, index);
		knownPorts.set(path, port);
		return {
			path,
			friendlyName: options.friendlyName,
			vendorId: info.usbVendorId?.toString(16) ?? null,
			productId: info.usbProductId?.toString(16) ?? null,
		};
	};

	const getKnownPort = async (
		path: string,
	): Promise<BrowserSerialPortLike | undefined> => {
		const known = knownPorts.get(path);
		if (known != null) {
			return known;
		}

		const ports = await browserSerial.getPorts();
		for (const [index, port] of ports.entries()) {
			const info = toPortInfo(port, index);
			if (info.path === path) {
				return port;
			}
		}

		return undefined;
	};

	return {
		async listPorts() {
			const ports = await browserSerial.getPorts();
			return ports.map((port, index) => toPortInfo(port, index));
		},
		async requestPort() {
			const port = await browserSerial.requestPort(
				requestFilters != null ? { filters: requestFilters } : undefined,
			);
			const ports = await browserSerial.getPorts();
			const index = ports.indexOf(port);
			return toPortInfo(port, index >= 0 ? index : ports.length);
		},
		async forgetPort(path: string) {
			const port = await getKnownPort(path);
			if (port?.forget == null) {
				throw new Error(`Serial port cannot be forgotten: ${path}`);
			}
			await port.forget();
			knownPorts.delete(path);
		},
		async openPort(path: string, requestedOpenOptions) {
			const port = await getKnownPort(path);
			if (port == null) {
				throw new Error(`Serial port not found: ${path}`);
			}

			let isOpen = false;
			let buffered = new Uint8Array(0);
			let reader: BrowserSerialReadableStreamReader | null = null;

			const readChunk = async (): Promise<Uint8Array> => {
				if (reader == null) {
					const readable = port.readable;
					if (readable == null) {
						throw new Error("Serial port is not readable");
					}
					reader = readable.getReader();
				}
				const result = await reader.read();
				if (result.done) {
					throw new Error("Serial port closed");
				}
				return result.value ?? new Uint8Array(0);
			};

			return {
				path,
				get isOpen() {
					return isOpen;
				},
				async open() {
					if (isOpen) {
						return;
					}
					const openOptions = requestedOpenOptions ?? defaultOpenOptions;
					await port.open({
						baudRate: openOptions?.baudRate ?? 115200,
						dataBits: openOptions?.dataBits ?? 8,
						stopBits: openOptions?.stopBits ?? 1,
						parity:
							openOptions?.parity === "even" || openOptions?.parity === "odd"
								? openOptions.parity
								: "none",
					});
					isOpen = true;
				},
				async close() {
					if (!isOpen) {
						return;
					}
					await reader?.cancel().catch(() => undefined);
					reader?.releaseLock();
					reader = null;
					buffered = new Uint8Array(0);
					await port.close();
					isOpen = false;
				},
				async write(data: Uint8Array) {
					const writable = port.writable;
					if (writable == null) {
						throw new Error("Serial port is not writable");
					}
					const writer = writable.getWriter();
					try {
						await writer.write(data);
					} finally {
						writer.releaseLock();
					}
				},
				async read(maxLength: number, timeoutMs: number) {
					if (buffered.length === 0) {
						const timeoutPromise = new Promise<Uint8Array>((_, reject) => {
							setTimeout(
								() =>
									reject(
										new Error(`Serial read timed out after ${timeoutMs}ms`),
									),
								timeoutMs,
							);
						});
						buffered = copyBytes(
							await Promise.race([readChunk(), timeoutPromise]),
						);
					}

					const size = Math.min(maxLength, buffered.length);
					const chunk = buffered.slice(0, size);
					buffered = buffered.slice(size);
					return chunk;
				},
			};
		},
	};
}
