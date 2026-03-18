/**
 * inspect-device - CLI tool for device diagnostics and protocol probing.
 *
 * Outputs YAML/markdown inspection output compatible with MCP formatting.
 *
 * @module
 */

import { writeFile } from "node:fs/promises";
import {
	createNodeSerialRuntime,
	createNodeUsbRuntime,
} from "@ecu-explorer/hardware-runtime-node";
import sade from "sade";
import {
	DiagnosticStage,
	DiagnosticStatus,
	runDiagnostic,
	TraceWriter,
} from "../device/dist/index.js";
import { MitsubishiBootloaderProtocol } from "../device/protocols/mitsubishi-bootloader/dist/index.js";
import {
	Mut3Protocol,
	RAX_PID_DESCRIPTORS,
} from "../device/protocols/mut3/dist/index.js";
import { Obd2Protocol } from "../device/protocols/obd2/dist/index.js";
import { SubaruProtocol } from "../device/protocols/subaru/dist/index.js";
import { UdsProtocol } from "../device/protocols/uds/dist/index.js";
import { OpenPort2Transport } from "../device/transports/openport2/dist/index.js";
import { formatDiagnosticOutput } from "../mcp/dist/formatters/diagnostics-formatter.js";

// Suppress console.warn since we handle errors explicitly
console.warn = () => {};

/**
 * @typedef {import("../device/dist/index.js").DiagnosticEvent} DiagnosticEvent
 * @typedef {import("../device/dist/index.js").DiagnosticResult} DiagnosticResult
 * @typedef {import("../device/dist/index.js").DiagnosticOptions} DiagnosticOptions
 * @typedef {import("../device/dist/index.js").DeviceInfo} DeviceInfo
 * @typedef {import("../device/dist/index.js").DeviceConnection} DeviceConnection
 * @typedef {import("../device/dist/index.js").EcuProtocol} EcuProtocol
 * @typedef {import("../device/dist/index.js").PidDescriptor} PidDescriptor
 * @typedef {import("../mcp/dist/formatters/diagnostics-formatter.js").DiagnosticEvent} FormattedDiagnosticEvent
 * @typedef {import("../mcp/dist/formatters/diagnostics-formatter.js").DiagnosticResult} FormattedDiagnosticResult
 */

/**
 * @typedef {DeviceConnection & { initialize?: () => Promise<void> }} InitializableDeviceConnection
 */

/**
 * @typedef {import("../device/transports/openport2/dist/index.js").OpenPort2TransportOptions} OpenPortRuntime
 */

/**
 * @typedef {Object} InspectDeviceBaseOptions
 * @property {string | undefined} [device]
 * @property {string | undefined} [protocol]
 * @property {boolean | undefined} [verbose]
 * @property {string | undefined} [traceFile]
 * @property {string | undefined} [transport]
 */

/**
 * @typedef {InspectDeviceBaseOptions} ListDeviceOptions
 */

/**
 * @typedef {InspectDeviceBaseOptions} ConnectDeviceOptions
 */

/**
 * @typedef {InspectDeviceBaseOptions} ProbeDeviceOptions
 */

/**
 * @typedef {Object} LogDeviceOptions
 * @property {string | undefined} [device]
 * @property {string | undefined} [protocol]
 * @property {boolean | undefined} [verbose]
 * @property {string | undefined} [traceFile]
 * @property {string | undefined} [transport]
 * @property {string | undefined} [pids]
 * @property {number | string | undefined} [duration]
 */

/**
 * @typedef {Object} ReadRomDeviceOptions
 * @property {string | undefined} [device]
 * @property {string | undefined} [protocol]
 * @property {boolean | undefined} [verbose]
 * @property {string | undefined} [traceFile]
 * @property {string | undefined} [transport]
 * @property {string | undefined} [out]
 * @property {boolean | undefined} [dryRun]
 */

/**
 * @typedef {Object} RawDeviceOptions
 * @property {string | undefined} [device]
 * @property {boolean | undefined} [verbose]
 * @property {string | undefined} [traceFile]
 * @property {string | undefined} [transport]
 * @property {string | undefined} [data]
 * @property {number | string | undefined} [repeat]
 * @property {number | string | undefined} [delay]
 * @property {number | string | undefined} [timeout]
 * @property {boolean | undefined} [ascii]
 */

/**
 * Create a USB runtime for desktop Node environments.
 *
 * @returns {Promise<NonNullable<OpenPortRuntime["usb"]>>}
 */
async function createNodeUSBInterface() {
	return /** @type {NonNullable<OpenPortRuntime["usb"]>} */ (
		await createNodeUsbRuntime()
	);
}

/**
 * Protocol registry with human-friendly aliases.
 *
 * @typedef {{ protocol: EcuProtocol; aliases: string[] }} ProtocolEntry
 */
const protocolRegistry = [
	{
		protocol: new Obd2Protocol(),
		aliases: ["obd", "obd2", "obd-ii", "generic-obd2", "mode01"],
	},
	{
		protocol: new Mut3Protocol(),
		aliases: [
			"mut3",
			"mut-iii",
			"mut",
			"mitsubishi-mut3",
			"mitsubishi-mut-iii",
		],
	},
	{
		protocol: new MitsubishiBootloaderProtocol(),
		aliases: [
			"mitsubishi-bootloader",
			"bootloader",
			"mitsu-bootloader",
			"mitsuboot",
		],
	},
	{
		protocol: new SubaruProtocol(),
		aliases: ["subaru", "ssm", "ssm2", "kwp2000", "subaru-kwp"],
	},
	{
		protocol: new UdsProtocol(),
		aliases: ["uds", "universal-diagnostic-services", "universal", "iso-14229"],
	},
];

/** @type {EcuProtocol[]} */
/** Registered protocols for probing (default order retained). */
const registeredProtocols = protocolRegistry.map((entry) => entry.protocol);

/** @type {PidDescriptor[]} */
const mut3PidDescriptors = RAX_PID_DESCRIPTORS;

const DEFAULT_MUT3_PID_NAMES = ["RPM", "Boost Pressure", "Timing Advance"];

/**
 * Create a serial runtime for desktop Node environments.
 *
 * @returns {Promise<import("../device/transports/openport2/dist/index.js").OpenPort2TransportOptions["serial"]>}
 */
async function createNodeSerialInterface() {
	const runtime = await createNodeSerialRuntime();
	return {
		async listPorts() {
			const ports = await runtime.listPorts();
			return ports.map((port) => ({
				path: port.path,
				serialNumber: port.serialNumber ?? null,
				manufacturer: port.manufacturer ?? null,
				friendlyName: port.friendlyName ?? null,
				vendorId: port.vendorId ?? null,
				productId: port.productId ?? null,
			}));
		},
		openPort: runtime.openPort,
	};
}

/**
 * Build the runtime object passed into OpenPort2Transport.
 *
 * @param {string} [preferredTransport]
 * @returns {Promise<OpenPortRuntime>}
 */
async function createOpenPortRuntime(preferredTransport = "auto") {
	/** @type {OpenPortRuntime} */
	const runtime = {};

	if (preferredTransport === "auto" || preferredTransport === "usb") {
		try {
			runtime.usb = await createNodeUSBInterface();
		} catch {
			// Ignore missing USB runtime.
		}
	}

	if (preferredTransport === "serial" || preferredTransport === "auto") {
		try {
			const serialRuntime = await createNodeSerialInterface();
			if (serialRuntime != null) {
				runtime.serial = serialRuntime;
			}
		} catch {
			// Ignore missing serial runtime.
		}
	}

	return runtime;
}

/**
 * Convert protocol names into a stable lowercase key for matching.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeProtocolName(value) {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * List all supported protocol names for error output.
 *
 * @returns {string[]}
 */
function supportedProtocolNames() {
	return protocolRegistry.map(
		(entry) =>
			entry.protocol.name ?? normalizeProtocolName(String(entry.protocol)),
	);
}

/**
 * @param {EcuProtocol} protocol
 * @returns {boolean}
 */
function isMut3Protocol(protocol) {
	return protocol instanceof Mut3Protocol;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePidToken(value) {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * @param {string} value
 * @returns {number}
 */
function parseNumericPidValue(value) {
	const normalized = value.toLowerCase();
	const radix =
		normalized.startsWith("0x") || /[a-f]/.test(normalized) ? 16 : 10;
	const parsed = Number.parseInt(normalized, radix);
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid PID value: ${value}`);
	}
	return parsed;
}

/**
 * @param {string[]} names
 * @returns {number[]}
 */
function resolveMut3DefaultPids(names) {
	return names
		.map((name) => {
			const match = mut3PidDescriptors.find(
				(descriptor) =>
					normalizePidToken(descriptor.name) === normalizePidToken(name),
			);
			return match?.pid ?? null;
		})
		.filter((pid) => pid != null);
}

/**
 * @param {string} input
 * @returns {number}
 */
function resolveMut3Pid(input) {
	const numericPid = /^(0x[a-f0-9]+|\d+)$/i.test(input)
		? parseNumericPidValue(input)
		: null;
	if (numericPid != null) {
		const exact = mut3PidDescriptors.find(
			(descriptor) => descriptor.pid === numericPid,
		);
		if (exact == null) {
			throw new Error(
				`Invalid MUT-III PID: ${input}. Use a synthetic MUT-III PID (for example 0x${mut3PidDescriptors[0]?.pid.toString(16)}) or a parameter name like RPM.`,
			);
		}
		return exact.pid;
	}

	const normalized = normalizePidToken(input);
	const exact = mut3PidDescriptors.find(
		(descriptor) => normalizePidToken(descriptor.name) === normalized,
	);
	if (exact != null) {
		return exact.pid;
	}

	const partialMatches = mut3PidDescriptors.filter((descriptor) =>
		normalizePidToken(descriptor.name).includes(normalized),
	);
	if (partialMatches.length === 1) {
		const [match] = partialMatches;
		if (match != null) {
			return match.pid;
		}
	}
	if (partialMatches.length > 1) {
		throw new Error(
			`Ambiguous MUT-III PID name: ${input}. Matches: ${partialMatches
				.slice(0, 5)
				.map((descriptor) => descriptor.name)
				.join(", ")}`,
		);
	}

	throw new Error(
		`Unknown MUT-III PID name: ${input}. Try names like RPM, Boost Pressure, Timing Advance, or a synthetic PID such as 0x${mut3PidDescriptors[0]?.pid.toString(16)}.`,
	);
}

/**
 * Resolve protocol list by optional user filter.
 *
 * @param {string | undefined} filter
 * @returns {EcuProtocol[]}
 */
function resolveProtocols(filter) {
	if (!filter) {
		return registeredProtocols;
	}

	const target = normalizeProtocolName(filter);
	const matches = protocolRegistry.filter((entry) => {
		const protocolName = normalizeProtocolName(entry.protocol.name);
		if (protocolName === target || protocolName.includes(target)) {
			return true;
		}

		return entry.aliases
			.map((alias) => normalizeProtocolName(alias))
			.some(
				(alias) =>
					alias === target || alias.includes(target) || target.includes(alias),
			);
	});

	if (matches.length === 0) {
		throw new Error(
			`No protocol matched: ${filter}. Available: ${supportedProtocolNames().join(", ")}`,
		);
	}

	return /** @type {EcuProtocol[]} */ (matches.map((entry) => entry.protocol));
}

/**
 * Parse a comma-separated PID list input.
 *
 * Defaults to Engine RPM (0x0C) when unset.
 *
 * @param {string | undefined} input
 * @param {number[]} [defaultPids]
 * @returns {number[]}
 */
function parsePidList(input, defaultPids = [0x0c]) {
	if (!input) {
		return defaultPids;
	}

	const values = input
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);

	if (values.length === 0) {
		return defaultPids;
	}

	return values.map((value) => parseNumericPidValue(value));
}

/**
 * Resolve log PIDs using protocol-aware defaults and parsing.
 *
 * @param {EcuProtocol[]} protocols
 * @param {string | undefined} input
 * @returns {number[]}
 */
function resolveLogPids(protocols, input) {
	const [firstProtocol] = protocols;
	if (
		protocols.length === 1 &&
		firstProtocol != null &&
		isMut3Protocol(firstProtocol)
	) {
		const mut3Defaults = resolveMut3DefaultPids(DEFAULT_MUT3_PID_NAMES);
		if (!input) {
			return mut3Defaults;
		}
		const values = input
			.split(",")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		if (values.length === 0) {
			return mut3Defaults;
		}
		return values.map((value) => resolveMut3Pid(value));
	}

	return parsePidList(input, [0x0c]);
}

/**
 * Render command-specific summary markdown.
 *
 * @param {Record<string, unknown>} summary
 * @returns {string}
 */
function formatOperationSummary(summary) {
	const entries = Object.entries(summary)
		.map(([key, value]) => {
			if (key === "sampledFrames" && Array.isArray(value)) {
				if (value.length === 0) {
					return "- sampledFrames: []";
				}
				const lines = value.map((frame, index) => {
					const record =
						frame && typeof frame === "object"
							? /** @type {{ timestamp?: unknown; pid?: unknown; value?: unknown; unit?: unknown }} */ (
									frame
								)
							: {};
					return `  - [${index}] t=${String(record.timestamp)} pid=${String(record.pid)} value=${String(record.value)} unit=${String(record.unit ?? "")}`;
				});
				return ["- sampledFrames:", ...lines].join("\n");
			}
			if (typeof value === "object" && value !== null) {
				return `- ${key}: ${JSON.stringify(value)}`;
			}
			return `- ${key}: ${String(value)}`;
		})
		.join("\n");

	if (!entries.length) {
		return "";
	}

	return `\n## Operation Result\n\n${entries}\n`;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Uint8Array} data
 * @returns {string}
 */
function formatHexBytes(data) {
	return Array.from(data)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join(" ");
}

/**
 * @param {Uint8Array} data
 * @returns {string}
 */
function formatAsciiBytes(data) {
	return Array.from(data)
		.map((byte) =>
			byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
		)
		.join("");
}

/**
 * @param {string | undefined} input
 * @returns {Uint8Array}
 */
function parseHexInput(input) {
	if (!input) {
		throw new Error(
			'Raw mode requires --data with hex bytes, for example "01 0c" or "10 03".',
		);
	}

	const normalized = input.replace(/,/g, " ").trim();
	if (!normalized) {
		throw new Error("Raw mode requires non-empty --data.");
	}

	const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
	const bytes = tokens.map((token) => {
		const cleaned = token.toLowerCase().startsWith("0x")
			? token.slice(2)
			: token;
		if (!/^[0-9a-fA-F]{1,2}$/.test(cleaned)) {
			throw new Error(`Invalid hex byte: ${token}`);
		}
		return Number.parseInt(cleaned, 16);
	});
	return Uint8Array.from(bytes);
}

/**
 * Extract the latest successful OPERATION event details.
 *
 * @param {DiagnosticResult} result
 * @returns {Record<string, unknown> | null}
 */
function getLatestOperationSummary(result) {
	for (let i = result.events.length - 1; i >= 0; i -= 1) {
		const event = result.events[i];
		if (event == null) {
			continue;
		}
		if (
			event.stage === DiagnosticStage.OPERATION &&
			event.status === DiagnosticStatus.SUCCESS
		) {
			return event.details ?? null;
		}
	}

	return null;
}

/**
 * Convert internal DiagnosticEvent to formatter-compatible format.
 *
 * @param {DiagnosticEvent} event
 * @returns {FormattedDiagnosticEvent}
 */
function convertEvent(event) {
	const converted = /** @type {FormattedDiagnosticEvent} */ ({
		stage: event.stage,
		status: event.status,
		timestamp: event.timestamp,
		summary: event.summary,
	});
	if (event.duration != null) {
		converted.duration = event.duration;
	}
	if (event.details !== undefined) {
		converted.details = event.details;
	}
	return converted;
}

/**
 * Convert internal DiagnosticResult to formatter-compatible format.
 *
 * @param {DiagnosticResult} result
 * @returns {FormattedDiagnosticResult}
 */
function convertResult(result) {
	/** @type {FormattedDiagnosticResult} */
	const formattedResult = {
		device: null,
		connection: null,
		protocol: null,
		events: [],
	};

	formattedResult.device = result.device
		? { id: result.device.id, name: result.device.name }
		: null;
	formattedResult.connection = result.connection
		? {
				deviceInfo: {
					id: result.connection.deviceInfo.id,
					name: result.connection.deviceInfo.name,
				},
			}
		: null;
	formattedResult.protocol = result.protocol
		? { name: result.protocol.name }
		: null;
	formattedResult.events = result.events.map(convertEvent);
	if (result.error != null) {
		formattedResult.error = result.error;
	}

	return formattedResult;
}

/**
 * Best-effort cleanup helper to avoid leaving transport handles open in CLI mode.
 *
 * @param {DiagnosticResult} result
 * @returns {Promise<void>}
 */
async function closeDiagnosticConnection(result) {
	if (result.connection == null) {
		return;
	}

	try {
		await result.connection.close();
	} catch {
		// Ignore cleanup failures during process shutdown.
	}
}

/**
 * Handle diagnostic events for verbose output.
 *
 * @param {boolean} verbose
 * @param {((event: DiagnosticEvent) => void)} [onEvent]
 * @returns {(event: DiagnosticEvent) => void}
 */
function createEventHandler(verbose, onEvent) {
	return (event) => {
		if (verbose) {
			const statusIcon =
				event.status === DiagnosticStatus.SUCCESS
					? "✓"
					: event.status === DiagnosticStatus.FAILURE
						? "✗"
						: "○";
			console.error(`  ${statusIcon} [${event.stage}] ${event.summary}`);
		}
		if (onEvent) {
			onEvent(event);
		}
	};
}

/**
 * Build options for runDiagnostic without adding `undefined` to optional fields.
 *
 * @param {ListDeviceOptions | ConnectDeviceOptions | ProbeDeviceOptions | LogDeviceOptions | ReadRomDeviceOptions} opts
 * @param {EcuProtocol[]} protocols
 * @param {"none" | "log" | "read-rom"} operation
 * @param {Partial<DiagnosticOptions>} operationOptions
 * @returns {DiagnosticOptions}
 */
function buildDiagnosticOptions(opts, protocols, operation, operationOptions) {
	/** @type {DiagnosticOptions} */
	const diagnosticOptions = {
		protocols,
		operation,
		traceWriter: null,
		...operationOptions,
	};
	if (opts.device != null) {
		diagnosticOptions.deviceId = opts.device;
	}
	return diagnosticOptions;
}

/**
 * List connected devices.
 *
 * @param {ListDeviceOptions} opts
 * @returns {Promise<void>}
 */
async function listDevices(opts) {
	const transport = new OpenPort2Transport(
		await createOpenPortRuntime(opts.transport),
	);

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	try {
		if (opts.verbose) {
			console.error("Enumerating devices...");
		}

		const devices = await transport.listDevices();

		if (opts.verbose) {
			console.error(`Found ${devices.length} device(s)`);
		}

		// Create a simple result for the formatter
		/** @type {DiagnosticResult} */
		const result = {
			device: devices[0] ?? null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.ENUMERATE,
					status: DiagnosticStatus.SUCCESS,
					timestamp: Date.now(),
					summary: `Found ${devices.length} device(s)`,
					details: { deviceCount: devices.length },
				},
			],
		};

		// Format and output
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}
		const output = formatDiagnosticOutput(
			"list",
			convertResult(result),
			tracePath,
		);
		console.log(output);
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.ENUMERATE,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}
		const output = formatDiagnosticOutput(
			"list",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Connect to a device.
 *
 * @param {ConnectDeviceOptions} opts
 * @returns {Promise<void>}
 */
async function connectDevice(opts) {
	const transport = new OpenPort2Transport(
		await createOpenPortRuntime(opts.transport),
	);

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	const eventHandler = createEventHandler(opts.verbose ?? false);

	try {
		if (opts.verbose) {
			console.error("Running diagnostic workflow...");
		}

		const protocols = resolveProtocols(opts.protocol);
		const result = await runDiagnostic(
			transport,
			buildDiagnosticOptions(opts, protocols, "none", {
				onEvent: eventHandler,
				traceWriter: traceWriter ?? null,
			}),
		);

		await closeDiagnosticConnection(result);

		// Close trace writer
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		// Format and output
		const output = formatDiagnosticOutput(
			"connect",
			convertResult(result),
			tracePath,
		);
		console.log(output);

		if (result.error) {
			throw result.error;
		}
	} catch (error) {
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.CONNECT,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		const output = formatDiagnosticOutput(
			"connect",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Probe for protocols.
 *
 * @param {ProbeDeviceOptions} opts
 * @returns {Promise<void>}
 */
async function probeDevice(opts) {
	const transport = new OpenPort2Transport(
		await createOpenPortRuntime(opts.transport),
	);

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	const eventHandler = createEventHandler(opts.verbose ?? false);

	try {
		if (opts.verbose) {
			console.error("Probing for protocols...");
		}

		const protocols = resolveProtocols(opts.protocol);
		const result = await runDiagnostic(
			transport,
			buildDiagnosticOptions(opts, protocols, "none", {
				onEvent: eventHandler,
				traceWriter: traceWriter ?? null,
			}),
		);

		await closeDiagnosticConnection(result);

		// Close trace writer
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		// Format and output
		const output = formatDiagnosticOutput(
			"probe",
			convertResult(result),
			tracePath,
		);
		console.log(output);

		if (result.error) {
			throw result.error;
		}
	} catch (error) {
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.PROBE,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		const output = formatDiagnosticOutput(
			"probe",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Run a logging probe.
 *
 * @param {LogDeviceOptions} opts
 * @returns {Promise<void>}
 */
async function logDevice(opts) {
	const transport = new OpenPort2Transport(
		await createOpenPortRuntime(opts.transport),
	);

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	const eventHandler = createEventHandler(opts.verbose ?? false);

	try {
		if (opts.verbose) {
			console.error(`Running log probe for ${opts.duration ?? 1000}ms...`);
		}

		const protocols = resolveProtocols(opts.protocol);
		const result = await runDiagnostic(
			transport,
			buildDiagnosticOptions(opts, protocols, "log", {
				logDuration: Number(opts.duration ?? 1000),
				logPids: resolveLogPids(protocols, opts.pids),
				onEvent: eventHandler,
				traceWriter: traceWriter ?? null,
			}),
		);
		const operationSummary = getLatestOperationSummary(result);

		await closeDiagnosticConnection(result);

		// Close trace writer
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		// Format and output
		const output = formatDiagnosticOutput(
			"log",
			convertResult(result),
			tracePath,
		);
		console.log(`${output}${formatOperationSummary(operationSummary || {})}`);

		if (result.error) {
			throw result.error;
		}
	} catch (error) {
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.OPERATION,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		const output = formatDiagnosticOutput(
			"log",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Run a ROM read (dry run).
 *
 * @param {ReadRomDeviceOptions} opts
 * @returns {Promise<void>}
 */
async function readRomDevice(opts) {
	const transport = new OpenPort2Transport(
		await createOpenPortRuntime(opts.transport),
	);

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	const eventHandler = createEventHandler(opts.verbose ?? false);

	try {
		if (opts.verbose) {
			console.error(
				opts.dryRun
					? "Running ROM read dry-run check..."
					: "Running ROM read...",
			);
		}

		const protocols = resolveProtocols(opts.protocol);
		/** @type {Partial<DiagnosticOptions>} */
		const operationOptions = {
			readRomDryRun: opts.dryRun ?? false,
			onEvent: eventHandler,
			traceWriter: traceWriter ?? null,
		};
		if (opts.out != null) {
			operationOptions.readRomOutPath = opts.out;
		}
		const result = await runDiagnostic(
			transport,
			buildDiagnosticOptions(opts, protocols, "read-rom", {
				...operationOptions,
			}),
		);
		const operationSummary = getLatestOperationSummary(result);

		if (!opts.dryRun && result.operationResult?.rom && opts.out) {
			await writeFile(opts.out, result.operationResult.rom);
			if (opts.verbose) {
				console.error(`  ✓ wrote ROM to ${opts.out}`);
			}
			if (operationSummary && operationSummary !== null) {
				operationSummary.out = opts.out;
			}
		}

		await closeDiagnosticConnection(result);

		// Close trace writer
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		// Format and output
		const output = formatDiagnosticOutput(
			"read-rom",
			convertResult(result),
			tracePath,
		);
		console.log(`${output}${formatOperationSummary(operationSummary || {})}`);

		if (result.error) {
			throw result.error;
		}
	} catch (error) {
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.OPERATION,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		const output = formatDiagnosticOutput(
			"read-rom",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Send raw bytes to the transport and print raw responses.
 *
 * @param {RawDeviceOptions} opts
 * @returns {Promise<void>}
 */
async function rawDevice(opts) {
	const transport = new OpenPort2Transport(
		await createOpenPortRuntime(opts.transport),
	);

	const request = parseHexInput(opts.data);
	const repeat = Math.max(1, Number(opts.repeat ?? 1));
	const delayMs = Math.max(0, Number(opts.delay ?? 0));
	const timeoutMs = Math.max(1, Number(opts.timeout ?? 500));

	/** @type {InitializableDeviceConnection | null} */
	let connection = null;
	let selectedDevice = null;

	try {
		if (opts.verbose) {
			console.error("Enumerating devices for raw request...");
		}

		const devices = await transport.listDevices();
		if (devices.length === 0) {
			throw new Error("No OpenPort 2.0 devices found.");
		}

		selectedDevice =
			opts.device != null
				? (devices.find((device) => device.id === opts.device) ?? null)
				: (devices[0] ?? null);

		if (selectedDevice == null) {
			throw new Error(`Device not found: ${opts.device}`);
		}

		if (opts.verbose) {
			console.error(`Connecting to ${selectedDevice.name}...`);
		}
		connection = await transport.connect(selectedDevice.id);

		if (typeof connection.initialize === "function") {
			if (opts.verbose) {
				console.error("Initializing connection...");
			}
			await connection.initialize();
		}

		const responses = [];
		for (let index = 0; index < repeat; index += 1) {
			if (opts.verbose) {
				console.error(
					`[raw ${index + 1}/${repeat}] tx ${formatHexBytes(request)}`,
				);
			}
			const response = await connection.sendFrame(request, timeoutMs);
			responses.push({
				iteration: index + 1,
				tx: formatHexBytes(request),
				rx: formatHexBytes(response),
				rxAscii: formatAsciiBytes(response),
				rxLength: response.length,
			});
			if (delayMs > 0 && index + 1 < repeat) {
				await sleep(delayMs);
			}
		}

		console.log("---");
		console.log("tool: device-inspect");
		console.log("command: raw");
		console.log(`device: ${selectedDevice.id}`);
		console.log(`transport: ${selectedDevice.name}`);
		console.log("status: success");
		console.log("---");
		console.log("## Raw Exchange");
		console.log("");
		for (const response of responses) {
			console.log(`- iteration: ${response.iteration}`);
			console.log(`- tx: ${response.tx}`);
			console.log(`- rx: ${response.rx}`);
			if (opts.ascii) {
				console.log(`- rx_ascii: ${response.rxAscii}`);
			}
			console.log(`- rx_length: ${response.rxLength}`);
			console.log("");
		}
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		console.log("---");
		console.log("tool: device-inspect");
		console.log("command: raw");
		console.log(`device: ${selectedDevice?.id ?? "none"}`);
		console.log(`transport: ${selectedDevice?.name ?? "none"}`);
		console.log("status: failure");
		console.log("---");
		console.log("## Raw Exchange");
		console.log("");
		console.log(`- error: ${err.message}`);
		throw error;
	} finally {
		if (connection != null) {
			try {
				await connection.close();
			} catch {
				// Ignore close errors in CLI mode.
			}
		}
	}
}

// Create CLI with Sade
const prog = sade("inspect-device");

prog
	.version("1.0.0")
	.describe("Device diagnostics and protocol probing tool")
	.example("inspect-device list")
	.example("inspect-device connect --device openport2:ABC123")
	.example("inspect-device probe --verbose")
	.example("inspect-device log --duration 5000 --protocol mut3")
	.example("inspect-device read-rom --protocol bootloader --out ./dump.bin")
	.example("inspect-device read-rom --protocol mut3 --dry-run")
	.example('inspect-device raw --data "01 0c" --ascii');

// Global options
prog
	.option("-d, --device", "Specific device ID (otherwise uses first available)")
	.option(
		"-p, --protocol <protocol>",
		"Force a protocol by name (obd2, mut3, bootloader, subaru, uds)",
	)
	.option("-v, --verbose", "Enable verbose output")
	.option(
		"--transport <transport>",
		"Preferred transport backend (auto, usb, hid, serial)",
		"auto",
	)
	.option("--trace-file", "Write trace output to file");

// List subcommand
prog
	.command("list")
	.describe("Enumerate compatible OpenPort 2.0 devices")
	.action((opts) => {
		listDevices({
			device: opts.device,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
			transport: opts.transport,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Connect subcommand
prog
	.command("connect")
	.describe("Connect to a device and initialize transport")
	.action((opts) => {
		connectDevice({
			device: opts.device,
			protocol: opts.protocol,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
			transport: opts.transport,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Probe subcommand
prog
	.command("probe")
	.describe("Connect and probe for protocols via canHandle()")
	.action((opts) => {
		probeDevice({
			device: opts.device,
			protocol: opts.protocol,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
			transport: opts.transport,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Log subcommand
prog
	.command("log")
	.describe("Run a logging probe for specified duration")
	.option("--duration", "Duration in milliseconds", 1000)
	.option(
		"--pids",
		"Comma-separated PIDs. OBD-II accepts numeric PIDs like 0c,0d; MUT-III accepts synthetic PIDs like 0x8000 or names like RPM,Boost Pressure.",
	)
	.action((opts) => {
		logDevice({
			device: opts.device,
			protocol: opts.protocol,
			pids: opts.pids,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
			duration: opts.duration,
			transport: opts.transport,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Read ROM subcommand
prog
	.command("read-rom")
	.describe("Test ROM-read path (with optional dry-run)")
	.option("--dry-run", "Perform dry run without full ROM read", false)
	.option("--out", "Write ROM bytes to file path after successful read")
	.action((opts) => {
		readRomDevice({
			device: opts.device,
			protocol: opts.protocol,
			out: opts.out,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
			dryRun: opts.dryRun,
			transport: opts.transport,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Raw subcommand
prog
	.command("raw")
	.describe("Send raw bytes and print the raw response")
	.option("--data", 'Hex bytes to send, for example "01 0c" or "10 03"')
	.option("--repeat", "Number of times to send the request", 1)
	.option("--delay", "Delay in milliseconds between repeated requests", 0)
	.option("--timeout", "Per-request response timeout in milliseconds", 500)
	.option("--ascii", "Also render the response as ASCII when printable", false)
	.action((opts) => {
		rawDevice({
			device: opts.device,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
			data: opts.data,
			repeat: opts.repeat,
			delay: opts.delay,
			timeout: opts.timeout,
			ascii: opts.ascii,
			transport: opts.transport,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

prog.parse(process.argv);
