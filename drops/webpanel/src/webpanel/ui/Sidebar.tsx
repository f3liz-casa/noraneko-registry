// SPDX-License-Identifier: MPL-2.0
// The sidebar: strip of icons, the box (header + browsers), the splitter.
// Drawn into one <hbox> host next to the tabs; the store says what to show.

import { useEffect, useRef } from "preact/hooks";
import type { ChromeWindow } from "../types/panel.ts";
import { menu, selected, shown, title } from "../state/store.ts";
import { panelWidth } from "../ops/panels.ts";
import { readFloorpConfig } from "../io/prefs.ts";
import { addCurrentTab, rememberWidth, select } from "../io/actions.ts";
import type { Browsers } from "../io/browsers.ts";

export function Sidebar(props: { win: ChromeWindow; browsers: Browsers; positionStart: boolean }) {
  const boxRef = useRef<HTMLElement>(null);
  const strip = <Strip win={props.win} browsers={props.browsers} />;
  const box = <Box browsers={props.browsers} boxRef={boxRef} />;
  const splitter = (
    <splitter id="nora-webpanel-splitter" hidden={selected.value === null} oncommand={() => rememberWidth(boxRef.current)} />
  );
  return props.positionStart ? <>{strip}{box}{splitter}</> : <>{splitter}{box}{strip}</>;
}

function Strip(props: { win: ChromeWindow; browsers: Browsers }) {
  return (
    <vbox id="nora-webpanel-strip">
      {shown.value.map((p) => (
        <toolbarbutton
          key={p.id}
          image={`page-icon:${p.url}`}
          tooltiptext={p.url ?? ""}
          selected={p.id === selected.value ? "true" : undefined}
          oncommand={() => select(props.browsers, p.id === selected.value ? null : p.id)}
          oncontextmenu={(ev: MouseEvent) => {
            ev.preventDefault();
            menu.target = p.id;
            menu.popup?.openPopupAtScreen(ev.screenX, ev.screenY, true);
          }}
        />
      ))}
      <toolbarbutton
        image="chrome://global/skin/icons/plus.svg"
        tooltiptext="Add the current tab"
        oncommand={() => addCurrentTab(props.win, props.browsers)}
      />
    </vbox>
  );
}

function Box(props: { browsers: Browsers; boxRef: { current: HTMLElement | null } }) {
  const browsersRef = useRef<HTMLElement>(null);
  // the <browser>s are made by hand inside this vbox; when the box goes, they go
  useEffect(() => {
    props.browsers.attach(browsersRef.current!);
    return () => props.browsers.detach();
  }, []);
  const panel = selected.value === null ? undefined : shown.value.find((p) => p.id === selected.value);
  return (
    <vbox
      id="nora-webpanel-box"
      ref={props.boxRef}
      hidden={!panel}
      style={panel ? { width: `${panelWidth(panel, readFloorpConfig())}px` } : undefined}
    >
      <hbox id="nora-webpanel-header">
        <label id="nora-webpanel-title" crop="end" value={title.value} />
        <toolbarbutton
          image="chrome://global/skin/icons/reload.svg"
          tooltiptext="Reload"
          oncommand={() => selected.value && props.browsers.reload(selected.value)}
        />
        <toolbarbutton
          image="chrome://global/skin/icons/close.svg"
          tooltiptext="Close"
          oncommand={() => select(props.browsers, null)}
        />
      </hbox>
      <vbox id="nora-webpanel-browsers" flex="1" ref={browsersRef} />
    </vbox>
  );
}
