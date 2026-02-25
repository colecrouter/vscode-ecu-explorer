# Graph Visualization Specification

**Status**: ✅ Implemented (v0.6) | Enhanced with Separate Windows (v0.7)  
**Related Specs**: [`separate-graph-windows.md`](separate-graph-windows.md)

## Overview

Enable users to visualize ROM table data as interactive charts with real-time updates, zoom/pan controls, and cell selection integration.

### Current State (v0.7)

- ✅ **Separate graph windows** with multi-monitor support
- ✅ Interactive chart rendering with Plotly.js
- ✅ 1D line plots, 2D heatmaps, 3D layer views
- ✅ Zoom, pan, and layer navigation controls
- ✅ Click-to-select cell integration
- ✅ Hover tooltips with axis and value information
- ✅ Real-time synchronization with table editor
- ✅ Persistence across VSCode reloads
- ✅ Multiple graphs can be open simultaneously

**Key Components**:
- [`GraphPanelManager`](../apps/vscode/src/graph-panel-manager.ts) - Manages graph panel lifecycle
- [`ChartViewerApp.svelte`](../apps/vscode/src/webview/ChartViewerApp.svelte) - Standalone chart viewer
- [`Chart.svelte`](../packages/ui/src/lib/views/Chart.svelte) - Chart rendering component
- [`ChartState`](../packages/ui/src/lib/views/chart.svelte.ts) - Chart state management

### User Value Proposition

- ✅ Visualize table data as charts (line, heatmap, layer views)
- ✅ Interactive zoom and pan
- ✅ Hover tooltips showing values
- ✅ Click to select cells in grid
- ✅ Real-time updates on cell edits
- ✅ Multiple chart types for different table dimensions
- ✅ **NEW**: Separate windows with multi-monitor support
- ✅ **NEW**: View multiple graphs simultaneously

### Acceptance Criteria

- [x] Render 1D table as line plot ✅ (v0.6)
- [x] Render 2D table as heatmap ✅ (v0.6)
- [x] Render 3D table as multiple 2D slices ✅ (v0.6)
- [x] Zoom in/out with mouse wheel ✅ (v0.6)
- [x] Pan with mouse drag ✅ (v0.6)
- [x] Show tooltip on hover ✅ (v0.6)
- [x] Click to select cell in grid ✅ (v0.6)
- [x] Update chart on cell edit ✅ (v0.6)
- [x] Axis labels and scaling ✅ (v0.6)
- [x] Legend and color bar ✅ (v0.6)
- [x] Grid lines ✅ (v0.6)
- [x] Keyboard navigation ✅ (v0.6)
- [x] **Separate graph windows** ✅ (v0.7)
- [x] **Multi-monitor support** ✅ (v0.7)
- [x] **Persistence across reloads** ✅ (v0.7)

---

## Chart Types

### 1D Table: Line Plot

**Purpose**: Visualize single-row or single-column data

**Features**:
- X axis: Index or axis labels
- Y axis: Values
- Line connecting points
- Points marked with circles
- Grid lines

**Example**:
```
Boost Target vs RPM
┌─────────────────────────────────┐
│ 100 │                    ●      │
│  80 │              ●            │
│  60 │        ●                  │
│  40 │  ●                        │
│  20 │●                          │
│   0 └────────────────────────────┤
│     1000  2000  3000  4000  5000 │
│                RPM               │
└─────────────────────────────────┘
```

**Implementation**:
- Use Plotly.js or Chart.js
- X axis: RPM values (1000, 1500, 2000, ...)
- Y axis: Boost target values (0-100)
- Line trace with markers

### 2D Table: Heatmap

**Purpose**: Visualize 2D table data with color intensity

**Features**:
- X axis: Column labels (RPM)
- Y axis: Row labels (Load)
- Color intensity: Value magnitude
- Color bar showing scale
- Grid lines

**Example**:
```
Fuel Injection Timing (2D)
┌──────────────────────────────────┐
│ Load  │ 1000  2000  3000  4000   │
│ 20%   │ ███   ███   ███   ███    │
│ 40%   │ ███   ███   ███   ███    │
│ 60%   │ ███   ███   ███   ███    │
│ 80%   │ ███   ███   ███   ███    │
│       └──────────────────────────┘
│       Color: 0 (blue) → 100 (red) │
└──────────────────────────────────┘
```

**Implementation**:
- Use Plotly.js heatmap
- X axis: Column axis values
- Y axis: Row axis values
- Z values: Color intensity
- Viridis color scale

### 3D Table: Multiple 2D Slices

**Purpose**: Visualize 3D table data as layer selector

**Features**:
- Layer selector (dropdown or slider)
- Display one 2D heatmap per layer
- Layer name/description
- Navigation between layers

**Example**:
```
Boost Target by Gear (3D)
┌──────────────────────────────────┐
│ Layer: [Gear 1 ▼]                │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ Load  │ 1000  2000  3000     │ │
│ │ 20%   │ ███   ███   ███      │ │
│ │ 40%   │ ███   ███   ███      │ │
│ │ 60%   │ ███   ███   ███      │ │
│ │ 80%   │ ███   ███   ███      │ │
│ └──────────────────────────────┘ │
│                                  │
│ [< Previous] [Next >]            │
└──────────────────────────────────┘
```

**Implementation**:
- Render 2D heatmap for selected layer
- Layer selector component
- Previous/Next buttons
- Layer name display

---

## Visualization Features

### Axis Labels and Scaling

**X Axis**:
- Label: "RPM" or "Index"
- Values: [1000, 1500, 2000, ...]
- Scaling: Linear or logarithmic
- Formatting: 1000 → "1k", 1500 → "1.5k"

**Y Axis**:
- Label: "Load (%)" or "Index"
- Values: [0, 10, 20, ...]
- Scaling: Linear or logarithmic
- Formatting: 0.5 → "0.5", 100 → "100"

**Z Axis** (for heatmap):
- Label: "Value" or unit name
- Scale: Min to max value
- Formatting: 0.0 → "0.0", 100.5 → "100.5"

### Legend

**Purpose**: Show color scale mapping

**Display**:
- Vertical color bar
- Min value at bottom
- Max value at top
- Tick marks and labels
- Unit label

**Example**:
```
100 ┌─────┐
 80 │     │
 60 │     │
 40 │     │
 20 │     │
  0 └─────┘
    Boost (kPa)
```

### Grid Lines

**Purpose**: Aid in reading values

**Features**:
- Major grid lines (every 10 units)
- Minor grid lines (every 1 unit)
- Dashed or dotted style
- Light gray color
- Optional toggle

### Zoom and Pan

**Zoom**:
- Mouse wheel: Zoom in/out
- Pinch gesture: Zoom in/out (touch)
- Zoom buttons: +/- buttons
- Zoom range: 0.5x to 10x
- Zoom center: Mouse cursor position

**Pan**:
- Mouse drag: Pan around chart
- Touch drag: Pan around chart
- Keyboard arrows: Pan (when focused)
- Pan limits: Don't pan beyond data bounds

**Example**:
```
User scrolls mouse wheel up
    ↓
Chart zooms in 1.2x
    ↓
Chart re-renders with new scale
    ↓
User drags mouse
    ↓
Chart pans to new position
```

### Hover Tooltips

**Purpose**: Show value at cursor position

**Display**:
- Tooltip box near cursor
- X value: "RPM: 2500"
- Y value: "Load: 40%"
- Z value: "Boost: 85.5 kPa"
- Cell coordinates: "(row: 3, col: 5)"

**Example**:
```
┌─────────────────────────────────┐
│ ┌──────────────────────────────┐│
│ │ RPM: 2500                    ││
│ │ Load: 40%                    ││
│ │ Boost: 85.5 kPa              ││
│ │ Cell: (3, 5)                 ││
│ └──────────────────────────────┘│
│                                 │
│ (tooltip follows cursor)        │
└─────────────────────────────────┘
```

### Click to Select Cell

**Purpose**: Link chart interaction to grid

**Behavior**:
- User clicks on chart point/cell
- Grid scrolls to cell
- Cell is highlighted
- Cell value shown in status bar

**Example**:
```
User clicks on heatmap cell
    ↓
Chart identifies cell coordinates (row: 3, col: 5)
    ↓
Grid scrolls to show cell
    ↓
Cell is highlighted with border
    ↓
Status bar shows: "Cell (3, 5): 85.5 kPa"
```

---

## Data Binding

### Real-Time Updates on Cell Edit

**Process**:
```
User edits cell in grid
    ↓
Grid sends cellCommit message
    ↓
Chart receives update
    ↓
Chart re-renders affected region
    ↓
Tooltip updates if hovering
```

**Optimization**:
- Debounce chart updates (100ms)
- Only re-render affected region
- Cache unchanged data
- Use requestAnimationFrame for smooth animation

### Reactive to Table Changes

**Triggers**:
- Cell edit (cellCommit)
- Undo/redo (update)
- Import (update)
- Math operations (update)

**Implementation**:
```typescript
// packages/ui/src/lib/views/chart.svelte.ts

export const chartState = writable<ChartState>({
  snapshot: null,
  selectedCell: null,
  zoomLevel: 1,
  panX: 0,
  panY: 0
});

export function updateChart(snapshot: TableSnapshot) {
  chartState.update(state => ({
    ...state,
    snapshot
  }));
}

export function selectCell(row: number, col: number) {
  chartState.update(state => ({
    ...state,
    selectedCell: { row, col }
  }));
}
```

### Performance Optimization

**Debouncing**:
```typescript
const debouncedUpdateChart = debounce((snapshot: TableSnapshot) => {
  renderChart(snapshot);
}, 100);

// On cell edit
snapshot.z[row][col] = newValue;
debouncedUpdateChart(snapshot);
```

**Caching**:
```typescript
let cachedColorMap: string[][] | null = null;
let cachedSnapshot: TableSnapshot | null = null;

function getColorMap(snapshot: TableSnapshot): string[][] {
  if (cachedSnapshot === snapshot && cachedColorMap) {
    return cachedColorMap;
  }

  cachedColorMap = computeColorMap(snapshot.z);
  cachedSnapshot = snapshot;
  return cachedColorMap;
}
```

---

## Implementation

### Files to Create

1. **`packages/ui/src/lib/views/Chart.svelte`** - Main chart component
2. **`packages/ui/src/lib/views/chart.svelte.ts`** - Chart state management
3. **`packages/ui/src/lib/views/ChartTooltip.svelte`** - Tooltip component
4. **`packages/ui/src/lib/views/ChartControls.svelte`** - Zoom/pan controls

### Files to Modify

1. **[`packages/ui/src/lib/views/colorMap.ts`](../packages/ui/src/lib/views/colorMap.ts)**
   - Extend for 3D support
   - Add color scale options

2. **[`packages/ui/src/routes/+page.svelte`](../packages/ui/src/routes/+page.svelte)**
   - Add chart view
   - Add split view (grid + chart)

### Chart Library

**Recommended**: Plotly.js

**Reasons**:
- Supports 1D, 2D, 3D charts
- Interactive zoom/pan built-in
- Hover tooltips
- Good performance
- MIT license

**Alternative**: Chart.js (simpler, but less 3D support)

### Chart Component

```svelte
<!-- packages/ui/src/lib/views/Chart.svelte -->

<script lang="ts">
  import { onMount } from "svelte";
  import Plotly from "plotly.js-dist-min";
  import type { TableSnapshot } from "@repo/core";

  export let snapshot: TableSnapshot;
  export let onCellSelect: (row: number, col: number) => void;

  let chartDiv: HTMLDivElement;
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;

  onMount(() => {
    renderChart();
  });

  function renderChart() {
    if (!chartDiv) return;

    const data = buildPlotlyData();
    const layout = buildPlotlyLayout();

    Plotly.newPlot(chartDiv, data, layout, { responsive: true });

    // Add click handler
    chartDiv.on("plotly_click", (data: any) => {
      const point = data.points[0];
      onCellSelect(point.y, point.x);
    });
  }

  function buildPlotlyData() {
    if (snapshot.kind === "table1d") {
      return [
        {
          x: snapshot.x || Array.from({ length: snapshot.z.length }, (_, i) => i),
          y: snapshot.z,
          type: "scatter",
          mode: "lines+markers",
          name: snapshot.name
        }
      ];
    } else if (snapshot.kind === "table2d") {
      return [
        {
          x: snapshot.x || Array.from({ length: snapshot.cols }, (_, i) => i),
          y: snapshot.y || Array.from({ length: snapshot.rows }, (_, i) => i),
          z: snapshot.z,
          type: "heatmap",
          colorscale: "Viridis",
          name: snapshot.name
        }
      ];
    }

    return [];
  }

  function buildPlotlyLayout() {
    return {
      title: snapshot.name,
      xaxis: { title: "X Axis" },
      yaxis: { title: "Y Axis" },
      hovermode: "closest",
      margin: { l: 50, r: 50, t: 50, b: 50 }
    };
  }

  function handleZoom(direction: "in" | "out") {
    zoomLevel *= direction === "in" ? 1.2 : 0.8;
    renderChart();
  }

  function handleReset() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    renderChart();
  }
</script>

<div class="chart-container">
  <div class="chart-controls">
    <button on:click={() => handleZoom("in")}>+</button>
    <button on:click={() => handleZoom("out")}>−</button>
    <button on:click={handleReset}>Reset</button>
  </div>
  <div bind:this={chartDiv} class="chart" />
</div>

<style>
  .chart-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }

  .chart-controls {
    display: flex;
    gap: 8px;
    padding: 8px;
    background-color: #f5f5f5;
    border-bottom: 1px solid #ddd;
  }

  .chart {
    flex: 1;
    overflow: hidden;
  }
</style>
```

### State Management

```typescript
// packages/ui/src/lib/views/chart.svelte.ts

import { writable, derived } from "svelte/store";
import type { TableSnapshot } from "@repo/core";

export interface ChartState {
  snapshot: TableSnapshot | null;
  selectedCell: { row: number; col: number } | null;
  zoomLevel: number;
  panX: number;
  panY: number;
  hoveredCell: { row: number; col: number } | null;
}

export const chartState = writable<ChartState>({
  snapshot: null,
  selectedCell: null,
  zoomLevel: 1,
  panX: 0,
  panY: 0,
  hoveredCell: null
});

export function updateSnapshot(snapshot: TableSnapshot) {
  chartState.update(state => ({
    ...state,
    snapshot
  }));
}

export function selectCell(row: number, col: number) {
  chartState.update(state => ({
    ...state,
    selectedCell: { row, col }
  }));
}

export function setZoom(level: number) {
  chartState.update(state => ({
    ...state,
    zoomLevel: Math.max(0.5, Math.min(10, level))
  }));
}

export function setPan(x: number, y: number) {
  chartState.update(state => ({
    ...state,
    panX: x,
    panY: y
  }));
}
```

---

## Testing

### Unit Tests

**File**: `packages/ui/test/Chart.test.ts`

```typescript
describe("Chart Component", () => {
  it("renders 1D table as line plot", () => {
    // Verify line plot rendered
  });

  it("renders 2D table as heatmap", () => {
    // Verify heatmap rendered
  });

  it("renders 3D table with layer selector", () => {
    // Verify layer selector shown
  });

  it("updates on snapshot change", () => {
    // Change snapshot, verify chart re-renders
  });

  it("handles zoom in", () => {
    // Click zoom in, verify scale increased
  });

  it("handles zoom out", () => {
    // Click zoom out, verify scale decreased
  });

  it("handles pan", () => {
    // Drag chart, verify pan applied
  });

  it("shows tooltip on hover", () => {
    // Hover over point, verify tooltip shown
  });

  it("selects cell on click", () => {
    // Click on point, verify onCellSelect called
  });
});
```

### E2E Tests

**File**: `apps/vscode/test/graph-visualization.test.ts`

```typescript
describe("Graph Visualization", () => {
  it("displays chart for opened table", async () => {
    // Open ROM, open table, verify chart shown
  });

  it("updates chart on cell edit", async () => {
    // Edit cell, verify chart updated
  });

  it("selects cell from chart", async () => {
    // Click on chart, verify grid cell selected
  });

  it("zooms and pans", async () => {
    // Zoom in, pan, verify chart updated
  });

  it("shows tooltip on hover", async () => {
    // Hover over chart, verify tooltip shown
  });

  it("handles large tables", async () => {
    // Open large table, verify chart renders
  });

  it("supports split view", async () => {
    // Open split view, verify grid and chart shown
  });
});
```

### Performance Tests

**File**: `packages/ui/test/chart-performance.test.ts`

```typescript
describe("Chart Performance", () => {
  it("renders 1000-cell table in < 200ms", () => {
    // Measure render time
  });

  it("updates on cell edit in < 100ms", () => {
    // Measure update time
  });

  it("handles zoom/pan smoothly", () => {
    // Measure frame rate
  });

  it("memory usage stays under 50MB", () => {
    // Measure memory
  });
});
```

---

## Accessibility

### Keyboard Navigation

- **Tab**: Navigate between chart elements
- **Arrow Keys**: Pan chart
- **+/-**: Zoom in/out
- **R**: Reset zoom/pan
- **Enter**: Select hovered cell

### Screen Reader Support

- Chart title announced
- Axis labels announced
- Hover values announced
- Cell selection announced

**Example**:
```html
<div role="img" aria-label="Boost Target vs RPM line chart">
  <div role="region" aria-live="polite">
    RPM: 2500, Boost: 85.5 kPa
  </div>
</div>
```

### High Contrast Mode

- Use high-contrast color schemes
- Increase line width
- Use patterns in addition to colors
- Ensure text contrast ratio >= 4.5:1

---

## Performance

### Large Table Rendering

**Target**: < 200ms for 1000+ cells

**Optimization**:
- Downsample data for display
- Use canvas rendering instead of SVG
- Lazy load chart library
- Cache color map

### Real-Time Update Performance

**Target**: < 100ms for cell edit update

**Optimization**:
- Debounce updates (100ms)
- Only re-render affected region
- Use requestAnimationFrame
- Batch multiple edits

### Memory Usage

**Target**: < 50MB for large tables

**Optimization**:
- Don't store full snapshot in chart
- Use typed arrays for data
- Clean up old chart instances
- Implement garbage collection

---

## Future Enhancements

- [ ] 3D surface plot
- [ ] Multiple chart types (bar, scatter, etc.)
- [ ] Custom color scales
- [ ] Export chart as image
- [ ] Comparison view (two tables side-by-side)
- [ ] Animated transitions
- [ ] Crosshair cursor
- [ ] Measurement tools
- [ ] Annotation support

---

## Status

- [ ] Design approved
- [ ] Implementation started
- [ ] Code review
- [ ] Testing complete
- [ ] Documentation complete

---

## Related Documentation

- [`specs/table-editing.md`](table-editing.md) - Table editing
- [`packages/ui/src/lib/views/colorMap.ts`](../packages/ui/src/lib/views/colorMap.ts) - Color computation
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System design
- [`specs/TESTING.md`](TESTING.md) - Testing guidelines
