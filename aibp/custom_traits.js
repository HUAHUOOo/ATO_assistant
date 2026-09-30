(function (root) {
  "use strict";

  const width = 728;
  const height = 1028;
  const titleFontFamily = '"LiSu", "隶书", "STLiti", serif';
  const bodyFontFamily = '"SimHei", "黑体", "Heiti SC", "Microsoft YaHei", sans-serif';
  let background = "";
  let context = null;
  if (typeof document !== "undefined") context = document.createElement("canvas").getContext("2d");

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
    })[char]);
  }

  function measure(text, size, bold, fontFamily) {
    if (context) {
      context.font = `${bold ? "700" : "400"} ${size}px ${fontFamily}`;
      return context.measureText(text).width;
    }
    return Array.from(text).reduce((sum, char) => sum + (/^[\x00-\xff]$/.test(char) ? 0.6 : 1) * size, 0);
  }

  function wrap(text, size, maxWidth, bold = false, fontFamily = bodyFontFamily) {
    const lines = [];
    String(text).replace(/\r\n?/g, "\n").split("\n").forEach((paragraph) => {
      let line = "";
      for (const char of Array.from(paragraph)) {
        if (line && measure(line + char, size, bold, fontFamily) > maxWidth) {
          // Keep Chinese closing punctuation off the start of a new line, and
          // opening brackets off the end of the preceding line.
          const chars = Array.from(line);
          const last = chars.at(-1);
          if (chars.length > 1 && ("，。！？；：、,.!?;:%））》】”’)]".includes(char)
            || "（《【“‘([".includes(last))) {
            const carry = chars.pop();
            lines.push(chars.join(""));
            line = carry;
          } else {
            lines.push(line);
            line = "";
          }
        }
        line += char;
      }
      lines.push(line);
    });
    return lines;
  }

  function fit(text, maxWidth, maxHeight, maxSize, minSize, lineSpacing, bold = false, fontFamily = bodyFontFamily) {
    for (let size = maxSize; size >= minSize; size--) {
      const lines = wrap(text, size, maxWidth, bold, fontFamily);
      const lineHeight = size * lineSpacing;
      if (lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight, fits: true };
    }
    return { lines: wrap(text, minSize, maxWidth, bold, fontFamily), size: minSize,
      lineHeight: minSize * lineSpacing, fits: false };
  }

  function layout(card) {
    return {
      title: fit(card.name || "自定义特性", 408, 100, 52, 20, 1.2, false, titleFontFamily),
      body: fit(card.content || "", 568, 260, 36, 16, 1.25)
    };
  }

  function svg(card, useBackground = true) {
    const { title, body } = layout(card);
    const paper = background && useBackground
      ? `<image href="${background}" width="${width}" height="${height}" preserveAspectRatio="none"/>`
      : '<rect x="1" y="1" width="726" height="1026" rx="24" fill="#e6e6d9" stroke="#353933"/><rect x="2" y="170" width="724" height="420" fill="#c5cec4" opacity=".5"/><path d="M628 40L649 60L674 79L650 99L628 120L606 99L582 79L607 60Z" fill="#414e48" stroke="#949b8c" stroke-width="3"/><text x="628" y="94" text-anchor="middle" fill="white" font-family="serif" font-size="36">X</text><path d="M2 962H726V1004Q726 1026 704 1026H24Q2 1026 2 1004Z" fill="#414e48"/><text x="364" y="1004" text-anchor="middle" fill="white" font-family="serif" font-size="30" font-weight="700">TRAIT</text>';
    const titleY = 10 + Math.max(0, (100 - title.lines.length * title.lineHeight) / 2) + title.size;
    const titleText = title.lines.map((line, index) => `<text x="364" y="${titleY + index * title.lineHeight}">${escapeText(line)}</text>`).join("");
    const bodyText = body.lines.map((line, index) => `<text x="80" y="${676 + body.size + index * body.lineHeight}" xml:space="preserve">${escapeText(line)}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="body"><rect x="76" y="670" width="576" height="270"/></clipPath></defs>${paper}<g fill="#171b18" font-family="${escapeText(titleFontFamily)}" font-size="${title.size}" text-anchor="middle">${titleText}</g><g fill="#171b18" font-family="${escapeText(bodyFontFamily)}" font-size="${body.size}" clip-path="url(#body)">${bodyText}</g></svg>`;
  }

  function src(card, useBackground = true) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(card, useBackground))}`;
  }

  // Embed the local paper inside each card so zoom and the second screen need
  // no external image requests from an SVG image. Saves keep only editable text.
  const ready = typeof document === "undefined" ? Promise.resolve() :
    fetch(new URL("ps/other/trait/custom_trait_blank.jpg?v=20260930-illustrated1", document.currentScript?.src || document.baseURI))
      .then((response) => { if (!response.ok) throw new Error("Missing card background"); return response.blob(); })
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { background = reader.result; resolve(); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      })).catch(() => { /* The empty paper fallback also works without a local asset pack. */ });

  const api = { src, svg, layout, wrap, ready };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CustomTraits = api;
})(typeof window !== "undefined" ? window : this);
