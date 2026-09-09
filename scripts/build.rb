#!/usr/bin/env ruby
# drops/<name>/ を registry の中だけで xpi にする(外の repo は使わない)。
#
#   ruby scripts/build.rb drops/<name>      → _build/<name>/{<actor>.xpi, manifest.json}
#
# 1. _stage/<name>/ に tooling/webext-actors(build.ts、_shared、tsdown の設定、deno.lock)と drops/<name>/src/<actor>/ を並べる
# 2. deno task build(actor → _dist/<actor>/)
# 3. scripts/build-drop.rb(reproducible、syntax check、minify 禁止、source 同梱)
# manifest の source は「この registry の、この commit の、drops/<name>/src」。正体は drop.toml の uuid、name は札。
require "fileutils"

dir = ARGV[0] or abort "usage: build.rb drops/<name>"
root = File.expand_path("..", __dir__)

require "json"
require_relative "compat"

# drop.toml を読む(uuid / name / note / actors か lib+version / [deps])
def read_drop_toml(dir)
  toml = File.read(File.join(dir, "drop.toml"))
  d = {
    dir: dir,
    uuid: toml[/^uuid\s*=\s*"([^"]+)"/, 1],
    name: toml[/^name\s*=\s*"([^"]+)"/, 1],
    note: toml[/^note\s*=\s*"([^"]*)"/, 1],
    actors: toml[/^actors\s*=\s*\[(.*)\]/, 1].to_s.scan(/"([^"]+)"/).flatten,
    lib: toml.match?(/^lib\s*=\s*true/),
    version: toml[/^version\s*=\s*"([^"]+)"/, 1],
    # [deps]: 札 = "uuid"。版は書かない(registry の木にある、その uuid の drop の version で固定する)
    deps: toml[/^\[deps\]\s*\n((?:(?!\[).*\n?)*)/, 1].to_s.scan(/^\s*([a-z0-9][a-z0-9._-]*)\s*=\s*"([^"]+)"/),
    # [actor]: actor.ts を書かない drop(logic も actor も Tsubaki)の meta。
    # id / namespace / version / run_at と matches(配列)。build.ts が標準の actor.ts を書く
    actor: (lambda do
      section = toml[/^\[actor\]\s*\n((?:(?!\[).*\n?)*)/, 1].to_s
      a = {}
      section.scan(/^\s*([a-z_]+)\s*=\s*"([^"]*)"/) { |k, v| a[k] = v }
      section.scan(/^\s*([a-z_]+)\s*=\s*\[([^\]]*)\]/) { |k, v| a[k] = v.scan(/"([^"]*)"/).flatten }
      a.empty? ? nil : a
    end).call,
    # [compat]: 札 = "範囲"(Julia と同じ読みかた。scripts/compat.rb)。無ければ何でもよい
    compat: toml[/^\[compat\]\s*\n((?:(?!\[).*\n?)*)/, 1].to_s.scan(/^\s*([a-z0-9][a-z0-9._-]*)\s*=\s*"([^"]+)"/).to_h,
    # versions.toml: 判が押された版の台帳(sign job が ledger/versions に積む)
    versions: Compat.read_versions(File.join(dir, "versions.toml")),
    # deps.toml / compat.toml: その版が「誰に依存し、どこまで許す」と言っていたか。
    # 木のいまの drop.toml は「いまの版」の約束でしかないので、古い版が選ばれたときは
    # こちらで解く(Julia の registry の Deps.toml / Compat.toml と同じ絵)
    deps_by_version: Compat.read_sections(File.join(dir, "deps.toml")),
    compat_by_version: Compat.read_sections(File.join(dir, "compat.toml")),
    has_lib: File.file?(File.join(dir, "src", "lib", "index.ts")),
    has_wasm: File.directory?(File.join(dir, "src", "wasm")),
    # src/ops/*.tsubaki: lib なら「使う drop の logic に先に読ませる言葉」(std.tsubaki)
    has_ops: File.directory?(File.join(dir, "src", "ops")),
  }
  d[:compat].each do |n, spec|
    Compat.parse(spec)
  rescue ArgumentError => e
    abort "#{dir}/drop.toml: [compat] #{n} = #{spec.inspect} が読めない(#{e.message})"
  end
  abort "#{dir}/drop.toml: uuid が無い(uuidgen で一つ振る)" unless d[:uuid]
  abort "#{dir}/drop.toml: name が無い" unless d[:name]
  abort "name と dir が違う(#{d[:name]} / #{File.basename(dir)})" unless File.basename(dir) == d[:name]
  if d[:lib]
    abort "#{dir}/drop.toml: lib には version が要る(1.0.0 の形)" unless d[:version]&.match?(/\A\d+\.\d+\.\d+\z/)
    abort "#{dir}: lib は src/lib/index.ts か src/wasm/ のどちらかが要る" unless d[:has_lib] || d[:has_wasm]
  else
    abort "#{dir}/drop.toml: actors が無い" if d[:actors].empty?
  end
  d
end

drop = read_drop_toml(dir)
uuid, name, note = drop[:uuid], drop[:name], drop[:note]
actors = drop[:lib] ? ["lib"] : drop[:actors]

# [deps] を registry の木で解決する: 札 → drops/*/drop.toml の uuid が同じもの。
# 版は「台帳(versions.toml、yanked を除く)∪ 木のいまの版」のうち、[compat] を全部満たす最高のもの(Julia の resolver の絵。
# compat は木のいまの drop.toml のものを使う。版ごとの compat は持たない)。umbrella の中身まで平らに、依存される順。
by_uuid = Dir.glob(File.join(root, "drops", "*", "drop.toml")).map { |t| File.dirname(t) }.reject { |d| File.basename(d).start_with?("_") }
  .map { |d| read_drop_toml(d) }.to_h { |d| [d[:uuid], d] }
# 版を選ぶと、その版の約束(deps / compat)で解き直す必要がある: 選ばれたのが木のいまの
# 版でなければ、いまの drop.toml ではなく台帳の deps.toml / compat.toml が正。選び直しが
# 落ち着くまで繰り返す(この registry の木は浅いので、たいてい一度で決まる)。
facts = lambda do |d, version|
  next { name: d[:name], deps: d[:deps], compat: d[:compat] } if version.nil? || version == d[:version]
  recorded = d[:deps_by_version][version]
  next nil if recorded.nil? && !d[:deps].empty?
  { name: "#{d[:name]} #{version}", deps: (recorded || {}).to_a, compat: d[:compat_by_version][version] || {} }
end
chosen = {}
order = nil
wants = nil
9.times do |round|
  order = [] # 依存される順
  wants = Hash.new { |h, k| h[k] = [] } # uuid => [[誰が, 範囲]]
  walk = lambda do |dep_name, dep_uuid, from|
    d = by_uuid[dep_uuid] or abort "#{from[:name]}: dep #{dep_name} = #{dep_uuid} が registry に無い"
    abort "#{from[:name]}: dep #{dep_name} の uuid #{dep_uuid} は #{d[:name]} のもの(札が違う)" unless d[:name] == dep_name
    abort "#{from[:name]}: dep #{dep_name} は lib ではない" unless d[:lib]
    wants[dep_uuid] << [from[:name], from[:compat][dep_name]] if from[:compat][dep_name]
    next if order.include?(dep_uuid)
    f = facts.call(d, chosen[dep_uuid]) or abort "#{d[:name]} #{chosen[dep_uuid]}: その版が何に依存していたかが台帳に無い" \
      "(#{d[:dir]}/deps.toml)。その版は deps を覚える前のもの。使うなら版を上げて組み直して"
    f[:deps].each { |n, u| walk.call(n, u, f) }
    order << dep_uuid
  end
  drop[:deps].each { |n, u| walk.call(n, u, drop) }
  picks = order.to_h do |u|
    d = by_uuid[u]
    candidates = (d[:versions].reject { |_, v| v["yanked"] }.keys + [d[:version]]).uniq
    specs = wants[u].map(&:last)
    pick = Compat.pick(candidates, specs) or abort "#{d[:name]}: #{candidates.join(", ")} のどれも " \
      "#{wants[u].map { |w, sp| "#{w} の #{sp.inspect}" }.join(" と ")} を満たさない"
    [u, pick]
  end
  break if picks == chosen
  chosen = picks
  abort "deps の解決が落ち着かない(#{chosen.map { |u, v| "#{by_uuid[u][:name]} #{v}" }.join(", ")})" if round == 8
end
resolved = order.map do |u|
  d = by_uuid[u]
  { name: d[:name], uuid: d[:uuid], version: chosen[u], lib: d[:has_lib], wasm: d[:has_wasm], ops: d[:has_ops], dir: d[:dir],
    note: wants[u].empty? ? "" : " (#{wants[u].map { |w, sp| "#{w}: #{sp}" }.join(", ")})" }
end
puts "deps: #{resolved.map { |r| "#{r[:name]} #{r[:version]}#{r[:note]}" }.join(", ")}" unless resolved.empty?

# 1. _stage/<name>/ に、tooling の道具と drop の src を並べる
stage = File.join(root, "_stage", name)
FileUtils.rm_rf(stage)
FileUtils.mkdir_p(stage)
%w[build.ts _shared tsdown.actor.config.ts tsdown.content.config.ts tsdown.lib.config.ts deno.json deno.lock tsconfig.json].each do |f|
  FileUtils.cp_r(File.join(root, "tooling/webext-actors", f), stage)
end

if drop[:lib]
  FileUtils.cp_r(File.join(dir, "src", "lib"), File.join(stage, "lib")) if drop[:has_lib]
  FileUtils.cp_r(File.join(dir, "src", "wasm"), File.join(stage, "wasm")) if drop[:has_wasm]
  FileUtils.cp_r(File.join(dir, "src", "ops"), File.join(stage, "ops")) if drop[:has_ops]
else
  actors.each do |a|
    src = File.join(dir, "src", a)
    # actor.ts が無いなら、actor も Tsubaki で書かれた drop: ops/*.tsubaki と
    # drop.toml の [actor] が要る(標準の actor.ts は build.ts が stage に書く)
    unless File.file?(File.join(src, "actor.ts"))
      abort "#{src}/actor.ts が無い(actor を Tsubaki で書くなら #{src}/ops/*.tsubaki を置いて)" unless
        Dir.glob(File.join(src, "ops", "*.tsubaki")).any?
      abort "#{dir}/drop.toml: actor.ts が無い drop には [actor](id / namespace / version / matches)が要る" unless drop[:actor]
    end
    FileUtils.cp_r(src, File.join(stage, a))
  end
end

# drop.json: build.ts と build-drop.rb が読む(この drop と、解決した deps)
File.write(File.join(stage, "drop.json"), JSON.pretty_generate({
  name: name, uuid: uuid, version: drop[:version], lib: drop[:lib], actor: drop[:actor],
  deps: resolved.map { |r| r.reject { |k, _| k == :dir || k == :note } },
}) + "\n")

# deps の src を型のために並べる(bundle には入れない。`import ... from "std"` が deno check で読めるように)
unless resolved.empty?
  deno_json = JSON.parse(File.read(File.join(stage, "deno.json")))
  resolved.each do |r|
    # dep の ops(std.tsubaki)は、使う側の _dist/<actor>/ops/<dep>/ へ写される(build.ts)
    if r[:ops]
      FileUtils.mkdir_p(File.join(stage, "_deps", r[:name]))
      FileUtils.cp_r(File.join(r[:dir], "src", "ops"), File.join(stage, "_deps", r[:name], "ops"))
    end
    next unless r[:lib]
    FileUtils.mkdir_p(File.join(stage, "_deps", r[:name]))
    FileUtils.cp_r(File.join(r[:dir], "src", "lib"), File.join(stage, "_deps", r[:name], "lib"))
    deno_json["imports"][r[:name]] = "./_deps/#{r[:name]}/lib/index.ts"
    deno_json["imports"]["#{r[:name]}/jsx-runtime"] = "./_deps/#{r[:name]}/lib/jsx-runtime.ts" if File.file?(File.join(r[:dir], "src", "lib", "jsx-runtime.ts"))
  end
  # JSX は dep のものを使う(preact を drop に同梱しないため)。jsx-runtime.ts を持つ dep のうち、いちばん後(直接の dep)
  jsx = resolved.reverse.find { |r| File.file?(File.join(r[:dir], "src", "lib", "jsx-runtime.ts")) }
  if jsx
    deno_json["compilerOptions"]["jsxImportSource"] = jsx[:name]
    tsconfig = JSON.parse(File.read(File.join(stage, "tsconfig.json")))
    tsconfig["compilerOptions"]["jsxImportSource"] = jsx[:name]
    File.write(File.join(stage, "tsconfig.json"), JSON.pretty_generate(tsconfig) + "\n")
    puts "jsx: #{jsx[:name]}"
  end
  File.write(File.join(stage, "deno.json"), JSON.pretty_generate(deno_json) + "\n")
end

# 2. stage の中で build する
Dir.chdir(stage) do
  # deno install --frozen:
  #   deno.json の imports(tsdown、birpc、@std/path)とその依存を、deno.lock の版と integrity のとおりに取ってくる。
  #   lock に無いもの・hash が違うものが来たら止まる(= vendor と同じ保証。binary は repo に積まない)
  system("mise", "exec", "--", "deno", "install", "-q", "--frozen") or abort "deno install failed (lock と違う? tooling/webext-actors/deno.lock)"

  # deno task build(= build.ts):
  #   stage の下の dir(= actor)ごとに actor.ts を読んで、_dist/<actor>/ に
  #   manifest.json / schema.json / api.js / background.js を生成し、tsdown で actor.mjs(親)と content.js(ページ側)を
  #   minify なしで束ねる。詳しくは docs/BUILD.md の 2
  system("mise", "exec", "--", "deno", "task", "build") or abort "webext-actors build failed"
end

# 3. build-drop.rb(scripts/build-drop.rb):
#   _dist/<actor>/ を xpi に固める。xpi = ただの zip(拡張子が違うだけ。unzip で開ける)。
#   版を <meta.version>.<commit の分> に、api.js の import 先を resource://<alias>/ に、
#   source/ を同梱し、deno check と minify 禁止の門を通し、mtime と権限を揃えて TZ=UTC で zip。manifest.json に sha256。
#   BUILD_* は registry 向けの置き場(noraneko の testbed と同じ script を、path だけ差し替えて使う)。docs/BUILD.md の 3〜6
env = {
  "BUILD_ROOT" => root, # git の repo(commit の時刻と、manifest の source.repo / commit)
  "BUILD_ACTORS" => stage, # _dist/ と source/ の元
  "BUILD_OUT" => File.join(root, "_build"), # _build/<name>/ に出す
  "BUILD_SOURCE_PATH" => "#{dir}/src", # manifest の source.path
}

args = ["mise", "exec", "--", "ruby", File.join(root, "scripts/build-drop.rb"), "--uuid", uuid, "--name", name]
args += ["--note", note] if note && !note.empty?
system(env, *args, *actors) or abort "build-drop failed"

# 台帳と照らす: 判が押された版を、中身を変えて組み直してはいけない(Julia と同じ。版を上げる)。
# commit が違っても、その commit から drop の src / drop.toml に差分が無ければ同じもの(台帳の PR や、tooling を直しての置き直し)
built = JSON.parse(File.read(File.join(root, "_build", name, "manifest.json")))
built_deps = (built["deps"] || []).map { |d| "#{d["name"]} #{d["version"]}" }.join(", ")
built["entries"].each do |e|
  semver = e["version"][/\A\d+\.\d+\.\d+/]
  v = drop[:versions][semver] or next
  next if v["commit"] == built.dig("source", "commit")
  # 「違う」と「見えない」は別のこと: 浅い clone だと判が押された commit が手元に無くて、
  # git diff は変わっていなくても失敗する(CI の checkout が深さ 2 だった頃、これで止まった)
  known = system("git", "-C", root, "cat-file", "-e", "#{v["commit"]}^{commit}", err: File::NULL, out: File::NULL)
  unless known
    warn "#{name} #{semver}: 判が押された commit #{v["commit"].to_s[0, 10]} が手元に無いので、src を照らせない(浅い clone?)"
    next
  end
  same = system("git", "-C", root, "diff", "--quiet", v["commit"].to_s, "--", "#{dir}/src", "#{dir}/drop.toml", err: File::NULL)
  abort "#{name} #{semver} は #{v["commit"].to_s[0, 10]} でもう判が押されていて、そこから src が変わっている(versions.toml)。版を上げて" unless same
  # src が一文字も変わっていなくても、足元が変われば別のものになる: deps の版は
  # 「台帳 ∪ 木」からそのとき解決されるので、std が上がっただけで中身が変わる。
  # 判を押したときに何を連れていたかを台帳が覚えているなら、それも照らす
  # (古い entry には deps が無い。その版については、何も言えないので黙る)。
  # 照らすのは顔ぶれで、書きかたではない(", " と "," の違いで止めない)
  faces = ->(text) { text.to_s.split(",").map(&:strip).reject(&:empty?).sort }
  next if v["deps"].nil? || v["deps"].empty? || faces.call(v["deps"]) == faces.call(built_deps)
  abort "#{name} #{semver} は #{v["commit"].to_s[0, 10]} で判が押されたとき deps が「#{faces.call(v["deps"]).join(", ")}」だった" \
    "(いまは「#{faces.call(built_deps).join(", ")}」)。src は同じでも配るものが変わる。版を上げて"
end

puts "→ #{File.join(root, "_build", name)}"
