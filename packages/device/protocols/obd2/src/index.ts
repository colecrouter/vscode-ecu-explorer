import type {
	DeviceConnection,
	EcuProtocol,
	LiveDataFrame,
	LiveDataSession,
	PidDescriptor,
} from "@ecu-explorer/device";

/**
 * Standard OBD-II PIDs (Mode 01)
 * Ref: https://en.wikipedia.org/wiki/OBD-II_PIDs
 */
export const STANDARD_PIDS: PidDescriptor[] = [
	{
		pid: 0x0c,
		name: "Engine RPM",
		unit: "rpm",
		minValue: 0,
		maxValue: 16383.75,
	},
	{
		pid: 0x0d,
		name: "Vehicle Speed",
		unit: "km/h",
		minValue: 0,
		maxValue: 255,
	},
	{
		pid: 0x04,
		name: "Calculated Engine Load",
		unit: "%",
		minValue: 0,
		maxValue: 100,
	},
	{
		pid: 0x05,
		name: "Engine Coolant Temperature",
		unit: "°C",
		minValue: -40,
		maxValue: 215,
	},
	{
		pid: 0x0b,
		name: "Intake Manifold Absolute Pressure",
		unit: "kPa",
		minValue: 0,
		maxValue: 255,
	},
	{
		pid: 0x0f,
		name: "Intake Air Temperature",
		unit: "°C",
		minValue: -40,
		maxValue: 215,
	},
	{
		pid: 0x10,
		name: "MAF Air Flow Rate",
		unit: "g/s",
		minValue: 0,
		maxValue: 655.35,
	},
	{
		pid: 0x11,
		name: "Throttle Position",
		unit: "%",
		minValue: 0,
		maxValue: 100,
	},
];

export class Obd2Protocol implements EcuProtocol {
	readonly name = "OBD-II (Generic)";

	async canHandle(connection: DeviceConnection): Promise<boolean> {
		try {
			// Try to request supported PIDs 01-20
			// Mode 01 PID 00
			const response = await connection.sendFrame(new Uint8Array([0x01, 0x00]));
			// Standard OBD-II response for Mode 01 PID 00 should start with 0x41 0x00
			return (
				response.length >= 2 && response[0] === 0x41 && response[1] === 0x00
			);
		} catch {
			return false;
		}
	}

	async getSupportedPids(
		_connection: DeviceConnection,
	): Promise<PidDescriptor[]> {
		// For now, return our hardcoded standard PIDs.
		// In a full implementation, we would query PID 0x00, 0x20, etc. to see what the ECU supports.
		return STANDARD_PIDS;
	}

	streamLiveData(
		connection: DeviceConnection,
		pids: number[],
		onFrame: (frame: LiveDataFrame) => void,
	): LiveDataSession {
		let running = true;
		const startTime = Date.now();

		const poll = async () => {
			while (running) {
				for (const pid of pids) {
					if (!running) break;
					try {
						const response = await connection.sendFrame(
							new Uint8Array([0x01, pid]),
						);
						if (
							response.length >= 3 &&
							response[0] === 0x41 &&
							response[1] === pid
						) {
							const data = response.slice(2);
							const value = this.decodePid(pid, data);
							const descriptor = STANDARD_PIDS.find((p) => p.pid === pid);

							onFrame({
								timestamp: Date.now() - startTime,
								pid,
								value,
								unit: descriptor?.unit ?? "",
							});
						}
					} catch (error) {
						console.error(`Failed to poll PID 0x${pid.toString(16)}:`, error);
					}
					// Small delay between PIDs to avoid flooding
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
		};

		poll();

		return {
			stop: () => {
				running = false;
			},
		};
	}

	private decodePid(pid: number, data: Uint8Array): number {
		const a = data[0] ?? 0;
		const b = data[1] ?? 0;

		switch (pid) {
			case 0x0c: // RPM: ((A*256)+B)/4
				return (a * 256 + b) / 4;
			case 0x0d: // Speed: A
				return a;
			case 0x04: // Load: A*100/255
			case 0x11: // Throttle: A*100/255
				return (a * 100) / 255;
			case 0x05: // Temp: A-40
			case 0x0f: // IAT: A-40
				return a - 40;
			case 0x0b: // MAP: A
				return a;
			case 0x10: // MAF: ((A*256)+B)/100
				return (a * 256 + b) / 100;
			default:
				return a;
		}
	}
}
