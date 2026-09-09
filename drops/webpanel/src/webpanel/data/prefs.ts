// SPDX-License-Identifier: MPL-2.0

// The list of panels is data: it keeps its shape (Floorp's), so it stays one
// pref holding JSON. The two settings are settings, so they are one about:config
// pref each, written out in the schema below -- a user.js line or another mod
// can set one of them without touching the other, and a third setting added
// later cannot disturb the two that are already answered.
// cf. f3liz-casa/noraneko#127
//
// The schema is data; the settings themselves are made from it once the window
// is there (actor.ts), because nothing under a module's top level may touch the
// browser -- the build imports this tree to read the actor's meta.

import { pref, type Prefs } from "std";

export const PREF_ROOT = "noraneko.webpanel";
export const PREF_DATA = "noraneko.webpanel.data";
export const PREF_FLOORP_DATA = "floorp.panelSidebar.data";
/** Floorp holds both settings below in this one JSON pref. Taken over once, then left alone. */
export const PREF_FLOORP_CONFIG = "floorp.panelSidebar.config";

export const SCHEMA = {
  /** How wide a panel opens when it carries no width of its own. */
  globalWidth: pref.int(400),
  /** The strip of icons on the left of the tabs, instead of the right. */
  positionStart: pref.bool(false),
};

export type WebpanelPrefs = Prefs<typeof SCHEMA>;
