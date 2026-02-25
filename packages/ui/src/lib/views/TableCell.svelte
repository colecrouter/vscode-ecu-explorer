<script lang="ts">
	import type { Endianness, ScalarType, ValidationResult } from "@ecu-explorer/core";
	import { validateValue } from "@ecu-explorer/core";
	import { createEventDispatcher } from "svelte";
	import { getStepForDataType, getRangeForDataType } from "./table";

	const dispatch = createEventDispatcher<{
		commit: { bytes: Uint8Array };
		input: { value: string };
	}>();

	let {
		bytes,
		dtype,
		disabled = false,
		endianness = "le" as Endianness,
		scale = 1,
		offset = 0,
		min: minConstraint = undefined,
		max: maxConstraint = undefined,
	} = $props<{
		bytes: Uint8Array;
		dtype: ScalarType;
		disabled?: boolean;
		label?: string;
		endianness?: Endianness;
		scale?: number;
		offset?: number;
		min?: number;
		max?: number;
	}>();

	// Calculate step, min, and max based on data type
	const step = $derived(getStepForDataType(dtype, scale));
	const range = $derived(getRangeForDataType(dtype));
	const min = $derived(
		range.min === -Infinity ? undefined : range.min * scale + offset,
	);
	const max = $derived(
		range.max === Infinity ? undefined : range.max * scale + offset,
	);

	let draft = $state("");
	let isDirty = $state(false);
	let validationError = $state<ValidationResult | null>(null);
	const formatted = $derived(format(bytes));

	$effect(() => {
		if (!isDirty) {
			draft = formatted;
			validationError = null;
		}
	});

	function getDecimalPlaces(scale: number, dtype: ScalarType): number {
		if (dtype !== "f32" && scale === 1) return 0;

		// If scale is a power of 10, use that precision
		const scaleStr = scale.toString();
		if (scaleStr.includes(".")) {
			const decimals = scaleStr.split(".")[1]?.length || 0;
			return Math.min(decimals, 4); // Cap at 4 decimal places for compact display
		}

		// For other scales (e.g. 0.01953125), use up to 4 decimal places
		if (scale < 1) {
			return 4;
		}

		// Default to 0 for integers with scale >= 1, or 2 for floats
		return dtype === "f32" ? 2 : 0;
	}

	function format(source: Uint8Array): string {
		const numeric = decodeScalar(source, dtype, endianness);
		const scaled = numeric * scale + offset;

		const decimals = getDecimalPlaces(scale, dtype);
		if (decimals > 0) {
			// Use toFixed and then Number to remove trailing zeros
			return Number(scaled.toFixed(decimals)).toString();
		}

		return Math.round(scaled).toString();
	}

	function validateDraft(): void {
		const parsed = Number(draft);

		// Create validation context with scale/offset
		const validationContext = {
			dtype,
			min: minConstraint,
			max: maxConstraint,
			scale,
			offset,
		};

		// Validate the parsed value
		const result = validateValue(parsed, validationContext, {
			checkDataType: true,
			checkMinMax: true,
		});

		validationError = result.valid ? null : result;
	}

	function handleInput(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		draft = target.value;
		isDirty = true;

		// Run real-time validation
		validateDraft();

		dispatch("input", { value: draft });
	}

	function handleCommit(): void {
		// Only commit if the value has actually changed
		if (!isDirty) {
			return;
		}

		const parsed = Number(draft);
		if (!Number.isFinite(parsed)) {
			isDirty = false;
			draft = formatted;
			validationError = null;
			return;
		}

		// Check if there's a validation error - if so, don't commit
		if (validationError && !validationError.valid) {
			return;
		}

		// Round to appropriate precision before encoding
		const decimals = getDecimalPlaces(scale, dtype);
		const rounded =
			decimals > 0 ? Number(parsed.toFixed(decimals)) : Math.round(parsed);

		const scaled = rounded - offset;
		const raw = scale !== 0 ? scaled / scale : scaled;

		const encoded = encodeScalar(raw, dtype, endianness);
		dispatch("commit", { bytes: encoded });
		dispatch("input", { value: draft });
		isDirty = false;
		validationError = null;
	}

	function decodeScalar(
		bytes: Uint8Array,
		dtype: ScalarType,
		endianness: Endianness,
	): number {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		switch (dtype) {
			case "u8":
				return view.getUint8(0);
			case "i8":
				return view.getInt8(0);
			case "u16":
				return view.getUint16(0, endianness === "le");
			case "i16":
				return view.getInt16(0, endianness === "le");
			case "u32":
				return view.getUint32(0, endianness === "le");
			case "i32":
				return view.getInt32(0, endianness === "le");
			case "f32":
				return view.getFloat32(0, endianness === "le");
			default:
				return NaN;
		}
	}

	function encodeScalar(
		value: number,
		dtype: ScalarType,
		endianness: Endianness,
	): Uint8Array {
		const buffer = new ArrayBuffer(sizeOf(dtype));
		const view = new DataView(buffer);
		const littleEndian = endianness === "le";

		switch (dtype) {
			case "u8":
				view.setUint8(0, clamp(value, 0, 0xff));
				break;
			case "i8":
				view.setInt8(0, clamp(value, -0x80, 0x7f));
				break;
			case "u16":
				view.setUint16(0, clamp(value, 0, 0xffff), littleEndian);
				break;
			case "i16":
				view.setInt16(0, clamp(value, -0x8000, 0x7fff), littleEndian);
				break;
			case "u32":
				view.setUint32(0, clamp(value, 0, 0xffffffff), littleEndian);
				break;
			case "i32":
				view.setInt32(0, clamp(value, -0x80000000, 0x7fffffff), littleEndian);
				break;
			case "f32":
				view.setFloat32(0, value, littleEndian);
				break;
		}

		return new Uint8Array(buffer);
	}

	function sizeOf(dtype: ScalarType): number {
		switch (dtype) {
			case "u8":
			case "i8":
				return 1;
			case "u16":
			case "i16":
				return 2;
			case "u32":
			case "i32":
			case "f32":
				return 4;
		}
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.round(Math.min(Math.max(value, min), max));
	}
</script>

<div class="table-cell__container">
	<input
		type="number"
		class="table-cell__input"
		class:table-cell__input--error={validationError && !validationError.valid}
		bind:value={draft}
		{disabled}
		{step}
		{min}
		{max}
		data-dirty={isDirty ? "true" : undefined}
		oninput={handleInput}
		onblur={handleCommit}
		style="background-color: {validationError && !validationError.valid
			? '#fee2e2'
			: disabled
				? 'var(--vscode-editor-inactiveSelectionBackground)'
				: 'transparent'}"
	/>
	{#if validationError && !validationError.valid}
		<div class="table-cell__error">
			<div class="table-cell__error-message">{validationError.error}</div>
			{#if validationError.suggestion}
				<div class="table-cell__error-suggestion">
					{validationError.suggestion}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.table-cell__container {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.table-cell__input {
		font: inherit;
		padding: 0.375rem 0.25rem;
		border: none;
		width: 100%;
		flex: 1;
		box-sizing: border-box;
		text-align: center;

		/* CSS-based text contrast:
		   Compute text color based on background luminance using CSS custom properties.
		   Uses WCAG relative luminance formula: L = 0.299*R + 0.587*G + 0.114*B
		   Applied via color-mix() to blend white/black text based on --t gradient position.
		   Result: white text on dark backgrounds, black on light backgrounds for readability.
		*/
		color: var(--cell-text-color, inherit);
	}

	.table-cell__input:focus {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}

	.table-cell__input--error {
		border: 2px solid #dc2626;
		border-radius: 2px;
	}

	.table-cell__input:disabled {
		background-color: var(--vscode-editor-inactiveSelectionBackground);
		color: var(--vscode-disabledForeground);
	}

	/* Remove number input spinners for a cleaner look */
	.table-cell__input::-webkit-outer-spin-button,
	.table-cell__input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.table-cell__input[type="number"] {
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.table-cell__error {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background-color: #fecaca;
		border: 1px solid #dc2626;
		border-top: none;
		padding: 0.375rem 0.5rem;
		font-size: 0.75rem;
		color: #7f1d1d;
		z-index: 10;
		white-space: normal;
		word-wrap: break-word;
	}

	.table-cell__error-message {
		font-weight: 500;
		margin-bottom: 0.25rem;
	}

	.table-cell__error-suggestion {
		font-size: 0.7rem;
		opacity: 0.9;
		font-style: italic;
	}
</style>
