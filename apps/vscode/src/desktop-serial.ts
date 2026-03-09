import { SerialPort } from "serialport";

export interface DesktopSerialDevice {
	id: string;
	preferredPath: string;
	allPaths: string[];
	serialNumber?: string;
	manufacturer?: string;
	vendorId?: string;
	productId?: string;
}

export interface DesktopSerialMatcher {
	vendorId?: string;
	productId?: string;
	manufacturerIncludes?: string[];
	pathIncludes?: string[];
}

export function normalizeUsbIdentifier(value?: string | null): string | undefined {
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

function comparePaths(left: string, right: string): number {
	const rankDifference = pathRank(left) - pathRank(right);
	if (rankDifference !== 0) {
		return rankDifference;
	}
	return left.localeCompare(right);
}

function buildDeviceKey(port: {
	path: string;
	serialNumber?: string | null | undefined;
	manufacturer?: string | null | undefined;
	vendorId?: string | null | undefined;
	productId?: string | null | undefined;
}): string {
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

export async function listDesktopSerialDevices(): Promise<DesktopSerialDevice[]> {
	const ports = await SerialPort.list();
	const grouped = new Map<string, DesktopSerialDevice>();

	for (const port of ports) {
		const key = buildDeviceKey(port);
		const existing = grouped.get(key);
		if (existing == null) {
			const device: DesktopSerialDevice = {
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
			grouped.set(key, device);
			continue;
		}

		existing.allPaths.push(port.path);
		existing.allPaths.sort(comparePaths);
		existing.preferredPath = existing.allPaths[0] ?? existing.preferredPath;
	}

	return [...grouped.values()].sort((left, right) =>
		comparePaths(left.preferredPath, right.preferredPath),
	);
}

export function matchDesktopSerialDevice(
	device: DesktopSerialDevice,
	matcher: DesktopSerialMatcher,
): boolean {
	const vendorId = normalizeUsbIdentifier(matcher.vendorId);
	if (vendorId != null && device.vendorId !== vendorId) {
		return false;
	}

	const productId = normalizeUsbIdentifier(matcher.productId);
	if (productId != null && device.productId !== productId) {
		return false;
	}

	if (matcher.manufacturerIncludes != null && matcher.manufacturerIncludes.length > 0) {
		const manufacturer = device.manufacturer?.toLowerCase() ?? "";
		if (
			!matcher.manufacturerIncludes.some((entry) =>
				manufacturer.includes(entry.toLowerCase()),
			)
		) {
			return false;
		}
	}

	if (matcher.pathIncludes != null && matcher.pathIncludes.length > 0) {
		const haystack = device.allPaths.join(" ").toLowerCase();
		if (
			!matcher.pathIncludes.some((entry) => haystack.includes(entry.toLowerCase()))
		) {
			return false;
		}
	}

	return true;
}
