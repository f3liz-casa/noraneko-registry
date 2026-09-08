#!/usr/bin/env ruby
# drop.toml の source(repo と commit)から drop を build し直して、manifest.json の sha256 と比べる。
#
#   ruby scripts/rebuild.rb drops/<code>
#
# 同じ commit を同じ道具(mise: deno / ruby)で build すれば同じ bytes が出る、が前提(noraneko の
# build-drop.rb は reproducible)。一致すれば exit 0 で、作り直した _dist/drops/<code>/ の path を出す。
# 一致しなければ何が違うかを出して exit 1。
require "json"
require "digest"
require "tmpdir"
require "fileutils"

dir = ARGV[0] or abort "usage: rebuild.rb drops/<code>"
toml = File.read(File.join(dir, "drop.toml"))
# 最小の toml 読み(この形しか使わない): key = "value" / key = [ "a", "b" ] / [section]
conf = {}
section = nil
toml.each_line do |l|
  l = l.sub(/#.*/, "").strip
  next if l.empty?
  if (m = l.match(/\A\[(\w+)\]\z/))
    section = m[1]
  elsif (m = l.match(/\A(\w+)\s*=\s*(.+)\z/))
    key = section ? "#{section}.#{m[1]}" : m[1]
    v = m[2].strip
    conf[key] = v.start_with?("[") ? v.scan(/"([^"]*)"/).flatten : v.delete('"')
  end
end
code = conf["code"] or abort "drop.toml: code が無い"
repo = conf["source.repo"] or abort "drop.toml: source.repo が無い"
commit = conf["source.commit"] or abort "drop.toml: source.commit が無い"
actors = conf["source.actors"] or abort "drop.toml: source.actors が無い"
abort "drop.toml: commit は 40 桁で(branch 名は動くので不可)" unless commit.match?(/\A[0-9a-f]{40}\z/)

expected = JSON.parse(File.read(File.join(dir, "manifest.json")))
abort "manifest.json: code が違う(#{expected["code"]} != #{code})" unless expected["code"] == code
abort "manifest.json: source.commit が違う" unless expected.dig("source", "commit") == commit

work = Dir.mktmpdir("nora-registry-")
begin
  puts "-> clone #{repo} @ #{commit[0, 10]}"
  system("git", "-c", "advice.detachedHead=false", "clone", "-q", "--no-checkout", repo, "#{work}/src") or abort "clone failed"
  system("git", "-C", "#{work}/src", "checkout", "-q", commit) or abort "checkout failed(commit が無い?)"
  Dir.chdir("#{work}/src") do
    puts "-> mise install"
    system("mise", "trust", "-q") if File.exist?("mise.toml")
    system("mise", "install", "-q") or abort "mise install failed"
    puts "-> deno install"
    system("mise", "exec", "--", "deno", "install", "--allow-scripts", "-q") or abort "deno install failed"
    puts "-> webext-actors build"
    system("mise", "exec", "--", "deno", "task", "build", chdir: "browser-features/webext-actors") or abort "actors build failed"
    puts "-> drop:build #{code} #{actors.join(' ')}"
    note = expected["note"]
    args = ["mise", "exec", "--", "ruby", "tools/scripts/build-drop.rb", "--code", code]
    args += ["--note", note] if note
    system(*args, *actors) or abort "build-drop failed"
  end
  built = JSON.parse(File.read("#{work}/src/_dist/drops/#{code}/manifest.json"))
  bad = []
  expected["entries"].each do |e|
    b = built["entries"].find { |x| x["file"] == e["file"] }
    if b.nil?
      bad << "#{e["file"]}: rebuild に無い"
    elsif b["sha256"] != e["sha256"]
      bad << "#{e["file"]}: sha256 が違う(manifest #{e["sha256"][0, 12]}… / rebuild #{b["sha256"][0, 12]}…)"
    elsif b["version"] != e["version"]
      bad << "#{e["file"]}: version が違う(#{e["version"]} / #{b["version"]})"
    end
  end
  if bad.empty?
    out = File.join(Dir.pwd, "_rebuild", code)
    FileUtils.rm_rf(out)
    FileUtils.mkdir_p(File.dirname(out))
    FileUtils.cp_r("#{work}/src/_dist/drops/#{code}", out)
    puts "OK: 同じ sha256 が出た(#{expected["entries"].size} 本)→ #{out}"
  else
    puts "NG:"
    bad.each { |b| puts "  #{b}" }
    exit 1
  end
ensure
  FileUtils.rm_rf(work)
end
