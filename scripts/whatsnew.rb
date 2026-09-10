#!/usr/bin/env ruby
# whatsnew.rb: **判を押す前に、何が新しくなるかを言う。**
#
#   ruby scripts/whatsnew.rb <name> [<name>...]            → markdown を stdout に
#   ruby scripts/whatsnew.rb --names <name> [<name>...]    → 置き直す価値のある名前だけ
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
# --names: 置き直す価値のあるものだけを一行で(道具を変えたときに全部を組み直しても、
# **中身が同じものは置き直さない**ため。時刻だけ違う bytes を配り直すと、版を固定して
# 使っている人が黙って別の bytes を受け取ることになる)
only_names = ARGV.delete("--names")

def served(uuid)
  r = Net::HTTP.get_response(URI("#{DL}/#{uuid}/manifest.json"))
  r.code == "200" ? JSON.parse(r.body) : nil
rescue StandardError
  nil
end

def entry_of(m) = (m["entries"] || []).first || {}

# 版の大小。段を数で較べる(足りない段は 0)。"1.0.0.202609080812" のような四段も読める
# ── 前は commit の時刻を四段目に足していて、いま配られているものにその形が残っている
def newer?(a, b)
  x = a.to_s.split(".").map(&:to_i)
  y = b.to_s.split(".").map(&:to_i)
  n = [x.size, y.size].max
  (x + [0] * n).take(n) <=> (y + [0] * n).take(n)
end

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
worth = []

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

  went_back = old && oe["version"] != ne["version"] && newer?(ne["version"], oe["version"]) == -1

  state =
    if old.nil? then "**はじめて**"
    elsif went_back then "⚠️ #{oe["version"]} → **#{ne["version"]}**(下がる)"
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
                 "固定して使っている drop が、黙って別のものになる。**置き直さない** ── " \
                 "版を上げるか、それでも置き直すなら workflow_dispatch で手で回して"
  end

  if went_back
    warn_rows << "- **#{name}** — 版が **下がる**(配られているのは `#{oe["version"]}`、これから置くのは " \
                 "`#{ne["version"]}`)。下がった版は、いま入れている人には更新として届かない。" \
                 "**置き直さない** ── `#{oe["version"]}` より大きい版を名乗ってから"
  end

  # 添え物と、使う library の動き
  meta_moved = false
  a = old ? extras(old) : []
  b = extras(now)
  if a != b
    notes << "- **#{name}** 添え物: #{a.empty? ? "(無し)" : a.join(" / ")} → #{b.empty? ? "(無し)" : b.join(" / ")}"
    meta_moved = true
  end
  od = (old&.dig("deps") || []).to_h { |d| [d["name"], d["version"]] }
  nd = (now["deps"] || []).to_h { |d| [d["name"], d["version"]] }
  (od.keys | nd.keys).sort.each do |k|
    next if od[k] == nd[k]
    notes << "- **#{name}** 使う library: #{k} #{od[k] || "(無し)"} → #{nd[k] || "(外れる)"}"
    meta_moved = true
  end

  # 置き直すか。置き直さないのは二つ ──
  #   1. **時刻が違うだけ**(中身は同じ)。配り直すと、版を固定して使っている人が黙って
  #      別の bytes を受け取ることになる
  #   2. **版が据え置きで、中身が違う**。これは黙って別のものにすり替えることそのもので、
  #      いちばんやってはいけない。上の ⚠️ で言って、置かずに置いておく。
  #      版を上げるか、それでもと言うなら workflow_dispatch(手で回すときは絞らない)
  # 残り(はじめて / 版が動く / 中身が確かめられなかった / 添え物・使う library が動く)は置き直す
  next if same_inside == false || went_back
  worth << name if old.nil? || oe["version"] != ne["version"] ||
                   (!same_bytes && same_inside.nil?) || meta_moved
end

if only_names
  puts worth.join(" ")
  exit 0
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
puts(if worth.empty?
       "**置き直すものは無い**。"
     else
       "置き直すのは **#{worth.size} 件**: #{worth.join(", ")}。残りはそのままにする " \
       "── 版を固定して使っている人が、黙って別の bytes を受け取らないように。"
     end)
puts
puts "組んだのは `#{(src["commit"] || "")[0, 10]}`(#{src["commit_time"]})。"
puts "この表は判を押す前に作ったもの ── 押したあとに置かれるのは、ここに出ている sha256 の bytes。"
