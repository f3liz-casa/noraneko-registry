// SPDX-License-Identifier: MPL-2.0
// The little box you type the name into. Made by hand, not drawn by a view: it
// lives for one edit, it has to take the focus and the caret, and it sits inside
// the tab's own layout. It puts itself away on Enter, Escape, or blur.

import type { XULTab } from "../types/tab.ts";

/** Ask for a name on this tab. `done` is called with what was typed, or not at all. */
export function askOn(tab: XULTab, current: string, placeholder: string, done: (name: string) => void): void {
  const label = tab.querySelector(".tab-label") as HTMLElement | null;
  const content = tab.querySelector(".tab-content") as HTMLElement | null;
  const container = content?.querySelector(".tab-label-container");
  if (!label || !container) return;

  const doc = tab.ownerDocument;
  const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input") as HTMLInputElement;
  input.type = "text";
  input.className = "nora-rename-input";
  input.value = current;
  input.placeholder = placeholder;

  const hidden = label.style.display;
  label.style.display = "none";
  container.before(input);
  input.focus();
  input.select();

  let over = false;
  const close = () => {
    if (over) return;
    over = true;
    input.remove();
    label.style.display = hidden;
  };
  const save = () => {
    if (over) return;
    const typed = input.value.trim();
    close();
    done(typed);
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
}
