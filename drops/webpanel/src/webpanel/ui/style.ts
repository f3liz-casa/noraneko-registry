// SPDX-License-Identifier: MPL-2.0

export const STYLE = `
#nora-webpanel-strip {
  width: 40px;
  min-width: 40px;
  padding: 4px 0;
  align-items: center;
  gap: 2px;
  background-color: var(--toolbar-bgcolor, var(--toolbar-background-color));
  border-inline: 1px solid var(--chrome-content-separator-color, transparent);
}
#nora-webpanel-strip toolbarbutton {
  appearance: none;
  width: 32px;
  height: 32px;
  padding: 6px;
  border-radius: 4px;
  -moz-context-properties: fill;
  fill: currentColor;
}
#nora-webpanel-strip toolbarbutton:hover {
  background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 12%, transparent));
}
#nora-webpanel-strip toolbarbutton[selected="true"] {
  background-color: var(--toolbarbutton-active-background, color-mix(in srgb, currentColor 20%, transparent));
}
#nora-webpanel-strip toolbarbutton .toolbarbutton-icon {
  width: 20px;
  height: 20px;
}
#nora-webpanel-box {
  min-width: 200px;
  background-color: var(--toolbar-bgcolor, var(--toolbar-background-color));
}
#nora-webpanel-header {
  align-items: center;
  height: 32px;
  padding: 0 4px 0 10px;
  gap: 4px;
}
#nora-webpanel-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
#nora-webpanel-header toolbarbutton {
  appearance: none;
  padding: 4px;
  border-radius: 4px;
  -moz-context-properties: fill;
  fill: currentColor;
}
#nora-webpanel-header toolbarbutton:hover {
  background-color: color-mix(in srgb, currentColor 12%, transparent);
}
#nora-webpanel-browsers browser {
  flex: 1;
}
#nora-webpanel-browsers browser:not([selected="true"]) {
  visibility: collapse;
}
#nora-webpanel-splitter {
  appearance: none;
  width: 4px;
  min-width: 4px;
  background-color: transparent;
  border: none;
}
#nora-webpanel-splitter:hover {
  background-color: color-mix(in srgb, currentColor 20%, transparent);
}
/* Firefox lays #browser out with CSS order (sidebar 1-4, tabs 5, ai window 6-7); go after them on the right */
#nora-webpanel[positionend] { order: 8; }
`;
