#!/usr/bin/env ruby
# build-drop: webext-actor を「降ってくる束(drop)」にする。
#
#   ruby scripts/build-drop.rb --uuid <uuid> --name <name> [--note "..."] <actor> [<actor>...]
#   (ふつうは scripts/build.rb が env を揃えて呼ぶ。noraneko の testbed の tools/scripts/build-drop.rb と同じもの)
#
# _dist/<actor>/ を xpi(= ただの zip)に固めて、_build/<name>/ に
# <actor>.xpi と manifest.json(uuid / name / version / sha256)を書く。あとは dl.f3liz.casa/drop/<uuid> に置くだけ
# (正体は uuid、name は札。about:nora:settings に uuid を入れると降ってくる。modules/Drops.sys.mts)。
#
# built-in と同じ id で profile に入るので:
# - version は built-in より大きく(<version>.<commit の yyyymmddHHMM>)。同じ commit なら同じ版。
# - parent.sys.mjs / child.sys.mjs は resource://noraneko-builtin/(= built-in の中身)ではなく、自分の xpi の
#   actor.mjs / content.js を読む(alias に書き換える)。
require "json"
require "digest"
require "fileutils"
require "tmpdir"
require "time"

uuid = nil
name = nil
note = nil
actors = []
args = ARGV.dup
until args.empty?
  a = args.shift
  case a
  when "--uuid" then uuid = args.shift
  when "--name" then name = args.shift
  when "--note" then note = args.shift
  else actors << a
  end
end
unless uuid&.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/) && name&.match?(/\A[a-z0-9][a-z0-9._-]{0,63}\z/) && !actors.empty?
  warn "usage: build-drop.rb --uuid <uuid(小文字)> --name <name> [--note ...] <actor>..."
  exit 2
end

# 置き場。registry: BUILD_ROOT(git の repo。commit の時刻と source の由来)と BUILD_ACTORS(stage した webext-actors)を env で
root = ENV.fetch("BUILD_ROOT") { File.expand_path("../..", __dir__) }
actors_root = ENV.fetch("BUILD_ACTORS") { File.join(root, "browser-features/webext-actors") }
dist = File.join(actors_root, "_dist")
out = File.join(ENV.fetch("BUILD_OUT") { File.join(root, "_dist/drops") }, name)

# reproducible: 同じ commit から同じ bytes が出るように。日時は「今」でなく commit の時刻。
# zip の中の mtime も全部これに揃え、zip は TZ=UTC・ファイル一覧を sort して渡す(順も固定)。
#   git rev-parse HEAD      → いまの commit の sha(manifest の source.commit)
#   git log -1 --format=%ct → その commit の時刻(unix 秒)。版と mtime の元
commit = `git -C #{root} rev-parse HEAD 2>/dev/null`.strip
commit_time = `git -C #{root} log -1 --format=%ct 2>/dev/null`.strip.to_i
abort "git の commit が読めない(reproducible にできない)" if commit.empty? || commit_time.zero?

# mtime は分に丸める(zip の時刻は 2 秒刻みで、秒がずれると bytes が変わる。
# GitHub の PR は merge commit を checkout するので、秒違いの commit で同じ bytes を出すため)
commit_time = commit_time - (commit_time % 60)
ENV["TZ"] = "UTC"

FileUtils.rm_rf(out)
FileUtils.mkdir_p(out)

# ---- 絵 ----
# icon.png は **manifest の中**に data: で入る(小さいので、棚の一覧に判の内側のまま乗せられる)。
# shots/ は大きいので xpi の中(最初の entry)に入れて、「見る」で開いたときだけ読む。
# どちらも判の内側 = コードと同じ一回の判断で見てもらえる。外に取りに行かないので、指紋にもならない。
ICON_MAX = 32 * 1024
ICON_PX = 96
SHOT_MAX = 512 * 1024
SHOT_COUNT = 3

# 中身を見て種類を決める(拡張子は名乗りでしかない)
def image_kind(path)
  b = File.binread(path, 16).to_s.b
  return "png" if b.start_with?("\x89PNG\r\n\x1a\n".b)
  return "jpeg" if b.start_with?("\xff\xd8\xff".b)
  return "webp" if b[0, 4] == "RIFF".b && b[8, 4] == "WEBP".b
  nil
end

# PNG の IHDR は 16 byte 目から width / height(big endian)
def png_size(path)
  b = File.binread(path, 24).to_s.b
  [b[16, 4].unpack1("N"), b[20, 4].unpack1("N")]
end

icon_path = File.join(actors_root, "icon.png")
icon_data = nil
if File.file?(icon_path)
  abort "icon.png は PNG で" unless image_kind(icon_path) == "png"
  abort "icon.png は #{ICON_MAX / 1024}KB まで(いまは #{File.size(icon_path)}B)" if File.size(icon_path) > ICON_MAX
  w, h = png_size(icon_path)
  abort "icon.png は #{ICON_PX}px 四方まで(いまは #{w}x#{h})" if w > ICON_PX || h > ICON_PX
  icon_data = "data:image/png;base64,#{[File.binread(icon_path)].pack("m0")}"
  puts "icon: #{w}x#{h} #{File.size(icon_path)}B"
end

shots_dir = File.join(actors_root, "shots")
shots = []
if File.directory?(shots_dir)
  found = Dir.glob(File.join(shots_dir, "*")).select { |f| File.file?(f) }.sort
  abort "shots/ は #{SHOT_COUNT} 枚まで(いまは #{found.size})" if found.size > SHOT_COUNT
  found.each do |f|
    kind = image_kind(f)
    abort "#{File.basename(f)}: PNG / JPEG / WebP だけ" unless kind
    abort "#{File.basename(f)}: #{SHOT_MAX / 1024}KB まで(いまは #{File.size(f)}B)" if File.size(f) > SHOT_MAX
    shots << { path: f, name: File.basename(f), type: "image/#{kind}", size: File.size(f) }
  end
  puts "shots: #{shots.map { |x| "#{x[:name]}(#{x[:size]}B)" }.join(", ")}" unless shots.empty?
end

entries = actors.map do |actor|
  src = File.join(dist, actor)
  manifest = JSON.parse(File.read(File.join(src, "manifest.json")))
  id = manifest.dig("browser_specific_settings", "gecko", "id")
  # 版は drop が名乗る semver そのもの。前は commit の時刻を四つ目に足していたが、
  # WebExtension の版は「一つが 9 桁まで」なので 202609081330 は長すぎて、Firefox が
  # 読むたびに警告していた。中身が変われば版を上げる約束(台帳の門)があるので、
  # 同じ版で違う bytes は出ない。
  version = manifest["version"]
  file = "#{actor}.xpi"
  xpi = File.join(out, file)

  Dir.mktmpdir("nora-drop-") do |work|
    # _dist/<actor>/ の産物(manifest.json / actor.json / parent.sys.mjs / child.sys.mjs / actor.mjs / content.js)を作業場へ
    Dir.glob(File.join(src, "**", "*")).select { |f| File.file?(f) }.each do |f|
      rel = f.sub("#{src}/", "")
      FileUtils.mkdir_p(File.join(work, File.dirname(rel)))
      FileUtils.cp(f, File.join(work, rel))
    end
    # 絵は drop に一つぶん。最初の entry の xpi に入れて、どれに入っているかは manifest が覚える
    if !shots.empty? && actor == actors.first
      FileUtils.mkdir_p(File.join(work, "shots"))
      shots.each { |x| FileUtils.cp(x[:path], File.join(work, "shots", x[:name])) }
    end

    # source を同梱する(入れる本人が読めるように。build された bytes が自分の source を持ち歩く)
    src_dir = actors_root
    FileUtils.mkdir_p(File.join(work, "source"))
    # lib の ops/(先に読ませる .tsubaki)は actor の木の外に置かれるので、名指しで足す
    lib_ops = actor == "lib" ? Dir.glob(File.join(src_dir, "ops", "**", "*")) : []
    # wasm/ is a build product, not source; it is in the xpi already (top level), not in source/
    (Dir.glob(File.join(src_dir, actor, "**", "*")).select { |f| File.file?(f) && !f.start_with?(File.join(src_dir, actor, "wasm") + "/") } + lib_ops + Dir.glob(File.join(src_dir, "_shared", "*.ts"))).each do |f|
      rel = f.sub("#{src_dir}/", "")
      FileUtils.mkdir_p(File.join(work, "source", File.dirname(rel)))
      FileUtils.cp(f, File.join(work, "source", rel))
    end

    # manifest.json: 版と名前を drop 用に
    manifest["version"] = version
    manifest["name"] = "#{manifest["name"]} (drop #{name})"
    File.write(File.join(work, "manifest.json"), JSON.pretty_generate(manifest))

    # parent.sys.mjs / child.sys.mjs: built-in の resource:// ではなく、この xpi の actor.mjs / content.js を読む。
    # importESModule は jar:file: を信用しない("System modules must be loaded from a trusted scheme")。
    # 入れる側(modules/Drops.sys.mts)が resource://<alias>/ を xpi の root に張るので、ここではその URL に書き換えるだけ。
    # alias の規則は Drops.sys.mts と同じ: ("noraneko-drop-" + uuid + "-" + version) を [a-z0-9] 以外 "-" に、小文字。
    # 版を含めるのは、module cache が URL 単位で、同じ session で版を替えたとき古いのが残らないように
    res_alias = "noraneko-drop-#{uuid}-#{version}".gsub(/[^a-z0-9]/i, "-").downcase
    # lib(lib.js / wasm/ だけ。actor は無い)には親も子も無い
    %w[parent.sys.mjs child.sys.mjs].select { |f| File.file?(File.join(work, f)) }.each do |f|
      src_text = File.read(File.join(work, f))
      patched = src_text.gsub(%r{resource://noraneko-builtin/[^/"]+/}, "resource://#{res_alias}/")
      abort "#{actor}: #{f} に resource://noraneko-builtin/ が無い" if patched == src_text
      File.write(File.join(work, f), patched)
    end

    Dir.chdir(work) do
      files = Dir.glob("**/*", File::FNM_DOTMATCH).select { |f| File.file?(f) }.sort
      # wasm/ holds the Tsubaki glue: a build product (like the .wasm beside it), not the drop's own JS
      js = files.select { |f| f.end_with?(".js", ".mjs") && !f.start_with?("wasm/") }

      # syntax check: 固める前に読めるか。壊れた印を入れて一日溶かした
      #   node --check <js> → parse だけ(deno check は .js でも JSDoc の import('./x') を型として追い、
      #   同梱した preact の source で転ぶ)。読めない JS があれば exit 1
      #   .json は JSON.parse
      js.each { |f| system("node", "--check", f) or abort "#{actor}: syntax check failed (node --check #{f})" }

      # minify 禁止: 人が読めない JS は drop にしない(一行が長すぎるものは minify と見なす)
      js.each do |f|
        long = File.foreach(f).find { |l| l.length > 400 }
        abort "#{actor}: #{f} looks minified (line > 400 chars). drop の JS は読める形で" if long
      end
      files.select { |f| f.end_with?(".json") }.each do |f|
        JSON.parse(File.read(f)) rescue abort("#{actor}: #{f} is not valid JSON")
      end

      # 権限と mtime を揃える(umask や今の時刻が bytes に混ざらないように)
      Dir.glob("**/*", File::FNM_DOTMATCH).each do |f|
        next if f.end_with?("/.", "/..") || f == "." || f == ".."
        File.chmod(File.directory?(f) ? 0o755 : 0o644, f)
        File.utime(commit_time, commit_time, f)
      end

      # zip -q -X -D <xpi> <files...>(sort 済の一覧を、この順で):
      #   -X = uid/gid などの extra field を入れない、-D = dir の entry を入れない。どちらも bytes を揺らさないため
      #   xpi は拡張子が違うだけの zip。unzip -l で中が見える
      system("zip", "-q", "-X", "-D", xpi, *files) or abort "zip failed: #{actor}"
    end
  end

  size = File.size(xpi)
  sha256 = Digest::SHA256.file(xpi).hexdigest
  puts "#{actor}: #{id} #{version} #{file} #{size}B"
  entry = { id: id, name: actor, version: version, file: file, sha256: sha256, size: size }
  entry[:kind] = "lib" if actor == "lib"
  entry
end

# drop.json(registry の build.rb が stage に置く): lib かどうかと、解決した deps
drop_json = File.join(actors_root, "drop.json")
drop_info = File.file?(drop_json) ? JSON.parse(File.read(drop_json)) : {}

# manifest.json: どの repo の、どの commit の、どの path から build したか(git remote get-url origin が repo)
source = {
  repo: `git -C #{root} remote get-url origin 2>/dev/null`.strip.sub(/\.git\z/, ""),
  commit: commit,
  commit_time: Time.at(commit_time).utc.iso8601,
  path: ENV.fetch("BUILD_SOURCE_PATH", "browser-features/webext-actors"),
}
File.write(File.join(out, "manifest.json"),
           JSON.pretty_generate({
             uuid: uuid, name: name, note: note, source: source, entries: entries,
             icon: icon_data,
             shots: shots.empty? ? nil : shots.map { |x| { file: "shots/#{x[:name]}", type: x[:type], size: x[:size], in: entries.first[:file] } },
             lib: drop_info["lib"] ? true : nil,
             deps: (drop_info["deps"] || []).empty? ? nil : drop_info["deps"],
           }.compact) + "\n")
puts "→ #{out}/manifest.json"
