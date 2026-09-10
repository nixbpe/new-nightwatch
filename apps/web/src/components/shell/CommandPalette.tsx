import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";

import { useTenant } from "../../lib/tenant/TenantProvider";
import { NAV_ICONS, SearchIcon } from "./icons";
import { Kbd } from "./Kbd";
import { getNavDestinations } from "./nav-config";

const DESTINATIONS = getNavDestinations();

function matches(query: string) {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return DESTINATIONS;
  }
  return DESTINATIONS.filter(
    (destination) =>
      destination.label.toLowerCase().includes(needle) ||
      destination.path.toLowerCase().includes(needle) ||
      (destination.group?.toLowerCase().includes(needle) ?? false),
  );
}

/**
 * Search-all (⌘K) overlay, per the reference: a modal command palette
 * anchored near the top. Today its only index is the nav config — pages
 * and settings — so that section is real and navigates; the reference's
 * project/member results wait on those features existing. Mounted only
 * while open, so state resets naturally; focus returns to whatever opened
 * it when it unmounts.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { activeOrg } = useTenant();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    return () => {
      opener?.focus();
    };
  }, []);

  const results = matches(query);
  const selectedIndex = Math.min(selected, Math.max(results.length - 1, 0));

  const choose = (index: number) => {
    const destination = results[index];
    if (destination === undefined) {
      return;
    }
    onClose();
    void navigate(destination.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        event.preventDefault();
        if (results.length > 0) {
          setSelected((selectedIndex + 1) % results.length);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (results.length > 0) {
          setSelected((selectedIndex - 1 + results.length) % results.length);
        }
        break;
      case "Enter":
        event.preventDefault();
        choose(selectedIndex);
        break;
      case "Tab":
        // The input is the palette's only tab stop; the list is driven by
        // the arrow keys, so Tab must not escape the modal.
        event.preventDefault();
        break;
      default:
        break;
    }
  };

  const activeOptionId =
    results.length === 0
      ? undefined
      : `command-option-${String(selectedIndex)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="ปิดการค้นหา"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ค้นหาทั้งหมด"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-[640px] rounded-md border border-foreground/10 bg-surface shadow-lg"
      >
        <div className="flex h-12 items-center gap-3 border-b border-foreground/10 px-4">
          <span className="text-foreground-secondary">
            <SearchIcon size={18} />
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="ค้นหาทั้งหมด"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="ค้นหาทั้งหมด..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-foreground-secondary"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-foreground-secondary">
              ไม่พบผลลัพธ์สำหรับ “{query.trim()}”
            </p>
          ) : (
            <>
              <p className="px-2 py-1.5 text-xs text-foreground-secondary">
                หน้าและการตั้งค่า
              </p>
              <ul
                id="command-palette-results"
                role="listbox"
                aria-label="ผลการค้นหา"
                className="flex flex-col gap-0.5"
              >
                {results.map((destination, index) => {
                  const Icon = NAV_ICONS[destination.icon];
                  const isSelected = index === selectedIndex;
                  return (
                    <li
                      key={destination.path}
                      id={`command-option-${String(index)}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => {
                        setSelected(index);
                      }}
                      onClick={() => {
                        choose(index);
                      }}
                      className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm ${
                        isSelected
                          ? "bg-foreground/8 text-foreground"
                          : "text-foreground"
                      }`}
                    >
                      <span className="text-foreground-secondary">
                        <Icon size={16} />
                      </span>
                      <span className="flex-1">{destination.label}</span>
                      <span className="text-xs text-foreground-secondary">
                        {destination.group ?? "หน้า"}
                      </span>
                      {isSelected ? <Kbd>↵</Kbd> : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-foreground/10 px-4 py-2 text-xs text-foreground-secondary">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span className="ms-1">เลือก</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd>
            <span className="ms-1">เปิด</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>esc</Kbd>
            <span className="ms-1">ปิด</span>
          </span>
          <span className="ms-auto truncate">
            ค้นหาใน {activeOrg?.name ?? "NightWatch"}
          </span>
        </div>
      </div>
    </div>
  );
}
