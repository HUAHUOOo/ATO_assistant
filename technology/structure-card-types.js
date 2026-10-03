(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_STRUCTURE_CARD_TYPES = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';

  const options = [
    { key: 'one_time', label: '一次性效果' },
    { key: 'save', label: '豁免' },
    { key: 'negotiation', label: '谈判' },
    { key: 'active', label: '主动' },
    { key: 'reference', label: '参考' },
    { key: 'permanent', label: '永久' },
    { key: 'passive', label: '被动' },
    { key: 'other', label: '其他' },
  ];

  function normalize(values) {
    const selected = new Set(Array.isArray(values) ? values : []);
    return options.filter(option => selected.has(option.key)).map(option => option.key);
  }

  function forType(type) {
    const values = Array.isArray(type?.structure_card_types) ? type.structure_card_types : [];
    // 已有谈判标记继续有效；旧工具保存时也会同步这个字段。
    return normalize(type?.negotiation === true ? [...values, 'negotiation'] : values);
  }

  function isLargeCard(card) {
    const crop = card?.image?.crop;
    const width = Number(card?.crop_width_px ?? crop?.[2] ?? crop?.w ?? 0);
    const height = Number(card?.crop_height_px ?? crop?.[3] ?? crop?.h ?? 0);
    return width >= 1000 || height >= 1300;
  }

  function canClassify(card) {
    const category = card?.tech_category || card?.category || card?.type?.category;
    return category !== 'battle';
  }

  function forCard(card) {
    return canClassify(card) ? forType(card?.type) : [];
  }

  function setForCard(card, values) {
    const selected = normalize(values);
    card.type ||= {};
    card.type.structure_card_types = selected;
    if (selected.includes('negotiation')) card.type.negotiation = true;
    else delete card.type.negotiation;
  }

  function labels(values) {
    return normalize(values).map(key => options.find(option => option.key === key).label);
  }

  return { options, normalize, forType, isLargeCard, canClassify, forCard, setForCard, labels };
});
