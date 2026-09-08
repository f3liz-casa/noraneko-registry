#!/usr/bin/env ruby
# drops/<name>/ を registry の中だけで xpi にする(外の repo は使わない)。
#
#   ruby scripts/build.rb drops/<name>      → _build/<name>/{<actor>.xpi, manifest.json}
#
# 1. _stage/<name>/ に tooling/webext-actors(build.ts、_shared、tsdown の設定、deno.lock)と drops/<name>/src/<actor>/ を並べる
# 2. deno task build(actor → _dist/<actor>/)
# 3. scripts/build-drop.rb(reproducible、syntax check、minify 禁止、source 同梱)
# manifest の source は「この registry の、この commit の、drops/<name>/src」。正体は drop.toml の uuid、name は札。
require "fileutils"

dir = ARGV[0] or abort "usage: build.rb drops/<name>"
root = File.expand_path("..", __dir__)

require "json"

# drop.toml を読む(uuid / name / note / actors か lib+version / [deps])
def read_drop_toml(dir)
  toml = File.read(File.join(dir, "drop.toml"))
  d = {
    dir: dir,
    uuid: toml[/^uuid\s*=\s*"([^"]+)"/, 1],
    name: toml[/^name\s*=\s*"([^"]+)"/, 1],
    note: toml[/^note\s*=\s*"([^"]*)"/, 1],
    actors: toml[/^actors\s*=\s*\[(.*)\]/, 1].to_s.scan(/"([^"]+)"/).flatten,
    lib: toml.match?(/^lib\s*=\s*true/),
    version: toml[/^version\s*=\s*"([^"]+)"/, 1],
    # [deps]: 札 = "uuid"。版は書かない(registry の木にある、その uuid の drop の version で固定する)
    deps: toml[/^\[deps\]\s*\n((?:[^\[].*\n?)*)/, 1].to_s.scan(/^\s*([a-z0-9][a-z0-9._-]*)\s*=\s*"([^"]+)"/),
    has_lib: File.file?(File.join(dir, "src", "lib", "index.ts")),
    has_wasm: File.directory?(File.join(dir, "src", "wasm")),
  }
  abort "#{dir}/drop.toml: uuid が無い(uuidgen で一つ振る)" unless d[:uuid]
  abort "#{dir}/drop.toml: name が無い" unless d[:name]
  abort "name と dir が違う(#{d[:name]} / #{File.basename(dir)})" unless File.basename(dir) == d[:name]
  if d[:lib]
    abort "#{dir}/drop.toml: lib には version が要る(1.0.0 の形)" unless d[:version]&.match?(/\A\d+\.\d+\.\d+\z/)
    abort "#{dir}: lib は src/lib/index.ts か src/wasm/ のどちらかが要る" unless d[:has_lib] || d[:has_wasm]
  else
    abort "#{dir}/drop.toml: actors が無い" if d[:actors].empty?
  end
  d
end

drop = read_drop_toml(dir)
uuid, name, note = drop[:uuid], drop[:name], drop[:note]
actors = drop[:lib] ? ["lib"] : drop[:actors]

# [deps] を registry の木で解決する: 札 → drops/*/drop.toml の uuid が同じもの。その drop の deps を先に(umbrella の中身まで平らに、依存される順)
by_uuid = Dir.glob(File.join(root, "drops", "*", "drop.toml")).map { |t| File.dirname(t) }.reject { |d| File.basename(d).start_with?("_") }
  .map { |d| read_drop_toml(d) }.to_h { |d| [d[:uuid], d] }
resolved = []
resolve = lambda do |dep_name, dep_uuid, from|
  d = by_uuid[dep_uuid] or abort "#{from}: dep #{dep_name} = #{dep_uuid} が registry に無い"
  abort "#{from}: dep #{dep_name} の uuid #{dep_uuid} は #{d[:name]} のもの(札が違う)" unless d[:name] == dep_name
  abort "#{from}: dep #{dep_name} は lib ではない" unless d[:lib]
  next if resolved.any? { |r| r[:uuid] == dep_uuid }
  d[:deps].each { |n, u| resolve.call(n, u, d[:name]) }
  resolved << { name: d[:name], uuid: d[:uuid], version: d[:version], lib: d[:has_lib], wasm: d[:has_wasm], dir: d[:dir] }
end
drop[:deps].each { |n, u| resolve.call(n, u, name) }
puts "deps: #{resolved.map { |r| "#{r[:name]} #{r[:version]}" }.join(", ")}" unless resolved.empty?

# 1. _stage/<name>/ に、tooling の道具と drop の src を並べる
stage = File.join(root, "_stage", name)
FileUtils.rm_rf(stage)
FileUtils.mkdir_p(stage)
%w[build.ts _shared tsdown.actor.config.ts tsdown.content.config.ts tsdown.lib.config.ts deno.json deno.lock tsconfig.json].each do |f|
  FileUtils.cp_r(File.join(root, "tooling/webext-actors", f), stage)
end

if drop[:lib]
  FileUtils.cp_r(File.join(dir, "src", "lib"), File.join(stage, "lib")) if drop[:has_lib]
  FileUtils.cp_r(File.join(dir, "src", "wasm"), File.join(stage, "wasm")) if drop[:has_wasm]
else
  actors.each do |a|
    src = File.join(dir, "src", a)
    abort "#{src}/actor.ts が無い" unless File.file?(File.join(src, "actor.ts"))
    FileUtils.cp_r(src, File.join(stage, a))
  end
end

# drop.json: build.ts と build-drop.rb が読む(この drop と、解決した deps)
File.write(File.join(stage, "drop.json"), JSON.pretty_generate({
  name: name, uuid: uuid, version: drop[:version], lib: drop[:lib],
  deps: resolved.map { |r| r.reject { |k, _| k == :dir } },
}) + "\n")

# deps の src を型のために並べる(bundle には入れない。`import ... from "std"` が deno check で読めるように)
unless resolved.empty?
  deno_json = JSON.parse(File.read(File.join(stage, "deno.json")))
  resolved.each do |r|
    next unless r[:lib]
    FileUtils.mkdir_p(File.join(stage, "_deps", r[:name]))
    FileUtils.cp_r(File.join(r[:dir], "src", "lib"), File.join(stage, "_deps", r[:name], "lib"))
    deno_json["imports"][r[:name]] = "./_deps/#{r[:name]}/lib/index.ts"
    deno_json["imports"]["#{r[:name]}/jsx-runtime"] = "./_deps/#{r[:name]}/lib/jsx-runtime.ts" if File.file?(File.join(r[:dir], "src", "lib", "jsx-runtime.ts"))
  end
  # JSX は dep のものを使う(preact を drop に同梱しないため)。jsx-runtime.ts を持つ dep のうち、いちばん後(直接の dep)
  jsx = resolved.reverse.find { |r| File.file?(File.join(r[:dir], "src", "lib", "jsx-runtime.ts")) }
  if jsx
    deno_json["compilerOptions"]["jsxImportSource"] = jsx[:name]
    tsconfig = JSON.parse(File.read(File.join(stage, "tsconfig.json")))
    tsconfig["compilerOptions"]["jsxImportSource"] = jsx[:name]
    File.write(File.join(stage, "tsconfig.json"), JSON.pretty_generate(tsconfig) + "\n")
    puts "jsx: #{jsx[:name]}"
  end
  File.write(File.join(stage, "deno.json"), JSON.pretty_generate(deno_json) + "\n")
end

# 2. stage の中で build する
Dir.chdir(stage) do
  # deno install --frozen:
  #   deno.json の imports(tsdown、birpc、@std/path)とその依存を、deno.lock の版と integrity のとおりに取ってくる。
  #   lock に無いもの・hash が違うものが来たら止まる(= vendor と同じ保証。binary は repo に積まない)
  system("mise", "exec", "--", "deno", "install", "-q", "--frozen") or abort "deno install failed (lock と違う? tooling/webext-actors/deno.lock)"

  # deno task build(= build.ts):
  #   stage の下の dir(= actor)ごとに actor.ts を読んで、_dist/<actor>/ に
  #   manifest.json / schema.json / api.js / background.js を生成し、tsdown で actor.mjs(親)と content.js(ページ側)を
  #   minify なしで束ねる。詳しくは docs/BUILD.md の 2
  system("mise", "exec", "--", "deno", "task", "build") or abort "webext-actors build failed"
end

# 3. build-drop.rb(scripts/build-drop.rb):
#   _dist/<actor>/ を xpi に固める。xpi = ただの zip(拡張子が違うだけ。unzip で開ける)。
#   版を <meta.version>.<commit の分> に、api.js の import 先を resource://<alias>/ に、
#   source/ を同梱し、deno check と minify 禁止の門を通し、mtime と権限を揃えて TZ=UTC で zip。manifest.json に sha256。
#   BUILD_* は registry 向けの置き場(noraneko の testbed と同じ script を、path だけ差し替えて使う)。docs/BUILD.md の 3〜6
env = {
  "BUILD_ROOT" => root, # git の repo(commit の時刻と、manifest の source.repo / commit)
  "BUILD_ACTORS" => stage, # _dist/ と source/ の元
  "BUILD_OUT" => File.join(root, "_build"), # _build/<name>/ に出す
  "BUILD_SOURCE_PATH" => "#{dir}/src", # manifest の source.path
}

args = ["mise", "exec", "--", "ruby", File.join(root, "scripts/build-drop.rb"), "--uuid", uuid, "--name", name]
args += ["--note", note] if note && !note.empty?
system(env, *args, *actors) or abort "build-drop failed"

puts "→ #{File.join(root, "_build", name)}"
