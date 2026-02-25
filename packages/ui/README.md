# @repo/ui - ECU Explorer UI Components

Svelte 5 components for ROM table visualization and editing, built for the ECU Explorer VS Code extension.

## Overview

This package provides browser-only Svelte components for:
- Interactive table grids with editing capabilities
- Chart visualization (1D line plots, 2D heatmaps, 3D layer views)
- Split view layouts with resizable dividers
- Heatmap color computation
- State management for tables and charts

## Components

### Table Components

#### TableGrid.svelte
Main table grid component with multi-cell selection, editing, and keyboard navigation.

**Props**:
- `tableState: TableState` - Table state manager
- `onCellSelect?: (row: number, col: number) => void` - Cell selection callback

**Features**:
- Multi-cell selection (mouse and keyboard)
- Inline editing with validation
- Keyboard navigation (arrow keys, Tab, Enter)
- Clipboard operations (copy/cut as TSV)
- Heatmap colors for 2D/3D tables
- Undo/redo support

#### TableCell.svelte
Individual cell renderer with editing and formatting.

**Props**:
- `value: number` - Cell value
- `isEditing: boolean` - Edit mode flag
- `isSelected: boolean` - Selection state
- `color?: string` - Background color for heatmap
- `precision?: number` - Decimal precision

### Chart Components

#### Chart.svelte
Main chart visualization component using Plotly.js.

**Props**:
- `chartState: ChartState` - Chart state manager
- `onCellSelect?: (row: number, col: number) => void` - Cell selection callback

**Features**:
- 1D line plots with axis labels
- 2D heatmaps with color gradients
- 3D tables as layer views
- Zoom and pan controls
- Click-to-select cell integration
- Hover tooltips
- Lazy loading of Plotly.js
- Canvas rendering for performance

**Example**:
```jsx
import { Chart, ChartState } from '@repo/ui';

const chartState = new ChartState(tableSnapshot);

<Chart 
  chartState={chartState} 
  onCellSelect={(row, col) => console.log(`Selected: ${row}, ${col}`)}
/>
```

#### ChartControls.svelte
Chart control panel with zoom, pan, and layer navigation.

**Props**:
- `chartState: ChartState` - Chart state manager

**Features**:
- Zoom in/out/reset buttons
- Pan controls (directional arrows)
- Layer selector for 3D tables
- View options (grid toggle)
- Keyboard shortcut support

#### ChartTooltip.svelte
Hover tooltip component for chart elements.

**Props**:
- `hoveredCell: HoveredCell | null` - Hovered cell data
- `snapshot: TableSnapshot | null` - Table snapshot
- `mousePosition?: { x: number; y: number }` - Mouse position

**Features**:
- Shows X/Y axis values with labels
- Shows Z value (data value) with formatting
- Smooth fade in/out transitions
- Follows mouse cursor

#### SplitView.svelte
Resizable split layout component.

**Props**:
- `leftContent: Snippet` - Left pane content
- `rightContent: Snippet` - Right pane content
- `initialRatio?: number` - Initial split ratio (0-1, default 0.6)

**Features**:
- Horizontal split layout
- Draggable divider
- Minimum sizes (left: 300px, right: 400px)
- Keyboard shortcuts (Ctrl/Cmd + [ / ])
- Responsive (stacks on mobile)

**Example**:
```svelte
<SplitView initialRatio={0.6}>
  {#snippet leftContent()}
    <TableGrid {tableState} />
  {/snippet}
  {#snippet rightContent()}
    <Chart {chartState} />
  {/snippet}
</SplitView>
```

## State Management

### ChartState Class

Manages chart state and interactions.

**Location**: [`src/lib/views/chart.svelte.ts`](src/lib/views/chart.svelte.ts)

**Constructor**:
```typescript
new ChartState(snapshot: TableSnapshot | null)
```

**Properties**:
- `snapshot: TableSnapshot | null` - Current table snapshot
- `chartType: ChartType` - Chart type ('line' | 'heatmap' | 'surface')
- `zoomLevel: number` - Zoom level (1-5)
- `panX: number` - Pan X offset
- `panY: number` - Pan Y offset
- `currentLayer: number` - Current layer for 3D tables
- `showGrid: boolean` - Grid visibility
- `hoveredCell: HoveredCell | null` - Hovered cell data

**Methods**:
- `setSnapshot(snapshot: TableSnapshot | null)` - Update snapshot
- `zoomIn()` - Zoom in by 20%
- `zoomOut()` - Zoom out by 20%
- `resetZoom()` - Reset to 1x zoom
- `pan(dx: number, dy: number)` - Pan by delta
- `setLayer(layer: number)` - Set current layer
- `nextLayer()` - Go to next layer
- `prevLayer()` - Go to previous layer
- `toggleGrid()` - Toggle grid visibility
- `setHoveredCell(cell: HoveredCell | null)` - Set hovered cell

**Example**:
```typescript
import { ChartState } from '@repo/ui';

const chartState = new ChartState(tableSnapshot);

// Zoom in
chartState.zoomIn();

// Pan right
chartState.pan(10, 0);

// Next layer (3D tables)
chartState.nextLayer();
```

### TableState Class

Manages table state and editing.

**Location**: [`src/lib/views/table.svelte.ts`](src/lib/views/table.svelte.ts)

See existing documentation for TableState API.

## Utilities

### Chart Utilities

**Location**: [`src/lib/views/chartUtils.ts`](src/lib/views/chartUtils.ts)

#### downsampleData()
Downsample large datasets using Largest-Triangle-Three-Buckets (LTTB) algorithm.

```typescript
function downsampleData(
  data: Array<{ x: number; y: number }>,
  threshold: number
): Array<{ x: number; y: number }>
```

**Parameters**:
- `data` - Input data points
- `threshold` - Target number of points (default: 10,000)

**Returns**: Downsampled data preserving visual shape

#### formatAxisValue()
Format axis values with appropriate precision.

```typescript
function formatAxisValue(value: number, precision?: number): string
```

**Parameters**:
- `value` - Value to format
- `precision` - Decimal precision (default: 2)

**Returns**: Formatted string

#### debounce()
Debounce function for performance optimization.

```typescript
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void
```

**Parameters**:
- `fn` - Function to debounce
- `delay` - Delay in milliseconds

**Returns**: Debounced function

### Color Map Utilities

**Location**: [`src/lib/views/colorMap.ts`](src/lib/views/colorMap.ts)

See existing documentation for color map utilities.

## Development

### Building

```sh
npm run build
```

### Testing

```sh
npm run test
npm run test:coverage
```

### Type Checking

```sh
npm run check
```

## Related Documentation

- [Graph Visualization User Guide](../../specs/graph-visualization-user-guide.md)
- [Graph Visualization Spec](../../specs/graph-visualization.md)
- [Architecture Documentation](../../ARCHITECTURE.md)
- [Development Guide](../../DEVELOPMENT.md)
