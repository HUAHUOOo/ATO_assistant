const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveCardTracks, cardStateAt, resolveCampaignProgress } = require('../briefing/briefing-core.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/story-doom-card-data.js'), 'utf8'), sandbox);
const cycles = sandbox.window.ATO_STORY_DOOM_DATA.cycles;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../briefing/briefing-progress-data.js'), 'utf8'), sandbox);
const hubs = sandbox.window.ATO_BRIEFING_HUBS;

test('内蕴知识等级不按实体卡迁移，旧计数器与循环起始等级保持一致', () => {
  const view = resolveCampaignProgress({ cardTracksVersion: 1, cardTracks: { inwardOdyssey: { position: 24, progress: 3 } } }, 'c2', hubs.c2);
  assert.equal(view.inward.position, 24);
  assert.equal(view.inward.progress, 3);
  assert.equal(resolveCampaignProgress({ cardCounters: { inwardOdysseyCount: 42 } }, 'c3', hubs.c3).inward.position, 42);
  assert.equal(resolveCampaignProgress({ cardTracks: { inwardOdyssey: { position: 0 } } }, 'c4', hubs.c4).inward.position, 60);
  assert.equal(resolveCampaignProgress({}, 'c1', hubs.c1).inward.known, false);
});

test('AHUB 只统计字典中的已勾选分支，区分零进度和缺失记录', () => {
  const view = resolveCampaignProgress({ adventureHubs: { checked: { 'fated-conundrum': ['alpha', '3-4', 'unknown'], 'unknown': ['alpha'] }, activeHub: 'fated-conundrum', activeBox: '3-4' } }, 'c1', hubs.c1);
  assert.equal(view.hubs.done, 2);
  assert.equal(view.hubs.rows[0].active, true);
  assert.equal(view.hubs.rows[0].boxes.find((box) => box.id === '3-4').active, true);
  assert.equal(resolveCampaignProgress({ adventureHubs: { checked: {} } }, 'c1', hubs.c1).hubs.known, true);
  assert.equal(resolveCampaignProgress({}, 'c1', hubs.c1).hubs.known, false);
  for (const rows of Object.values(hubs)) assert.ok(rows.every((hub) => hub.boxes.length >= 7 && /[\u4e00-\u9fff]/.test(hub.name)));
});

test('知识与 AHUB 回放沿用前一份备份，不引用未来进度', () => {
  const earlier = resolveCampaignProgress({ cardCounters: { inwardOdyssey: 3 }, adventureHubs: { checked: {} } }, 'c1', hubs.c1);
  const later = resolveCampaignProgress({ cardCounters: { inwardOdyssey: 9 } }, 'c1', hubs.c1);
  const days = [{ present: true, title: '第 0 天', progress: earlier }, { present: false }, { present: true, progress: later }];
  assert.equal(cardStateAt(days, 1).progress.inward.position, 3);
  assert.equal(cardStateAt(days, 2).progress.inward.position, 9);
  assert.equal(cardStateAt([{ present: false }], 0).progress, null);
});

test('现代存档按 A/B 步骤选择卡面并保留当前卡上的数量', () => {
  const cards = resolveCardTracks({ cardTracksVersion: 2, cardTracks: {
    story: { position: 2, progress: '3', doom: 0 },
    doom: { position: 3, progress: 2, doom: 5 },
  } }, cycles.c1);
  assert.equal(cards.story.card.label, '1B');
  assert.equal(cards.story.card.image, cycles.c1.storySteps[1].image);
  assert.equal(cards.story.progress, 3);
  assert.equal(cards.doom.card.label, '2A');
  assert.equal(cards.doom.doom, 5);
});

test('v1 实体卡位置迁移到对应 A 面，单独的旧计数器维持主控台规则', () => {
  const old = resolveCardTracks({ cardTracksVersion: 1, cardTracks: { story: { position: 2, progress: 4 } } }, cycles.c1);
  assert.equal(old.story.position, 3);
  assert.equal(old.story.card.label, '2A');
  assert.equal(old.story.progress, 4);
  const counters = resolveCardTracks({ cardCounters: { storyCount: 2, doom: 4 } }, cycles.c1);
  assert.equal(counters.story.card.label, '1B');
  assert.equal(counters.doom.card.label, '2B');
});

test('未开始仅预览首卡；历史没有字段时保持未知', () => {
  const preview = resolveCardTracks({ cardTracksVersion: 2, cardTracks: { story: { position: 0, progress: 0 } } }, cycles.c1);
  assert.equal(preview.story.preview, true);
  assert.equal(preview.story.position, 0);
  assert.equal(preview.story.card.label, '1A');
  assert.equal(preview.doom.known, false);
  const unknown = resolveCardTracks({}, cycles.c1);
  assert.equal(unknown.story.known, false);
  assert.equal(unknown.story.card, null);
});

test('越界回到最后一步并清空进展，灾祸数量保留；异常数值不扩散', () => {
  const cards = resolveCardTracks({ cardTracksVersion: 2, cardTracks: {
    story: { position: -2, progress: 'invalid' }, doom: { position: 999, progress: 9, doom: 6 },
  } }, cycles.c1);
  assert.equal(cards.story.position, 0);
  assert.equal(cards.story.progress, 0);
  assert.equal(cards.doom.position, cycles.c1.doomSteps.length);
  assert.equal(cards.doom.progress, 0);
  assert.equal(cards.doom.doom, 6);
});

test('循环 IV/V 灾祸 A 面使用字典指定的背面图片', () => {
  for (const id of ['c4', 'c5']) {
    const cards = resolveCardTracks({ cardTracksVersion: 2, cardTracks: { doom: { position: 1 } } }, cycles[id]);
    assert.equal(cards.doom.card.image, cycles[id].doomCards[0].back);
    assert.equal(cards.doom.card.side, 'A');
  }
});

test('缺口日沿用过去备份并标出来源，回退卡片不累计未来数量', () => {
  const first = resolveCardTracks({ cardTracksVersion: 2, cardTracks: { story: { position: 4, progress: 5 } } }, cycles.c1);
  const last = resolveCardTracks({ cardTracksVersion: 2, cardTracks: { story: { position: 2, progress: 1 } } }, cycles.c1);
  const days = [{ present: true, title: '第 0 天', cards: first }, { present: false, title: '第 1 天' }, { present: true, title: '第 2 天', cards: last }];
  const gap = cardStateAt(days, 1);
  assert.equal(gap.gap, true);
  assert.equal(gap.sourceDay, '第 0 天');
  assert.equal(gap.cards.story.progress, 5);
  assert.equal(cardStateAt(days, 2).cards.story.progress, 1);
  assert.equal(cardStateAt([{ present: false }], 0).cards, null);
});
