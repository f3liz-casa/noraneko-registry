#!/usr/bin/env ruby
# SPDX-License-Identifier: MPL-2.0
#
#   ruby scripts/dev.rb drops/<name> [drops/<other> ...]
#
# 書いているあいだの輪。見張って、組んで、棚に置く。
#
# 見ているのは二つ:
#
#   drops/<name>/          その drop
#   tooling/webext-actors/ 殻(ここが動くと、どの drop の bytes も変わる)
#
# 変わったら `build.rb --dev` で組み直して、`shelf.rb` で棚を書き直す。
# `--dev` は版に四つ目を足すので、**同じ版のまま bytes だけ替わることがない** --
# ブラウザの module cache は URL で引いていて、その URL に版が入っているから
# (docs/TRAPS.md「手元で見るとき」)。建て直しは、要らなくなる。
#
# 棚は 127.0.0.1:8765 で配りっぱなし。noraneko の pref に一度書けば、あとは
# 「入れ直す」を押すか、`noraneko.drops.dev.watch` を立てておけば勝手に入れ替わる。
#
# 転んでも死なない。組むところで転んだら、その理由を出して、次の変化を待つ。
require "json"
require "socket"

$stdout.sync = true   # 見張っている輪は、書いたそばから出す(file に落としても、tee しても)

ROOT = File.expand_path("..", __dir__)
PORT = 8765
TOOLING = File.join(ROOT, "tooling", "webext-actors")

abort "usage: dev.rb drops/<name> [drops/<other> ...]" if ARGV.empty?

names = ARGV.map do |arg|
  name = File.basename(arg)
  abort "#{name}: drops/#{name}/drop.toml が無い" unless File.file?(File.join(ROOT, "drops", name, "drop.toml"))
  name
end

def now
  Time.now.strftime("%H:%M:%S")
end

# その木の、いまの姿。file の path と mtime だけ見る(中身は読まない)
def snapshot(dir)
  Dir.glob(File.join(dir, "**", "*"), File::FNM_DOTMATCH)
     .reject { |f| f.include?("/node_modules/") || f.end_with?("/.", "/..") }
     .select { |f| File.file?(f) }
     .to_h { |f| [f, File.mtime(f).to_f] }
rescue Errno::ENOENT
  {}   # 書いている最中に消えた file。次の周で見える
end

# 組む。通ったら版を返す。転んだら、その出力をそのまま見せる
def build(name)
  t = Time.now
  out = IO.popen(
    ["mise", "exec", "--", "ruby", File.join(ROOT, "scripts", "build.rb"), "--dev", "drops/#{name}"],
    chdir: ROOT, err: [:child, :out], &:read
  )
  unless $?.success?
    puts "#{now}  #{name}: 組めなかった"
    out.each_line { |l| puts "    #{l.chomp}" }
    return nil
  end
  manifest = JSON.parse(File.read(File.join(ROOT, "_build", name, "manifest.json")))
  version = manifest.dig("entries", 0, "version")
  puts "#{now}  #{name} #{version} を組んだ(#{"%.1f" % (Time.now - t)} 秒)"
  # --dev が門を素通りしたところだけは、黙らずに出す(出すときに効く話なので)
  out.each_line { |l| puts "    #{l.chomp}" if l.start_with?("--dev:") }
  version
end

# 棚を書き直す。足りない足元があれば、それだけ出す
def shelf
  out = IO.popen(["mise", "exec", "--", "ruby", File.join(ROOT, "scripts", "shelf.rb")],
                 chdir: ROOT, err: [:child, :out], &:read)
  unless $?.success?
    puts "#{now}  棚が書けなかった"
    out.each_line { |l| puts "    #{l.chomp}" }
    return
  end
  missing = out[/^足りない.*\n((?:  .*\n)*)/]
  puts missing.lines.map { |l| "    #{l.chomp}" } if missing
end

puts "見ている: #{names.join(", ")} と 殻(tooling/webext-actors)"
names.each { |n| build(n) }
shelf

# 配る。`_shelf/` そのものは消えない作りなので(shelf.rb)、組み直しても足元は残る。
# だから、もう誰かが同じ棚を配っているなら、そのまま乗る(二つ立てても取り合うだけ)
served = File.join(ROOT, "_shelf")
abort "棚がまだ無い(_shelf/)。上の「組めなかった」を先に" unless File.directory?(served)
already = begin
  TCPSocket.new("127.0.0.1", PORT).close
  true
rescue SystemCallError
  false
end
server = already ? nil : spawn("python3", "-m", "http.server", PORT.to_s, "--bind", "127.0.0.1",
                               chdir: served, out: File::NULL, err: File::NULL)
puts
puts "(#{PORT} は、もう誰かが配っている。そのまま使う)" if already
puts "棚: http://127.0.0.1:#{PORT}/drop  (noraneko の pref noraneko.drops.registries に)"
puts %([{"name":"local","base":"http://127.0.0.1:#{PORT}/drop","identity":"local","issuer":"local"}])
puts "Ctrl-C で終わり"
puts

running = true
trap("INT") { running = false }

seen = names.to_h { |n| [n, snapshot(File.join(ROOT, "drops", n))] }
seen_tooling = snapshot(TOOLING)

while running
  sleep 0.5
  next unless running

  tooling_now = snapshot(TOOLING)
  shell_moved = tooling_now != seen_tooling
  changed = shell_moved ? names : names.select { |n| snapshot(File.join(ROOT, "drops", n)) != seen[n] }
  next if changed.empty?

  # 書き終わるのを待つ(保存の途中で読むと、半分の file を組むことになる)
  sleep 0.3
  changed.each { |n| seen[n] = snapshot(File.join(ROOT, "drops", n)) }
  seen_tooling = snapshot(TOOLING)

  puts "#{now}  殻が変わった(#{changed.length} 枚を組み直す)" if shell_moved
  built = changed.map { |n| build(n) }.compact
  shelf unless built.empty?
end

if server
  Process.kill("TERM", server) rescue nil
  Process.wait(server) rescue nil
end
puts "\n終わり"
