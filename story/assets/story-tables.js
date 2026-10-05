/* 正文里的「管道表格」渲染。
 *
 * 故事正文（尤其是官方版 C2 战斗的奖赏表）里有原书排版留下来的管道表格：
 *
 *     常规伤口堆 | 第二伤口堆 | 奖励卡牌：部位1 | … | 核心
 *     --- | --- | --- | --- | --- | ---
 *     6 | 6 | 1 | 2 | 1 | +
 *
 * 阅读器以前把它当普通正文显示（white-space: pre-wrap），读者看到的是裸竖线和分隔行。
 * 这里把它渲染成真正的表格。
 *
 * 关键约束：混排渲染器（assets/mixed-media/renderer.js）用「去掉空白后的字符序列」把源文
 * 和 DOM 逐字符对齐（prepareHTML），再按字符偏移把图片插进文字里；图片也可能落在表格单元
 * 格内部。所以这里的表格必须保留源文里每一个非空白字符（包括 | 和 --- 分隔行），只靠 CSS
 * 把它变成表格：
 *   - 单元格是 span + display: table-cell；
 *   - | 和整行 --- 用 display: none 藏起来（字符仍在 DOM 里）；
 *   - 表头行加 story-table-head。
 * 这样「表格显示」和「插图定位」可以同时成立；万一混排渲染器对不上字符，它会按既有规则
 * 回退成原文，不会把正文弄丢。
 */
(function (root) {
  "use strict";

  const SEPARATOR_CELL = /^:?-{2,}:?$/;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // 按 | 切分，但保留竖线本身（作为隐藏 span 输出），保证字符一个不少。
  function splitDelimiters(line) {
    const parts = [];
    let buffer = "";
    for (const ch of String(line)) {
      if (ch === "|") {
        if (buffer) parts.push({ text: buffer, bar: false });
        buffer = "";
        parts.push({ text: ch, bar: true });
      } else {
        buffer += ch;
      }
    }
    if (buffer) parts.push({ text: buffer, bar: false });
    return parts;
  }

  // 一行的单元格文本片段（竖线不算）。行首/行尾的竖线只是分隔符，切分后自然只剩空片段。
  function rowCells(line) {
    return splitDelimiters(line).filter((part) => !part.bar);
  }

  function isSeparatorLine(line) {
    const value = String(line == null ? "" : line);
    if (!value.includes("|")) return false;
    const cells = rowCells(value);
    return cells.length >= 2 && cells.every((cell) => SEPARATOR_CELL.test(cell.text.trim()));
  }

  // 从 lines[start] 开始识别一个表格（表头行 + 分隔行 + 至少一行数据）。
  // 列数以分隔行为准：书里有些表头是「方框数量 | 」（右列空着），列数比数据行少。
  function matchTable(lines, start) {
    const header = lines[start];
    const separator = lines[start + 1];
    if (typeof header !== "string" || !header.includes("|")) return null;
    if (!isSeparatorLine(separator)) return null;
    const width = rowCells(separator).length;
    if (width < 2 || rowCells(header).length > width) return null;
    let end = start + 2;
    while (end < lines.length) {
      const line = lines[end];
      if (typeof line !== "string" || !line.includes("|") || !line.trim()) break;
      if (rowCells(line).length > width) break;
      end += 1;
    }
    if (end === start + 2) return null;
    return { start, end, width };
  }

  function renderTable(lines, width, formatCell, escape) {
    const rows = lines.map((line, index) => {
      const separatorRow = index === 1;
      const headRow = index === 0;
      const cells = [];
      for (const part of splitDelimiters(line)) {
        if (part.bar) { cells.push(`<span class="story-table-bar" aria-hidden="true">${escape(part.text)}</span>`); continue; }
        if (separatorRow) { cells.push(`<span class="story-table-sep" aria-hidden="true">${escape(part.text)}</span>`); continue; }
        const className = headRow ? "story-table-cell story-table-head" : "story-table-cell";
        cells.push(`<span class="${className}">${formatCell(part.text)}</span>`);
      }
      // 列数不足时补空单元格（不增加任何字符），让表格边框整齐。
      const filled = cells.filter((html) => html.includes("story-table-cell")).length;
      for (let missing = filled; missing < width; missing += 1) {
        cells.push(`<span class="${headRow ? "story-table-cell story-table-head" : "story-table-cell"}"></span>`);
      }
      return `<span class="story-table-row${separatorRow ? " story-table-sep-row" : ""}">${cells.join("")}</span>`;
    }).join("");
    return `<span class="story-table">${rows}</span>`;
  }

  // 把整段正文里的表格块渲染成表格，其余部分仍交给 formatText（通常是 linkify）。
  function renderText(text, formatText, escapeFn) {
    const source = String(text == null ? "" : text);
    const format = typeof formatText === "function" ? formatText : escapeHtml;
    const escape = typeof escapeFn === "function" ? escapeFn : escapeHtml;
    const lines = source.split("\n");
    const out = [];
    let buffer = [];
    let index = 0;
    const flush = () => {
      if (!buffer.length) return;
      out.push(format(buffer.join("\n")));
      buffer = [];
    };
    while (index < lines.length) {
      const table = matchTable(lines, index);
      if (table) {
        flush();
        out.push(renderTable(lines.slice(table.start, table.end), table.width, format, escape));
        index = table.end;
        continue;
      }
      buffer.push(lines[index]);
      index += 1;
    }
    flush();
    return out.join("\n");
  }

  // 这段文本里有没有可渲染的表格块（第二屏用它决定走 HTML 还是纯文本）。
  function hasTable(text) {
    const lines = String(text == null ? "" : text).split("\n");
    for (let index = 0; index + 1 < lines.length; index += 1) {
      if (matchTable(lines, index)) return true;
    }
    return false;
  }

  root.ATO_STORY_TABLES = Object.freeze({ schema: 1, renderText, hasTable, isSeparatorLine });
})(typeof window !== "undefined" ? window : globalThis);
