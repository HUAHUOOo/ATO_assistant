#!/usr/bin/env python3
"""Reader/writer for the Aeon Trespass: Odyssey official app campaign save (*.jsave).

Container format (reverse engineered from three real saves)
-----------------------------------------------------------
    offset 0 : 2 opaque bytes            e.g. DB BB / D4 92 / D5 AC  -- varies per save,
                                         matches no standard checksum of the payload
    offset 2 : 1 byte, always 0x03       format/version stamp
    offset 3 : JSON text, UTF-8/ASCII    tab indented, non-ASCII escaped as uppercase \\uXXXX

The file may carry STALE BYTES after the JSON (observed in campaign_0001): the app
appears to overwrite an existing save without truncating it, so a shorter newer save
leaves the tail of an older, longer one behind. Therefore the JSON is decoded by
consuming the FIRST complete JSON value, not by requiring the whole file to be JSON.

The app's JSON writer differs from Python's json.dumps in three ways:
  * empty array  -> "[ ]"      (Python: "[]")
  * item comma   -> "," then newline, no trailing space
  * non-ASCII    -> uppercase \\uXXXX escapes
so a byte-exact re-serialiser is required for round-trip fidelity.
"""
import json

HEADER_LEN = 3
_decoder = json.JSONDecoder()


def read_jsave(path):
    """Parse a .jsave file.

    Returns (prefix, obj, raw, json_bytes) where `json_bytes` is the length of the
    JSON text actually consumed; raw[HEADER_LEN + json_bytes:] is stale tail (may be empty).
    """
    raw = open(path, "rb").read()
    return parse(raw)


def parse(raw):
    if len(raw) < HEADER_LEN:
        raise ValueError("file too short to be a .jsave")
    prefix = raw[:HEADER_LEN]
    text = raw[HEADER_LEN:].decode("utf-8")
    obj, end = _decoder.raw_decode(text)
    return prefix, obj, raw, end


def _esc(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif o < 0x20 or o > 0x7E:
            if o > 0xFFFF:
                o -= 0x10000
                out.append("\\u%04X\\u%04X" % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
            else:
                out.append("\\u%04X" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _num(v):
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return "%d" % int(v)
        return repr(v)
    return str(v)


def render(v, indent=0):
    """Serialise exactly the way the official app does."""
    pad = "\t" * indent
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, str):
        return _esc(v)
    if isinstance(v, (int, float)):
        return _num(v)
    if isinstance(v, dict):
        if not v:
            return "{ }"
        inner = pad + "\t"
        body = ",\n".join(inner + _esc(str(k)) + ": " + render(x, indent + 1)
                          for k, x in v.items())
        return "{\n" + body + "\n" + pad + "}"
    if isinstance(v, (list, tuple)):
        if not v:
            return "[ ]"
        inner = pad + "\t"
        body = ",\n".join(inner + render(x, indent + 1) for x in v)
        return "[\n" + body + "\n" + pad + "]"
    raise TypeError(type(v))


def to_bytes(prefix, obj):
    """Serialise a whole .jsave file body (no stale tail)."""
    return prefix + render(obj).encode("utf-8")


def write_jsave(path, prefix, obj):
    open(path, "wb").write(to_bytes(prefix, obj))


def _selftest(paths):
    for src in paths:
        prefix, obj, raw, used = parse(open(src, "rb").read())
        rebuilt = to_bytes(prefix, obj)
        exact = rebuilt == raw
        tail = len(raw) - HEADER_LEN - used
        print(f"{src.split(chr(92))[-1]}")
        print(f"  prefix {prefix.hex(' ')} | keys {len(obj)} | json bytes {used} | "
              f"file bytes {len(raw)} | stale tail {tail}")
        print(f"  clean rebuild byte-identical: {exact}"
              + ("" if exact else
                 "  (expected when the file carries a stale tail)"))
        if not exact and tail == 0:
            n = min(len(rebuilt), len(raw))
            i = 0
            while i < n and rebuilt[i] == raw[i]:
                i += 1
            print(f"  !! first diff at {i}: {raw[max(0,i-60):i+40]!r} vs "
                  f"{rebuilt[max(0,i-60):i+40]!r}")
    return 0


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit("usage: jsavelib.py <file.jsave> [more.jsave ...]")
    raise SystemExit(_selftest(sys.argv[1:]))
