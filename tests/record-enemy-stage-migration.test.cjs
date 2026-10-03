/* 记录表：C4 迈达斯之主 / 半神迪精 VI 从两个独立等级（6a / 6b）合并成一个共用计数器（6）
   之后，旧存档里点亮过的等级必须折算成计数，否则老档进度会看起来消失。
   这里直接把页面里的 migrateEnemyStages() 抽出来跑，不依赖浏览器。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const recordSource = read('record/index.html');

const extractFunction = (source, name) => {
  const match = source.match(new RegExp('^( *)function ' + name + '\\([^]*?^\\1}', 'm'));
  assert.ok(match, `record/index.html 缺少函数 ${name}`);
  return match[0];
};

const context = vm.createContext({});
vm.runInContext([
  extractFunction(recordSource, 'isPlainObject'),
  extractFunction(recordSource, 'migrateEnemyStages'),
  'globalThis.migrateEnemyStages = migrateEnemyStages;',
].join('\n'), context);
const migrateEnemyStages = context.migrateEnemyStages;

const SHARED = 'c4:shared:demidjinn+midascore';

test('6a 与 6b 都点亮时折算成计数 2', () => {
  const migrated = migrateEnemyStages({ [`${SHARED}:6a`]: true, [`${SHARED}:6b`]: true });
  assert.equal(migrated[`${SHARED}:6`], 2);
  assert.equal(migrated[`${SHARED}:6a`], undefined);
  assert.equal(migrated[`${SHARED}:6b`], undefined);
});

test('只点亮一格时折算成计数 1', () => {
  assert.equal(migrateEnemyStages({ [`${SHARED}:6a`]: true })[`${SHARED}:6`], 1);
  assert.equal(migrateEnemyStages({ [`${SHARED}:6b`]: 1 })[`${SHARED}:6`], 1);
});

test('未点亮的旧键只删除、不产生计数', () => {
  const migrated = migrateEnemyStages({ [`${SHARED}:6a`]: false, [`${SHARED}:6b`]: 0 });
  assert.equal(migrated[`${SHARED}:6`], undefined);
  assert.deepEqual(Object.keys(migrated), []);
});

test('已经是新键的存档原样保留', () => {
  const migrated = migrateEnemyStages({ [`${SHARED}:6`]: 1, 'c4:midascore:5a': true });
  assert.equal(migrated[`${SHARED}:6`], 1);
  assert.equal(migrated['c4:midascore:5a'], true);
});

test('其余等级键与其它循环不受影响', () => {
  const input = {
    [`${SHARED}:5b`]: true,
    'c4:midascore:4c': true,
    'c2:shared:chimera+cyclonus:6a': true,
    'c3:shared:chimera+cyclonus:6b': true,
  };
  const migrated = migrateEnemyStages(input);
  assert.equal(migrated[`${SHARED}:5b`], true);
  assert.equal(migrated['c4:midascore:4c'], true);
  // 别的循环若也出现 6a / 6b，同样折算（规则按键形，不写死循环）
  assert.equal(migrated['c2:shared:chimera+cyclonus:6'], 1);
  assert.equal(migrated['c3:shared:chimera+cyclonus:6'], 1);
});

test('对同一份数据重复归一化不会重复累加', () => {
  const once = migrateEnemyStages({ [`${SHARED}:6a`]: true, [`${SHARED}:6b`]: true });
  const twice = migrateEnemyStages(once);
  assert.equal(twice[`${SHARED}:6`], 2);
});

test('非对象输入返回空对象，与原来的归一化行为一致', () => {
  for (const bad of [undefined, null, 'x', 3, []]) {
    // vm 里造出来的 {} 与宿主不是同一个 realm，deepEqual 会因原型不同而失败，这里只比键。
    assert.deepEqual(Object.keys(migrateEnemyStages(bad)), []);
  }
});
