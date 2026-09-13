#!/usr/bin/env ruby
# SPDX-License-Identifier: MPL-2.0
#
#   ruby scripts/drop-test.rb drops/<name> <ops.tsb> [--record]
#
# drop の logic を、**配る wasm そのもの**で走らせて、記録した答えと突き合わせる。
# browser を建てずに「振る舞いが変わっていないか」が分かる。
#
#   drops/<name>/tests/<case>.calls   叩く door を上から順に(一行が一つ)
#   drops/<name>/tests/<case>.out     そのときの答え(記録)
#
# 同じ VM の中で順に叩くので、呼び出しの間に state が残る -- 実機と同じ形です。
# --record で記録を取り直す(**diff を読んでから**入れること。golden は、変わった
# ことに気づくためのもので、合わせるためのものではない)。

ROOT = File.expand_path("..", __dir__)

dir = ARGV[0] or abort "usage: drop-test.rb drops/<name> <ops.tsb> [--record]"
dir = File.expand_path(dir, ROOT)
tsb = ARGV[1] or abort "ops.tsb を指して"
record = ARGV.include?("--record")
name = File.basename(dir)

cases = Dir.glob(File.join(dir, "tests", "*.calls")).sort
if cases.empty?
  puts "#{name}: tests/*.calls が無い(まだ記録していない)"
  exit 0
end

wasm = Dir.glob(File.join(ROOT, "drops", "std-tsubaki-runtime", "src", "wasm", "*.wasm")).first
abort "runtime の wasm が見つからない" unless wasm

bad = []
cases.each do |calls|
  want_path = calls.sub(/\.calls\z/, ".out")
  got = `node #{File.join(ROOT, "scripts/run-ops.cjs").inspect} #{wasm.inspect} #{tsb.inspect} --calls #{calls.inspect} 2>&1`
  unless $?.success?
    bad << "#{File.basename(calls)}: 走らせるところで転んだ\n#{got.lines.first(6).join}"
    next
  end

  if record
    File.write(want_path, got)
    puts "#{name}/#{File.basename(want_path)}: 記録した(#{got.lines.length} 行)"
    next
  end

  unless File.file?(want_path)
    bad << "#{File.basename(want_path)} が無い(--record で取る)"
    next
  end
  want = File.read(want_path)
  next if want == got

  # どこが違うかを、行で言う
  w = want.lines
  g = got.lines
  i = w.zip(g).index { |a, b| a != b } || [w.length, g.length].min
  bad << "#{File.basename(calls)}: #{i + 1} 行目から違う\n" \
         "  記録: #{(w[i] || "(ここで終わり)").chomp}\n" \
         "  いま: #{(g[i] || "(ここで終わり)").chomp}"
end

if bad.empty?
  puts "#{name}: golden #{cases.length} 枚、同じ答え" unless record
  exit 0
end
puts "#{name}: 振る舞いが変わっている"
bad.each { |b| puts "  #{b}" }
puts "  (直したのなら ruby scripts/drop-test.rb #{ARGV[0]} #{tsb} --record。**diff を読んでから**)"
exit 1
