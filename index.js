/**
 * Host half of the learning talent tree.
 *
 * - Three model tools: techtree_plan, techtree_record, techtree_view.
 * - A personal knowledge map shared by every session, kept as one JSON file.
 * - Every tool result carries the session's complete tree snapshot in its
 *   presentation meta; the `techtree` session projection folds those results,
 *   so the sidebar view replays, resumes and forks with the session log.
 * - A static system-prompt section with the tutoring rules.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  GLOSSARY_MAX, HOOK_MAX, NODE_TYPES, buildLibrary, buildSnapshot, describeSnapshot, emptyStore, likelyDuplicates, mapDigest, mergeNodes, mergePlan, recordMastery, rememberGoal, validatePlan,
} from './graph.js'

export const name = 'dsh-talent-tree'
export const inject = ['tools', 'systemPrompt', 'sessionProjections']

const META_KIND = 'techtree/snapshot'
/** Authenticated read of the whole knowledge map for the left-Sidebar panel. */
export const LIBRARY_PATH = '/api/techtree/library'
const PROJECTION_KEY = 'techtree'
/** A node may rise one level per check; a second raise of the same node inside this window is refused. */
const RAISE_WINDOW_MS = 60_000
/** At most this many nodes may rise inside the window (a skip-ahead answer can light a few prerequisites). */
const MAX_RAISES_PER_WINDOW = 6

const TUTOR_PROMPT = `# Learning talent tree (techtree tools)

The learner keeps a personal "talent tree": a prerequisite graph of knowledge points, where points light up (bronze / silver / gold) only when the learner has shown they understand them. All goals share ONE knowledge map: a point learned for one goal is already lit in every other goal that needs it. The sidebar shows the tree.

## Planning a goal
When the learner wants to learn or understand something (e.g. "我想学会拉格朗日中值定理"):
1. Ask at most two quick diagnostic questions only if the right depth is unclear; otherwise plan right away.
2. Call techtree_plan with the goal and the knowledge points needed to truly understand it, each with its direct prerequisites: concepts, theorems, methods and the key proof ideas or tricks (for example "constructing an auxiliary function"). Go 2-4 layers deep, stopping at material a student at the learner's level surely knows. A prerequisite must be strictly more basic than the node that needs it.
3. REUSE EXISTING POINTS. Before planning, call techtree_view with map=true: it lists every point the learner already has (id, name, mastery). Whenever a point you would add is the same knowledge as a listed point — even under a different wording ("导数定义" = "导数的定义", "泰勒展开" = "泰勒公式") — use that point's exact id and name instead of creating a new one, so the learner never has to learn it twice. Only create a new point for genuinely different knowledge ("方差" is not "协方差").
4. If techtree_plan reports possible duplicates, decide for each pair: same knowledge → call techtree_merge (from the new id into the existing id); different → leave both. If you notice any two points in the map that are the same knowledge, merge them the same way.
5. Tell the learner which points are learnable now (mention points already lit from other goals) and suggest where to start. Do not restate the whole tree.

Every node gets a "hook": the single most intriguing formula, idea or question about it — the thing that makes a learner want to open it (e.g. "$e^{i\\pi}+1=0$：五个最重要的数为什么能凑成一个等式？", "为什么点积大就说明两个向量'像'？"). One line, concrete, surprising.

Writing node text: the summary is one or two plain sentences that someone who has learned only this node's prerequisites can follow — what the idea is in everyday words or with a tiny concrete example, and in plain words why the goal needs it, without symbols that later nodes introduce. Every symbol in the node's name, summary or hook gets a glossary entry: the symbol as LaTeX in $…$ and its meaning in plain words, with a typical value when it helps (term "$d_k$", meaning "每个查询/键向量里有多少个数（维度），常见是 64").

Math notation: in node names, summaries, hooks and replies write every formula as LaTeX between dollar signs ($…$ inline, $$…$$ on its own line). Never write bare x_k or 1/√d outside dollars. When techtree_view marks nodes no-hook, plain-math or no-glossary, fix them by calling techtree_plan again with the same ids and prerequisites.

## Teaching
Teach in small steps. Each reply covers one idea and ends with exactly one question for the learner; then stop and wait for their answer.
- Starting a node: open with its hook, build intuition with a concrete example, then give the precise statement. Mention the classic pitfall when there is one.
- Check questions must make the learner produce something: explain in their own words, compute a small case, predict what happens, give an example or counterexample, or say why a step is needed. No yes/no questions, no questions that hint at their own answer, and never reveal the answer in the same reply.
- Grading an answer: compare it with the key points. Say precisely what is right and what is missing or wrong. Never call a wrong or incomplete answer correct, and do not pad with praise. If it is partly right, ask a follow-up aimed at the missing part.
- If the learner is stuck: first a small hint, then a bigger hint, then a worked example of a similar problem — and after that ask a fresh parallel question so they still produce the answer themselves.
- Accuracy matters more than speed: check every formula, number and example before sending it; prefer standard definitions; if you are unsure of a fact, say so instead of guessing.
- Skip-ahead challenge: when the learner asks to skip ahead to a locked node, give one or two integrated questions that can only be solved by also knowing its key prerequisites. If they succeed, light the node and each prerequisite the answers clearly demonstrated; if not, say which prerequisite is missing and start there.
- Review: when a point needs review, ask a NEW question about it (not the one from last time), then record the result.

## Exercises and study material
When the learner shares an exercise, their own working, or study material (pasted text, an image or a file):
- An exercise or exam question: do not hand over the full solution. Find which knowledge points it needs (planning or extending the tree if useful), then guide the learner to solve it step by step with questions.
- Their own answer or working: grade it like any answer — exactly what is right, what is wrong and why — then follow up.
- Notes, slides or a textbook chapter: when they want to learn it, plan the tree from that material, using its terms and order.

## Lighting a node (techtree_record)
- Only after the learner has answered in their own words in this conversation. Messages sent from the sidebar buttons are requests, not answers: ask first and record after their reply.
- One step per answer: a node rises at most one level per learner reply (the plugin rejects bigger jumps, and a second raise of the same node within a minute). Levels: 1 bronze = states and explains it correctly in their own words; 2 silver = explains why it holds or how it follows from its prerequisites; 3 gold = applies it correctly to a new problem they have not seen.
- Never light a node because the learner says they already know it — quiz them first.
- evidence: quote or closely paraphrase what the learner actually said or did.
- When an answer reveals a gap, record the prerequisite at fault with weak=true (keeping its level) and repair that gap before moving on.

Use techtree_view to read current progress, including review needs, before choosing what to teach next. Reply in the learner's language.`

/** Optional row config: { dataFile?: string } */
export function apply(ctx, config = {}) {
  const dataFile = typeof config?.dataFile === 'string' && config.dataFile !== ''
    ? config.dataFile
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'techtree', 'knowledge.json')
  const store = createStore(dataFile)
  let projection
  const ready = ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: { parse: parseSnapshotOrNull },
    init: () => null,
    apply(state, event) {
      if (event.type !== 'tool/result') return state
      const meta = event.data?.meta
      if (meta === null || typeof meta !== 'object' || meta.kind !== META_KIND) return state
      return meta.snapshot ?? state
    },
    wire: {
      viewSchema: { parse: parseSnapshotOrNull },
      view: state => state,
      summary: false,
    },
  })
  ready.then(handle => { projection = handle }, error => ctx.logger?.warn?.('techtree projection unavailable', error))

  /** Goals this session's tree already shows, from its own log; ids merged away since then point to their new node. */
  const sessionGoals = (exec, current) => {
    const session = exec?.agent?.session
    if (projection === undefined || session === undefined) return []
    let goals
    try {
      goals = projection.stateOf(session)?.goals ?? []
    } catch {
      return []
    }
    if (!current?.mergedInto) return goals
    const resolve = id => { let x = id; for (let i = 0; i < 20 && current.mergedInto[x]; i++) x = current.mergedInto[x]; return x }
    return goals.map(g => ({ ...g, id: resolve(g.id) })).filter((g, i, all) => all.findIndex(x => x.id === g.id) === i)
  }
  /** Recent level raises, for the one-step-per-check rule. */
  let recentRaises = []

  // Optional: the web/desktop connection serves an authenticated GET under /api.
  // Absent in headless runs, so it is injected on demand rather than required.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], scope => {
      scope.effect(() => scope.connection.fetch.register({
        path: LIBRARY_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => new Response(JSON.stringify(buildLibrary(await store.read(), Date.now())), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        }),
      }), `techtree: ${LIBRARY_PATH}`)
    })
  }

  ctx.effect(() => ctx.systemPrompt.section({ name: 'plugin:techtree', order: 9000, interpolate: false, text: TUTOR_PROMPT }))

  const register = definition => ctx.effect(() => ctx.tools.register(withSnapshotOutput(definition)))

  register({
    name: 'techtree_plan',
    description: 'Create or extend the learner\'s knowledge talent tree for a learning goal. Give the goal node and every knowledge point needed to understand it, each with its direct prerequisites (ids). Nodes merge into the learner\'s personal map: reuse the id of any point already in the map that is the same knowledge (list them with techtree_view map=true); matching ids or identical names are reused automatically and keep their mastery.',
    parameters: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'Id of the goal node; it must also appear in nodes.' },
        nodes: {
          type: 'array',
          description: 'Knowledge points, goal included. Prerequisites must be more basic than the node.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable lower_snake_case ASCII id, e.g. "rolle_theorem".' },
              name: { type: 'string', description: 'Display name in the learner\'s language, e.g. "罗尔定理"; formulas as LaTeX in $…$.' },
              type: { type: 'string', enum: NODE_TYPES, description: 'concept, theorem, method (technique), proof_idea, or skill.' },
              summary: { type: 'string', description: 'One or two plain sentences a learner who knows only the prerequisites can follow: what it is (everyday words or a tiny example) and, in plain words, why the goal needs it. No symbols from later nodes.' },
              glossary: {
                type: 'array',
                maxItems: GLOSSARY_MAX,
                description: 'Every symbol used in name, summary or hook, explained in plain words. Empty when there are no symbols.',
                items: {
                  type: 'object',
                  properties: {
                    term: { type: 'string', description: 'The symbol as LaTeX in $…$, e.g. "$d_k$".' },
                    meaning: { type: 'string', description: 'Plain-words meaning, with a typical value when it helps, e.g. "每个向量里有多少个数（维度），常见是 64".' },
                  },
                  required: ['term', 'meaning'],
                },
              },
              hook: { type: 'string', maxLength: HOOK_MAX, description: 'The most intriguing formula, idea or question about this point, to spark curiosity. One line; formulas as LaTeX in $…$.' },
              prerequisites: { type: 'array', items: { type: 'string' }, description: 'Ids of direct prerequisites only.' },
              est_minutes: { type: 'integer', description: 'Rough study time for a first pass.' },
            },
            required: ['id', 'name', 'type', 'summary', 'hook', 'prerequisites'],
          },
        },
      },
      required: ['goal_id', 'nodes'],
    },
    async execute(args, exec) {
      const plan = validatePlan(args)
      let outcome
      const next = await store.update(current => {
        outcome = mergePlan(current, plan)
        return rememberGoal(outcome.store, outcome.goal, Date.now())
      })
      const goals = upsertGoal(sessionGoals(exec, next), outcome.goal)
      const snapshot = buildSnapshot(next, goals, Date.now())
      const notes = []
      const remaps = Object.entries(outcome.remapped)
      if (remaps.length) notes.push(`Merged into existing nodes (use these ids from now on): ${remaps.map(([a, b]) => `${a} -> ${b}`).join(', ')}`)
      const known = snapshot.nodes.filter(n => n.mastery >= 1).map(n => n.name)
      if (known.length) notes.push(`Already lit from earlier study: ${known.join(', ')}`)
      const dupes = likelyDuplicates(next, outcome.added)
      if (dupes.length) {
        notes.push(`Possible duplicates of points already in the map (new -> existing). If a pair is the same knowledge, call techtree_merge with from_id = the new id and into_id = the existing id; if not, ignore it:\n${dupes.map(d => `- ${d.id} "${d.name}" -> ${d.existingId} "${d.existingName}"`).join('\n')}`)
      }
      return { text: [`Planned "${outcome.goal.name}": ${outcome.added.length} new, ${outcome.merged.length} reused.`, ...notes, describeSnapshot(snapshot, Date.now())].join('\n'), snapshot }
    },
  })

  register({
    name: 'techtree_record',
    description: 'Record the learner\'s verified mastery of one knowledge point. Level 1-3 lights it (bronze: explains it; silver: explains why/connections; gold: applies it to new problems); 0 un-lights it. Only after the learner demonstrated it in this conversation. Set weak=true when an answer exposed a gap in this node.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Id of the knowledge point.' },
        level: { type: 'integer', enum: [0, 1, 2, 3], description: '0 none, 1 bronze, 2 silver, 3 gold.' },
        weak: { type: 'boolean', description: 'True when the learner showed a gap here that needs reinforcement.' },
        evidence: { type: 'string', description: 'What the learner said or did that justifies this judgement.' },
      },
      required: ['node_id', 'level', 'evidence'],
    },
    async execute(args, exec) {
      const now = Date.now()
      let raised = false
      const next = await store.update(current => {
        const target = current.nodes[args?.node_id]
        const before = target?.mastery ?? 0
        if (target && Number.isInteger(args.level) && args.level > before) {
          if (args.level > before + 1) {
            throw new Error(`a node rises at most one level per answer ("${target.name}" is at ${before}); record level ${before + 1} now and check the next level with a new question`)
          }
          recentRaises = recentRaises.filter(r => now - r.at < RAISE_WINDOW_MS)
          if (recentRaises.some(r => r.id === target.id)) {
            throw new Error(`"${target.name}" just went up a level; ask a new question and wait for the learner's answer before raising it again`)
          }
          if (recentRaises.length >= MAX_RAISES_PER_WINDOW) {
            throw new Error(`at most ${MAX_RAISES_PER_WINDOW} nodes can be raised from one answer; check the rest with further questions`)
          }
          raised = true
        }
        return recordMastery(current, args, now)
      })
      const node = next.nodes[args.node_id]
      if (raised) recentRaises.push({ id: node.id, at: now })
      let goals = sessionGoals(exec, next)
      if (goals.length === 0) goals = [{ id: node.id, name: node.name }]
      const snapshot = buildSnapshot(next, goals, now)
      const verb = args.level >= 1 ? `Lit "${node.name}" at level ${args.level}` : `Set "${node.name}" to unlit`
      return { text: `${verb}${args.weak ? ' (marked weak)' : ''}.\n${describeSnapshot(snapshot, now)}`, snapshot }
    },
  })

  register({
    name: 'techtree_merge',
    description: 'Merge two knowledge points that are the same knowledge under different names, so the learner learns it once. The learner keeps the better mastery; every tree, prerequisite and goal that used from_id now uses into_id. Use it for duplicates reported by techtree_plan or spotted with techtree_view map=true. Never merge points that are merely related.',
    parameters: {
      type: 'object',
      properties: {
        from_id: { type: 'string', description: 'Id of the duplicate to remove (usually the newer one).' },
        into_id: { type: 'string', description: 'Id of the point to keep (usually the existing one).' },
        reason: { type: 'string', description: 'Why these are the same knowledge.' },
      },
      required: ['from_id', 'into_id', 'reason'],
    },
    async execute(args, exec) {
      let from
      const next = await store.update(current => {
        from = current.nodes[args?.from_id]
        const merged = mergeNodes(current, args?.from_id, args?.into_id)
        // Remember the move so goals saved in other conversations still resolve.
        return { ...merged, mergedInto: { ...(current.mergedInto ?? {}), [args.from_id]: args.into_id } }
      })
      const kept = next.nodes[args.into_id]
      const goals = sessionGoals(exec, next)
      const now = Date.now()
      const snapshot = goals.length ? buildSnapshot(next, goals, now) : null
      const text = [`Merged "${from.name}" (${from.id}) into "${kept.name}" (${kept.id}); mastery is now ${kept.mastery ?? 0}. Use ${kept.id} from now on.`,
        snapshot ? describeSnapshot(snapshot, now) : ''].filter(Boolean).join('\n')
      return { text, snapshot }
    },
  })

  register({
    name: 'techtree_view',
    description: 'Show the current talent tree for this conversation: every node with its state (lit level, learnable, locked, weak, fading/needs review). Pass goal_id to bring an existing goal from the learner\'s map into this conversation; pass map=true to also list every point the learner has (do this before planning a new goal).',
    parameters: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'Optional id of an existing node to show as a goal.' },
        map: { type: 'boolean', description: 'Also list every point in the learner\'s knowledge map (id, name, mastery). Call this before planning a new goal, to reuse existing points.' },
      },
    },
    async execute(args, exec) {
      const current = await store.read()
      let goals = sessionGoals(exec, current)
      const digest = args?.map === true ? mapDigest(current) : ''
      const mapText = args?.map === true
        ? `The learner's knowledge map, as "id · name · mastery 0-3" (w = weak). Reuse these ids for the same knowledge:\n${digest || '(empty: nothing planned yet)'}`
        : ''
      if (typeof args?.goal_id === 'string') {
        const node = current.nodes[args.goal_id]
        if (node === undefined) throw new Error(`unknown node "${args.goal_id}"`)
        goals = upsertGoal(goals, { id: node.id, name: node.name })
      }
      if (goals.length === 0) {
        const all = Object.values(current.nodes)
        const text = all.length === 0
          ? 'This conversation has no talent tree yet and the learner\'s map is empty. Use techtree_plan.'
          : `This conversation has no talent tree yet. The learner's map has ${all.length} nodes (${all.filter(n => n.mastery >= 1).length} lit). Pass goal_id to show one, or use techtree_plan.`
        return { text: [text, mapText].filter(Boolean).join('\n\n'), snapshot: null }
      }
      const now = Date.now()
      const snapshot = buildSnapshot(current, goals, now)
      return { text: [describeSnapshot(snapshot, now), mapText].filter(Boolean).join('\n\n'), snapshot }
    },
  })
}

function upsertGoal(goals, goal) {
  return goals.some(g => g.id === goal.id) ? goals : [...goals, goal]
}

/** Add the shared canonical output: model sees `text`, the session log keeps `snapshot` as meta. */
function withSnapshotOutput(definition) {
  return {
    ...definition,
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          snapshot: { description: 'Complete talent-tree snapshot for this session, or null.' },
        },
        required: ['text', 'snapshot'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
      presentationMeta: (_args, value) => (value.snapshot === null ? null : { kind: META_KIND, snapshot: value.snapshot }),
    },
  }
}

/** Loose structural check: projection state is plain JSON written by this plugin. */
function parseSnapshotOrNull(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || !Array.isArray(value.goals) || !Array.isArray(value.nodes)) {
    throw new Error('invalid techtree snapshot')
  }
  return value
}

/** The personal knowledge map: one JSON file, writes serialized and atomic. */
function createStore(file) {
  let cache
  let chain = Promise.resolve()
  const load = async () => {
    if (cache !== undefined) return cache
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      cache = parsed && typeof parsed.nodes === 'object' ? parsed : emptyStore()
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`cannot read talent tree data at ${file}: ${error.message}`)
      cache = emptyStore()
    }
    return cache
  }
  return {
    read: () => chain.then(load),
    update(change) {
      const run = chain.then(async () => {
        const next = change(await load())
        await mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(next, null, 1), 'utf8')
        await rename(tmp, file)
        cache = next
        return next
      })
      chain = run.catch(() => {})
      return run
    },
  }
}
