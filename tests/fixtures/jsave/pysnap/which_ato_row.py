# -*- coding: utf-8 -*-
"""决策依据：此刻磁盘上的 import_jsave.py 到底对那 5 项货舱资源算出什么 ato_row。

结论直接进 jsave-web/report.md，所以由脚本现场跑、不靠记忆。
用法（从仓库根）：python jsave-web/pysnap/which_ato_row.py <file.jsave>
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    mod.ROOT = REPO
    mod.TABLES = os.path.join(REPO, "app-extract", "official-tables.json")
    mod.GEAR_PROD = os.path.join(REPO, "technology", "ato_gear_production.json")
    mod.ATO_DATA = os.path.join(REPO, "data")
    mod.RECORD_HTML = os.path.join(REPO, "record", "index.html")
    mod.MAP_DATA_JS = os.path.join(REPO, "map", "map-data.js")
    return mod


sys.path.insert(0, os.path.join(REPO, "jsave-work"))
import jsavelib  # noqa: E402

prefix, official, raw, used = jsavelib.read_jsave(sys.argv[1])

names = ["SUPERSOLID_RELIEF_MASS", "ECHOES_OF_RECOLLECTION", "UMBRAL_COUNT",
         "STRING_WISH", "STRING_WISH_PICK"]

for label, path in (("live  jsave-import/import_jsave.py",
                     os.path.join(REPO, "jsave-import", "import_jsave.py")),
                    ("frozen pysnap/import_jsave_snapshot.py",
                     os.path.join(HERE, "import_jsave_snapshot.py"))):
    mod = load(path, "probe_" + label.split()[0])
    tables = mod.load_json(mod.TABLES)
    gear = mod.load_json(mod.GEAR_PROD)
    conv = mod.Converter(tables, gear, False)
    result = conv.build_resources(official, "c5")
    detail = conv.stats["resource_detail"]
    print("==", label)
    for name in names:
        row = next((r for r in detail if r["official"] == name), None)
        print("   %-26s ato_row=%s" % (name, None if row is None else row["ato_row"]))
    no_row = [d["official"] for d in detail if not d.get("ato_row")]
    print("   no_row 数 =", len(no_row), json.dumps(no_row, ensure_ascii=False))
