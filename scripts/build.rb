#!/usr/bin/env ruby
# drops/<code>/ を registry の中だけで xpi にする(外の repo は使わない)。
#
#   ruby scripts/build.rb drops/<code>      → _build/<code>/{<actor>.xpi, manifest.json}
#
# 1. _stage/<code>/ に tooling/webext-actors(build.ts、_shared、tsdown の設定)と drops/<code>/src/<actor>/ を並べる
# 2. deno task build(actor → _dist/<actor>/)
# 3. tooling/build-drop.rb(reproducible、syntax check、minify 禁止、source 同梱)
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
%w[build.ts _shared tsdown.actor.config.ts tsdown.content.config.ts deno.json tsconfig.json].each do |f|
  FileUtils.cp_r(File.join(root, "tooling/webext-actors", f), stage)
end
actors.each do |a|
  src = File.join(dir, "src", a)
  abort "#{src}/actor.ts が無い" unless File.file?(File.join(src, "actor.ts"))
  FileUtils.cp_r(src, File.join(stage, a))
end

Dir.chdir(stage) do
  system("mise", "exec", "--", "deno", "install", "-q") or abort "deno install failed"
  system("mise", "exec", "--", "deno", "task", "build") or abort "webext-actors build failed"
end

env = {
  "BUILD_ROOT" => root,
  "BUILD_ACTORS" => stage,
  "BUILD_OUT" => File.join(root, "_build"),
  "BUILD_SOURCE_PATH" => "#{dir}/src",
}
args = ["mise", "exec", "--", "ruby", File.join(root, "tooling/build-drop.rb"), "--code", code]
args += ["--note", note] if note && !note.empty?
system(env, *args, *actors) or abort "build-drop failed"
puts "→ #{File.join(root, "_build", code)}"
