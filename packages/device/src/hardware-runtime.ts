export type HardwareLocality = "extension-host" | "client-browser";

export interface SerialPortDescriptor {
	path: string;
	serialNumber?: string | null | undefined;
	manufacturer?: string | null | undefined;
	vendorId?: string | null | undefined;
	productId?: string | null | undefined;
	friendlyName?: string | null | undefined;
}

export interface SerialOpenOptions {
	baudRate?: number;
	dataBits?: 5 | 6 | 7 | 8;
	stopBits?: 1 | 2;
	parity?: "none" | "even" | "mark" | "odd" | "space";
}

export interface SerialPortSession {
	readonly path: string;
	readonly isOpen: boolean;
	open(): Promise<void>;
	close(): Promise<void>;
	write(data: Uint8Array): Promise<void>;
	read(maxLength: number, timeoutMs: number): Promise<Uint8Array>;
}

export interface SerialRuntime {
	listPorts(): Promise<readonly SerialPortDescriptor[]>;
	openPort(
		path: string,
		options?: SerialOpenOptions,
	): Promise<SerialPortSession>;
	requestPort?(): Promise<SerialPortDescriptor>;
	forgetPort?(path: string): Promise<void>;
}

export interface SerialPortGroup {
	id: string;
	preferredPath: string;
	allPaths: string[];
	serialNumber?: string;
	manufacturer?: string;
	vendorId?: string;
	productId?: string;
	friendlyName?: string;
}

export interface HardwareSelectionRecord {
	id: string;
	transportName: string;
	name: string;
	locality?: HardwareLocality;
	serialNumber?: string;
	vendorId?: string;
	productId?: string;
}

export function normalizeUsbIdentifier(
	value?: string | null,
): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0) {
		return undefined;
	}
	return normalized.startsWith("0x") ? normalized.slice(2) : normalized;
}

function pathRank(path: string): number {
	if (path.startsWith("/dev/cu.")) {
		return 0;
	}
	if (path.startsWith("/dev/tty.")) {
		return 1;
	}
	return 2;
}

export function comparePreferredDevicePaths(
	left: string,
	right: string,
): number {
	const rankDifference = pathRank(left) - pathRank(right);
	if (rankDifference !== 0) {
		return rankDifference;
	}
	return left.localeCompare(right);
}

export function buildSerialPortIdentity(port: SerialPortDescriptor): string {
	const vendorId = normalizeUsbIdentifier(port.vendorId) ?? "unknown-vendor";
	const productId = normalizeUsbIdentifier(port.productId) ?? "unknown-product";
	const serialNumber = port.serialNumber?.trim();
	if (serialNumber != null && serialNumber.length > 0) {
		return `${vendorId}:${productId}:${serialNumber}`;
	}

	const manufacturer = port.manufacturer?.trim().toLowerCase() ?? "unknown";
	const suffix = port.path.replace(/^\/dev\/(cu|tty)\./, "");
	return `${vendorId}:${productId}:${manufacturer}:${suffix}`;
}

export function groupSerialPorts(
	ports: readonly SerialPortDescriptor[],
): SerialPortGroup[] {
	const grouped = new Map<string, SerialPortGroup>();

	for (const port of ports) {
		const key = buildSerialPortIdentity(port);
		const existing = grouped.get(key);
		if (existing == null) {
			const device: SerialPortGroup = {
				id: key,
				preferredPath: port.path,
				allPaths: [port.path],
			};
			if (port.serialNumber != null) {
				device.serialNumber = port.serialNumber;
			}
			if (port.manufacturer != null) {
				device.manufacturer = port.manufacturer;
			}
			const vendorId = normalizeUsbIdentifier(port.vendorId);
			if (vendorId != null) {
				device.vendorId = vendorId;
			}
			const productId = normalizeUsbIdentifier(port.productId);
			if (productId != null) {
				device.productId = productId;
			}
			if (port.friendlyName != null) {
				device.friendlyName = port.friendlyName;
			}
			grouped.set(key, device);
			continue;
		}

		existing.allPaths.push(port.path);
		existing.allPaths.sort(comparePreferredDevicePaths);
		existing.preferredPath = existing.allPaths[0] ?? existing.preferredPath;
		if (existing.friendlyName == null && port.friendlyName != null) {
			existing.friendlyName = port.friendlyName;
		}
	}

	return [...grouped.values()].sort((left, right) =>
		comparePreferredDevicePaths(left.preferredPath, right.preferredPath),
	);
}
