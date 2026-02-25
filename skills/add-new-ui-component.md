# Create a New Svelte UI Component

This guide explains how to create a new Svelte UI component for ECU Explorer.

## Prerequisites

- Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) - Understand system architecture
- Review existing components in [`packages/ui/src/lib/`](../packages/ui/src/lib/)
- Understand Svelte 5 syntax and reactive features
- Review component testing patterns in [`packages/ui/test/`](../packages/ui/test/)

## Step-by-Step Instructions

### 1. Create Component File

Create a new Svelte component file:

**File**: `packages/ui/src/lib/components/YourComponent.svelte`

```svelte
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  
  /**
   * Props for YourComponent
   */
  interface Props {
    /** Title to display */
    title: string;
    /** Whether component is disabled */
    disabled?: boolean;
    /** Callback when action is triggered */
    onAction?: (data: any) => void;
  }
  
  let { title, disabled = false, onAction }: Props = $props();
  
  /**
   * Internal state
   */
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  
  /**
   * Computed property
   */
  let isReady = $derived(!isLoading && !error);
  
  /**
   * Handle action
   */
  async function handleAction(): Promise<void> {
    if (disabled || isLoading) return;
    
    try {
      isLoading = true;
      error = null;
      
      // Perform action
      if (onAction) {
        await onAction({ timestamp: Date.now() });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="your-component" class:disabled class:loading={isLoading}>
  <h2>{title}</h2>
  
  {#if error}
    <div class="error">
      <p>{error}</p>
    </div>
  {/if}
  
  <button
    on:click={handleAction}
    disabled={disabled || isLoading}
    aria-busy={isLoading}
  >
    {isLoading ? 'Loading...' : 'Action'}
  </button>
</div>

<style>
  .your-component {
    padding: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  
  .your-component.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  
  .your-component.loading {
    opacity: 0.7;
  }
  
  .error {
    color: #d32f2f;
    margin: 0.5rem 0;
    padding: 0.5rem;
    background-color: #ffebee;
    border-radius: 4px;
  }
  
  button {
    padding: 0.5rem 1rem;
    background-color: #1976d2;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
  }
  
  button:hover:not(:disabled) {
    background-color: #1565c0;
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

### 2. Add Component Tests

Create tests for your component:

**File**: `packages/ui/test/YourComponent.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import YourComponent from '../src/lib/components/YourComponent.svelte';

describe('YourComponent', () => {
  it('renders with title', () => {
    render(YourComponent, {
      props: {
        title: 'Test Title',
      },
    });
    
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });
  
  it('calls onAction when button is clicked', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    
    render(YourComponent, {
      props: {
        title: 'Test',
        onAction,
      },
    });
    
    const button = screen.getByRole('button');
    await user.click(button);
    
    expect(onAction).toHaveBeenCalled();
  });
  
  it('disables button when disabled prop is true', () => {
    render(YourComponent, {
      props: {
        title: 'Test',
        disabled: true,
      },
    });
    
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });
  
  it('shows loading state during action', async () => {
    const onAction = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    const user = userEvent.setup();
    
    render(YourComponent, {
      props: {
        title: 'Test',
        onAction,
      },
    });
    
    const button = screen.getByRole('button');
    await user.click(button);
    
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
  
  it('displays error message on failure', async () => {
    const onAction = vi.fn(async () => {
      throw new Error('Test error');
    });
    const user = userEvent.setup();
    
    render(YourComponent, {
      props: {
        title: 'Test',
        onAction,
      },
    });
    
    const button = screen.getByRole('button');
    await user.click(button);
    
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });
});
```

### 3. Export Component

Add your component to the library exports:

**File**: `packages/ui/src/lib/index.ts`

```typescript
export { default as YourComponent } from './components/YourComponent.svelte';
export type { Props as YourComponentProps } from './components/YourComponent.svelte';
```

### 4. Use Component in Application

Use your component in the main application:

**File**: `packages/ui/src/routes/+page.svelte`

```svelte
<script lang="ts">
  import { YourComponent } from '$lib';
  
  function handleAction(data: any): void {
    console.log('Action triggered', data);
  }
</script>

<main>
  <YourComponent
    title="My Component"
    onAction={handleAction}
  />
</main>
```

### 5. Add Storybook Story (Optional)

Create a Storybook story for your component:

**File**: `packages/ui/src/lib/components/YourComponent.stories.ts`

```typescript
import type { Meta, StoryObj } from '@storybook/svelte';
import YourComponent from './YourComponent.svelte';

const meta = {
  title: 'Components/YourComponent',
  component: YourComponent,
  tags: ['autodocs'],
  argTypes: {
    title: {
      control: 'text',
      description: 'Title to display',
    },
    disabled: {
      control: 'boolean',
      description: 'Whether component is disabled',
    },
  },
} satisfies Meta<YourComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Default Component',
  },
};

export const Disabled: Story = {
  args: {
    title: 'Disabled Component',
    disabled: true,
  },
};

export const WithAction: Story = {
  args: {
    title: 'Component with Action',
    onAction: async (data) => {
      console.log('Action triggered', data);
    },
  },
};
```

### 6. Add Documentation

Create documentation for your component:

**File**: `packages/ui/src/lib/components/YourComponent.md`

```markdown
# YourComponent

A component that does something useful.

## Props

- `title` (string, required) - Title to display
- `disabled` (boolean, optional) - Whether component is disabled (default: false)
- `onAction` (function, optional) - Callback when action is triggered

## Events

None

## Slots

None

## Usage

```svelte
<script>
  import { YourComponent } from '$lib';
  
  function handleAction(data) {
    console.log('Action triggered', data);
  }
</script>

<YourComponent
  title="My Component"
  onAction={handleAction}
/>
```

## Styling

The component uses CSS classes for styling:

- `.your-component` - Main container
- `.your-component.disabled` - Applied when disabled
- `.your-component.loading` - Applied when loading
- `.error` - Error message container

You can override styles using CSS variables or custom CSS.

## Accessibility

- Button has proper `aria-busy` attribute for loading state
- Disabled state is properly communicated to assistive technologies
- Error messages are displayed in a semantic way
```

## Common Mistakes and Fixes

### Mistake 1: Not Using Svelte 5 Runes

**Problem**: Component doesn't update reactively

**Fix**: Use Svelte 5 runes for state and derived values:
```svelte
<!-- ✅ Correct: Use $state and $derived -->
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);
  
  function increment() {
    count++;
  }
</script>

<!-- ❌ Wrong: Old Svelte 4 syntax -->
<script>
  let count = 0;
  $: doubled = count * 2;
  
  function increment() {
    count++;
  }
</script>
```

### Mistake 2: Not Handling Props Correctly

**Problem**: Props don't update when parent changes them

**Fix**: Use proper prop destructuring with Svelte 5:
```svelte
<!-- ✅ Correct: Destructure props with $props() -->
<script lang="ts">
  interface Props {
    title: string;
    disabled?: boolean;
  }
  
  let { title, disabled = false }: Props = $props();
</script>

<!-- ❌ Wrong: Old export let syntax -->
<script>
  export let title;
  export let disabled = false;
</script>
```

### Mistake 3: Not Testing Edge Cases

**Problem**: Component breaks in unexpected scenarios

**Fix**: Test edge cases and error conditions:
```typescript
// ✅ Correct: Test edge cases
it('handles rapid clicks', async () => {
  const onAction = vi.fn();
  const user = userEvent.setup();
  
  render(YourComponent, { props: { onAction } });
  
  const button = screen.getByRole('button');
  await user.click(button);
  await user.click(button); // Second click while loading
  
  expect(onAction).toHaveBeenCalledTimes(1); // Only called once
});

// ❌ Wrong: Only test happy path
it('calls onAction when clicked', async () => {
  const onAction = vi.fn();
  render(YourComponent, { props: { onAction } });
  
  await user.click(screen.getByRole('button'));
  expect(onAction).toHaveBeenCalled();
});
```

## Verification Checklist

- [ ] Component file created with proper structure
- [ ] Props interface defined with JSDoc
- [ ] Reactive state using `$state` runes
- [ ] Derived values using `$derived` runes
- [ ] Error handling implemented
- [ ] Loading state managed
- [ ] Tests written and passing
- [ ] Edge cases tested
- [ ] Accessibility features added
- [ ] Styling is responsive
- [ ] Component exported from library
- [ ] Documentation created
- [ ] Coverage meets targets (≥80%)
- [ ] JSDoc comments added
- [ ] DEVELOPMENT.md updated with completion

## Links to Related Documentation

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System architecture
- [`packages/ui/src/lib/`](../packages/ui/src/lib/) - Existing components
- [`packages/ui/test/`](../packages/ui/test/) - Test examples
- [Svelte 5 Documentation](https://svelte.dev/docs/svelte/overview) - Official Svelte docs
