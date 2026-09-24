# std — the words a drop's logic starts from

`std` is the umbrella library drop a drop depends on to get its shell and its
vocabulary. Add one line to `drop.toml`:

```toml
[deps]
std = "0064c162-13ac-458e-80ef-e73b1bc49a24"

[compat]
std = "1"
```

The uuid is the identity (`std`'s), and the version is **fixed by the registry
at build time** — you do not write it, and it stays put until you rebuild.
`std` pulls in the pieces and the build lays them into your drop's scope:

| dep | what it is |
|---|---|
| `std-actor` | the shell: calls your three doors, draws the view, carries out effects |
| `std-preact-xul` | `preact` and `mount`, and the XUL-aware move-before rearranging |
| `std-tsubaki-runtime` | the Tsubaki VM (in a Worker) **and the vocabulary** (`ops/std.tsubaki`) |
| `std-prefs` | typed prefs (`pref.int` / `pref.bool` / …, `definePrefs`, `watchPrefs`) — only if you write your own `actor.ts` |
| `std-context-menu` | rows mixed into the browser's own menupopups |
| `std-settings` | a drop's own pane in `about:nora:settings` |

You only ever name `std`. The pieces are what it means.

## If your actor is Tsubaki (no `actor.ts`)

This is the common case. You write `src/<actor>/ops/*.tsubaki` and the
`[actor]` table; the build dresses it in `std-actor`'s shell. Your logic answers
exactly three doors and nothing else:

```julia
setup()           # -> where it goes, its style, which prefs to follow
start(facts)      # -> the first frame
dispatch(action)  # -> the next frame, and what to do
```

A **frame** is `frame(view)` or `frame(view, effects)`. Both the view and the
effects are *data* — you make them, the shell does them.

The vocabulary (`ops/std.tsubaki`, shipped by `std-tsubaki-runtime`) is what
you write with. It is a small list on purpose — the whole of what a drop can
do. Each entry here is a `struct`; naming it makes a value.

### Looking at data

```julia
get(d, :key, default)   # reads the "key" key too — Symbol and string are the same key
haskey(d, :key)
put(d, key, value)      # a copy with one key set (state is never changed in place)
merge(a, b)             # b wins on a shared key
copy(d)
```

### The view

```julia
el("label", Dict("value" => "hi"))        # a tag, props, kids
el("vbox", Dict("flex" => "1"), [child])  # kids are a Vector
```

`"style" => Dict("width" => "320px")` prints an inline style; a nested Dict
becomes a class + a rule, handled by the shell. `"on:command" => MyAction()`
is **the action itself, not a closure** (closures do not cross the worker
boundary). The shell translates it into a listener and hands it back to
`dispatch`, adding what only that side can know (`__event`).

`t(:add)` is a word by key; which locale's word it becomes is the shell's
choice (from the drop's `strings.toml`).

### Saying what should happen (effects)

```julia
SetPref(name, value)        # write a pref          -> permission prefs
OpenURL(url)                # open a web URL         -> open_url
DoCommand(name)             # run a browser command  -> commands
WriteClipboard(text)        # put text on the clipboard -> clipboard_write
FileExists(path, action)    # ask about a path, answer as an action -> files = "read"
RevealFile(path)            # show it in the file manager           -> files = "open"
LaunchFile(path)            # open with the default app             -> files = "open"
ReloadFrame(selector)       # reload a <browser> you placed         -> web_frame
OpenPopup(selector, x, y)   # open a menupopup you placed
Measure(selector, action)   # measure something you placed
Log(text)                   # one line to the console
```

The right-hand side is the `[permissions]` line that has to be in your
`drop.toml`. A word you didn't declare is refused by the shell (and
`check-drop.rb` says so before you ship). The whole list, with the
install-screen Japanese, is [`ABI.md`](ABI.md).

### Asking instead of making

logic never makes a fact (a fresh uuid, the current tab's URL, a measured
width). It **asks**, and the answer arrives as an ordinary action:

```julia
Ask(["uuid", "url"], "AddPanel")     # -> dispatch Dict("__type"=>"AddPanel", "uuid"=>…, "url"=>…)
Ask(["clipboard"], "GotClipboard")   # needs clipboard_read
Ask(["session_start"], "Loaded")
Measure("#nora-box", "SetWidth")     # -> Dict(…, "width"=>321, "height"=>640)
```

Facts: `uuid`, `url` (needs `current_url`), `tabs` / `tab` (need `tabs`),
`clipboard` (needs `clipboard_read`), `session_start`.

### Prefs and settings

```julia
Setup(anchors = [...], prefs = ["noraneko.mydrop.on"])
```

A pref in `prefs` comes in at `start(facts)` under `facts.prefs[name]`, and a
change raises `dispatch(Dict("__type"=>"PrefChanged", "name"=>…, "value"=>…))`.
Your own namespace (`noraneko.<drop name>.*`) needs no listing; anything else
does. A `SetPref` on a pref listed in `prefs_json` is stored as JSON.

### Tabs, windows, keys

`SetTabAttr` / `SetTabValue` / `HideTab` / `ShowTab` / `SelectTab` /
`SetWindowValue` / `Prompt` — the tab vocabulary (`docs/GUIDE.md` §"タブのこと"
has the shapes). A `<key combo="Accel+Alt+Z">` in the view listens, if the
combo is in `[permissions] keys`.

## If you write your own `actor.ts`

Then you have the content hook itself — `window`, `document`, `ctx.io`,
`ctx.expose`, `ctx.ops`, `ctx.onDestroy`. `std-preact-xul` gives you `h` /
`mount` / `signal` / `useSignalValue`; `std-prefs` gives typed prefs; and you
place every DOM node, style, listener and observer through `ctx.io` so that
removing the drop puts them back (`docs/LAYERS.md`). The shell is a
convenience, not a requirement — the door stays open.

## Reading more

- [`ABI.md`](ABI.md) — the permission / effect / fact table, and how to add a word to it
- [`GUIDE.md`](GUIDE.md) — making your first drop
- [`LAYERS.md`](LAYERS.md) — placement, the io/ layer, deps and compat
- [`for-drops.md`](https://docs.f3liz.casa/nyanrus/tsubaki/docs/for-drops) (Tsubaki repo) — the language, from inside a drop
