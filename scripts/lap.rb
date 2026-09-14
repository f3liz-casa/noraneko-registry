#!/usr/bin/env ruby
# SPDX-License-Identifier: MPL-2.0
#
#   ruby scripts/lap.rb drops/<name> [drops/<name> ...]
#   NORANEKO=/path/to/Noraneko.app/Contents/MacOS/noraneko ruby scripts/lap.rb drops/hello-tsubaki
#
# 実機で一周させて、置かれたか・何をしたか・言い忘れたことはあるかを出す。
#
# `_stage/<name>/_dist/<actor>/` を使い捨ての場所へ写し、resource の別名を張って、
# actor を手で登録して、窓を一つ開く。集めるのは三つ:
#
#   置いた    その drop が窓に足した要素の id
#   したこと  observer "nora-drop-did"(_shared/tsubakiActor.ts の note)
#   言い忘れ  宣言の外に出たときの、drop.toml に貼れる行
#
# **本体の Drops 機構は通らない。** artifact build では起きない(`import.meta.env` が
# 無くて `[noraneko-drops] startup install failed`)ので、代わりに noraneko-testbed の
# NoraActors.sys.mts と同じ形で registerWindowActor する。だから「本体経由でも動く」
# までは言えない -- 言えるのは「殻と logic は実機で一周する」ところまで。
#
# 自分で actor.ts を書いた drop(殻を使わない drop)は、置かれても記録が出ない。
# 出ないのが正しい -- 記録は殻が残しているので。
#
# 分かっている穴(直したら消す):
#
# - **newtab 系の drop が、この道具では起きない。** about:home / about:welcome /
#   about:newtab のどれを開いても置かれず、console も静か。本体経由なら動いている
#   ので、手で登録する形が本体とどこか違う。「置いた」が空なのは、道具が見落として
#   いるのか本当に置かれていないのか、いまは見分けられない。
# - 「置いた」は id か class に `nora` を含むものを探す。それが無い drop は、その
#   drop の名前がページに出ているかで見る(newtab-hello は mount に id を渡して
#   いない)。どちらも無ければ、見つからない。
# - 置くところまでしか回さない。押したときに何をするかは golden(drop-test.rb)で。
require "json"
require "socket"
require "tmpdir"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
abort "usage: lap.rb drops/<name> [drops/<name> ...]" if ARGV.empty?

# `..` を含んだままだと XPCOM が自分の場所を見つけられない("Couldn't load XPCOM.")
BIN = File.expand_path(ENV["NORANEKO"] || File.join(
  ROOT, "..", "noraneko-testbed", "_dist", "bin", "noraneko", "Noraneko.app", "Contents", "MacOS", "noraneko"
))
abort "noraneko が見つからない: #{BIN}\n  NORANEKO=... で指してください" unless File.executable?(BIN)

# 走らせる drop: _stage に build 済みのものだけ(先に scripts/build.rb を通すこと)
drops = ARGV.map do |arg|
  name = File.basename(arg)
  dist = Dir[File.join(ROOT, "_stage", name, "_dist", "*")].find { |d| File.file?(File.join(d, "actor.json")) }
  abort "#{name}: _stage に build がない(先に `ruby scripts/build.rb drops/#{name}`)" unless dist
  { name: name, dir: File.basename(dist), dist: dist }
end

# 写して、自分を指す別名だけ付け替える(noraneko-builtin は本体が張っているので、触らない)
live = Dir.mktmpdir("nora-lap-")
drops.each do |d|
  dest = File.join(live, d[:dir])
  FileUtils.cp_r(d[:dist], dest)
  Dir[File.join(dest, "*.sys.mjs")].each do |f|
    File.write(f, File.read(f).gsub("resource://noraneko-builtin/#{d[:dir]}/", "resource://live-#{d[:dir]}/"))
  end
end

profile = Dir.mktmpdir("nora-lap-profile-")
log = File.join(File.dirname(profile), "nora-lap.log")   # profile を片づけても残す(転んだときに読む)

# ── Marionette。`<長さ>:<JSON>` の往復だけ ──────────────────────────────────
class Marionette
  def initialize(port)
    @sock = TCPSocket.new("127.0.0.1", port)
    @id = 0
    recv # hello
  end

  def recv
    len = +""
    loop do
      c = @sock.readpartial(1)
      break if c == ":"
      len << c
    end
    want = len.to_i
    body = +""
    body << @sock.readpartial(want - body.bytesize) while body.bytesize < want
    JSON.parse(body)
  end

  def call(name, params = {})
    @id += 1
    msg = JSON.generate([0, @id, name, params])
    @sock.write("#{msg.bytesize}:#{msg}")
    recv
  end
end

pid = nil
begin
  pid = spawn(
    { "MOZ_HEADLESS" => "1", "MOZ_NO_REMOTE" => "1" },
    BIN, "--profile", profile, "--marionette", "--remote-allow-system-access", "--no-remote",
    # out: と err: を別々に書くと、同じ file を二つの offset で書いて行が壊れる
    [:out, :err] => log
  )
  # marionette が立つまで(--marionette-port は効かないので 2828 固定)
  up = false
  60.times do
    sleep 0.5
    up = File.exist?(log) && File.read(log).include?("Listening on port")
    break if up
  end
  abort "marionette が立たなかった。ほかの noraneko が 2828 を使っていませんか\n  #{log}" unless up

  m = Marionette.new(2828)
  m.call("WebDriver:NewSession", {})
  m.call("WebDriver:SetTimeouts", { "script" => 120_000 })
  m.call("Marionette:SetContext", { "value" => "chrome" })

  script = File.read(File.join(__dir__, "lap.js"))
  r = m.call("WebDriver:ExecuteAsyncScript", {
    "script" => script,
    "args" => [{ "stage" => File.join(ROOT, "_stage"), "live" => live,
                 "drops" => drops.map { |d| { "name" => d[:name], "dir" => d[:dir] } } }],
  })
  out = r.is_a?(Array) ? r[3]&.dig("value") : nil
  abort "走らなかった: #{JSON.pretty_generate(r)}" unless out.is_a?(Hash)
  abort "走らなかった: #{out["err"]}" if out["err"]

  puts
  out["drops"].each do |d|
    puts "#{d["name"]}  #{d["actor"]}"
    puts "  宣言     #{d["permissions"].empty? ? "(何も要らない)" : d["permissions"].join(", ")}"
    puts "  置いた   #{d["placed"].empty? ? "(何も見つからない)" : d["placed"].join(" ")}"
    did = out["did"].select { |x| x["drop"] == d["name"] }
    if did.empty?
      puts "  したこと #{d["shell"] ? "(まだ何もしていない)" : "(殻を通らない drop ── 自分で actor.ts を書いている)"}"
    else
      did.each { |x| puts "  したこと #{x["did"]} #{x["about"]}#{x["value"] ? " = #{x["value"]}" : ""}" }
    end
    told = out["told"].select { |t| t.include?(d["name"]) }
    puts "  言い忘れ #{told.empty? ? "なし" : ""}"
    told.each { |t| puts "    #{t}" }
    puts
  end
  unless out["errors"].empty?
    puts "console に出たもの:"
    out["errors"].each { |e| puts "  #{e}" }
    puts
  end
  exit(out["errors"].empty? ? 0 : 1)
ensure
  if pid
    Process.kill("TERM", pid) rescue nil
    Process.wait(pid) rescue nil
  end
  FileUtils.rm_rf(live)
  FileUtils.rm_rf(profile)
end
