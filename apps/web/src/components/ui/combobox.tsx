import {
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
} from "react";

import { cn } from "@/lib/utils";

import { Input } from "./input";

type ComboboxOption = { value: string; label: string };

type ComboboxProps = Omit<
  ComponentProps<"input">,
  | "value"
  | "onChange"
  | "onClick"
  | "onKeyDown"
  | "onFocus"
  | "type"
  | "role"
  | "ref"
> & {
  options: readonly ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Shown when the typed text matches no option. */
  emptyText: (query: string) => string;
  optionTestId?: (value: string) => string;
  ref?: Ref<HTMLInputElement>;
};

function matches(option: ComboboxOption, query: string): boolean {
  const haystack = option.label.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/** Searchable single choice from a long list. Typing filters; the closed field shows the chosen label. */
function Combobox({
  options,
  value,
  onValueChange,
  emptyText,
  optionTestId,
  className,
  onBlur,
  ref,
  ...props
}: ComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((option) => option.value === value);
  const shown =
    query === null ? options : options.filter((o) => matches(o, query));
  const optionId = (index: number) => `${listId}-${String(index)}`;

  const openList = () => {
    if (open) return;
    setOpen(true);
    const index = options.findIndex((option) => option.value === value);
    setActive(Math.max(index, 0));
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const chosen = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (chosen) {
        list.scrollTop =
          chosen.offsetTop - (list.clientHeight - chosen.offsetHeight) / 2;
      }
      // The page moves only as far as it takes to show the whole list.
      list.parentElement?.scrollIntoView({ block: "nearest" });
    });
  };

  const close = () => {
    setOpen(false);
    setQuery(null);
  };

  const choose = (option: ComboboxOption) => {
    onValueChange(option.value);
    close();
  };

  const move = (index: number) => {
    setActive(index);
    requestAnimationFrame(() => {
      document.getElementById(optionId(index))?.scrollIntoView({
        block: "nearest",
      });
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openList();
      else move(Math.max(Math.min(active + 1, shown.length - 1), 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList();
      else move(Math.max(active - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = shown[active];
      if (option) choose(option);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        role="combobox"
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && shown[active] ? optionId(active) : undefined
        }
        className={cn("field-caret pr-8", className)}
        value={query ?? selected?.label ?? ""}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onClick={openList}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onBlur={(event) => {
          close();
          onBlur?.(event);
        }}
      />
      {open ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-control-border bg-surface shadow-lg">
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={props["aria-label"]}
            aria-labelledby={props["aria-labelledby"]}
            className="relative max-h-64 overflow-y-auto py-1"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          >
            {shown.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                data-testid={optionTestId?.(option.value)}
                onClick={() => {
                  choose(option);
                }}
                onMouseMove={() => {
                  if (active !== index) setActive(index);
                }}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm text-foreground",
                  index === active && "bg-foreground/5",
                  option.value === value && "font-semibold",
                )}
              >
                {option.label}
              </li>
            ))}
          </ul>
          {shown.length === 0 ? (
            <p
              role="status"
              className="px-3 py-2 text-sm text-foreground-secondary"
            >
              {emptyText(query ?? "")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { Combobox };
export type { ComboboxOption };
