/**
 * Context IPC Handler
 *
 * Listens for context update messages from the VS Code extension on stdin.
 * Messages are JSON-encoded and must have the format:
 *
 * {"type": "context-update", "data": {...OpenDocumentsContext}}
 *
 * Since the MCP server runs as a child process with stdio transport,
 * we monitor stdin for special messages before the MCP protocol takes over.
 */

interface ContextUpdateMessage {
	type: "context-update";
	data: Record<string, unknown>;
}

/**
 * Listener for context updates
 */
export type ContextUpdateListener = (data: Record<string, unknown>) => void;

/**
 * Set up stdin monitoring for context updates
 */
export function setupContextIpc(
	onContextUpdate: ContextUpdateListener,
): () => void {
	// Store the input event listener so we can remove it later
	const listener = (chunk: Uint8Array) => {
		try {
			const text = new TextDecoder("utf-8").decode(chunk);
			// Try to parse as JSON
			const lines = text.split("\n");
			for (const line of lines) {
				if (!line.trim()) continue;

				try {
					const message = JSON.parse(line) as ContextUpdateMessage;
					if (message.type === "context-update" && message.data) {
						onContextUpdate(message.data);
					}
				} catch {
					// Not a JSON message, skip
					// This is expected - MCP protocol messages are also on stdin
				}
			}
		} catch (err) {
			console.error("Error processing context update:", err);
		}
	};

	// Only attach if stdin is available and not already being used
	// Note: MCP SDK will handle most stdin reading, so we use a secondary
	// parser that gracefully ignores non-JSON or non-context-update messages
	if (process.stdin && typeof process.stdin.on === "function") {
		process.stdin.on("data", listener);
	}

	// Return cleanup function
	return () => {
		if (process.stdin && typeof process.stdin.off === "function") {
			process.stdin.off("data", listener);
		}
	};
}
