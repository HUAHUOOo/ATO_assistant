# -*- coding: utf-8 -*-
"""把 import_jsave.py 冻结版本跑出参考 sections.json 的启动器。

为什么要有它：jsave-import/import_jsave.py 由另一个代理在改，为了让"JS 与 Python
深比较 0 差异"这条验收有**不动的参照物**，这里用 importlib 从 pysnap/ 里的快照加载
模块（快照里的 ROOT 会因此指向 pysnap/），再把 ROOT / WORK / TABLES / GEAR_PROD /
ATO_DATA 重定向回仓库，最后调它的 main()。
注意：不改动 jsave-import/import_jsave.py 一个字节；本文件只是它的加载器。
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

spec = importlib.util.spec_from_file_location(
    "import_jsave_snapshot", os.path.join(HERE, "import_jsave_snapshot.py"))
mod = importlib.util.module_from_spec(spec)
sys.modules["import_jsave_snapshot"] = mod
spec.loader.exec_module(mod)

# 快照在 pysnap/ 下，ROOT 会算成 .../jsave-web；重定向回仓库根。
mod.ROOT = REPO
mod.TABLES = os.path.join(REPO, "app-extract", "official-tables.json")
mod.GEAR_PROD = os.path.join(REPO, "technology", "ato_gear_production.json")
mod.ATO_DATA = os.path.join(REPO, "data")
mod.RECORD_HTML = os.path.join(REPO, "record", "index.html")
mod.MAP_DATA_JS = os.path.join(REPO, "map", "map-data.js")

raise SystemExit(mod.main(sys.argv[1:]))
