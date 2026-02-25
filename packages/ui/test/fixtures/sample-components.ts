/**
 * Helper functions to create test components
 */

export function createTableGridProps(
	columns: number = 16,
	rows: number = 16,
	data: number[] = [],
) {
	return {
		columns,
		rows,
		data: data.length > 0 ? data : Array(columns * rows).fill(0),
		onCellChange: (_row: number, _col: number, _value: number) => {},
		onCellCommit: (_row: number, _col: number, _value: number) => {},
	};
}

export function createTableViewProps(
	name: string = "Test Table",
	type: "1d" | "2d" | "3d" = "2d",
	columns: number = 16,
	rows: number = 16,
) {
	return {
		name,
		type,
		columns,
		rows,
		data: Array(columns * rows).fill(0),
		staged: new Map(),
		onStage: (_key: string, _value: number) => {},
		onCommit: () => {},
		onUndo: () => {},
		onRedo: () => {},
	};
}

export function createColorMapProps(
	data: number[] = [],
	min: number = 0,
	max: number = 255,
) {
	return {
		data: data.length > 0 ? data : Array(256).fill(128),
		min,
		max,
		colorScheme: "viridis",
	};
}

export function createLayerSelectorProps(
	currentLayer: number = 0,
	totalLayers: number = 8,
) {
	return {
		currentLayer,
		totalLayers,
		onLayerChange: (layer: number) => {},
	};
}

export function createCellProps(
	row: number = 0,
	col: number = 0,
	value: number = 0,
	isEditing: boolean = false,
) {
	return {
		row,
		col,
		value,
		isEditing,
		onEdit: () => {},
		onCommit: (value: number) => {},
		onCancel: () => {},
	};
}

export function createAxisSelectorProps(
	axes: Array<{ name: string; values: number[] }> = [],
) {
	return {
		axes:
			axes.length > 0
				? axes
				: ([
						{
							name: "X Axis",
							values: Array(16)
								.fill(0)
								.map((_, i) => i * 10),
						},
						{
							name: "Y Axis",
							values: Array(16)
								.fill(0)
								.map((_, i) => i * 10),
						},
					] as const),
		onAxisChange: (_axis: string, _index: number) => {},
	};
}

export function createToolbarProps() {
	return {
		onUndo: () => {},
		onRedo: () => {},
		onExport: () => {},
		onImport: () => {},
		canUndo: true,
		canRedo: false,
	};
}

export function createStatusBarProps(
	selectedCell: { row: number; col: number } | null = null,
	isDirty: boolean = false,
) {
	return {
		selectedCell,
		isDirty,
		message: "Ready",
	};
}

export function createModalProps(
	title: string = "Test Modal",
	isOpen: boolean = true,
	onClose: () => void = () => {},
) {
	return {
		title,
		isOpen,
		onClose,
	};
}

export function createInputProps(
	value: string = "",
	placeholder: string = "Enter value",
	onChange: (_value: string) => void = () => {},
) {
	return {
		value,
		placeholder,
		onChange,
		type: "text",
	};
}

export function createButtonProps(
	label: string = "Click me",
	onClick: () => void = () => {},
	disabled: boolean = false,
) {
	return {
		label,
		onClick,
		disabled,
	};
}

export function createSelectProps(
	options: Array<{ label: string; value: string }> = [],
	value: string = "",
	onChange: (value: string) => void = () => {},
) {
	return {
		options:
			options.length > 0
				? options
				: [
						{ label: "Option 1", value: "opt1" },
						{ label: "Option 2", value: "opt2" },
					],
		value,
		onChange,
	};
}

export function createSliderProps(
	min: number = 0,
	max: number = 100,
	value: number = 50,
	onChange: (_value: number) => void = () => {},
) {
	return {
		min,
		max,
		value,
		onChange,
		step: 1,
	};
}

export function createCheckboxProps(
	label: string = "Check me",
	checked: boolean = false,
	onChange: (_checked: boolean) => void = () => {},
) {
	return {
		label,
		checked,
		onChange,
	};
}

export function createTooltipProps(
	content: string = "Tooltip content",
	position: "top" | "bottom" | "left" | "right" = "top",
) {
	return {
		content,
		position,
	};
}

export function createNotificationProps(
	message: string = "Notification",
	type: "info" | "success" | "warning" | "error" = "info",
	duration: number = 3000,
) {
	return {
		message,
		type,
		duration,
	};
}
