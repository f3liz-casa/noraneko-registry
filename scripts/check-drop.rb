#!/usr/bin/env ruby
# SPDX-License-Identifier: MPL-2.0
#
#   ruby scripts/check-drop.rb drops/<name> [_stage/<name>/_dist/<actor>/ops.tsb]
#
# 宣言([permissions])と、drop が実際にしていることを突き合わせる。
#
# 宣言は、書いただけでは嘘になれる。殻は実行時に断るけれど、それが分かるのは
# 実機で console を見たときで、**出したあと**になる。ここで出す前に言う。
#
# 見かたは二つ:
#   - setup() を **配る wasm で実際に走らせて**、読む pref と生の style を正確に知る
#   - ops/*.tsubaki を読んで、どの effect を使っているかを数える(書く pref は
#     定数に辿れるものだけ。辿れなければ「名前は分からないが書いている」と言う)
#
# 「宣言に無い」も「宣言していて一度も使わない」も、どちらも言う。使わない宣言を
# 放っておくと、入れる人の画面の行が、年月とともにだけ伸びる。

require "json"

ROOT = File.expand_path("..", __dir__)
ABI = JSON.parse(File.read(File.join(ROOT, "abi", "v1.json")))

dir = ARGV[0] or abort "usage: check-drop.rb drops/<name> [ops.tsb]"
dir = File.expand_path(dir, ROOT)
name = File.basename(dir)
toml = File.read(File.join(dir, "drop.toml"))

# --- 宣言 -------------------------------------------------------------------
section = toml[/^\[permissions\]\s*\n((?:(?!\[).*\n?)*)/, 1].to_s
declared = {}
section.scan(/^\s*([a-z_]+)\s*=\s*\[([^\]]*)\]/) { |k, v| declared[k] = v.scan(/"([^"]*)"/).flatten }
section.scan(/^\s*([a-z_]+)\s*=\s*(true|false)\s*$/) { |k, v| declared[k] = (v == "true") }
own = "noraneko.#{name}."

# --- 実際にしていること -------------------------------------------------------
needed = Hash.new { |h, k| h[k] = [] }   # permission → なぜ要るか(理由の並び)
used_prefs = []

# (1) setup() を走らせる。読む pref と style は、ここが正確
tsb = ARGV[1]
if tsb && File.file?(tsb)
  wasm = Dir.glob(File.join(ROOT, "drops", "std-tsubaki-runtime", "src", "wasm", "*.wasm")).first
  out = `node #{File.join(ROOT, "scripts/run-ops.cjs").inspect} #{wasm.inspect} #{tsb.inspect} setup 2>/dev/null`
  if $?.success? && !out.strip.empty?
    setup = JSON.parse(out) rescue nil
    if setup
      used_prefs = ((setup["prefs"] || []) + (setup["prefs_json"] || [])).uniq
      needed["chrome_style"] << "setup() が生の CSS を一枚出している" if setup["style"].to_s != ""
    end
  end
end

# (2) ops を読む
src = Dir.glob(File.join(dir, "src", "*", "ops", "*.tsubaki"))
text = src.map { |f| File.read(f) }.join("\n")
consts = text.scan(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/).to_h

text.scan(/\bOpenURL\(/) { needed["open_url"] << "OpenURL を使っている" }
text.scan(/\bReloadFrame\(/) { needed["web_frame"] << "ReloadFrame を使っている" }
text.scan(/el\("browser"/) { needed["web_frame"] << "view が <browser> を書いている" }
text.scan(/\bAsk\(\[([^\]]*)\]/) do |fields|
  fields[0].scan(/"([^"]+)"/).flatten.each do |f|
    p = ABI.dig("facts", f, "permission")
    needed[p] << %(Ask("#{f}") を使っている) if p
  end
end
text.scan(/\bSetPref\(\s*([A-Za-z_][A-Za-z0-9_]*)/) do |var|
  value = consts[var[0]]
  used_prefs << value if value
  needed["prefs"] << (value ? "SetPref(#{value})" : "SetPref(#{var[0]}) -- 名前が定数に辿れない") unless value&.start_with?(own)
end
text.scan(/\bSetPref\(\s*"([^"]+)"/) do |lit|
  used_prefs << lit[0]
  needed["prefs"] << %(SetPref("#{lit[0]}")) unless lit[0].start_with?(own)
end
used_prefs = used_prefs.uniq
outside = used_prefs.reject { |p| p.start_with?(own) }
outside.each { |p| needed["prefs"] << "pref #{p} を読む / 書く" }
needed.delete(nil)

# --- 突き合わせ --------------------------------------------------------------
missing = []
unused = []

needed.each do |perm, whys|
  spec = ABI["permissions"][perm] or next
  if spec["shape"] == "flag"
    missing << ["#{perm} = true", whys.uniq] unless declared[perm] == true
  else
    named = declared[perm].is_a?(Array) ? declared[perm] : []
    lack = outside.reject { |p| named.include?(p) }
    missing << ["#{perm} に #{lack.join(", ")}", whys.uniq] unless lack.empty?
  end
end

declared.each do |perm, value|
  spec = ABI["permissions"][perm]
  next unless spec
  if spec["shape"] == "flag"
    unused << perm if value == true && !needed.key?(perm)
  elsif value.is_a?(Array)
    value.each { |p| unused << "#{perm}: #{p}" unless used_prefs.include?(p) }
  end
end

# --- 出す --------------------------------------------------------------------
puts "#{name}: 入れる人の画面には、こう出る"
if declared.empty?
  puts "  (何も要らない。置いて、描くだけ)"
else
  declared.each do |perm, value|
    spec = ABI["permissions"][perm] or next
    next if spec["shape"] == "flag" && value != true
    ja = spec["shape"] == "names" ? spec["ja"].sub("{names}", Array(value).join("、")) : spec["ja"]
    puts "  - #{ja}"
  end
  puts "  これ以外のことはできません。"
end

unless missing.empty?
  puts
  puts "宣言が足りない:"
  missing.each { |what, whys| puts "  #{what}\n    #{whys.join(" / ")}" }
end
unless unused.empty?
  puts
  puts "宣言していて、一度も使っていない:"
  unused.each { |u| puts "  #{u}" }
end

exit(missing.empty? && unused.empty? ? 0 : 1)
