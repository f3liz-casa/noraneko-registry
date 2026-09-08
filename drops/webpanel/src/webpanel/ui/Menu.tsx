// SPDX-License-Identifier: MPL-2.0
// The context menu of a strip button. Drawn into a <menupopup> host in #mainPopupSet.

import { menu } from "../state/store.ts";
import { removePanel, unloadPanel } from "../io/actions.ts";
import type { Browsers } from "../io/browsers.ts";

export function Menu(props: { browsers: Browsers }) {
  const on = (fn: (id: string) => void) => () => {
    if (menu.target) fn(menu.target);
  };
  return (
    <>
      <menuitem label="Reload" oncommand={on((id) => props.browsers.reload(id))} />
      <menuitem label="Unload" oncommand={on((id) => unloadPanel(props.browsers, id))} />
      <menuitem label="Remove" oncommand={on((id) => removePanel(props.browsers, id))} />
    </>
  );
}
