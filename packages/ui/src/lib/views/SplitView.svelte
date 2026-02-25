<script lang="ts">
	/**
	 * SplitView component for resizable split layout
	 *
	 * Provides a horizontal split layout with a draggable divider.
	 * Supports keyboard shortcuts, responsive design, and state persistence.
	 *
	 * Features:
	 * - Horizontal split layout (grid on left, chart on right)
	 * - Resizable divider with drag interaction
	 * - Minimum sizes (left: 300px, right: 400px)
	 * - Responsive: stacks vertically on mobile (less than 768px)
	 * - Keyboard shortcuts: Ctrl/Cmd + [ / ] to adjust split
	 * - Accessible with ARIA labels
	 *
	 * @component
	 * @example
	 * ```svelte
	 * <SplitView initialRatio={0.6}>
	 *   {#snippet leftContent()}
	 *     <div>Left pane content</div>
	 *   {/snippet}
	 *   {#snippet rightContent()}
	 *     <div>Right pane content</div>
	 *   {/snippet}
	 * </SplitView>
	 * ```
	 */

	import { onMount, onDestroy } from "svelte";
	import type { Snippet } from "svelte";

	/**
	 * Component props
	 * @typedef {Object} Props
	 * @property {Snippet} leftContent - Content for left pane (Svelte snippet)
	 * @property {Snippet} rightContent - Content for right pane (Svelte snippet)
	 * @property {number} [initialRatio=0.6] - Initial split ratio (0-1), default 0.6 (60/40 split)
	 */
	interface Props {
		leftContent: Snippet;
		rightContent: Snippet;
		initialRatio?: number; // 0-1, default 0.6 (60/40 split)
	}

	let { leftContent, rightContent, initialRatio = 0.6 }: Props = $props();

	// State
	let containerDiv = $state<HTMLDivElement | null>(null);
	let isDragging = $state(false);
	const syncedInitialRatio = $derived(initialRatio);
	let splitRatio = $state(0.6);
	let isMobile = $state(false);

	$effect(() => {
		splitRatio = syncedInitialRatio;
	});

	// Constants
	const MIN_LEFT_WIDTH = 300;
	const MIN_RIGHT_WIDTH = 400;
	const MOBILE_BREAKPOINT = 768;
	const KEYBOARD_ADJUST_STEP = 0.05; // 5% per keystroke

	/**
	 * Check if viewport is mobile size
	 */
	function checkMobile() {
		isMobile = window.innerWidth < MOBILE_BREAKPOINT;
	}

	/**
	 * Handle divider drag start
	 */
	function handleDragStart(event: MouseEvent) {
		if (isMobile) return;
		isDragging = true;
		event.preventDefault();
	}

	/**
	 * Handle divider drag move
	 */
	function handleDragMove(event: MouseEvent) {
		if (!isDragging || !containerDiv || isMobile) return;

		const containerRect = containerDiv.getBoundingClientRect();
		const containerWidth = containerRect.width;
		const mouseX = event.clientX - containerRect.left;

		// Calculate new ratio
		let newRatio = mouseX / containerWidth;

		// Apply minimum width constraints
		const minLeftRatio = MIN_LEFT_WIDTH / containerWidth;
		const maxLeftRatio = (containerWidth - MIN_RIGHT_WIDTH) / containerWidth;

		newRatio = Math.max(minLeftRatio, Math.min(maxLeftRatio, newRatio));

		splitRatio = newRatio;
	}

	/**
	 * Handle divider drag end
	 */
	function handleDragEnd() {
		isDragging = false;
	}

	/**
	 * Handle keyboard shortcuts
	 */
	function handleKeyDown(event: KeyboardEvent) {
		if (isMobile) return;

		// Ctrl/Cmd + [ to decrease left panel
		if ((event.ctrlKey || event.metaKey) && event.key === "[") {
			event.preventDefault();
			adjustSplitRatio(-KEYBOARD_ADJUST_STEP);
		}

		// Ctrl/Cmd + ] to increase left panel
		if ((event.ctrlKey || event.metaKey) && event.key === "]") {
			event.preventDefault();
			adjustSplitRatio(KEYBOARD_ADJUST_STEP);
		}
	}

	/**
	 * Adjust split ratio by delta
	 */
	function adjustSplitRatio(delta: number) {
		if (!containerDiv) return;

		const containerWidth = containerDiv.getBoundingClientRect().width;
		const minLeftRatio = MIN_LEFT_WIDTH / containerWidth;
		const maxLeftRatio = (containerWidth - MIN_RIGHT_WIDTH) / containerWidth;

		let newRatio = splitRatio + delta;
		newRatio = Math.max(minLeftRatio, Math.min(maxLeftRatio, newRatio));

		splitRatio = newRatio;
	}

	/**
	 * Handle window resize
	 */
	function handleResize() {
		checkMobile();

		// Revalidate split ratio on resize
		if (!isMobile && containerDiv) {
			const containerWidth = containerDiv.getBoundingClientRect().width;
			const minLeftRatio = MIN_LEFT_WIDTH / containerWidth;
			const maxLeftRatio = (containerWidth - MIN_RIGHT_WIDTH) / containerWidth;

			if (splitRatio < minLeftRatio) {
				splitRatio = minLeftRatio;
			} else if (splitRatio > maxLeftRatio) {
				splitRatio = maxLeftRatio;
			}
		}
	}

	// Lifecycle
	onMount(() => {
		checkMobile();

		// Add event listeners
		window.addEventListener("mousemove", handleDragMove);
		window.addEventListener("mouseup", handleDragEnd);
		window.addEventListener("resize", handleResize);
		document.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("mousemove", handleDragMove);
			window.removeEventListener("mouseup", handleDragEnd);
			window.removeEventListener("resize", handleResize);
			document.removeEventListener("keydown", handleKeyDown);
		};
	});

	onDestroy(() => {
		// Cleanup handled by onMount return
	});

	// Derived styles
	const leftStyle = $derived(
		isMobile
			? ""
			: `flex: 0 0 ${splitRatio * 100}%; min-width: ${MIN_LEFT_WIDTH}px;`,
	);
	const rightStyle = $derived(
		isMobile
			? ""
			: `flex: 0 0 ${(1 - splitRatio) * 100}%; min-width: ${MIN_RIGHT_WIDTH}px;`,
	);
</script>

<div
	bind:this={containerDiv}
	class="split-view"
	class:mobile={isMobile}
	class:dragging={isDragging}
>
	<div class="split-pane left" style={leftStyle}>
		{@render leftContent()}
	</div>

	{#if !isMobile}
		<div
			class="split-divider"
			role="slider"
			aria-orientation="vertical"
			aria-label="Resize split view"
			aria-valuenow={Math.round(splitRatio * 100)}
			aria-valuemin={Math.round(
				(MIN_LEFT_WIDTH /
					(containerDiv?.getBoundingClientRect().width || 1000)) *
					100,
			)}
			aria-valuemax={Math.round(
				(((containerDiv?.getBoundingClientRect().width || 1000) -
					MIN_RIGHT_WIDTH) /
					(containerDiv?.getBoundingClientRect().width || 1000)) *
					100,
			)}
			tabindex="0"
			onmousedown={handleDragStart}
			onkeydown={(e) => {
				if (e.key === "ArrowLeft") {
					e.preventDefault();
					adjustSplitRatio(-KEYBOARD_ADJUST_STEP);
				} else if (e.key === "ArrowRight") {
					e.preventDefault();
					adjustSplitRatio(KEYBOARD_ADJUST_STEP);
				}
			}}
		>
			<div class="split-divider-handle"></div>
		</div>
	{/if}

	<div class="split-pane right" style={rightStyle}>
		{@render rightContent()}
	</div>
</div>

<style>
	.split-view {
		display: flex;
		width: 100%;
		height: 100%;
		overflow: hidden;
		position: relative;
	}

	.split-view.mobile {
		flex-direction: column;
	}

	.split-view.dragging {
		cursor: col-resize;
		user-select: none;
	}

	.split-pane {
		overflow: auto;
		position: relative;
	}

	.split-pane.left {
		border-right: 1px solid var(--vscode-panel-border);
	}

	.split-view.mobile .split-pane.left {
		border-right: none;
		border-bottom: 1px solid var(--vscode-panel-border);
		flex: 1 1 auto;
		min-height: 300px;
	}

	.split-view.mobile .split-pane.right {
		flex: 1 1 auto;
		min-height: 400px;
	}

	.split-divider {
		width: 8px;
		background-color: var(--vscode-panel-border);
		cursor: col-resize;
		position: relative;
		flex-shrink: 0;
		transition: background-color 0.2s ease;
	}

	.split-divider:hover,
	.split-divider:focus {
		background-color: var(--vscode-focusBorder);
		outline: none;
	}

	.split-divider:focus {
		box-shadow: 0 0 0 2px var(--vscode-focusBorder);
	}

	.split-divider-handle {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 3px;
		height: 40px;
		background-color: var(--vscode-foreground);
		opacity: 0.3;
		border-radius: 2px;
		pointer-events: none;
	}

	.split-divider:hover .split-divider-handle,
	.split-divider:focus .split-divider-handle {
		opacity: 0.6;
	}

	/* Accessibility: High contrast mode */
	@media (prefers-contrast: high) {
		.split-divider {
			border: 1px solid var(--vscode-contrastBorder);
		}

		.split-divider-handle {
			opacity: 1;
		}
	}

	/* Performance: Use GPU acceleration for smooth dragging */
	.split-view.dragging .split-pane {
		will-change: flex-basis;
	}
</style>
