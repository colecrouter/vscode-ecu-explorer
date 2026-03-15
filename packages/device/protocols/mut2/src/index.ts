import type {
	DeviceConnection,
	DtcCode,
	EcuProtocol,
	LiveDataFrame,
	LiveDataHealth,
	LiveDataSession,
	PidDescriptor,
} from "@ecu-explorer/device";

type Decoder = (bytes: readonly number[]) => number;

interface Mut2PidDefinition extends PidDescriptor {
	requestIds: readonly number[];
	decode: Decoder;
}

interface Mut2ModuleProbe {
	requestId: number;
	validate?: (response: Uint8Array) => boolean;
}

interface Mut2ModuleProfile {
	id: string;
	name: string;
	probes: readonly Mut2ModuleProbe[];
	supportsClearDtcs: boolean;
	pids: readonly Mut2PidDefinition[];
}

const MUT2_POLL_INTERVAL_MS = 50;
const MUT2_PID_BASE = 0x9000;

const identity = (bytes: readonly number[]): number => bytes[0] ?? 0;
const boolBit =
	(mask: number): Decoder =>
	(bytes) =>
		(bytes[0] ?? 0) & mask ? 1 : 0;

const decodePair =
	(scale: number): Decoder =>
	(bytes) =>
		(((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0)) * scale;

const decodeSignedOffset =
	(scale: number, offset: number): Decoder =>
	(bytes) =>
		(bytes[0] ?? 0) * scale + offset;

function buildPid(
	moduleOffset: number,
	paramOffset: number,
	name: string,
	unit: string,
	minValue: number,
	maxValue: number,
	requestIds: readonly number[],
	decode: Decoder,
): Mut2PidDefinition {
	return {
		pid: MUT2_PID_BASE + moduleOffset * 0x100 + paramOffset,
		name,
		unit,
		minValue,
		maxValue,
		requestIds,
		decode,
	};
}

const EFI_OBDI_PROFILE: Mut2ModuleProfile = {
	id: "efi-obdi",
	name: "MUT-II EFI OBDI",
	probes: [{ requestId: 0x14 }, { requestId: 0x17 }],
	supportsClearDtcs: true,
	pids: [
		buildPid(
			0x01,
			0x00,
			"Battery Level",
			"V",
			0,
			16,
			[0x14],
			(bytes) => (bytes[0] ?? 0) * 0.07333,
		),
		buildPid(
			0x01,
			0x01,
			"Throttle Position",
			"%",
			0,
			100,
			[0x17],
			(bytes) => ((bytes[0] ?? 0) * 100) / 255,
		),
		buildPid(
			0x01,
			0x02,
			"Engine RPM",
			"rpm",
			0,
			8000,
			[0x21],
			(bytes) => (bytes[0] ?? 0) * 31.25,
		),
		buildPid(
			0x01,
			0x03,
			"Coolant Temp",
			"deg C",
			-40,
			150,
			[0x10],
			(bytes) => (bytes[0] ?? 0) - 40,
		),
		buildPid(0x01, 0x04, "Knock Sum", "count", 0, 50, [0x26], identity),
	],
};

const EFI_CEDDY_PROFILE: Mut2ModuleProfile = {
	id: "efi-ceddymod",
	name: "MUT-II EFI CeddyMod Evo5/6",
	probes: [{ requestId: 0x94 }, { requestId: 0x95 }],
	supportsClearDtcs: false,
	pids: [
		buildPid(
			0x02,
			0x00,
			"Throttle Position",
			"%",
			0,
			100,
			[0x17],
			(bytes) => ((bytes[0] ?? 0) * 100) / 255,
		),
		buildPid(
			0x02,
			0x01,
			"Engine RPM",
			"rpm",
			0,
			8000,
			[0x21],
			(bytes) => (bytes[0] ?? 0) * 31.25,
		),
		buildPid(
			0x02,
			0x02,
			"Timing Advance",
			"deg",
			-20,
			60,
			[0x06],
			decodeSignedOffset(1, -20),
		),
		buildPid(
			0x02,
			0x03,
			"Load 1Byte",
			"load",
			0,
			357,
			[0x0a],
			(bytes) => ((bytes[0] ?? 0) * 5) / 4,
		),
		buildPid(
			0x02,
			0x04,
			"2Byte Load",
			"load",
			0,
			500,
			[0x00, 0x01],
			decodePair(5 / 16),
		),
		buildPid(
			0x02,
			0x05,
			"2Byte RPM",
			"rpm",
			0,
			9000,
			[0x02, 0x03],
			decodePair(1000 / 256),
		),
	],
};

const ABS_PROFILE: Mut2ModuleProfile = {
	id: "abs-1g-dsm",
	name: "MUT-II ABS 1G DSM OBDI",
	probes: [{ requestId: 0x07 }, { requestId: 0x01 }],
	supportsClearDtcs: true,
	pids: [
		buildPid(
			0x03,
			0x00,
			"Battery Level",
			"V",
			0,
			16,
			[0x01],
			(bytes) => (bytes[0] ?? 0) / 10,
		),
		buildPid(
			0x03,
			0x01,
			"Front Right Wheel Speed",
			"km/h",
			0,
			255,
			[0x02],
			(bytes) => (bytes[0] ?? 0) * 0.57,
		),
		buildPid(
			0x03,
			0x02,
			"Front Left Wheel Speed",
			"km/h",
			0,
			255,
			[0x03],
			(bytes) => (bytes[0] ?? 0) * 0.57,
		),
		buildPid(
			0x03,
			0x03,
			"Rear Right Wheel Speed",
			"km/h",
			0,
			255,
			[0x04],
			(bytes) => (bytes[0] ?? 0) * 1.088,
		),
		buildPid(0x03, 0x04, "Brake Light", "on/off", 0, 1, [0x07], boolBit(0x02)),
	],
};

const TCU_PROFILE: Mut2ModuleProfile = {
	id: "tcu-1g-dsm",
	name: "MUT-II TCU 1G DSM OBDI",
	probes: [{ requestId: 0x86 }, { requestId: 0xb4 }],
	supportsClearDtcs: true,
	pids: [
		buildPid(
			0x04,
			0x00,
			"Transmission Temperature",
			"deg C",
			0,
			255,
			[0x86],
			identity,
		),
		buildPid(
			0x04,
			0x01,
			"Switch Position P",
			"on/off",
			0,
			1,
			[0xb4],
			boolBit(0x40),
		),
		buildPid(
			0x04,
			0x02,
			"Switch Position R",
			"on/off",
			0,
			1,
			[0xb4],
			boolBit(0x80),
		),
		buildPid(
			0x04,
			0x03,
			"Switch Position N",
			"on/off",
			0,
			1,
			[0xb3],
			boolBit(0x01),
		),
		buildPid(
			0x04,
			0x04,
			"Switch Position D",
			"on/off",
			0,
			1,
			[0xb3],
			boolBit(0x02),
		),
	],
};

const AYC_PROFILE: Mut2ModuleProfile = {
	id: "ayc-evo4-6",
	name: "MUT-II AYC Evo4-5-6",
	probes: [{ requestId: 0xa6 }, { requestId: 0xa7 }],
	supportsClearDtcs: true,
	pids: [
		buildPid(
			0x05,
			0x00,
			"Battery",
			"V",
			0,
			16,
			[0xa6],
			(bytes) => (bytes[0] ?? 0) / 10,
		),
		buildPid(
			0x05,
			0x01,
			"Throttle Position",
			"%",
			0,
			100,
			[0xa7],
			(bytes) => ((bytes[0] ?? 0) * 100) / 255,
		),
		buildPid(0x05, 0x02, "Vehicle Speed", "km/h", 0, 255, [0xa4], identity),
		buildPid(
			0x05,
			0x03,
			"G-Force Accel/Decel",
			"V",
			0,
			5,
			[0xa5],
			(bytes) => (2.5 * (bytes[0] ?? 0)) / 128,
		),
		buildPid(
			0x05,
			0x04,
			"Steering Angle Direction",
			"deg",
			-512,
			512,
			[0xae],
			decodeSignedOffset(4, -512),
		),
	],
};

const ACD_PROFILE: Mut2ModuleProfile = {
	id: "acd-evo7-9",
	name: "MUT-II ACD Evo7-8-9",
	probes: [{ requestId: 0x19 }, { requestId: 0x02 }],
	supportsClearDtcs: true,
	pids: [
		buildPid(
			0x06,
			0x00,
			"Battery",
			"V",
			0,
			16,
			[0x19],
			(bytes) => (bytes[0] ?? 0) / 10,
		),
		buildPid(
			0x06,
			0x01,
			"Pressure Switch",
			"on/off",
			0,
			1,
			[0x01],
			boolBit(0x01),
		),
		buildPid(0x06, 0x02, "Brake Switch", "on/off", 0, 1, [0x01], boolBit(0x10)),
		buildPid(
			0x06,
			0x03,
			"Handbrake Switch",
			"on/off",
			0,
			1,
			[0x02],
			boolBit(0x01),
		),
		buildPid(
			0x06,
			0x04,
			"Right AYC Valve Active",
			"on/off",
			0,
			1,
			[0x02],
			boolBit(0x40),
		),
	],
};

const MUT2_MODULES: readonly Mut2ModuleProfile[] = [
	AYC_PROFILE,
	ACD_PROFILE,
	EFI_CEDDY_PROFILE,
	EFI_OBDI_PROFILE,
	TCU_PROFILE,
	ABS_PROFILE,
];

const moduleCache = new WeakMap<DeviceConnection, Mut2ModuleProfile>();

async function readRequestByte(
	connection: DeviceConnection,
	requestId: number,
): Promise<number> {
	const response = await connection.sendFrame(new Uint8Array([requestId]));
	const value = response[0];
	if (value === undefined) {
		throw new Error(
			`MUT-II request 0x${requestId.toString(16)} returned no data`,
		);
	}
	return value;
}

async function readMetricValue(
	connection: DeviceConnection,
	definition: Mut2PidDefinition,
): Promise<number> {
	const bytes: number[] = [];
	for (const requestId of definition.requestIds) {
		bytes.push(await readRequestByte(connection, requestId));
	}
	return definition.decode(bytes);
}

async function probeModule(
	connection: DeviceConnection,
	profile: Mut2ModuleProfile,
): Promise<boolean> {
	for (const probe of profile.probes) {
		try {
			const response = await connection.sendFrame(
				new Uint8Array([probe.requestId]),
			);
			if (response.length === 0) {
				return false;
			}
			if (probe.validate && !probe.validate(response)) {
				return false;
			}
		} catch {
			return false;
		}
	}

	return true;
}

async function detectModule(
	connection: DeviceConnection,
): Promise<Mut2ModuleProfile | null> {
	const cached = moduleCache.get(connection);
	if (cached) {
		return cached;
	}

	if (connection.deviceInfo.transportName !== "kline") {
		return null;
	}

	for (const profile of MUT2_MODULES) {
		if (await probeModule(connection, profile)) {
			moduleCache.set(connection, profile);
			return profile;
		}
	}

	return null;
}

async function getModuleOrThrow(
	connection: DeviceConnection,
): Promise<Mut2ModuleProfile> {
	const profile = await detectModule(connection);
	if (!profile) {
		throw new Error("Unable to identify MUT-II module on this connection");
	}
	return profile;
}

export class Mut2Protocol implements EcuProtocol {
	readonly name = "MUT-II (Mitsubishi)";

	async canHandle(connection: DeviceConnection): Promise<boolean> {
		return (await detectModule(connection)) != null;
	}

	async getSupportedPids(
		connection: DeviceConnection,
	): Promise<PidDescriptor[]> {
		const profile = await getModuleOrThrow(connection);
		return [...profile.pids];
	}

	async clearDtcs(connection: DeviceConnection): Promise<void> {
		const profile = await getModuleOrThrow(connection);
		if (!profile.supportsClearDtcs) {
			throw new Error(
				`MUT-II module "${profile.name}" does not expose clear-DTC support`,
			);
		}
		await connection.sendFrame(new Uint8Array([0xfc]));
	}

	async readDtcs(_connection: DeviceConnection): Promise<DtcCode[]> {
		throw new Error("MUT-II DTC read decoding is not implemented yet");
	}

	streamLiveData(
		connection: DeviceConnection,
		pids: number[],
		onFrame: (frame: LiveDataFrame) => void,
		onHealth?: (health: LiveDataHealth) => void,
	): LiveDataSession {
		let running = true;
		const startTime = Date.now();
		let frameCount = 0;
		let droppedFrames = 0;
		let latencyTotalMs = 0;
		let latencySamples = 0;
		let lastHealthReportTime = startTime;

		const poll = async (): Promise<void> => {
			const profile = await getModuleOrThrow(connection);
			const selectedPids = profile.pids.filter((pid) => pids.includes(pid.pid));

			while (running) {
				const cycleStart = Date.now();

				for (const definition of selectedPids) {
					if (!running) {
						break;
					}

					try {
						const requestStart = Date.now();
						const value = await readMetricValue(connection, definition);
						latencyTotalMs += Date.now() - requestStart;
						latencySamples++;
						frameCount++;

						onFrame({
							timestamp: Date.now() - startTime,
							pid: definition.pid,
							value,
							unit: definition.unit,
						});
					} catch (error) {
						droppedFrames++;
						console.error(`[MUT-II] Failed to read ${definition.name}:`, error);
					}
				}

				const now = Date.now();
				const elapsed = now - lastHealthReportTime;
				if (onHealth && elapsed >= 1000) {
					const samplesPerSecond = frameCount / (elapsed / 1000);
					const latencyMs =
						latencySamples > 0
							? Math.round(latencyTotalMs / latencySamples)
							: 0;
					const status =
						samplesPerSecond === 0
							? "stalled"
							: droppedFrames > 0
								? "degraded"
								: "healthy";

					onHealth({
						samplesPerSecond: Math.round(samplesPerSecond),
						droppedFrames,
						latencyMs,
						status,
					});

					frameCount = 0;
					droppedFrames = 0;
					latencyTotalMs = 0;
					latencySamples = 0;
					lastHealthReportTime = now;
				}

				const waitMs = Math.max(
					0,
					MUT2_POLL_INTERVAL_MS - (Date.now() - cycleStart),
				);
				if (waitMs > 0) {
					await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
				}
			}
		};

		void poll().catch((error) => {
			console.error("[MUT-II] Streaming loop exited with error:", error);
		});

		return {
			stop: () => {
				running = false;
			},
		};
	}
}

export { MUT2_MODULES, MUT2_PID_BASE };
