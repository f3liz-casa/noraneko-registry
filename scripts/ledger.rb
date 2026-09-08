#!/usr/bin/env ruby
# 判を押した版を台帳に積む(sign job から呼ばれる)。
#
#   ruby scripts/ledger.rb drops/<name>
#
# 三つに分けて書く。中身の形は Julia の registry(General)の
# Versions.toml / Deps.toml / Compat.toml に合わせてある:
#
#   versions.toml  判が押された版そのもの。General は git-tree-sha1 を持つが、
#                  ここが配るのは木ではなく xpi なので commit / time / file /
#                  sha256、それに **そのとき連れていった deps の版**(Manifest の側)
#   deps.toml      その版が「誰に依存すると言っていたか」。札 = "uuid"(General と同じ)
#   compat.toml    その版が「どこまで許すと言っていたか」。値は文字列、または
#                  union の配列(General と同じ。この repo では "," 一本と同じ意味)
#
# 節の見出しは General では**版の範囲**("0-0.2" のように圧縮する)。ここでは
# 一つの版だけを書く(範囲としても正しい形。drop の版はまだ数えるほどなので、
# 圧縮する理由がない)。ある版の deps / compat は「その版を含む節ぜんぶの和」で、
# それも General と同じ読みかた。
#
# 版ごとに残すのは、あとで古い版が選ばれたときに、その版の約束で解けるように
# するため。木のいまの drop.toml は「いまの版」の約束でしかない。
require "json"

dir = ARGV[0] or abort "usage: ledger.rb drops/<name>"
name = File.basename(dir)
root = File.expand_path("..", __dir__)
manifest = JSON.parse(File.read(File.join(root, "_build", name, "manifest.json")))
toml = File.read(File.join(dir, "drop.toml"))

section = lambda do |key|
  toml[/^\[#{key}\]\s*\n((?:(?!\[).*\n?)*)/, 1].to_s.scan(/^\s*([a-z0-9][a-z0-9._-]*)\s*=\s*"([^"]+)"/)
end
declared_deps = section.call("deps")
declared_compat = section.call("compat")
resolved = (manifest["deps"] || []).map { |d| "#{d["name"]} #{d["version"]}" }.join(", ")

# 既にある版は触らない(置き直しのとき。台帳は一度書いたら動かさない)
has = lambda do |path, semver|
  File.file?(path) && File.read(path).match?(/^\["#{Regexp.escape(semver)}"\]/)
end
# 値の書きかたも General に合わせる: union("," で繋いだもの)は配列で書く
value = lambda do |v|
  parts = v.to_s.split(",").map(&:strip)
  parts.length > 1 ? "[" + parts.map { |p| "\"#{p}\"" }.join(", ") + "]" : "\"#{v}\""
end
append = lambda do |file, header, semver, lines|
  path = File.join(dir, file)
  next if lines.empty? || has.call(path, semver)
  text = File.file?(path) ? File.read(path) : header
  text += "\n[\"#{semver}\"]\n" + lines.map { |k, v| "#{k} = #{value.call(v)}\n" }.join
  File.write(path, text)
  puts "#{dir}/#{file}: #{semver} を積んだ"
end

manifest["entries"].each do |e|
  semver = e["version"][/\A\d+\.\d+\.\d+/]
  version_lines = [
    ["commit", manifest.dig("source", "commit")],
    ["time", manifest.dig("source", "commit_time")],
    ["file", e["file"]],
    ["sha256", e["sha256"]],
  ]
  version_lines << ["deps", resolved] unless resolved.empty?
  if has.call(File.join(dir, "versions.toml"), semver)
    puts "#{dir}: #{semver} はもう台帳にある(置き直し)"
  else
    append.call("versions.toml", "# 判が押された版の台帳(sign job が積む)。yank は yanked = true を書く PR\n", semver, version_lines)
  end
  append.call("deps.toml", "# その版が誰に依存すると言っていたか(札 = uuid)。sign job が積む\n", semver, declared_deps)
  append.call("compat.toml", "# その版が許していた範囲。sign job が積む(scripts/compat.rb の読みかた)\n", semver, declared_compat)
end
