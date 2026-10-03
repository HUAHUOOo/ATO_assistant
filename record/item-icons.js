/* Icon spec for the record page's runtime-built item labels.
   The glyphs themselves live in assets/icons/<name>.svg and arrive with the
   .atopack iconFiles section -- the program package does not ship them
   (see tools/packaging/package_common.py). Only the name and the glyph box
   live here: buildItemIcon derives the pixel size from the same
   equal-bounding-box-area rule the field labels use, so one entry serves
   both a 24px track title and a 13px counter. */
window.RECORD_ICON_BASE = "../assets/icons/";
window.RECORD_ITEM_ICONS = {
  "船体": { name: "hull", w: 111, h: 115 },
  "船员": { name: "crew", w: 111, h: 113 },
  "难民": { name: "refugees", w: 80, h: 113 },
  "俘虏": { name: "captives", w: 115, h: 111 },
};

/* A masked <span> instead of an inline <svg>: the glyph is painted with
   background-color: currentColor through --icon-src, so it keeps the accent
   colour the inline glyph used to inherit. When the file is missing (no pack
   installed yet) the box simply stays empty. */
window.buildItemIcon = function (spec, className, box) {
  box = box || 24;
  const isString = typeof spec === "string";
  const name = isString ? spec : String((spec && spec.name) || "");
  const vb = isString ? [] : String(spec.viewBox || "").trim().split(/\s+/).map(Number);
  const w0 = (spec && spec.w) || (vb.length === 4 && isFinite(vb[2]) ? vb[2] : box);
  const h0 = (spec && spec.h) || (vb.length === 4 && isFinite(vb[3]) ? vb[3] : box);
  const s = Math.min(box / Math.sqrt(w0 * h0),
                     box * 1.25 / Math.max(w0, h0));
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("aria-hidden", "true");
  if (name) span.style.setProperty("--icon-src", `url(${window.RECORD_ICON_BASE}${name}.svg)`);
  span.style.width = Math.max(1, Math.round(w0 * s)) + "px";
  span.style.height = Math.max(1, Math.round(h0 * s)) + "px";
  return span;
};
