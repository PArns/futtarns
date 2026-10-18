import { ChevronDown } from 'lucide-react';
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Phones get 16px text: iOS Safari zooms into a smaller field on focus, and the page then
// pans sideways.
const field =
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, 'h-9 py-1 max-sm:h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-24 py-2', className)} {...props} />;
}

/**
 * A native select with its own chevron: the browser's arrow sat on the rounded border.
 * `className` styles the field, `containerClassName` places it in its row.
 */
export function Select({
  className,
  containerClassName,
  variant = 'default',
  children,
  ...props
}: ComponentProps<'select'> & {
  containerClassName?: string;
  /** `sm` is the pill on cards and in the calendar; it needs a controlled `value`. */
  variant?: 'default' | 'sm';
}) {
  const chevron = (
    <ChevronDown
      aria-hidden
      className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
    />
  );
  if (variant === 'sm') {
    // The pill's small text would make iOS Safari zoom in on a tap. So the pill only shows the
    // chosen option, and the select lies invisible on top of it at 16px.
    return (
      <span className={cn('relative inline-flex max-w-full align-middle', containerClassName)}>
        <select
          className="peer dark:[&>option]:bg-popover absolute inset-0 size-full cursor-pointer appearance-none text-base opacity-0 disabled:cursor-not-allowed"
          {...props}
        >
          {children}
        </select>
        <span
          aria-hidden
          className={cn(
            field,
            'peer-focus-visible:border-ring peer-focus-visible:ring-ring/50 inline-flex h-7 items-center rounded-full px-2.5 pr-8 text-xs font-semibold peer-focus-visible:ring-[3px] peer-disabled:opacity-50 max-sm:h-9 md:text-xs',
            className
          )}
        >
          <span className="truncate">{chosenLabel(children, props.value)}</span>
        </span>
        {chevron}
      </span>
    );
  }
  return (
    <span className={cn('relative block', containerClassName)}>
      <select
        className={cn(
          field,
          'dark:[&>option]:bg-popover h-9 appearance-none py-0 pr-8 max-sm:h-11',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {chevron}
    </span>
  );
}

/** The text of the option a select's `value` picks, or of its first option. */
function chosenLabel(children: ReactNode, value: unknown): ReactNode {
  const options = Children.toArray(children).filter(isValidElement<ComponentProps<'option'>>);
  const chosen =
    options.find((option) => String(option.props.value ?? '') === String(value ?? '')) ??
    options[0];
  return chosen?.props.children;
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label className={cn('flex flex-col gap-1.5 text-sm font-medium', className)} {...props} />
  );
}

export function Hint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-muted-foreground text-xs font-normal', className)} {...props} />;
}
