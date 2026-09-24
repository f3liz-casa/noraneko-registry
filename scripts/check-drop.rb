#!/usr/bin/env ruby
# SPDX-License-Identifier: MPL-2.0
#
#   ruby scripts/check-drop.rb drops/<name> [<sheet.tsb>...]
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

dir = ARGV[0] or abort "usage: check-drop.rb drops/<name> [<sheet.tsb>...]"
dir = File.expand_path(dir, ROOT)
name = File.basename(dir)
toml = File.read(File.join(dir, "drop.toml"))

# --- 宣言 -------------------------------------------------------------------
section = toml[/^\[permissions\]\s*\n((?:(?!\[).*\n?)*)/, 1].to_s
declared = {}
section.scan(/^\s*([a-z_]+)\s*=\s*\[([^\]]*)\]/) { |k, v| declared[k] = v.scan(/"([^"]*)"/).flatten }
section.scan(/^\s*([a-z_]+)\s*=\s*(true|false)\s*$/) { |k, v| declared[k] = (v == "true") }
# 段のある permission(tabs = "read")。段は一つの字で書く
section.scan(/^\s*([a-z_]+)\s*=\s*"([^"]*)"\s*$/) { |k, v| declared[k] = v }
own = "noraneko.#{name}."

# --- 実際にしていること -------------------------------------------------------
needed = Hash.new { |h, k| h[k] = [] }   # permission → なぜ要るか(理由の並び)
used_prefs = []

# (1) setup() を走らせる。読む pref と style は、ここが正確
# 読む順に並べた .tsb。deps の言葉(std)が先、drop 自身のがあと
sheets = ARGV[1..].select { |a| a.end_with?(".tsb") && File.file?(a) }
if sheets.any?
  wasm = Dir.glob(File.join(ROOT, "drops", "std-tsubaki-runtime", "src", "wasm", "*.wasm")).first
  out = `node #{File.join(ROOT, "scripts/run-ops.cjs").inspect} #{wasm.inspect} #{sheets.map(&:inspect).join(" ")} setup 2>/dev/null`
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
text.scan(/\bWriteClipboard\(/) { needed["clipboard_write"] << "WriteClipboard を使っている" }
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

# view が書いている <key> の押しかた。指の並び順と大文字小文字は押しかたを
# 変えないので、突き合わせる前に同じ字にする(殻の sameKey と同じ決まり)。
def same_key(combo)
  parts = combo.split("+").map { |p| p.strip.downcase }.reject(&:empty?)
  last = parts.pop.to_s
  (parts.sort + [last]).join("+")
end
# 字で書いてあっても、定数に置いてあっても(`COMBO = "Accel+Alt+Z"`)、同じ一つ
used_combos = (
  text.scan(/"combo"\s*=>\s*"([^"]+)"/).flatten +
  text.scan(/"combo"\s*=>\s*([A-Z][A-Z0-9_]*)/).flatten.filter_map { |v| consts[v] }
).uniq
used_combos.each { |c| needed["keys"] << %(<key> の #{c}) }

# permission ごとの「実際に名指ししているもの」。宣言(名前の並び)と突き合わせる
# DoCommand("back") / DoCommand(BACK)。どちらの綴りでも、同じ一つ
used_commands = (
  text.scan(/\bDoCommand\(\s*"([^"]+)"/).flatten +
  text.scan(/\bDoCommand\(\s*([A-Z][A-Z0-9_]*)\s*\)/).flatten.filter_map { |v| consts[v] }
).uniq
used_commands.each { |c| needed["commands"] << %(DoCommand("#{c}")) }

# タブのこと。目印(見えるもの)と覚書(残るもの)と、字を打つ欄。
# どれも「自分が付けたもの」しか触らないので、名前の並びではなく一つの宣言で足りる
text.scan(/\bSetTabAttr\(|\bClearTabAttr\(/) { needed["tab_marks"] << "タブに目印を付けている(SetTabAttr)" }
text.scan(/\bSetTabValue\(|\bClearTabValue\(/) { needed["tab_values"] << "タブに覚書を残している(SetTabValue)" }
text.scan(/\bPrompt\(/) { needed["prompt"] << "Prompt(字を打つ欄)を出している" }
text.scan(/\bWatch\(/) { needed["tabs"] << "タブの出来事を見ている(setup の watch)" }
text.scan(/\btab_values\s*=\s*\[/) { needed["tab_values"] << "setup が覚書の鍵を並べている" }
text.scan(/\bSetWindowValue\(|\bClearWindowValue\(/) { needed["window_values"] << "窓に覚書を残している(SetWindowValue)" }
text.scan(/\bwindow_values\s*=\s*\[/) { needed["window_values"] << "setup が窓の覚書の鍵を並べている" }

# 段のある permission の、どの段が要るか。**表が知っている**(level を書いた effect)
# ので、ここで名前を並べ直さない。二つ以上の段が要るときは上のほうを採る
# ── 上の段を一つ言えば、下の段はその一文の中に含まれている。
need_level = {}
raise_level = lambda do |perm, step|
  steps = ABI["permissions"].dig(perm, "levels")&.keys or next
  now = need_level[perm]
  need_level[perm] = step if now.nil? || steps.index(step).to_i > steps.index(now).to_i
end
ABI["effects"].each do |ename, spec|
  next unless spec["level"] && text.include?("#{ename}(")
  needed[spec["permission"]] << "#{ename} を使っている"
  raise_level.call(spec["permission"], spec["level"])
end

# 戻ってくるタブを、覚書から迎えるところ(setup の restore)
text.scan(/\bRestore\(/) { needed["tab_values"] << "戻ってくるタブに、覚書から目印を焼いている(Restore)" }
if text.match?(/\bhide_unless\b/)
  needed["tabs"] << "戻ってくるタブを、仕舞ったまま戻している(Restore の hide_unless)"
  raise_level.call("tabs", "write")
end

# 本体の menu に混ぜる行(Anchor(at = "menu", menu = "tabContextMenu"))
used_menus = text.scan(/\bmenu\s*=\s*"([^"]+)"/).flatten.uniq
used_menus.each { |m| needed["menu"] << %(at: "menu" の #{m}) }

# view が <browser> に書いているページの名前
used_pages = text.scan(/"page"\s*=>\s*"([^"]+)"/).flatten.uniq
used_pages.each { |n| needed["browser_pages"] << %(<browser page="#{n}">) }
# 名前が表に無いものは、宣言してあっても実行されない。ここで先に言う
unknown = used_commands.reject { |c| ABI["commands"].key?(c) } +
          used_pages.reject { |n| ABI["browser_pages"].key?(n) }.map { |n| "page: #{n}" } +
          used_menus.reject { |m| ABI["menus"].key?(m) }.map { |m| "menu: #{m}" }

# ops のどこかで口にしている字。**名前をデータで持つ drop**(席の並び、選べる命令の
# 一覧)は `DoCommand("back")` とは書かない -- 名前は表に入っていて、実行時に選ばれる。
# 静的に読むほうは、そこまで追えない。だから「使っている」を
# **「その名前を口にしている」** と読む。宣言だけがあって、どこにも書いていない名前は
# 見つかる(そこが目的)。実際に走るかどうかは、殻が実行時に断るほうで守られている。
mentioned = text.scan(/"([^"]*)"/).flatten.uniq

wanted = { "prefs" => outside, "keys" => used_combos, "commands" => used_commands,
           "browser_pages" => used_pages, "menu" => used_menus }
used_names = { "prefs" => used_prefs, "keys" => used_combos, "commands" => used_commands,
               "browser_pages" => used_pages, "menu" => used_menus }
# prefs は名前が定数に辿れるので、そこは締めたまま
loose = ["keys", "commands", "browser_pages"]
same = { "keys" => method(:same_key) }
needed.delete(nil)

# --- 突き合わせ --------------------------------------------------------------
missing = []
unused = []

needed.each do |perm, whys|
  spec = ABI["permissions"][perm] or next
  if spec["shape"] == "flag"
    missing << ["#{perm} = true", whys.uniq] unless declared[perm] == true
  elsif spec["shape"] == "level"
    # どの段が要るかは、上で effect から拾っている。書いていない、あるいは要るより
    # 下の段なら、足りない(前は「一段でも書いてあれば通る」だった)
    steps = spec["levels"].keys
    want = need_level[perm] || steps.first
    have = declared[perm]
    at = have.is_a?(String) ? steps.index(have) : nil
    missing << ["#{perm} = #{want.inspect}", whys.uniq] if at.nil? || at < steps.index(want).to_i
  else
    as = same[perm] || :itself.to_proc
    named = (declared[perm].is_a?(Array) ? declared[perm] : []).map(&as)
    lack = (wanted[perm] || []).reject { |p| named.include?(as.call(p)) }
    missing << ["#{perm} に #{lack.join(", ")}", whys.uniq] unless lack.empty?
  end
end

declared.each do |perm, value|
  spec = ABI["permissions"][perm]
  next unless spec
  if spec["shape"] == "flag"
    unused << perm if value == true && !needed.key?(perm)
  elsif spec["shape"] == "level"
    unused << perm if spec["levels"].key?(value) && !needed.key?(perm)
  elsif value.is_a?(Array)
    as = same[perm] || :itself.to_proc
    used = (used_names[perm] || []).map(&as)
    used += mentioned.map(&as) if loose.include?(perm)
    value.each { |p| unused << "#{perm}: #{p}" unless used.include?(as.call(p)) }
  end
end

# --- 言葉 --------------------------------------------------------------------
# 鍵で書いたものが、どのロケールで字になるか。en は最後の頼りなので、そこに
# 無い鍵は実機で鍵そのものが出る。他のロケールの抜けは「まだ訳していない」で、
# 止めはしないが、数は言う。
used_keys = text.scan(/\bt\(:([A-Za-z_][A-Za-z0-9_]*)\)/).flatten.uniq.sort
strings = {}
Dir.glob(File.join(dir, "src", "*", "strings.toml")).each do |path|
  locale = nil
  File.readlines(path).each do |line|
    if (m = line.match(/^\s*\[([A-Za-z][A-Za-z0-9-]*)\]\s*$/))
      locale = m[1]
      strings[locale] ||= {}
    elsif locale && (m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"(.*)"\s*$/))
      strings[locale][m[1]] = m[2]
    end
  end
end
lost = used_keys.reject { |k| strings.dig("en", k) }
spare = (strings["en"] || {}).keys.reject { |k| used_keys.include?(k) }
thin = strings.keys.sort.reject { |l| l == "en" }.map do |l|
  gap = used_keys.reject { |k| strings[l][k] }
  gap.empty? ? nil : [l, gap]
end.compact

# --- 出す --------------------------------------------------------------------
puts "#{name}: 入れる人の画面には、こう出る"
if declared.empty?
  puts "  (何も要らない。置いて、描くだけ)"
else
  declared.each do |perm, value|
    spec = ABI["permissions"][perm] or next
    next if spec["shape"] == "flag" && value != true
    if spec["shape"] == "level"
      # 段の一文だけを出す(下の段の文は、その中に含まれている)
      ja = spec["levels"][value]
      next unless ja
    elsif spec["shape"] == "names"
      # 表に載っている名前は、表の日本語で並べる(入れる人が読むのは、そちらのほう)
      table = spec["names_from"] ? ABI[spec["names_from"]] : nil
      words = Array(value).map { |v| table&.dig(v.to_s, "ja") || v.to_s }
      ja = spec["ja"].sub("{names}", words.join("、"))
    else
      ja = spec["ja"]
    end
    puts "  - #{ja}"
  end
  puts "  これ以外のことはできません。"
end

unless unknown.empty?
  puts
  puts "表に無い名前(宣言しても通らない。abi/v1.json):"
  unknown.each { |c| puts "  #{c}" }
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

unless used_keys.empty?
  puts
  locales = strings.keys.sort
  puts "言葉: 鍵 #{used_keys.length} 個 / ロケール #{locales.join(", ")}"
  thin.each { |l, gap| puts "  #{l} に無い: #{gap.join(", ")}" }
end
unless lost.empty?
  puts
  puts "字が en に並んでいない鍵(実機では鍵がそのまま出る):"
  lost.each { |k| puts "  t(:#{k})" }
end
unless spare.empty?
  puts
  puts "字を並べていて、一度も呼ばれない鍵:"
  spare.each { |k| puts "  #{k}" }
end

exit(missing.empty? && unused.empty? && lost.empty? && spare.empty? && unknown.empty? ? 0 : 1)
