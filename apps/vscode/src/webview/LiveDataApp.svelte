<script lang="ts">
	import type { PidDescriptor, LiveDataFrame } from "@ecu-explorer/device";

	const vscode = acquireVsCodeApi();

	let supportedPids: PidDescriptor[] = [];
	let selectedPids: Set<number> = new Set();
	let liveData: Map<number, LiveDataFrame> = new Map();
	let isStreaming = false;
	let isRecording = false;
	let startTime: number | null = null;
	let duration = "00:00";

	window.addEventListener("message", (event) => {
		const message = event.data;
		switch (message.type) {
			case "supportedPids":
				supportedPids = message.pids;
				break;
			case "data":
				liveData.set(message.frame.pid, message.frame);
				liveData = liveData; // trigger reactivity
				break;
			case "streamingStarted":
				isStreaming = true;
				startTime = Date.now();
				updateDuration();
				break;
			case "streamingStopped":
				isStreaming = false;
				isRecording = false;
				startTime = null;
				break;
		}
	});

	function togglePid(pid: number) {
		if (selectedPids.has(pid)) {
			selectedPids.delete(pid);
		} else {
			selectedPids.add(pid);
		}
		selectedPids = selectedPids;
	}

	function startStreaming() {
		vscode.postMessage({
			type: "startStreaming",
			pids: Array.from(selectedPids),
			record: isRecording,
		});
	}

	function stopStreaming() {
		vscode.postMessage({ type: "stopStreaming" });
	}

	function updateDuration() {
		if (startTime && isStreaming) {
			const diff = Math.floor((Date.now() - startTime) / 1000);
			const mins = Math.floor(diff / 60)
				.toString()
				.padStart(2, "0");
			const secs = (diff % 60).toString().padStart(2, "0");
			duration = `${mins}:${secs}`;
			setTimeout(updateDuration, 1000);
		}
	}

	// Signal ready
	vscode.postMessage({ type: "ready" });
</script>

<main>
	<header>
		<h1>Live Data</h1>
		<div class="controls">
			{#if !isStreaming}
				<label>
					<input type="checkbox" bind:checked={isRecording} />
					Record to CSV
				</label>
				<button on:click={startStreaming} disabled={selectedPids.size === 0}>
					Start Streaming
				</button>
			{:else}
				<span class="status">
					{isRecording ? "🔴 Recording" : "🟢 Streaming"} - {duration}
				</span>
				<button on:click={stopStreaming}>Stop</button>
			{/if}
		</div>
	</header>

	<section class="pid-selector">
		<h2>Select PIDs</h2>
		<div class="pid-grid">
			{#each supportedPids as pid}
				<button
					class="pid-chip"
					class:selected={selectedPids.has(pid.pid)}
					on:click={() => togglePid(pid.pid)}
					disabled={isStreaming}
				>
					{pid.name}
				</button>
			{/each}
		</div>
	</section>

	<section class="data-display">
		<h2>Real-time Data</h2>
		<div class="data-grid">
			{#each Array.from(selectedPids) as pidId}
				{@const descriptor = supportedPids.find((p) => p.pid === pidId)}
				{@const data = liveData.get(pidId)}
				<div class="data-card">
					<span class="label"
						>{descriptor?.name ?? `PID 0x${pidId.toString(16)}`}</span
					>
					<span class="value">{data?.value.toFixed(2) ?? "--"}</span>
					<span class="unit">{descriptor?.unit ?? ""}</span>
				</div>
			{/each}
		</div>
	</section>
</main>

<style>
	main {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--vscode-panel-border);
		padding-bottom: 1rem;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.status {
		font-weight: bold;
	}

	.pid-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.pid-chip {
		padding: 0.25rem 0.75rem;
		border-radius: 1rem;
		border: 1px solid var(--vscode-button-background);
		background: transparent;
		color: var(--vscode-foreground);
		cursor: pointer;
	}

	.pid-chip.selected {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}

	.pid-chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.data-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1rem;
	}

	.data-card {
		background: var(--vscode-sideBar-background);
		padding: 1rem;
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid var(--vscode-panel-border);
	}

	.label {
		font-size: 0.8rem;
		opacity: 0.8;
	}

	.value {
		font-size: 2rem;
		font-weight: bold;
	}

	.unit {
		font-size: 0.9rem;
		opacity: 0.7;
	}
</style>
