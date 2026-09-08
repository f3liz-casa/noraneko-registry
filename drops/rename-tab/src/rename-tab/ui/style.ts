// SPDX-License-Identifier: MPL-2.0

// The tab's own label is still there, just not drawn: `font-size: 0` keeps it in
// the layout (and in the accessibility tree) while the name the person gave is
// what shows. Both come off together when the attribute goes.
export const STYLE = `
.tabbrowser-tab[data-customlabel] .tab-label::before {
  content: var(--customlabel);
  font-size: 1rem;
}

.tabbrowser-tab[data-customlabel] .tab-label {
  font-size: 0;
}

.nora-rename-input {
  margin: 0;
  min-width: 0;
  flex: 1;
  background: var(--toolbar-bgcolor);
  color: var(--toolbar-color);
  border: 1px solid var(--toolbar-field-border-color);
  border-radius: 4px;
  padding: 2px 4px;
  font: inherit;
  outline: none;
}
`;
