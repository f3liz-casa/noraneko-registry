#!/usr/bin/env ruby
# drops/<code>/ を registry の中だけで xpi にする(外の repo は使わない)。
#
#   ruby scripts/build.rb drops/<code>      → _build/<code>/{<actor>.xpi, manifest.json}
#
# 1. _stage/<code>/ に tooling/webext-actors(build.ts、_shared、tsdown の設定、deno.lock)と drops/<code>/src/<actor>/ を並べる
# 2. deno task build(actor → _dist/<actor>/)
# 3. scripts/build-drop.rb(reproducible、syntax check、minify 禁止、source 同梱)
# manifest の source は「この registry の、この commit の、drops/<code>/src」。
require "fileutils"

dir = ARGV[0] or abort "usage: build.rb drops/<code>"
root = File.expand_path("..", __dir__)
toml = File.read(File.join(dir, "drop.toml"))
code = toml[/^code\s*=\s*"([^"]+)"/, 1] or abort "drop.toml: code が無い"
note = toml[/^note\s*=\s*"([^"]*)"/, 1]
actors = toml[/^actors\s*=\s*\[(.*)\]/, 1].to_s.scan(/"([^"]+)"/).flatten
abort "drop.toml: actors が無い" if actors.empty?
abort "code と dir が違う(#{code} / #{File.basename(dir)})" unless File.basename(dir) == code

stage = File.join(root, "_stage", code)
FileUtils.rm_rf(stage)
FileUtils.mkdir_p(stage)
%w[build.ts _shared tsdown.actor.config.ts tsdown.content.config.ts deno.json deno.lock tsconfig.json].each do |f|
  FileUtils.cp_r(File.join(root, "tooling/webext-actors", f), stage)
end
actors.each do |a|
  src = File.join(dir, "src", a)
  abort "#{src}/actor.ts が無い" unless File.file?(File.join(src, "actor.ts"))
  FileUtils.cp_r(src, File.join(stage, a))
end

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

# build-drop.rb(scripts/build-drop.rb):
#   _dist/<actor>/ を xpi に固める。版を <meta.version>.<commit の分> に、api.js の import 先を resource://<alias>/ に、
#   source/ を同梱し、deno check と minify 禁止の門を通し、mtime と権限を揃えて TZ=UTC で zip。manifest.json に sha256。
#   BUILD_* は registry 向けの置き場(noraneko の testbed と同じ script を、path だけ差し替えて使う)。docs/BUILD.md の 3〜6
env = {
  "BUILD_ROOT" => root, # git の repo(commit の時刻と、manifest の source.repo / commit)
  "BUILD_ACTORS" => stage, # _dist/ と source/ の元
  "BUILD_OUT" => File.join(root, "_build"), # _build/<code>/ に出す
  "BUILD_SOURCE_PATH" => "#{dir}/src", # manifest の source.path
}
args = ["mise", "exec", "--", "ruby", File.join(root, "scripts/build-drop.rb"), "--code", code]
args += ["--note", note] if note && !note.empty?
system(env, *args, *actors) or abort "build-drop failed"
puts "→ #{File.join(root, "_build", code)}"
