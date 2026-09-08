// SPDX-License-Identifier: MPL-2.0

/** One entry of the list. Same fields as Floorp; only type "web" is shown here, the rest is kept as-is. */
export interface Panel {
  id: string;
  type: "web" | "static" | "extension";
  width: number;
  url?: string | null;
  icon?: string | null;
  userContextId?: number | null;
  zoomLevel?: number | null;
  userAgent?: boolean | null;
  extensionId?: string | null;
}

/** Floorp's config, for the two things we honour: default width and which side. */
export interface FloorpConfig {
  globalWidth?: number;
  position_start?: boolean;
}

export type ChromeWindow = Window & {
  delayedStartupPromise: Promise<void>;
  gBrowser: { currentURI: { spec: string; scheme: string } };
};

export type XULBrowser = HTMLElement & {
  loadURI(uri: nsIURI, options: { triggeringPrincipal: nsIPrincipal }): void;
  reload(): void;
  contentTitle: string;
};

export type XULPopup = HTMLElement & {
  openPopupAtScreen(x: number, y: number, isContextMenu: boolean): void;
};

/** Where the mounted <menupopup> is kept, so an effect can open it. */
export interface XULPopupHost {
  popup: XULPopup | null;
}
