#!/usr/bin/env ruby
# SPDX-License-Identifier: MPL-2.0
#
#   ruby scripts/build-wasm.rb [--tsubaki ~/repos/tsubaki] [--check]
#
# 配っている wasm(drops/std-tsubaki-runtime/src/wasm/tsbvm.wasm)が、本当に
# wasm.toml の書いた素から出るのかを確かめる。--check だけなら sha256 を見るだけ
# (組む道具が要らないので、CI の verify はこちら)。
#
# いまは bit 単位では再現しない -- 同じ recipe で組み直すと一バイト大きい。
# 素の repo の枝が push されたら、CI で pinned commit から組むところまで行く。

require "digest"
require "fileutils"
require "tmpdir"

root = File.expand_path("..", __dir__)
drop = File.join(root, "drops", "std-tsubaki-runtime")
lock = File.read(File.join(drop, "wasm.toml"))

want = lock[/^sha256\s*=\s*"([0-9a-f]+)"/, 1] or abort "wasm.toml に sha256 が無い"
rel  = lock[/^file\s*=\s*"([^"]+)"/, 1] or abort "wasm.toml に file が無い"
commit = lock[/^commit\s*=\s*"([^"]+)"/, 1]
wasm = File.join(drop, rel)

have = Digest::SHA256.hexdigest(File.binread(wasm))
if have != want
  abort "配っている wasm が wasm.toml と違う\n  wasm.toml: #{want}\n  実物:      #{have}\n" \
        "  (差し替えたなら wasm.toml の sha256 と bytes と commit も直す)"
end
puts "sha256 ok: #{have[0, 16]}… (#{File.size(wasm)} bytes, tsubaki #{commit})"
exit 0 if ARGV.include?("--check")

# ここから先は、手元の tsubaki を組んで突き合わせる
i = ARGV.index("--tsubaki")
src = File.expand_path(i ? ARGV[i + 1] : "~/repos/tsubaki")
abort "tsubaki が見つからない: #{src}(--tsubaki で指す)" unless File.directory?(File.join(src, "tsbvm"))

at = `git -C "#{src}" rev-parse --short HEAD 2>/dev/null`.strip
warn "note: 手元の tsubaki は #{at}、wasm.toml は #{commit}" if !at.empty? && !commit.start_with?(at) && !at.start_with?(commit)

cargo = lock[/^cargo\s*=\s*"([^"]+)"/, 1]
opt   = lock[/^wasm_opt\s*=\s*"([^"]+)"/, 1]
raw   = File.join(src, "tsbvm", "target", "wasm32-unknown-unknown", "release", "tsbvm.wasm")

puts "組む: #{cargo}"
Dir.chdir(File.join(src, "tsbvm")) { abort "cargo が転んだ" unless system(cargo) }
out = File.join(Dir.tmpdir, "tsbvm-rebuilt.wasm")
puts "縮める: #{opt}"
abort "wasm-opt が転んだ" unless system("#{opt} #{raw} -o #{out}")

again = Digest::SHA256.hexdigest(File.binread(out))
if again == have
  puts "同じ bytes が出た(#{File.size(out)} bytes)"
else
  puts "ちがう bytes が出た:"
  puts "  配っているもの: #{File.size(wasm)} bytes  #{have[0, 16]}…"
  puts "  組み直したもの: #{File.size(out)} bytes  #{again[0, 16]}…"
  puts "  (toolchain の版が違うと、こうなる。rustc と wasm-opt の版は wasm.toml の [built_with])"
end
