import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSnapshot, emptyStore, goalsContaining, likelyDuplicates, mapDigest, mergeNodes, mergePlan, nameSimilarity, recordMastery, rememberGoal, validatePlan } from '../graph.js'

const n = (id, name, pre = []) => ({ id, name, type: 'concept', summary: 's', hook: 'h', prerequisites: pre })
const now = 1_800_000_000_000
const plan = (store, goal_id, nodes) => {
  const out = mergePlan(store, validatePlan({ goal_id, nodes }))
  return { ...out, store: rememberGoal(out.store, out.goal, now) }
}

test('names: different wordings of one idea score high, unrelated ones low', () => {
  assert.equal(nameSimilarity('导数的定义', '导数定义'), 1)
  assert.ok(nameSimilarity('连续性', '函数的连续性') >= 0.72)
  assert.ok(nameSimilarity('罗尔定理', '拉格朗日中值定理') < 0.5)
  assert.ok(nameSimilarity('矩阵乘法', '矩阵转置') < 0.5)
})

test('duplicates are found, merged with the better mastery, and show in both goals', () => {
  let k = plan(emptyStore(), 'lagrange', [n('limit', '极限'), n('derivative', '导数的定义', ['limit']), n('lagrange', '拉格朗日中值定理', ['derivative'])]).store
  k = recordMastery(k, { node_id: 'derivative', level: 2, evidence: 'ok' }, now)
  const second = plan(k, 'taylor', [n('derivative_definition', '导数定义'), n('taylor', '泰勒公式', ['derivative_definition'])])
  assert.deepEqual(likelyDuplicates(second.store, second.added).map(d => [d.id, d.existingId]), [['derivative_definition', 'derivative']])
  const m = mergeNodes(second.store, 'derivative_definition', 'derivative')
  assert.equal(m.nodes.derivative.mastery, 2)
  assert.ok(m.nodes.derivative.aliases.includes('导数定义'))
  assert.deepEqual(buildSnapshot(m, [{ id: 'taylor' }], now).nodes.map(x => x.id), ['limit', 'derivative', 'taylor'])
  assert.deepEqual(goalsContaining(m, 'derivative').map(g => g.id).sort(), ['lagrange', 'taylor'])
  assert.match(mapDigest(m), /derivative · 导数的定义 · 2/)
})

test('merge refuses points that build on each other, unknown ids and self-merges', () => {
  const k = plan(emptyStore(), 'b', [n('a', 'A'), n('b', 'B', ['a'])]).store
  assert.throws(() => mergeNodes(k, 'a', 'b'), /prerequisite of the other/)
  assert.throws(() => mergeNodes(k, 'a', 'a'), /itself/)
  assert.throws(() => mergeNodes(k, 'nope', 'a'), /unknown/)
})

test('snapshots carry the latest evidence so the card can show why a point is lit', () => {
  let k = plan(emptyStore(), 'a', [n('a', 'A')]).store
  k = recordMastery(k, { node_id: 'a', level: 1, evidence: '用自己的话讲清楚了' }, now)
  assert.equal(buildSnapshot(k, [{ id: 'a' }], now).nodes[0].evidence, '用自己的话讲清楚了')
})
