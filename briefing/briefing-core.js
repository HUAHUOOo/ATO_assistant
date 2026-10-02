// 战役简报的纯逻辑（不碰 DOM）。
//
// 抽出来是给测试直接 require 的：日期轴上的点亮判定、以及「画哪几页科技树」这两条规则
// 都曾经出过错（节点只在当天亮一次、两个循环的图纸叠在一起），单独成文件才好写回归。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_BRIEFING_CORE = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  /**
   * 某一天里某个科技节点的状态。
   *
   * @param {string|null} firstDay      节点首次点亮的日期名（"T0"、"5"…），从未点亮为 null
   * @param {number} currentIndex       当前回放到的日期轴序号
   * @param {number|null} firstDayIndex 首次点亮日期在日期轴上的序号（轴外为 Infinity）
   * @param {Set<string>} todayKeys     当天新点亮的科技 key
   * @param {string} nodeKey            当前节点的科技 key
   * @param {boolean} isBaseline        当前是不是日期轴的第一天
   */
  function nodeState(firstDay, currentIndex, firstDayIndex, todayKeys, nodeKey, isBaseline) {
    // 按日期轴上的先后比，而不是比日期字符串是否相等：只要首次点亮不晚于当前这天，
    // 节点就该一直亮着。
    const unlocked = firstDayIndex !== null && firstDayIndex !== undefined && firstDayIndex <= currentIndex;
    const today = Boolean(
      !isBaseline
      && firstDay !== null
      && firstDayIndex === currentIndex
      && todayKeys
      && todayKeys.has(nodeKey)
    );
    return { unlocked, today };
  }

  /**
   * 选出要画的科技树页面。
   *
   * 接口会把「存档里有点亮记录的所有循环」的页面都回传，而简报一次只看一个循环；
   * 把多页画进同一个画布会让两张图纸在同一个坐标系里重叠。这里只取当前循环那一页，
   * 它没有节点时再退回有节点的页面（例如备份数据本身不完整）。
   */
  function selectTechPages(pages, cycleId) {
    const all = Array.isArray(pages) ? pages : [];
    const wanted = all.filter((page) => page && page.cycleId === cycleId && (page.nodes || []).length);
    if (wanted.length) return wanted;
    const withNodes = all.filter((page) => page && (page.nodes || []).length);
    return withNodes.length ? withNodes : all;
  }

  return { nodeState, selectTechPages };
});
