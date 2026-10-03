/* 收割 / 播种的「记录」下拉（记录表）。
 *
 * 页面把每个字段的值存在一个 [data-cycle-bind] 元素上，并且：
 *   - 每次重新渲染时把值写进去（input.value = …）；
 *   - 元素上挂一个 input 监听器，用户改动时回写 state 并保存。
 *
 * 所以这里不去碰页面的状态：保留一个隐藏的 [data-cycle-bind] 输入作为存储，
 * 界面只负责读写它并派发 input 事件——保存、切换循环、导入导出全部沿用原来的逻辑。
 * 值用换行分隔，旧的单行文本会自然成为一条记录。
 *
 * 列表在每次展开时重新读取隐藏输入，因此页面在任何时候改写它都不会出现不同步。
 */
(function () {
  "use strict";

  function entriesOf(value) {
    return String(value == null ? "" : value)
      .split("\n")
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  }

  var GAP = 8;

  // 面板是绝对定位的，不会把页面撑高，所以超出视口的部分既看不到也点不到。
  // 展开和增删之后都重新判断：优先向下，放不下就翻到上方；两边都放不下才限高自滚。
  function place(panel) {
    panel.classList.remove("above");
    panel.style.maxHeight = "";
    panel.style.overflowY = "";
    if (panel.getBoundingClientRect().bottom <= window.innerHeight - GAP) return;
    panel.classList.add("above");
    var room = panel.getBoundingClientRect().top - GAP;
    if (room < panel.offsetHeight) {
      panel.style.maxHeight = Math.max(120, room) + "px";
      panel.style.overflowY = "auto";
    }
  }

  function setup(details) {
    var bind = details.getAttribute("data-mark-notes");
    var field = details.closest(".identity-mark-field");
    var store = field && field.querySelector('[data-cycle-bind="' + bind + '"]');
    var list = details.querySelector(".identity-mark-notes-list");
    var empty = details.querySelector(".identity-mark-notes-empty");
    var panel = details.querySelector(".identity-mark-notes-panel");
    var form = details.querySelector(".identity-mark-notes-add");
    if (!store || !list || !form) return;
    var text = form.querySelector('input[type="text"]');

    // .panel 上的 overflow: hidden 是给 8px 圆角裁边用的，会把绝对定位的下拉
    // 一起裁掉。给这个面板打个标记，让 record.css 放开裁剪。
    var host = details.closest(".panel");
    if (host) host.classList.add("has-mark-notes");

    function refresh() {
      if (details.open && panel) place(panel);
    }

    function render(entries) {
      list.textContent = "";
      entries.forEach(function (entry, index) {
        var item = document.createElement("li");
        var label = document.createElement("span");
        label.textContent = entry;
        var remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "删除";
        remove.setAttribute("aria-label", "删除这条记录");
        remove.addEventListener("click", function () {
          var next = entriesOf(store.value);
          next.splice(index, 1);
          commit(next);
        });
        item.appendChild(label);
        item.appendChild(remove);
        list.appendChild(item);
      });
      if (empty) empty.hidden = entries.length > 0;
    }

    function commit(entries) {
      store.value = entries.join("\n");
      store.dispatchEvent(new Event("input", { bubbles: true }));
      render(entries);
      refresh();
    }

    details.addEventListener("toggle", function () {
      render(entriesOf(store.value));
      if (!details.open) return;
      refresh();
      if (text) text.focus();
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = (text.value || "").trim();
      if (!value) return;
      var next = entriesOf(store.value);
      next.push(value);
      text.value = "";
      commit(next);
    });

    render(entriesOf(store.value));
  }

  function boot() {
    document.querySelectorAll("[data-mark-notes]").forEach(setup);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
