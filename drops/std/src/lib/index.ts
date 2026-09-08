// SPDX-License-Identifier: MPL-2.0
// std: the umbrella. What a drop gets with `import { ... } from "std"`, by name
// (an iife cannot `export *` from a global it does not bundle, so the list is
// written out; that also makes what std offers something a person can read).
// std-tsubaki-runtime has no JS to re-export; it arrives as ctx.ops.

export {
  // preact
  Component,
  Fragment,
  cloneElement,
  createContext,
  createElement,
  createRef,
  h,
  hydrate,
  isValidElement,
  options,
  render,
  toChildArray,
  // preact/jsx-runtime (for jsxImportSource: "std")
  jsx,
  jsxDEV,
  jsxs,
  // preact/hooks
  useCallback,
  useContext,
  useDebugValue,
  useEffect,
  useErrorBoundary,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  // @preact/signals-core
  batch,
  computed,
  effect,
  signal,
  // std-preact-xul
  mount,
  useSignalValue,
} from "std-preact-xul";
export type { ComponentChild, ComponentChildren, JSX, VNode } from "std-preact-xul";
export type { IoLike, MountAt, ReadonlySignal, Signal } from "std-preact-xul";
