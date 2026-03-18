import type { OpenPort2TransportOptions } from "@ecu-explorer/device-transport-openport2";
import {
	createNodeSerialRuntime,
	createNodeUsbRuntime,
	type NodeSerialRuntime,
} from "@ecu-explorer/hardware-runtime-node";
import {
	listDesktopSerialDevices,
	matchDesktopSerialDevice,
} from "./desktop-serial.js";

export async function createOpenPortDesktopRuntime(
	serialRuntime?: NodeSerialRuntime,
): Promise<OpenPort2TransportOptions> {
	const resolvedSerialRuntime =
		serialRuntime ?? (await createNodeSerialRuntime());
	const usbRuntime = (await createNodeUsbRuntime().catch(() => undefined)) as
		| OpenPort2TransportOptions["usb"]
		| undefined;

	return {
		usb: usbRuntime,
		serial: {
			async listPorts() {
				const devices = await listDesktopSerialDevices();
				return devices
					.filter((device) =>
						matchDesktopSerialDevice(device, {
							vendorId: "0403",
							productId: "cc4d",
							manufacturerIncludes: ["tactrix"],
							pathIncludes: ["usbmodem"],
						}),
					)
					.map((device) => ({
						path: device.preferredPath,
						serialNumber: device.serialNumber ?? null,
						manufacturer: device.manufacturer ?? null,
						vendorId: device.vendorId ?? null,
						productId: device.productId ?? null,
					}));
			},
			openPort: resolvedSerialRuntime.openPort,
		},
	};
}
