"""巴别语／塞壬语字形（PNG）：随 .atopack 分发的密语字形文件。

程序包（便携版 / Docker / APK）都不带这些字形：它们是第三方参考资料
（Babelian & Siren Translator，见 ``story/assets/cryptic/NOTICE.md``）里的字形素材，
按仓库的版权约定只留在本地，不进版本库（``.gitignore`` 的 ``*.png``）。这里让素材库把
``story/assets/cryptic/glyphs/`` 下的 PNG 原样写进 .atopack 的 ``crypticFiles`` 段，导入后
再由「分享与安装」落回同目录；Android 端 AtopackStore 按同一段解包到 web 根目录的
``story/assets/cryptic/glyphs/``，因此故事书侧栏按 ``./assets/cryptic/glyphs/<名称>.png``
（相对 ``story/index.html``）取字形时不用额外配置。

``crypticFiles`` 与 ``bgmFiles`` / ``iconFiles`` 一样是附加字段（不改变资料包版本号），
老版本读取方会直接忽略它。``glyph-catalog.js`` 与 API 用到的 ``glyphs/<名称>.png`` 在同一个
上游目录树里，但只有 PNG 是二进制素材；目录里其它文件（例如上游留下的说明）一律不收。
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

GLYPH_DIR = "story/assets/cryptic/glyphs"
LIBRARY = Path("sources/cryptic")
# 工程根目录（asset-studio 的上一层）：字形清单在 story/ 下，不在素材库里。
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
GLYPH_SUFFIXES = (".png",)
# 单张原图最大 45KB（实测 siren-14 约 45KB）：留一倍余量，128KB 足够拦住误放的整页截图。
MAX_FILE_BYTES = 128 * 1024
MAX_FILES = 256

_TARGET = re.compile(r"story/assets/cryptic/glyphs/[A-Za-z0-9][A-Za-z0-9._-]*\.png")
_MIME = {".png": "image/png"}


def allowed_target(target: str) -> bool:
    return bool(_TARGET.fullmatch(str(target or "")))


def mime_for(target: str) -> str:
    return _MIME.get(Path(str(target)).suffix.lower(), "application/octet-stream")


def _collect(folder: Path) -> list[tuple[str, Path]]:
    """挑出目录里符合命名规范的 PNG；其它文件一律忽略。

    名字不合规的文件不会让整包导出失败——它们本来就取不到（页面按 glyph-catalog.js 里的
    固定文件名引用字形），所以这里只跳过，不报错。
    """
    if not folder.is_dir():
        return []
    files: list[tuple[str, Path]] = []
    for path in sorted(folder.iterdir(), key=lambda item: item.name.lower()):
        if path.is_dir() or path.suffix.lower() not in GLYPH_SUFFIXES:
            continue
        target = f"{GLYPH_DIR}/{path.name}"
        if not allowed_target(target):
            continue
        if path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError(f"密语字形过大（上限 {MAX_FILE_BYTES // 1024}KB）：{path.name}")
        files.append((target, path))
        if len(files) > MAX_FILES:
            raise ValueError(f"密语字形数量超过 {MAX_FILES} 个上限")
    return files


def collect(root: Path | None) -> list[tuple[str, Path]]:
    """工程目录 story/assets/cryptic/glyphs/ 下的字形，按文件名排序。"""
    return _collect(Path(root) / GLYPH_DIR) if root is not None else []


def collect_library(library: Path) -> list[tuple[str, Path]]:
    """素材库中已导入的字形，安装时从素材库复制回工程目录。"""
    return _collect(Path(library) / LIBRARY / GLYPH_DIR)


def glyph_names(project_root: Path | None = None) -> tuple[str, ...]:
    """字形文件名清单，取自随源码发布的 ``glyph-catalog.js``。

    字形 PNG 本身不进版本库（干净检出里一个都没有），但引用它们的
    ``story/assets/cryptic/glyph-catalog.js`` 是程序代码、随源码发布，所以清单从这里读：
    内置清单（``fixed_catalog``）与 APK 的 ``atopack-catalog.json`` 因此不依赖本地素材，
    也不会和字形文件列表脱节。文件缺失或格式变了就返回空清单——这两条通道各自有独立校验，
    这里不报错。
    """
    catalog = (Path(project_root) if project_root is not None else _PROJECT_ROOT) / "story" / "assets" / "cryptic" / "glyph-catalog.js"
    try:
        text = catalog.read_text(encoding="utf-8")
    except OSError:
        return ()
    prefix = GLYPH_DIR + "/"
    # 只认文件名本身；路径前缀由 allowed_target 再校验一次，避免清单格式变化时收到别的图。
    names = {
        match.group(1)
        for match in re.finditer(r"([A-Za-z0-9][A-Za-z0-9._-]*\.png)", text)
        if allowed_target(prefix + match.group(1))
    }
    return tuple(sorted(names))


def add_to_archive(
    archive, manifest: dict, root: Path | None, fallback_library: Path | None = None,
) -> int:
    """把字形写进资料包；工程目录没有字形时退回素材库里的副本。"""
    files = collect(root)
    if not files and fallback_library is not None:
        files = collect_library(fallback_library)
    if not files:
        manifest.pop("crypticFiles", None)
        return 0
    entries = []
    for target, path in files:
        raw = path.read_bytes()
        archive.writestr(target, raw)
        entries.append({
            "target": target,
            "member": target,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "mimeType": mime_for(target),
        })
    manifest["crypticFiles"] = entries
    return len(entries)


def checked_bytes(archive, item: dict) -> bytes:
    target = str(item.get("target") or "")
    if not allowed_target(target) or item.get("member") != target:
        raise ValueError(f"不支持的密语字形路径：{target}")
    try:
        info = archive.getinfo(target)
    except KeyError as exc:
        raise ValueError(f"资料包中缺少密语字形：{target}") from exc
    if info.file_size > MAX_FILE_BYTES:
        raise ValueError(f"密语字形过大：{target}")
    raw = archive.read(target)
    if hashlib.sha256(raw).hexdigest() != item.get("sha256"):
        raise ValueError(f"密语字形校验失败：{target}")
    return raw


def import_resources(archive, manifest: dict, library: Path, replace: bool) -> int:
    """把资料包里的字形存进素材库（等待「分享与安装」落回工程目录）。"""
    imported = 0
    for item in manifest.get("crypticFiles", []) or []:
        raw = checked_bytes(archive, item)
        target = Path(library) / LIBRARY / str(item["target"])
        if target.exists() and not replace:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        imported += 1
    return imported
