import type {
	HardwareLocality,
	SerialOpenOptions,
	SerialPortSession,
	SerialRuntime,
} from "@ecu-explorer/device/hardware-runtime";

export type WidebandReading =
	| {
			kind: "lambda";
			value: number;
			timestamp: number;
	  }
	| {
			kind: "afr";
			value: number;
			timestamp: number;
	  };

export interface WidebandHardwareCandidate {
	id: string;
	name: string;
	transportName: string;
	locality: HardwareLocality;
	serialNumber?: string;
	vendorId?: string;
	productId?: string;
}

export interface WidebandSession {
	readonly id: string;
	readonly name: string;
	startStream(onReading: (reading: WidebandReading) => void): Promise<void>;
	stopStream(): Promise<void>;
	close(): Promise<void>;
}

export interface WidebandAdapter {
	readonly id: string;
	readonly name: string;
	canOpen(candidate: WidebandHardwareCandidate): Promise<boolean> | boolean;
	open(candidate: WidebandHardwareCandidate): Promise<WidebandSession>;
}

export interface WidebandSerialPortSession extends SerialPortSession {}

export interface WidebandSerialRuntime extends SerialRuntime {
	openPort(
		path: string,
		options?: SerialOpenOptions,
	): Promise<WidebandSerialPortSession>;
}

export function isLambdaReading(
	reading: WidebandReading,
): reading is Extract<WidebandReading, { kind: "lambda" }> {
	return reading.kind === "lambda";
}

export function isAfrReading(
	reading: WidebandReading,
): reading is Extract<WidebandReading, { kind: "afr" }> {
	return reading.kind === "afr";
}

export function formatWidebandReading(reading: WidebandReading): string {
	const formattedValue = reading.value.toFixed(2);
	if (isLambdaReading(reading)) {
		return `${formattedValue} lambda`;
	}
	return `${formattedValue} AFR`;
}

export type AemWidebandMode = "afr" | "lambda";

export function parseAemWidebandLine(
	line: string,
	mode: AemWidebandMode,
	timestamp: number,
): WidebandReading | undefined {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	const parsed = Number.parseFloat(trimmed);
	if (!Number.isFinite(parsed)) {
		return undefined;
	}

	return {
		kind: mode,
		value: parsed,
		timestamp,
	};
}

export class AemSerialWidebandSession implements WidebandSession {
	private streaming = false;
	private streamTask: Promise<void> | undefined;
	private readonly decoder = new TextDecoder();
	private bufferedLine = "";

	constructor(
		readonly id: string,
		readonly name: string,
		private readonly mode: AemWidebandMode,
		private readonly port: WidebandSerialPortSession,
		private readonly now: () => number = () => Date.now(),
	) {}

	async startStream(
		onReading: (reading: WidebandReading) => void,
	): Promise<void> {
		if (this.streaming) {
			return;
		}
		if (!this.port.isOpen) {
			await this.port.open();
		}

		this.streaming = true;
		this.streamTask = this.readLoop(onReading);
	}

	async stopStream(): Promise<void> {
		this.streaming = false;
		await this.streamTask;
		this.streamTask = undefined;
		this.bufferedLine = "";
	}

	async close(): Promise<void> {
		this.streaming = false;
		await this.streamTask;
		this.streamTask = undefined;
		this.bufferedLine = "";
		await this.port.close();
	}

	private async readLoop(
		onReading: (reading: WidebandReading) => void,
	): Promise<void> {
		while (this.streaming) {
			let chunk: Uint8Array;
			try {
				chunk = await this.port.read(64, 250);
			} catch {
				if (!this.streaming) {
					return;
				}
				continue;
			}

			if (chunk.length === 0) {
				continue;
			}

			this.bufferedLine += this.decoder.decode(chunk);
			const lines = this.bufferedLine.split(/\r?\n/);
			this.bufferedLine = lines.pop() ?? "";

			for (const line of lines) {
				const reading = parseAemWidebandLine(line, this.mode, this.now());
				if (reading != null) {
					onReading(reading);
				}
			}
		}
	}
}

export class AemSerialWidebandAdapter implements WidebandAdapter {
	readonly id = "aem-serial-wideband";
	readonly name = "AEM Serial Wideband";

	constructor(
		private readonly runtime: WidebandSerialRuntime,
		private readonly mode: AemWidebandMode,
	) {}

	canOpen(candidate: WidebandHardwareCandidate): boolean {
		return (
			candidate.transportName === "serial" ||
			candidate.id.startsWith("wideband-serial:") ||
			candidate.id.startsWith("openport2-serial:")
		);
	}

	async open(candidate: WidebandHardwareCandidate): Promise<WidebandSession> {
		const path = getWidebandSerialPath(candidate);
		if (path == null) {
			throw new Error(
				`Wideband candidate is not serial-backed: ${candidate.id}`,
			);
		}

		const port = await this.runtime.openPort(path, {
			baudRate: 9600,
			dataBits: 8,
			stopBits: 1,
			parity: "none",
		});

		return new AemSerialWidebandSession(
			candidate.id,
			candidate.name,
			this.mode,
			port,
		);
	}
}

export function getWidebandSerialPath(
	candidate: WidebandHardwareCandidate,
): string | undefined {
	if (candidate.id.startsWith("wideband-serial:")) {
		return candidate.id.slice("wideband-serial:".length);
	}
	if (candidate.id.startsWith("openport2-serial:")) {
		return candidate.id.slice("openport2-serial:".length);
	}
	return undefined;
}
