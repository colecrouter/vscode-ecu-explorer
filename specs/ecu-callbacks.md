# Spec: ECU Callback and Progress Reporting Interface

This document outlines the improved interface for ECU operations, including ROM reading/writing and live data streaming.

## Goals
- Provide human-readable status updates during long-running operations.
- Support protocol-specific events (e.g., "Security Access Granted") without breaking generic interfaces.
- Improve health monitoring for live data streams.
- Maintain backward compatibility where possible.

## Proposed Changes

### 1. Updated `RomProgress` Interface
The `RomProgress` interface is expanded to include a `message` field for human-readable status updates.

```typescript
export interface RomProgress {
    /** Current high-level phase of the operation */
    phase: "reading" | "writing" | "erasing" | "verifying" | "negotiating";
    /** Number of bytes processed in the current phase */
    bytesProcessed: number;
    /** Total bytes to be processed in the current phase */
    totalBytes: number;
    /** Percentage completion (0-100) */
    percentComplete: number;
    /** Optional estimate of time remaining */
    estimatedSecondsRemaining?: number;
    /** Human-readable status message (e.g., "Requesting Security Access...") */
    message?: string;
}
```

### 2. Generic Event Callback System
To handle specific ECU events or non-fatal errors, we introduce an `EcuEvent` type and an `onEvent` callback.

```typescript
export type EcuEventType = 
    | "info"      // General information
    | "warning"   // Non-fatal warning
    | "security"  // Security access events
    | "reset"     // ECU reset events
    | "protocol"; // Protocol-specific events

export interface EcuEvent {
    type: EcuEventType;
    code: string;    // Machine-readable code (e.g., "SECURITY_ACCESS_GRANTED")
    message: string; // Human-readable description
    data?: any;      // Optional metadata
}

// Updated EcuProtocol methods
readRom?(
    connection: DeviceConnection,
    onProgress: (progress: RomProgress) => void,
    onEvent?: (event: EcuEvent) => void,
): Promise<Uint8Array>;
```

### 3. Live Data Health Monitoring
Live data streaming now includes a health callback to report sample rates and dropped frames.

```typescript
export interface LiveDataHealth {
    /** Current samples per second */
    samplesPerSecond: number;
    /** Total frames received in current session */
    totalFrames: number;
    /** Number of dropped or malformed frames */
    droppedFrames: number;
    /** Last latency measurement in ms (if available) */
    latencyMs?: number;
    /** Status of the stream */
    status: "healthy" | "degraded" | "stalled";
}

// Updated streamLiveData
streamLiveData?(
    connection: DeviceConnection,
    pids: number[],
    onFrame: (frame: LiveDataFrame) => void,
    onHealth?: (health: LiveDataHealth) => void,
): LiveDataSession;
```

## Usage Examples

### ROM Write with Progress and Events
```typescript
await protocol.writeRom(connection, romData, 
    (progress) => {
        console.log(`[${progress.phase}] ${progress.percentComplete}% - ${progress.message}`);
    },
    (event) => {
        if (event.type === "security") {
            showNotification(`Security: ${event.message}`);
        }
    }
);
```

### Live Data with Health Monitoring
```typescript
const session = protocol.streamLiveData(connection, [0x0C, 0x0D], 
    (frame) => {
        updateDashboard(frame);
    },
    (health) => {
        if (health.status === "degraded") {
            console.warn(`Stream degraded: ${health.samplesPerSecond} Hz`);
        }
    }
);
```

## Implementation Plan
1. Update `packages/device/src/types.ts` with new interfaces.
2. Update `packages/device/src/index.ts` (`EcuProtocol` interface).
3. Update existing protocol implementations (UDS, Mitsubishi, Subaru, MUT3) to support new callbacks.
4. Update VSCode extension UI to display the new `message` and `health` data.
