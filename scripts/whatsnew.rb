#!/usr/bin/env ruby
# whatsnew.rb: **判を押す前に、何が新しくなるかを言う。**
#
#   ruby scripts/whatsnew.rb <name> [<name>...]   → markdown を stdout に
#
# sign は environment の門(管理者の承認)で止まる。そのとき run の頁に出ているのが
# 「approve しますか」だけだと、押す人は中身を見ないまま押すことになる。組み上がった
# _build/<name>/manifest.json と、**いま dl が配っているもの**を較べて、変わるところだけを出す。
#
# いちばん見たいのは「版は同じなのに **中身** が違う」── 中身が変わったのに版が据え置きなら、
# 固定して使っている drop が黙って別のものになる。ここで赤く言う。
#
# sha256 が違うだけでは、そうとは限らない: xpi には組んだ commit の時刻が刻まれるので、
# main が動くと中身が同じでも sha は変わる。だから **中に入っている file の CRC で較べる**。
# 「時刻だけ違う」と「中身が違う」は、押す人にとって全く別の話なので、混ぜない。
require "json"
require "net/http"
require "uri"
require "tmpdir"
require "shellwords"

DL = ENV.fetch("DL", "https://dl.f3liz.casa/drop")
root = File.expand_path("..", __dir__)

def served(uuid)
  r = Net::HTTP.get_response(URI("#{DL}/#{uuid}/manifest.json"))
  r.code == "200" ? JSON.parse(r.body) : nil
rescue StandardError
  nil
end

def entry_of(m) = (m["entries"] || []).first || {}

# xpi の中身の指紋: (名前, 大きさ, CRC)。時刻は入れない
def fingerprint(path)
  out = `unzip -v #{path.shellescape} 2>/dev/null`
  out.lines.filter_map { |l|
    f = l.split
    next unless f.size >= 8 && f[0] =~ /\A\d+\z/
    "#{f[7]} #{f[0]} #{f[6]}"
  }.sort
end

# 配られている xpi を落として、中身の指紋を取る(数十 KB。判を押す前の一回だけ)
def served_fingerprint(uuid, file)
  r = Net::HTTP.get_response(URI("#{DL}/#{uuid}/#{file}"))
  return nil unless r.code == "200"
  Dir.mktmpdir("whatsnew-") do |d|
    p = File.join(d, file)
    File.binwrite(p, r.body)
    fingerprint(p)
  end
rescue StandardError
  nil
end
def extras(m) = %w[icon sources].filter_map { |k| m[k] && "#{k}(#{m[k]["size"]}B)" } +
                ((m["shots"] || []).empty? ? [] : ["shots ×#{m["shots"].size}"])

rows = []
notes = []
warn_rows = []

ARGV.each do |name|
  path = File.join(root, "_build", name, "manifest.json")
  next warn("#{name}: _build に manifest が無い(build されていない)") unless File.file?(path)
  now = JSON.parse(File.read(path))
  old = served(now["uuid"])
  ne = entry_of(now)
  oe = old ? entry_of(old) : {}

  same_bytes = old && oe["sha256"] == ne["sha256"]
  same_inside = nil
  if old && !same_bytes && oe["version"] == ne["version"]
    # 版が据え置きで sha が違うときだけ、中身まで見に行く
    now_fp = fingerprint(File.join(root, "_build", name, ne["file"].to_s))
    old_fp = served_fingerprint(now["uuid"], oe["file"].to_s)
    same_inside = old_fp && now_fp == old_fp
  end

  state =
    if old.nil? then "**はじめて**"
    elsif oe["version"] != ne["version"] then "#{oe["version"]} → **#{ne["version"]}**"
    elsif same_bytes then "変わらない"
    elsif same_inside then "中身は同じ(組んだ時刻だけ)"
    elsif same_inside == false then "⚠️ **中身が変わる**"
    else "bytes が違う(中身は確かめられなかった)"
    end
  rows << [name, ne["version"], state, "`#{(ne["sha256"] || "")[0, 12]}`"]

  if same_inside == false
    warn_rows << "- **#{name}** — `#{ne["version"]}` のまま **中身が変わる**(配られているのは " \
                 "`#{(oe["sha256"] || "")[0, 12]}`、これから置くのは `#{(ne["sha256"] || "")[0, 12]}`)。" \
                 "固定して使っている drop が、黙って別のものになる。版を上げたほうがいい"
  end

  # 添え物と、使う library の動き
  a = old ? extras(old) : []
  b = extras(now)
  notes << "- **#{name}** 添え物: #{a.empty? ? "(無し)" : a.join(" / ")} → #{b.empty? ? "(無し)" : b.join(" / ")}" if a != b
  od = (old&.dig("deps") || []).to_h { |d| [d["name"], d["version"]] }
  nd = (now["deps"] || []).to_h { |d| [d["name"], d["version"]] }
  (od.keys | nd.keys).sort.each do |k|
    next if od[k] == nd[k]
    notes << "- **#{name}** 使う library: #{k} #{od[k] || "(無し)"} → #{nd[k] || "(外れる)"}"
  end
end

exit 0 if rows.empty?

puts "## 判を押すと、こうなる"
puts
puts "いま `#{DL}` が配っているものと較べたところ。"
puts
puts "| drop | 置く版 | いまと較べて | xpi の sha256 |"
puts "| --- | --- | --- | --- |"
rows.each { |r| puts "| #{r.join(" | ")} |" }

unless warn_rows.empty?
  puts
  puts "### ⚠️ 気をつけて"
  puts
  warn_rows.each { |w| puts w }
end

unless notes.empty?
  puts
  puts "### ほかに変わるところ"
  puts
  notes.each { |n| puts n }
end

src = (JSON.parse(File.read(File.join(root, "_build", ARGV.first, "manifest.json")))["source"] || {}) rescue {}
puts
puts "組んだのは `#{(src["commit"] || "")[0, 10]}`(#{src["commit_time"]})。"
puts "この表は判を押す前に作ったもの ── 押したあとに置かれるのは、ここに出ている sha256 の bytes。"
