/**
 * K-line (ISO 14230 / KWP2000) transport layer
 * Provides ISO 14230 framing, flow control, and device communication
 */

export { FlowControlManager, KLineTransaction } from "./flow-control.js";
export {
	calculateChecksum,
	decodeFrame,
	encodeFrame,
	extractPayload,
	getFrameLength,
	parseFrames,
	validateChecksum,
} from "./iso14230-framing.js";
export { KLineConnection, KLineTransport } from "./kline-transport.js";
export {
	type FlowControlConfig,
	FlowControlState,
	type Frame,
	type KLineHealth,
} from "./types.js";
