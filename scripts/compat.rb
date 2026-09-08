#!/usr/bin/env ruby
# compat: Julia の Pkg と同じ読みかたで、版の範囲を解く。
#
#   "1.2.3"  = ^1.2.3 = [1.2.3, 2.0.0)     "0.2.3" = [0.2.3, 0.3.0)     "0.0.3" = [0.0.3, 0.0.4)   (caret。既定)
#   "1.2"    = [1.2.0, 2.0.0)             "1"     = [1.0.0, 2.0.0)
#   "~1.2.3" = [1.2.3, 1.3.0)             "~1.2"  = [1.2.0, 1.3.0)     "~1"    = [1.0.0, 2.0.0)   (tilde)
#   "1.2 - 1.5" = [1.2.0, 1.6.0)                                                                  (範囲。上は含む)
#   "=1.2.3" = その版だけ
#   "1.2, 2.0 - 2.3" = どちらか                                                                   (union)
#
#   ruby scripts/compat.rb --test      自分の試験
#   require_relative "compat"; Compat.satisfies?("1.2", "1.4.0")  Compat.pick(["1.0.0", "1.4.0"], "1.2")
module Compat
  module_function

  def parse_version(s)
    m = s.to_s.strip.match(/\A(\d+)(?:\.(\d+))?(?:\.(\d+))?\z/) or raise ArgumentError, "版の形が違う: #{s.inspect}"
    [m[1].to_i, (m[2] || 0).to_i, (m[3] || 0).to_i]
  end

  # 一つの条件 → [lower(含む), upper(含まない)]
  def parse_one(spec)
    s = spec.strip
    if (m = s.match(/\A(\d+(?:\.\d+){0,2})\s*-\s*(\d+(?:\.\d+){0,2})\z/))
      lo = parse_version(m[1])
      parts = m[2].split(".").map(&:to_i)
      hi = case parts.length
           when 1 then [parts[0] + 1, 0, 0]
           when 2 then [parts[0], parts[1] + 1, 0]
           else [parts[0], parts[1], parts[2] + 1]
           end
      return [lo, hi]
    end
    if s.start_with?("=")
      v = parse_version(s[1..])
      return [v, [v[0], v[1], v[2] + 1]]
    end
    tilde = s.start_with?("~")
    s = s.sub(/\A[~^]/, "")
    parts = s.split(".").map(&:to_i)
    raise ArgumentError, "版の形が違う: #{spec.inspect}" unless (1..3).cover?(parts.length) && s.match?(/\A\d+(\.\d+){0,2}\z/)
    lo = parse_version(s)
    hi =
      if tilde
        parts.length == 1 ? [lo[0] + 1, 0, 0] : [lo[0], lo[1] + 1, 0]
      elsif lo[0] > 0 then [lo[0] + 1, 0, 0]
      elsif lo[1] > 0 then [0, lo[1] + 1, 0]
      elsif parts.length == 3 then [0, 0, lo[2] + 1]
      else [0, 1, 0] # "0" / "0.0" は [0.0.0, 0.1.0)
      end
    [lo, hi]
  end

  def parse(spec)
    spec.to_s.split(",").map { |s| parse_one(s) }
  end

  def satisfies?(spec, version)
    v = parse_version(version)
    parse(spec).any? { |lo, hi| (lo <=> v) <= 0 && (v <=> hi) < 0 }
  end

  # 候補のうち、全部の条件を満たす最高の版。無ければ nil
  def pick(candidates, specs)
    candidates.map { |c| [parse_version(c), c] }.sort.reverse.each do |v, c|
      return c if specs.all? { |s| satisfies?(s, c) }
    end
    nil
  end

  # ["1.0.0"] の節に key = value が並ぶ形を読む(TOML の道具は入れない)。
  # versions.toml / deps.toml / compat.toml は三つともこの形
  def read_sections(path)
    return {} unless File.file?(path)
    out = {}
    cur = nil
    File.foreach(path) do |line|
      if (m = line.match(/\A\s*\["([^"]+)"\]/))
        cur = m[1]
        out[cur] = {}
      elsif cur && (m = line.match(/\A\s*([\w.-]+)\s*=\s*(.+?)\s*\z/))
        k, v = m[1], m[2]
        out[cur][k] =
          if v == "true" then true
          elsif v == "false" then false
          # General の Compat.toml と同じで、値は文字列でも配列でもよい
          # (配列は union。この repo の中では "," で繋いだ一本と同じ意味)
          elsif v.start_with?("[") then v.scan(/"([^"]*)"/).flatten.join(",")
          else v.sub(/\A"(.*)"\z/, '\1')
          end
      end
    end
    out
  end

  # versions.toml: 判が押された版。commit / time / file / sha256 / deps、それに yank
  def read_versions(path)
    read_sections(path).transform_values { |h| { "yanked" => false }.merge(h) }
  end
end

if __FILE__ == $PROGRAM_NAME && ARGV[0] == "--test"
  t = lambda do |spec, yes, no|
    yes.each { |v| Compat.satisfies?(spec, v) or abort "#{spec.inspect} は #{v} を含むはず" }
    no.each { |v| !Compat.satisfies?(spec, v) or abort "#{spec.inspect} は #{v} を含まないはず" }
  end
  t.call("1.2.3", %w[1.2.3 1.9.0], %w[1.2.2 2.0.0])
  t.call("1.2", %w[1.2.0 1.5.1], %w[1.1.9 2.0.0])
  t.call("1", %w[1.0.0 1.99.0], %w[0.9.0 2.0.0])
  t.call("0.2.3", %w[0.2.3 0.2.9], %w[0.2.2 0.3.0])
  t.call("0.0.3", %w[0.0.3], %w[0.0.2 0.0.4])
  t.call("~1.2.3", %w[1.2.3 1.2.9], %w[1.2.2 1.3.0])
  t.call("~1.2", %w[1.2.0 1.2.9], %w[1.3.0])
  t.call("~1", %w[1.0.0 1.9.9], %w[2.0.0])
  t.call("1.2 - 1.5", %w[1.2.0 1.5.9], %w[1.1.9 1.6.0])
  t.call("=1.2.3", %w[1.2.3], %w[1.2.4 1.2.2])
  t.call("1.2, 2.0 - 2.3", %w[1.4.0 2.3.9], %w[2.4.0 0.9.0])
  Compat.pick(%w[1.0.0 1.4.0 2.0.0 1.3.0], ["1.2"]) == "1.4.0" or abort "pick は 1.4.0 のはず"
  Compat.pick(%w[1.0.0 1.4.0], ["1.2", "~1.3"]) == nil or abort "pick は nil のはず(交差が空)"
  Compat.pick(%w[1.0.0 1.4.0 1.3.2], ["1.2", "~1.3"]) == "1.3.2" or abort "pick は 1.3.2 のはず"
  begin
    Compat.parse("abc")
    abort "abc は読めないはず"
  rescue ArgumentError
  end
  puts "compat: ok"
end
