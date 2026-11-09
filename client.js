/**
 * Browser half of the learning talent tree.
 *
 * - A left-Sidebar panel entry "天赋树" (sidebar.panellist + main): every goal the
 *   learner has planned, with a full-size tree; actions start a new conversation.
 * - A right-Sidebar page type `techtree` for the current conversation.
 * - A composer-dock chip that shows progress and opens the right-Sidebar page.
 * Both trees are a pannable / zoomable canvas (drag, wheel, buttons, keyboard).
 * Data arrives through the Host `techtree` session projection (useProjection);
 * the left panel reads the last snapshot each goal was seen with, kept in
 * localStorage. Actions go through the composer, so the model does the work.
 */
window.__ModuleLoader__.load({
  id: 'dsh-talent-tree',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PLUGIN_ID = 'dsh-talent-tree'
    const KIND = 'techtree'
    const NS = 'techtree'
    const LIBRARY_KEY = 'dsh-talent-tree.library.v1'
    const LIBRARY_ROUTE = 'api/techtree/library'
    const LIBRARY_POLL_MS = 15000
    const EMPTY = []
    const REVIEW_DAYS = { 1: 3, 2: 7, 3: 21 }
    const NODE_W = 168
    const NODE_H = 60
    const GAP_X = 22
    const GAP_Y = 58
    const MIN_ZOOM = 0.3
    const MAX_ZOOM = 2

    const zh = {
      'type.label': '天赋树',
      'nav.label': '天赋树',
      'guide.title': '学习天赋树',
      'guide.description': '把一个知识点拆成前置知识，学会一个点亮一个',
      'page.title': '学习天赋树',
      'page.subtitle': '把想学的知识拆成前置知识点，学会一个点亮一个。',
      'goal.placeholder': '我想学会……（例如：拉格朗日中值定理）',
      'goal.submit': '生成',
      'goal.prompt': '我想学会「{goal}」。请用 techtree_plan 帮我生成学习天赋树，然后告诉我从哪里开始。',
      'empty.title': '还没有天赋树',
      'empty.body': '在上面输入你想学会的知识，AI 会把它拆成一个个前置知识点。通过讲解或小测验证明你会了，节点才会点亮。',
      'library.title': '我的天赋树',
      'library.empty': '还没有天赋树。在上面输入想学的知识，会新建一个对话帮你生成。',
      'library.note': '暂时连不上后台，显示的是上次同步的进度。',
      'library.updated': '更新于{time}',
      'time.now': '刚刚',
      'time.minutes': ' {n} 分钟前',
      'time.hours': ' {n} 小时前',
      'time.days': ' {n} 天前',
      'progress': '已点亮 {lit}/{total}',
      'frontier': '现在可以学：{n} 个',
      'state.lit': '已点亮',
      'state.available': '可以学',
      'state.locked': '未解锁',
      'level.1': '铜 · 了解',
      'level.2': '银 · 理解',
      'level.3': '金 · 会用',
      'medal.1': '铜',
      'medal.2': '银',
      'medal.3': '金',
      'flag.weak': '需加固',
      'flag.fading': '该复习了',
      'flag.goal': '目标',
      'type.concept': '概念',
      'type.theorem': '定理',
      'type.method': '方法',
      'type.proof_idea': '证明思路',
      'type.skill': '技能',
      'detail.prereqs': '前置知识',
      'detail.glossary': '符号说明',
      'detail.unlocks': '解锁',
      'detail.none': '无',
      'detail.minutes': '约 {n} 分钟',
      'detail.close': '关闭',
      'action.learn': '开始学习',
      'action.check': '检验我',
      'action.review': '复习',
      'action.refresh': '刷新',
      'action.continue': '继续学习',
      'prompt.learn': '我想学习「{name}」（{id}）。请先用直观的方式讲，再用提问引导我，不要一次讲完。',
      'prompt.check': '我觉得我掌握了「{name}」（{id}）。请让我先用自己的话解释，或者出一道题检验我，判断后再决定是否用 techtree_record 点亮。',
      'prompt.review': '帮我复习「{name}」（{id}）：先出一道题考我，再根据我的回答更新 techtree_record。',
      'prompt.refresh': '请用 techtree_view 刷新我的天赋树进度。',
      'prompt.resume': '请先用 techtree_view 打开我的「{goal}」天赋树（goal_id: {goalId}）。',
      'prompt.continue': '然后告诉我现在最适合学哪个知识点，并开始带我学。',
      'flag.recommended': '推荐',
      'action.route': '按路线学',
      'action.skip': '跳级挑战',
      'action.levelUp': '冲击下一级',
      'action.recommend': '定位推荐',
      'action.export': '导出图片',
      'detail.route': '学习路线 · {n} 步',
      'prompt.route': '我想学会「{name}」（{id}）。请按这个顺序一个个带我学：{route}。从第一个开始，每个先抛出它的钩子问题，学完一个就用 techtree_record 记录，再进入下一个。',
      'prompt.skip': '我想跳级挑战「{name}」（{id}）：我觉得不用按顺序学前置也能掌握它。请出一两道能同时检验它和关键前置的综合题考我；我答对了就点亮它和你确认我已经会的前置，答错就告诉我缺哪块，从那里开始学。',
      'toast.lit': '点亮「{name}」· {level}',
      'toast.unlocked': '解锁了 {n} 个新知识点：{names}',
      'toast.exported': '已导出图片',
      'toast.copied': '图片已复制到剪贴板',
      'toast.exportFailed': '导出失败，请重试',
      'sync.ok': '已同步',
      'sync.loading': '同步中…',
      'sync.offline': '未连上后台',
      'medal.summary': '铜 {b} · 银 {s} · 金 {g}',
      'export.footer': '学习天赋树 · DeepSeek Harness',
      'export.filename': '天赋树',
      'review.today': '今日待复习 {n}',
      'review.short': '待复习 {n}',
      'prompt.reviewBatch': '今天要复习这 {n} 个知识点：{list}。请一个一个来：先抛出它的钩子，再出一道题考我；等我回答后用 techtree_record 更新（答得好就刷新复习时间、去掉需加固标记，答得不好就降一级或标记需加固并当场补上），然后进入下一个。全部结束后告诉我今天的复习结果。',
      'chip.open': '打开天赋树',
      'legend.lit': '已点亮',
      'legend.available': '可以学',
      'legend.locked': '未解锁',
      'view.zoomIn': '放大',
      'view.zoomOut': '缩小',
      'view.fit': '适应窗口',
      'view.hint': '悬停看钩子 · 拖动平移 · 滚轮缩放 · 双击空白处复位',
    }
    const en = {
      'type.label': 'Talent tree',
      'nav.label': 'Talent tree',
      'guide.title': 'Learning talent tree',
      'guide.description': 'Break a topic into prerequisites and light them up as you learn',
      'page.title': 'Learning talent tree',
      'page.subtitle': 'Break what you want to learn into prerequisites and light them up one by one.',
      'goal.placeholder': 'I want to learn… (e.g. the mean value theorem)',
      'goal.submit': 'Plan',
      'goal.prompt': 'I want to learn "{goal}". Please use techtree_plan to build my learning talent tree, then tell me where to start.',
      'empty.title': 'No talent tree yet',
      'empty.body': 'Type what you want to learn above. The AI breaks it into prerequisite knowledge points. A point lights up only after you show you understand it.',
      'library.title': 'My talent trees',
      'library.empty': 'No talent trees yet. Type what you want to learn above and a new conversation will plan it.',
      'library.note': 'Cannot reach the Host right now; showing the last synced progress.',
      'library.updated': 'Updated {time}',
      'time.now': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
      'progress': '{lit}/{total} lit',
      'frontier': '{n} learnable now',
      'state.lit': 'Lit',
      'state.available': 'Learnable',
      'state.locked': 'Locked',
      'level.1': 'Bronze · knows',
      'level.2': 'Silver · understands',
      'level.3': 'Gold · applies',
      'medal.1': 'Bronze',
      'medal.2': 'Silver',
      'medal.3': 'Gold',
      'flag.weak': 'Needs work',
      'flag.fading': 'Review due',
      'flag.goal': 'Goal',
      'type.concept': 'Concept',
      'type.theorem': 'Theorem',
      'type.method': 'Method',
      'type.proof_idea': 'Proof idea',
      'type.skill': 'Skill',
      'detail.prereqs': 'Prerequisites',
      'detail.glossary': 'Symbols',
      'detail.unlocks': 'Unlocks',
      'detail.none': 'None',
      'detail.minutes': '~{n} min',
      'detail.close': 'Close',
      'action.learn': 'Learn',
      'action.check': 'Test me',
      'action.review': 'Review',
      'action.refresh': 'Refresh',
      'action.continue': 'Continue',
      'prompt.learn': 'I want to learn "{name}" ({id}). Start with intuition, then guide me with questions rather than explaining everything at once.',
      'prompt.check': 'I think I understand "{name}" ({id}). Let me explain it in my own words or give me a question first, then decide with techtree_record whether to light it.',
      'prompt.review': 'Help me review "{name}" ({id}): quiz me first, then update techtree_record based on my answer.',
      'prompt.refresh': 'Please refresh my talent tree progress with techtree_view.',
      'prompt.resume': 'First open my "{goal}" talent tree with techtree_view (goal_id: {goalId}).',
      'prompt.continue': 'Then tell me which point is best to learn now and start teaching me.',
      'flag.recommended': 'Next',
      'action.route': 'Follow the route',
      'action.skip': 'Skip-ahead challenge',
      'action.levelUp': 'Go for next level',
      'action.recommend': 'Show recommended',
      'action.export': 'Export image',
      'detail.route': 'Route · {n} steps',
      'prompt.route': 'I want to learn "{name}" ({id}). Teach me in this order: {route}. Start with the first; open each with its hook question, record it with techtree_record when done, then move on.',
      'prompt.skip': 'Skip-ahead challenge for "{name}" ({id}): I think I can handle it without studying the prerequisites in order. Give me one or two integrated questions that test it and its key prerequisites; if I get them right, light it and the prerequisites you are sure I know; if not, tell me what is missing and start there.',
      'toast.lit': 'Lit "{name}" · {level}',
      'toast.unlocked': '{n} new points unlocked: {names}',
      'toast.exported': 'Image exported',
      'toast.copied': 'Image copied to clipboard',
      'toast.exportFailed': 'Export failed, try again',
      'sync.ok': 'Synced',
      'sync.loading': 'Syncing…',
      'sync.offline': 'Offline',
      'medal.summary': 'Bronze {b} · Silver {s} · Gold {g}',
      'export.footer': 'Learning talent tree · DeepSeek Harness',
      'export.filename': 'talent-tree',
      'review.today': '{n} to review today',
      'review.short': '{n} due',
      'prompt.reviewBatch': 'Today I need to review these {n} points: {list}. Go one at a time: open with its hook, then quiz me; after my answer update it with techtree_record (good answer: refresh the review time and clear the needs-work flag; weak answer: drop a level or mark it weak and fix the gap right away), then move on. Summarise today\'s review at the end.',
      'chip.open': 'Open talent tree',
      'legend.lit': 'Lit',
      'legend.available': 'Learnable',
      'legend.locked': 'Locked',
      'view.zoomIn': 'Zoom in',
      'view.zoomOut': 'Zoom out',
      'view.fit': 'Fit to view',
      'view.hint': 'Hover for the hook · drag to pan · wheel to zoom · double-click to reset',
    }

    const STYLE = `
.tt-scope{--tt-fg:var(--dsw-alias-label-primary,#1f2329);--tt-fg2:var(--dsw-alias-label-secondary,#5f6672);--tt-fg3:var(--dsw-alias-label-tertiary,#8f959e);--tt-line:var(--dsw-alias-border-l2,rgba(128,128,128,.28));--tt-line-soft:var(--dsw-alias-border-l1,rgba(128,128,128,.16));--tt-bg:var(--dsw-alias-bg-layer-1,#fff);--tt-bg2:var(--dsw-alias-bg-layer-2,#f4f5f7);--tt-hover:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));--tt-brand:var(--dsw-alias-brand-primary,#4d6bfe);--tt-warn:var(--dsw-alias-state-warn-primary,#f08a24);--tt-bronze:#c8834c;--tt-silver:#93a4bd;--tt-gold:#eeb031;color:var(--tt-fg);font-size:13px;line-height:1.45;box-sizing:border-box}
.tt-scope *,.tt-scope *::before,.tt-scope *::after{box-sizing:border-box}
.tt-root{height:100%;display:flex;flex-direction:column;gap:12px;padding:12px 14px 14px;overflow:hidden}
.tt-form{display:flex;gap:8px;align-items:center;flex:none}
.tt-input-wrap{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;border-radius:12px;border:1px solid var(--tt-line);background:var(--tt-bg);transition:border-color .15s,box-shadow .15s}
.tt-input-wrap:focus-within{border-color:var(--tt-brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--tt-brand) 16%,transparent)}
.tt-input-wrap svg{flex:none;color:var(--tt-brand)}
.tt-input{flex:1;min-width:0;height:100%;border:none;background:transparent;color:var(--tt-fg);font:inherit;outline:none}
.tt-input::placeholder{color:var(--tt-fg3)}
.tt-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border-radius:10px;border:1px solid var(--tt-line);background:var(--tt-bg);color:var(--tt-fg);font:inherit;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .15s,transform .1s,box-shadow .15s}
.tt-btn:hover{background:var(--tt-hover)}
.tt-btn:active{transform:translateY(1px)}
.tt-btn:disabled{opacity:.45;cursor:default;transform:none}
.tt-btn-primary{border-color:transparent;color:#fff;background:linear-gradient(135deg,var(--tt-brand),color-mix(in srgb,var(--tt-brand) 70%,#8b5cf6));box-shadow:0 4px 12px -4px color-mix(in srgb,var(--tt-brand) 60%,transparent)}
.tt-btn-primary:hover{background:linear-gradient(135deg,color-mix(in srgb,var(--tt-brand) 88%,#000),color-mix(in srgb,var(--tt-brand) 62%,#8b5cf6))}
.tt-form .tt-btn{height:38px;border-radius:12px;padding:0 18px}
.tt-icon-btn{display:inline-grid;place-items:center;width:30px;height:30px;padding:0;border-radius:9px;border:none;background:transparent;color:var(--tt-fg2);cursor:pointer}
.tt-icon-btn:hover{background:var(--tt-hover);color:var(--tt-fg)}
.tt-hero{display:flex;align-items:center;gap:12px;flex:none;min-width:0}
.tt-ring{flex:none;position:relative;width:52px;height:52px}
.tt-ring svg{display:block;transform:rotate(-90deg)}
.tt-ring b{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.tt-ring circle{transition:stroke-dashoffset .6s ease}
.tt-hero-text{flex:1;min-width:0}
.tt-goal{font-size:16px;font-weight:700;letter-spacing:.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:2px;color:var(--tt-fg2);font-size:12px}
.tt-medals{display:inline-flex;gap:6px}
.tt-medal{display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums}
.tt-medal i{width:9px;height:9px;border-radius:50%;display:inline-block}
.tt-stage{position:relative;flex:1;min-height:300px;border-radius:16px;border:1px solid var(--tt-line-soft);overflow:hidden;background:color-mix(in srgb,var(--tt-bg2) 70%,var(--tt-bg))}
.tt-viewport{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;outline:none;background-image:radial-gradient(circle,color-mix(in srgb,var(--tt-fg3) 32%,transparent) 1px,transparent 1.4px)}
.tt-viewport:focus-visible{box-shadow:inset 0 0 0 2px var(--tt-brand)}
.tt-viewport.tt-dragging{cursor:grabbing}
.tt-viewport,.tt-overlay:not(.tt-card),.tt-node{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
html.tt-grabbing,html.tt-grabbing *{-webkit-user-select:none!important;user-select:none!important;cursor:grabbing!important}
.tt-viewport.tt-dragging .tt-node{pointer-events:none}
.tt-canvas{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.tt-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}
.tt-edge{fill:none;transition:opacity .2s}
.tt-edge-locked{stroke:var(--tt-fg3);stroke-opacity:.45;stroke-width:1.5;stroke-dasharray:3 6}
.tt-edge-flow{stroke:var(--tt-brand);stroke-width:2.2;stroke-dasharray:7 7;animation:tt-flow 1.1s linear infinite}
.tt-edge-lit{stroke-width:2.8}
.tt-edge-dim{opacity:.12}
@keyframes tt-flow{to{stroke-dashoffset:-28}}
.tt-node{position:absolute;width:${NODE_W}px;height:${NODE_H}px;display:flex;align-items:center;gap:10px;padding:8px 12px 8px 9px;border-radius:15px;border:1.5px solid var(--tt-line);background:var(--tt-bg);color:inherit;font:inherit;text-align:left;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.06);transition:transform .16s,box-shadow .2s,opacity .2s,border-color .2s}
.tt-node:hover{transform:translateY(-2px);box-shadow:0 8px 20px -10px rgba(0,0,0,.35)}
.tt-node:focus-visible{outline:2px solid var(--tt-brand);outline-offset:3px}
.tt-badge{flex:none;position:relative;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--tt-bg2);color:var(--tt-fg3)}
.tt-node-text{display:flex;flex-direction:column;min-width:0;flex:1}
.tt-node-name{font-weight:650;font-size:12.5px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.tt-node-sub{font-size:11px;color:var(--tt-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.tt-locked{opacity:.74;background:color-mix(in srgb,var(--tt-bg) 70%,var(--tt-bg2))}
.tt-locked .tt-node-name{color:var(--tt-fg2)}
.tt-available{border-style:dashed;border-color:var(--tt-brand);background:color-mix(in srgb,var(--tt-brand) 6%,var(--tt-bg))}
.tt-badge-available{color:var(--tt-brand);background:color-mix(in srgb,var(--tt-brand) 12%,var(--tt-bg));animation:tt-pulse 2.2s ease-in-out infinite}
.tt-lit-1,.tt-m-1{--tt-m:var(--tt-bronze)}
.tt-lit-2,.tt-m-2{--tt-m:var(--tt-silver)}
.tt-lit-3,.tt-m-3{--tt-m:var(--tt-gold)}
.tt-badge-lit{color:#fff;background:radial-gradient(circle at 32% 28%,color-mix(in srgb,var(--tt-m) 45%,#fff),var(--tt-m) 62%,color-mix(in srgb,var(--tt-m) 70%,#000));box-shadow:0 0 12px color-mix(in srgb,var(--tt-m) 70%,transparent)}
.tt-badge-goal{color:#8a5a00;background:color-mix(in srgb,var(--tt-gold) 22%,var(--tt-bg))}
.tt-lit-1,.tt-lit-2,.tt-lit-3{border-color:var(--tt-m);background:linear-gradient(135deg,color-mix(in srgb,var(--tt-m) 22%,var(--tt-bg)),var(--tt-bg) 72%);box-shadow:0 0 0 3px color-mix(in srgb,var(--tt-m) 16%,transparent),0 8px 22px -10px var(--tt-m)}
.tt-lit-1 .tt-node-sub,.tt-lit-2 .tt-node-sub,.tt-lit-3 .tt-node-sub{color:color-mix(in srgb,var(--tt-m) 75%,var(--tt-fg))}
.tt-lit-3::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.45) 50%,transparent 65%);background-size:250% 100%;animation:tt-shine 4.5s ease-in-out infinite}
.tt-fading{filter:saturate(.45);box-shadow:none}
.tt-weak{border-color:var(--tt-warn);border-style:solid}
.tt-dot{position:absolute;right:-2px;top:-2px;width:11px;height:11px;border-radius:50%;border:2px solid var(--tt-bg)}
.tt-dot-weak{background:var(--tt-warn)}
.tt-dot-fading{background:var(--tt-fg3)}
.tt-goal-node{border-width:2px;box-shadow:0 0 0 4px color-mix(in srgb,var(--tt-gold) 20%,transparent),0 10px 26px -12px var(--tt-gold)}
.tt-goal-tag{position:absolute;top:-10px;right:12px;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:700;color:#5b3a00;background:linear-gradient(135deg,#ffd76a,var(--tt-gold));box-shadow:0 2px 6px -2px var(--tt-gold);letter-spacing:.5px}
.tt-selected{outline:2px solid var(--tt-brand);outline-offset:3px}
.tt-dim{opacity:.18}
@keyframes tt-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--tt-brand) 35%,transparent)}50%{box-shadow:0 0 0 6px transparent}}
@keyframes tt-shine{0%,60%{background-position:120% 0}100%{background-position:-120% 0}}
@media (prefers-reduced-motion:reduce){.tt-badge-available,.tt-edge-flow,.tt-lit-3::after{animation:none}.tt-node,.tt-ring circle{transition:none}}
.tt-overlay{position:absolute;display:flex;gap:6px;align-items:center;pointer-events:none}
.tt-overlay>*{pointer-events:auto}
.tt-legend{left:10px;top:10px;flex-wrap:wrap}
.tt-pill{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;font-size:11px;color:var(--tt-fg2);background:color-mix(in srgb,var(--tt-bg) 88%,transparent);border:1px solid var(--tt-line-soft);backdrop-filter:blur(6px)}
.tt-pill i{width:8px;height:8px;border-radius:50%;display:inline-block}
.tt-zoom{right:10px;top:10px;gap:0;padding:3px;border-radius:12px;background:color-mix(in srgb,var(--tt-bg) 90%,transparent);border:1px solid var(--tt-line-soft);box-shadow:0 4px 14px -8px rgba(0,0,0,.3);backdrop-filter:blur(6px)}
.tt-zoom .tt-icon-btn{width:28px;height:28px}
.tt-zoom-val{min-width:44px;text-align:center;font-size:11px;color:var(--tt-fg2);font-variant-numeric:tabular-nums}
.tt-hint{left:50%;bottom:10px;transform:translateX(-50%);font-size:11px;color:var(--tt-fg3);white-space:nowrap}
.tt-card{position:absolute;left:10px;right:10px;bottom:10px;max-width:440px;margin:0 auto;padding:14px 14px 12px;border-radius:16px;border:1px solid var(--tt-line-soft);background:color-mix(in srgb,var(--tt-bg) 94%,transparent);backdrop-filter:blur(12px);box-shadow:0 18px 40px -18px rgba(0,0,0,.45);animation:tt-rise .18s ease-out;cursor:auto}
@keyframes tt-rise{from{opacity:0;transform:translateY(8px)}}
.tt-card-head{display:flex;align-items:center;gap:10px}
.tt-card-head .tt-badge{width:30px;height:30px}
.tt-card-title{flex:1;min-width:0;font-size:15px;font-weight:700}
.tt-tags{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 6px}
.tt-tag{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--tt-bg2);color:var(--tt-fg2)}
.tt-tag-warn{background:color-mix(in srgb,var(--tt-warn) 16%,var(--tt-bg));color:color-mix(in srgb,var(--tt-warn) 70%,var(--tt-fg))}
.tt-tag-medal{color:#fff;background:var(--tt-m)}
.tt-card p{margin:6px 0 8px;color:var(--tt-fg2)}
.tt-links{display:flex;flex-wrap:wrap;align-items:center;gap:5px;font-size:12px;color:var(--tt-fg3);margin:5px 0}
.tt-links>span:first-child{margin-right:2px}
.tt-link{border:1px solid var(--tt-line-soft);background:var(--tt-bg);border-radius:999px;padding:1px 9px;font:inherit;font-size:12px;color:var(--tt-fg);cursor:pointer}
.tt-link:hover{border-color:var(--tt-brand);color:var(--tt-brand)}
.tt-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.tt-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:28px 18px;color:var(--tt-fg2);border-radius:16px;border:1px dashed var(--tt-line);background:color-mix(in srgb,var(--tt-bg2) 60%,var(--tt-bg))}
.tt-empty b{color:var(--tt-fg);font-size:15px}
.tt-empty-icon{width:68px;height:68px;border-radius:50%;display:grid;place-items:center;color:var(--tt-brand);background:radial-gradient(circle,color-mix(in srgb,var(--tt-brand) 18%,transparent),transparent 70%)}
.tt-empty p{margin:0;max-width:340px}
.tt-chip{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 11px 0 6px;margin:4px 0;border-radius:999px;border:1px solid var(--tt-line);background:var(--tt-bg);color:var(--tt-fg2);font:inherit;font-size:12px;cursor:pointer;max-width:100%;transition:border-color .15s,color .15s}
.tt-chip:hover{border-color:var(--tt-brand);color:var(--tt-fg)}
.tt-chip>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-page{height:100%;display:grid;grid-template-columns:280px minmax(0,1fr);overflow:hidden}
.tt-aside{display:flex;flex-direction:column;gap:14px;padding:22px 16px 16px 22px;border-right:1px solid var(--tt-line-soft);overflow:auto}
.tt-page-title{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:750}
.tt-page-title span{display:grid;place-items:center;width:30px;height:30px;color:var(--tt-fg)}
.tt-page-sub{margin:-6px 0 0;color:var(--tt-fg2);font-size:12.5px}
.tt-aside .tt-form{flex-direction:column;align-items:stretch}
.tt-aside .tt-input-wrap{flex:none}
.tt-section{font-size:12px;font-weight:600;color:var(--tt-fg3);margin-top:4px}
.tt-lib{display:flex;flex-direction:column;gap:6px}
.tt-lib-item{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:12px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.tt-lib-item:hover{background:var(--tt-hover)}
.tt-lib-item[aria-current="true"]{border-color:color-mix(in srgb,var(--tt-brand) 35%,transparent);background:color-mix(in srgb,var(--tt-brand) 8%,var(--tt-bg))}
.tt-lib-name{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-lib-row{display:flex;justify-content:space-between;font-size:11px;color:var(--tt-fg3)}
.tt-bar{height:5px;border-radius:3px;background:var(--tt-bg2);overflow:hidden}
.tt-bar>i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--tt-bronze),var(--tt-gold))}
.tt-note{font-size:11px;color:var(--tt-fg3)}
.tt-main{display:flex;flex-direction:column;gap:12px;padding:18px 20px 20px;min-width:0;overflow:hidden}
@media (max-width:760px){.tt-page{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.tt-aside{border-right:none;border-bottom:1px solid var(--tt-line-soft);max-height:42%}}
.tt-step{position:absolute;left:-9px;top:-9px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;display:grid;place-items:center;font-size:11px;font-weight:800;color:#fff;background:var(--tt-brand);border:2px solid var(--tt-bg);box-shadow:0 2px 6px -1px color-mix(in srgb,var(--tt-brand) 60%,transparent);z-index:2}
.tt-on-route{border-color:var(--tt-brand);border-style:solid;box-shadow:0 0 0 3px color-mix(in srgb,var(--tt-brand) 22%,transparent)}
.tt-on-route.tt-locked{opacity:.96}
.tt-edge-route{stroke:var(--tt-brand)!important;stroke-width:3;stroke-dasharray:none;stroke-opacity:1;animation:none}
.tt-rec{position:absolute;left:50%;top:-22px;transform:translateX(-50%);display:flex;align-items:center;gap:3px;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:700;color:#fff;background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 3px 8px -3px #16a34a;white-space:nowrap;animation:tt-bob 1.6s ease-in-out infinite;z-index:2}
.tt-rec i{font-style:normal;font-size:8px}
@keyframes tt-bob{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,-4px)}}
.tt-celebrate{animation:tt-pop .7s cubic-bezier(.2,1.6,.4,1);z-index:3}
.tt-celebrate::before{content:"";position:absolute;inset:-6px;border-radius:20px;border:3px solid var(--tt-m,var(--tt-gold));animation:tt-ring 1.1s ease-out forwards;pointer-events:none}
@keyframes tt-pop{0%{transform:scale(.6)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes tt-ring{from{opacity:.9;transform:scale(.92)}to{opacity:0;transform:scale(1.5)}}
.tt-burst{position:absolute;left:26px;top:50%;width:0;height:0;pointer-events:none}
.tt-burst i{position:absolute;width:6px;height:6px;margin:-3px;border-radius:50%;background:var(--tt-m,var(--tt-gold));box-shadow:0 0 6px var(--tt-m,var(--tt-gold));opacity:0;animation:tt-spark 1s ease-out forwards}
@keyframes tt-spark{0%{opacity:1;transform:rotate(var(--a)) translateX(6px) scale(1)}100%{opacity:0;transform:rotate(var(--a)) translateX(70px) scale(.3)}}
.tt-edge-ignite{stroke-dasharray:420;stroke-dashoffset:420;animation:tt-draw 1.2s ease-out .25s forwards}
@keyframes tt-draw{to{stroke-dashoffset:0}}
.tt-bubble{position:absolute;transform-origin:50% 100%;max-width:240px;width:max-content;padding:7px 11px;border-radius:12px;font-size:12px;line-height:1.45;color:var(--tt-fg);background:var(--tt-bg);border:1px solid color-mix(in srgb,var(--tt-gold) 60%,var(--tt-line));box-shadow:0 10px 24px -12px rgba(0,0,0,.45);pointer-events:none;z-index:5;animation:tt-fade .18s ease-out}
.tt-bubble::after{content:"";position:absolute;left:50%;bottom:-6px;width:10px;height:10px;margin-left:-5px;background:inherit;border-right:inherit;border-bottom:inherit;transform:rotate(45deg)}
.tt-bubble b{margin-right:4px;font-weight:400}
.tt-bubble-below{transform-origin:50% 0}
.tt-bubble-below::after{bottom:auto;top:-6px;border:none;border-left:inherit;border-top:inherit}
@keyframes tt-fade{from{opacity:0}}
.tt-hook{display:flex;gap:8px;margin:10px 0 2px;padding:9px 11px;border-radius:12px;font-size:13px;line-height:1.5;font-weight:500;color:var(--tt-fg);background:linear-gradient(135deg,color-mix(in srgb,var(--tt-gold) 16%,var(--tt-bg)),color-mix(in srgb,var(--tt-brand) 8%,var(--tt-bg)));border:1px solid color-mix(in srgb,var(--tt-gold) 35%,transparent)}
.tt-route{margin:8px 0;padding:8px 10px;border-radius:12px;background:color-mix(in srgb,var(--tt-brand) 6%,var(--tt-bg));border:1px solid color-mix(in srgb,var(--tt-brand) 20%,transparent)}
.tt-route-title{font-size:12px;font-weight:650;color:var(--tt-brand);margin-bottom:6px}
.tt-route-list{display:flex;flex-wrap:wrap;gap:6px}
.tt-route-step{display:inline-flex;align-items:center;gap:5px;padding:2px 9px 2px 3px;border-radius:999px;border:1px solid var(--tt-line-soft);background:var(--tt-bg);font:inherit;font-size:12px;color:var(--tt-fg);cursor:pointer}
.tt-route-step b{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;font-size:10.5px;color:#fff;background:var(--tt-brand)}
.tt-route-step:hover{border-color:var(--tt-brand)}
.tt-btn-skip{border-color:color-mix(in srgb,#f59e0b 55%,transparent);color:color-mix(in srgb,#d97706 85%,var(--tt-fg));background:color-mix(in srgb,#f59e0b 10%,var(--tt-bg))}
.tt-btn-skip:hover{background:color-mix(in srgb,#f59e0b 18%,var(--tt-bg))}
.tt-toasts{left:50%;top:48px;transform:translateX(-50%);flex-direction:column;gap:6px;align-items:center;z-index:6}
.tt-toast{display:flex;align-items:center;gap:7px;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:600;color:#fff;background:linear-gradient(135deg,#1f2937,#374151);box-shadow:0 10px 24px -10px rgba(0,0,0,.5);animation:tt-toast .35s cubic-bezier(.2,1.4,.4,1);white-space:nowrap}
.tt-toast-lit{background:linear-gradient(135deg,#d08a2c,#eeb031);color:#3b2600}
.tt-toast-unlock{background:linear-gradient(135deg,var(--tt-brand),#8b5cf6)}
@keyframes tt-toast{from{opacity:0;transform:translateY(-8px) scale(.9)}}
.tt-zoom-sep{width:1px;height:18px;margin:0 3px;background:var(--tt-line)}
.tt-section{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tt-sync{display:inline-flex;align-items:center;gap:5px;border:none;background:none;padding:2px 6px;border-radius:6px;font:inherit;font-size:11px;font-weight:400;color:var(--tt-fg3);cursor:pointer}
.tt-sync:hover{background:var(--tt-hover)}
.tt-sync i{width:7px;height:7px;border-radius:50%;background:var(--tt-fg3)}
.tt-sync-ok i{background:#22c55e}
.tt-sync-offline i{background:var(--tt-warn)}
.tt-sync-loading i{animation:tt-blink 1s infinite}
@keyframes tt-blink{50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){.tt-rec,.tt-celebrate,.tt-celebrate::before,.tt-burst i,.tt-toast,.tt-edge-ignite,.tt-bubble{animation:none}.tt-burst{display:none}.tt-edge-ignite{stroke-dasharray:none;stroke-dashoffset:0}}
.tt-rich{white-space:normal}
.tt-glossary{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;align-items:baseline;margin:2px 0 8px;padding:9px 11px;border-radius:12px;background:var(--tt-bg2);font-size:12.5px;line-height:1.5}
.tt-glossary-title{grid-column:1/-1;font-size:11.5px;font-weight:650;color:var(--tt-fg3)}
.tt-gloss-row{display:contents}
.tt-gloss-term{font-weight:650;color:var(--tt-fg);white-space:nowrap}
.tt-gloss-meaning{color:var(--tt-fg2)}
.tt-bubble-gloss{display:grid;grid-template-columns:auto 1fr;gap:3px 8px;align-items:baseline;margin-top:6px;padding-top:6px;border-top:1px dashed var(--tt-line);font-size:11.5px;color:var(--tt-fg2)}
.tt-card p{color:var(--tt-fg)}
.tt-rich sub,.tt-rich sup,.tt-tex-lite sub,.tt-tex-lite sup{font-size:.72em;line-height:0}
.tt-tex-lite{font-family:"Latin Modern Math","Cambria Math","STIX Two Math","Times New Roman",serif;font-style:italic;white-space:nowrap}
.tt-frac{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 .12em;font-size:.86em;line-height:1.1;font-style:normal}
.tt-frac>span:first-child{border-bottom:1px solid currentColor;padding:0 .15em}
.tt-frac>span:last-child{padding:0 .15em}
.tt-sqrt{display:inline-block;position:relative;white-space:nowrap;padding:.05em .1em 0 .62em;margin-left:.06em;border-top:1px solid currentColor;line-height:1.12;vertical-align:baseline}
.tt-sqrt::before{content:"";position:absolute;left:0;top:-1px;bottom:-.12em;width:.6em;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 24' preserveAspectRatio='none'%3E%3Cpath d='M.6 14.2 3.4 12.6 6.6 23.2 11.6.6H12' fill='none' stroke='%23000' stroke-width='1.3'/%3E%3C/svg%3E") no-repeat 0 0/100% 100%;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 24' preserveAspectRatio='none'%3E%3Cpath d='M.6 14.2 3.4 12.6 6.6 23.2 11.6.6H12' fill='none' stroke='%23000' stroke-width='1.3'/%3E%3C/svg%3E") no-repeat 0 0/100% 100%}
.tt-sqrt-index{position:absolute;left:-.1em;top:-.35em;font-size:.55em}
.tt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tt-tex{display:inline}
.tt-tex>div{display:inline!important;color:inherit!important;font-size:inherit!important;line-height:inherit!important;margin:0!important;padding:0!important}
.tt-tex>div>*{display:inline!important;margin:0!important;padding:0!important;color:inherit!important;font-size:inherit!important}
.tt-tex .katex{font-size:1.08em}
.tt-node-name .tt-tex .katex{font-size:1em}
.tt-shape-concept{border-radius:15px}
.tt-shape-theorem{border-radius:5px;border-width:2px}
.tt-shape-method{border-radius:15px;border-left-width:5px;padding-left:6px}
.tt-shape-proof_idea{border-radius:22px 5px 22px 5px}
.tt-shape-skill{border-radius:999px;padding-left:8px}
.tt-goal-node{scale:1.1;z-index:1}
.tt-badge-icon{display:grid;place-items:center}
.tt-bshape-theorem{border-radius:9px}
.tt-bshape-method{width:29px;height:29px;margin:0 2px;border-radius:7px;transform:rotate(45deg)}
.tt-bshape-method>.tt-badge-icon{transform:rotate(-45deg)}
.tt-bshape-method>.tt-dot{transform:rotate(-45deg)}
.tt-bshape-proof_idea{border-radius:50% 5px 50% 5px}
.tt-bshape-skill{border-radius:50% 50% 50% 50%/32% 32% 68% 68%}
.tt-legend{flex-direction:column;align-items:flex-start;gap:5px}
.tt-legend-row{display:flex;flex-wrap:wrap;gap:6px}
.tt-mini{display:inline-block;width:11px;height:11px;border:1.5px solid var(--tt-fg3);background:var(--tt-bg2);border-radius:50%}
.tt-mini.tt-bshape-method{width:9px;height:9px;margin:0 1px;border-radius:2px}
.tt-mini.tt-bshape-theorem{border-radius:3px}
.tt-dot-fading{background:#f59e0b}
.tt-review{display:inline-flex;align-items:center;gap:6px;flex:none;height:30px;padding:0 12px;border-radius:999px;border:1px solid color-mix(in srgb,#f59e0b 55%,transparent);background:color-mix(in srgb,#f59e0b 12%,var(--tt-bg));color:color-mix(in srgb,#b45309 85%,var(--tt-fg));font:inherit;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap;animation:tt-nudge 3s ease-in-out infinite}
.tt-review:hover{background:color-mix(in srgb,#f59e0b 20%,var(--tt-bg))}
@keyframes tt-nudge{0%,88%,100%{transform:none}92%{transform:rotate(-3deg)}96%{transform:rotate(3deg)}}
.tt-chip-due{flex:none;margin-left:2px;padding:0 7px;border-radius:999px;font-size:10.5px;font-weight:700;line-height:18px;color:#92400e;background:#fde68a}
.tt-lib-name{display:flex;align-items:center;justify-content:space-between;gap:6px}
.tt-lib-name>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.tt-review{animation:none}}
`

    function Style() {
      return h('style', null, STYLE)
    }

    // ---- icons --------------------------------------------------------------

    function svg(size, children, extra) {
      return h('svg', Object.assign({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, extra), ...children)
    }

    /** Skill-tree glyph: a lit path (bronze → silver → gold star) and a still-open branch. */
    function TreeIcon(props) {
      const size = props && props.size ? props.size : 16
      return svg(size, [
        h('path', { key: 'o', d: 'M12 19.8 16.35 14.51M16.33 10.52 12 5.4', stroke: 'var(--dsw-alias-label-tertiary, #a3a8b0)', strokeWidth: 1.5 }),
        h('path', { key: 'l', d: 'M12 19.8 6 12.5 12 5.4', strokeWidth: 1.6 }),
        h('circle', { key: 'a', cx: 6, cy: 12.5, r: 2.1, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 'b', cx: 18, cy: 12.5, r: 1.9, strokeWidth: 1.4 }),
        h('circle', { key: 'c', cx: 12, cy: 19.8, r: 2.1, fill: 'currentColor', stroke: 'none' }),
        h('path', { key: 'd', d: 'M12.00 1.50 L12.97 4.07 L15.71 4.19 L13.57 5.91 L14.29 8.56 L12.00 7.05 L9.71 8.56 L10.43 5.91 L8.29 4.19 L11.03 4.07Z', fill: 'currentColor', stroke: 'none' }),
      ], { className: props && props.className })
    }
    const LockIcon = () => svg(15, [h('rect', { key: 'r', x: 5, y: 11, width: 14, height: 9, rx: 2 }), h('path', { key: 'p', d: 'M8 11V8a4 4 0 0 1 8 0v3' })])
    const SparkIcon = ({ size }) => svg(size || 16, [h('path', { key: 'p', d: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18' })])
    const StarIcon = () => svg(16, [h('path', { key: 'p', d: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z', fill: 'currentColor', stroke: 'none' })])
    const FlagIcon = () => svg(16, [h('path', { key: 'p', d: 'M5 21V4M5 4h11l-2 4 2 4H5' })])
    const PlusIcon = () => svg(15, [h('path', { key: 'p', d: 'M12 5v14M5 12h14' })])
    const MinusIcon = () => svg(15, [h('path', { key: 'p', d: 'M5 12h14' })])
    const FitIcon = () => svg(15, [h('path', { key: 'p', d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' })])
    const CloseIcon = () => svg(15, [h('path', { key: 'p', d: 'M6 6l12 12M18 6 6 18' })])
    const TargetIcon = () => svg(15, [h('circle', { key: 'a', cx: 12, cy: 12, r: 7 }), h('circle', { key: 'b', cx: 12, cy: 12, r: 2.5, fill: 'currentColor' }), h('path', { key: 'c', d: 'M12 2v3M12 19v3M2 12h3M19 12h3' })])
    const DownloadIcon = () => svg(15, [h('path', { key: 'p', d: 'M12 4v11M7 10l5 5 5-5M5 20h14' })])
    const BoltIcon = () => svg(14, [h('path', { key: 'p', d: 'M13 2 4 14h7l-1 8 9-12h-7z', fill: 'currentColor', stroke: 'none' })])
    const ClockIcon = () => svg(14, [h('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), h('path', { key: 'p', d: 'M12 7.5V12l3 2' })])
    const RefreshIcon = () => svg(15, [h('path', { key: 'p', d: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4' })])

    // ---- math ---------------------------------------------------------------
    // Text may carry TeX between $…$ (or \( … \)). The app's own Markdown
    // renderer typesets it with KaTeX when the shared primitives are present;
    // otherwise a small built-in renderer draws fractions, roots, sub/superscripts
    // and symbols. Plain text also gets light touches (√x, x_k, x^2) so older
    // Unicode formulas read as math too.

    const TEX_SYMBOLS = {
      alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
      iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
      phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
      Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥',
      geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞', sum: '∑', prod: '∏', int: '∫',
      oint: '∮', partial: '∂', nabla: '∇', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔',
      mapsto: '↦', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', forall: '∀', exists: '∃', emptyset: '∅',
      cdots: '⋯', ldots: '…', dots: '…', top: '⊤', perp: '⊥', angle: '∠', circ: '∘', star: '⋆', langle: '⟨', rangle: '⟩',
      lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', mid: '|', '|': '‖', quad: ' ', qquad: '  ', ',': ' ',
      ';': ' ', ' ': ' ', '{': '{', '}': '}', '%': '%', '$': '$', '#': '#', '&': '&', _: '_',
      lim: 'lim', log: 'log', ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan', max: 'max', min: 'min', det: 'det',
      arg: 'arg', sup: 'sup', inf: 'inf', Pr: 'Pr', E: 'E', Var: 'Var',
    }
    const TEX_SKIP = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'textstyle', 'limits', '!'])
    const TEX_TEXT = new Set(['text', 'mathrm', 'operatorname', 'mathit', 'mathbf', 'boldsymbol', 'textbf', 'mathsf', 'mathcal', 'mathbb', 'vec', 'hat', 'bar', 'overline', 'tilde', 'dot'])
    const BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', E: '𝔼', P: 'ℙ' }
    const ACCENT = { vec: '⃗', hat: '̂', bar: '̅', overline: '̅', tilde: '̃', dot: '̇' }
    const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', T: 'ᵀ', k: 'ᵏ', x: 'ˣ', '⊤': 'ᵀ', '′': '′' }
    const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' }

    /** Parse TeX into a small tree: strings, {frac}, {sqrt}, {sup}, {sub}, {accent}. */
    function parseTex(src) {
      let i = 0
      const group = () => {
        while (src[i] === ' ') i++
        if (src[i] === '{') {
          i++
          const out = seq('}')
          i++
          return out
        }
        if (src[i] === '\\') return seq(null, 1)
        const ch = src[i]
        i++
        return ch === undefined ? [] : [ch]
      }
      const seq = (end, limit) => {
        const out = []
        while (i < src.length && src[i] !== end && (limit === undefined || out.length < limit)) {
          const ch = src[i]
          if (ch === '\\') {
            const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i))
            const name = m ? m[1] : ''
            i += m ? m[0].length : 1
            if (name === 'frac' || name === 'dfrac' || name === 'tfrac') out.push({ frac: [group(), group()] })
            else if (name === 'sqrt') {
              let index = null
              if (src[i] === '[') { const close = src.indexOf(']', i); index = src.slice(i + 1, close); i = close + 1 }
              out.push({ sqrt: group(), index })
            } else if (name === 'mathbb') {
              const g = group()
              out.push(g.map(x => (typeof x === 'string' && BLACKBOARD[x] ? BLACKBOARD[x] : x)).join(''))
            } else if (ACCENT[name]) out.push({ accent: ACCENT[name], body: group() })
            else if (TEX_TEXT.has(name)) out.push(...group())
            else if (TEX_SKIP.has(name)) continue
            else if (TEX_SYMBOLS[name] !== undefined) out.push(TEX_SYMBOLS[name])
            else out.push(name)
          } else if (ch === '^' || ch === '_') {
            i++
            out.push({ [ch === '^' ? 'sup' : 'sub']: group() })
          } else if (ch === '{') {
            i++
            out.push(...seq('}'))
            i++
          } else {
            out.push(ch === "'" ? '′' : ch === '-' ? '−' : ch)
            i++
          }
        }
        return out
      }
      return seq(undefined)
    }

    /** TeX as Unicode text (for canvas export and plain fallbacks). */
    function texToUnicode(src) {
      const flat = list => list.map(one).join('')
      const script = (map, body, mark) => {
        const s = flat(body)
        return Array.from(s).every(c => map[c]) ? Array.from(s).map(c => map[c]).join('') : `${mark}${s.length > 1 ? `(${s})` : s}`
      }
      // A single token (x, 10, dₖ, √x, (a+b)) needs no parentheses around it.
      const atom = s => /^[\p{L}\p{N}.]+[\u2070-\u209f\u1d40-\u1d6a\u02e3\u2071\u207f\u2c7c′]*$/u.test(s) || /^√?\([^()]*\)$/u.test(s) || /^√[^\s/()+\-−=]+$/u.test(s)
      const wrap = s => (atom(s) ? s : `(${s})`)
      function one(x) {
        if (typeof x === 'string') return x
        if (x.frac) return `${wrap(flat(x.frac[0]))}/${wrap(flat(x.frac[1]))}`
        if (x.sqrt) return `${x.index ? script(SUP, [x.index], '^') : ''}√${wrap(flat(x.sqrt))}`
        if (x.sup) return script(SUP, x.sup, '^')
        if (x.sub) return script(SUB, x.sub, '_')
        if (x.accent) return flat(x.body) + x.accent
        return ''
      }
      return flat(parseTex(src))
    }

    function texToReact(src) {
      let k = 0
      const many = list => list.map(one)
      function one(x) {
        const key = k++
        if (typeof x === 'string') return x
        if (x.frac) return h('span', { key, className: 'tt-frac' }, h('span', null, many(x.frac[0])), h('span', null, many(x.frac[1])))
        if (x.sqrt) return h('span', { key, className: 'tt-sqrt' }, x.index ? h('span', { className: 'tt-sqrt-index' }, x.index) : null, h('span', { className: 'tt-sr' }, '√'), many(x.sqrt))
        if (x.sup) return h('sup', { key }, many(x.sup))
        if (x.sub) return h('sub', { key }, many(x.sub))
        if (x.accent) return h('span', { key }, many(x.body), x.accent)
        return null
      }
      return h('span', { className: 'tt-tex-lite' }, many(parseTex(src)))
    }

    /** Split text into plain and math parts: $…$, $$…$$ and \( … \). */
    function splitMath(text) {
      const parts = []
      const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g
      let last = 0
      let m
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index) })
        parts.push({ tex: (m[1] || m[2] || m[3]).trim() })
        last = re.lastIndex
      }
      if (last < text.length) parts.push({ text: text.slice(last) })
      return parts
    }

    /** Plain text with light math touches: √x gets a vinculum, x_k / x^2 become sub/superscripts. */
    function prettyPlain(text, keyBase) {
      const out = []
      const re = /√\(([^()]+)\)|√([A-Za-z0-9]+(?:_\{?[A-Za-z0-9]+\}?)?)|([A-Za-z0-9)\]])_\{([^{}]+)\}|([A-Za-z0-9)\]])_([A-Za-z0-9])(?![A-Za-z0-9])|([A-Za-z0-9)\]])\^\{([^{}]+)\}|([A-Za-z0-9)\]])\^([A-Za-z0-9]+)/g
      let last = 0
      let m
      let k = 0
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index))
        const key = `${keyBase}-${k++}`
        if (m[1] !== undefined || m[2] !== undefined) {
          const body = m[1] !== undefined ? m[1] : m[2]
          out.push(h('span', { key, className: 'tt-sqrt' }, h('span', { className: 'tt-sr' }, '√'), prettyPlain(body, key)))
        } else if (m[3] !== undefined) out.push(m[3], h('sub', { key }, m[4]))
        else if (m[5] !== undefined) out.push(m[5], h('sub', { key }, m[6]))
        else if (m[7] !== undefined) out.push(m[7], h('sup', { key }, m[8]))
        else out.push(m[9], h('sup', { key }, m[10]))
        last = re.lastIndex
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    /** The app's KaTeX-backed Markdown renderer, when the shared primitives module is available. */
    let MarkdownText = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      if (primitives && primitives.MarkdownText) MarkdownText = primitives.MarkdownText
    } catch {}
    const MD_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }

    /** Text with inline math. Formulas use KaTeX when available, otherwise the built-in renderer. */
    function Rich({ text }) {
      if (typeof text !== 'string' || text === '') return null
      return h('span', { className: 'tt-rich' }, splitMath(text).map((part, i) => {
        if (part.text !== undefined) return h(React.Fragment, { key: i }, prettyPlain(part.text, i))
        if (MarkdownText) return h('span', { key: i, className: 'tt-tex' }, h(MarkdownText, { text: `$${part.tex}$`, labels: MD_LABELS, variant: 'compact' }))
        return h(React.Fragment, { key: i }, texToReact(part.tex))
      }))
    }

    /** Plain-string form of rich text (aria labels, canvas export). */
    function richToPlain(text) {
      if (typeof text !== 'string') return ''
      return splitMath(text).map(p => (p.text !== undefined ? p.text : texToUnicode(p.tex))).join('')
    }

    // ---- pure helpers -------------------------------------------------------

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

    function stateOf(node, byId) {
      if (node.mastery >= 1) return 'lit'
      return node.prerequisites.every(p => byId[p] && byId[p].mastery >= 1) ? 'available' : 'locked'
    }

    function fading(node, now) {
      if (!(node.mastery >= 1) || node.reviewedAt === undefined) return false
      return now - node.reviewedAt > REVIEW_DAYS[node.mastery] * 86400000
    }

    /** Layered layout: foundations on top, goals at the bottom. */
    function layout(nodes) {
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
      const depth = {}
      const depthOf = id => {
        if (depth[id] !== undefined) return depth[id]
        depth[id] = 0 // cycle guard; the Host rejects cycles
        const pre = byId[id].prerequisites.filter(p => byId[p])
        depth[id] = pre.length ? 1 + Math.max(...pre.map(depthOf)) : 0
        return depth[id]
      }
      nodes.forEach(n => depthOf(n.id))
      const layers = []
      nodes.forEach(n => { (layers[depth[n.id]] = layers[depth[n.id]] || []).push(n.id) })
      // Barycenter passes, downward then upward, to reduce crossings.
      const pos = {}
      layers.forEach(layer => layer.forEach((id, i) => { pos[id] = i }))
      const children = {}
      nodes.forEach(n => n.prerequisites.forEach(p => { (children[p] = children[p] || []).push(n.id) }))
      for (let pass = 0; pass < 3; pass++) {
        for (let d = 1; d < layers.length; d++) {
          const bary = id => {
            const pre = byId[id].prerequisites.filter(p => pos[p] !== undefined)
            return pre.length ? pre.reduce((s, p) => s + pos[p], 0) / pre.length : pos[id]
          }
          layers[d].sort((a, b) => bary(a) - bary(b))
          layers[d].forEach((id, i) => { pos[id] = i })
        }
        for (let d = layers.length - 2; d >= 0; d--) {
          const bary = id => {
            const ch = (children[id] || []).filter(c => pos[c] !== undefined)
            return ch.length ? ch.reduce((s, c) => s + pos[c], 0) / ch.length : pos[id]
          }
          layers[d].sort((a, b) => bary(a) - bary(b))
          layers[d].forEach((id, i) => { pos[id] = i })
        }
      }
      const widest = Math.max(1, ...layers.map(l => l.length))
      const width = widest * NODE_W + (widest - 1) * GAP_X
      const coords = {}
      layers.forEach((layer, d) => {
        const rowW = layer.length * NODE_W + (layer.length - 1) * GAP_X
        const x0 = (width - rowW) / 2
        layer.forEach((id, i) => { coords[id] = { x: x0 + i * (NODE_W + GAP_X), y: d * (NODE_H + GAP_Y) } })
      })
      return { coords, width, height: Math.max(NODE_H, layers.length * NODE_H + (layers.length - 1) * GAP_Y) }
    }

    function related(nodes, id) {
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
      const set = new Set([id])
      const up = x => (byId[x] ? byId[x].prerequisites : []).forEach(p => { if (!set.has(p)) { set.add(p); up(p) } })
      const down = x => nodes.forEach(n => { if (n.prerequisites.includes(x) && !set.has(n.id)) { set.add(n.id); down(n.id) } })
      up(id)
      down(id)
      return set
    }

    /** The goal node and everything it depends on. */
    function closure(nodes, goalId) {
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
      const keep = new Set()
      const walk = id => {
        if (keep.has(id) || !byId[id]) return
        keep.add(id)
        byId[id].prerequisites.forEach(walk)
      }
      walk(goalId)
      return nodes.filter(n => keep.has(n.id))
    }

    function fill(template, values) {
      return template.replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? String(values[k]) : m))
    }

    function stats(nodes) {
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
      const medals = { 1: 0, 2: 0, 3: 0 }
      let lit = 0
      let frontier = 0
      nodes.forEach(n => {
        if (n.mastery >= 1) { lit++; medals[n.mastery] = (medals[n.mastery] || 0) + 1 }
        else if (stateOf(n, byId) === 'available') frontier++
      })
      return { lit, frontier, medals, total: nodes.length }
    }

    function ago(t, at, now) {
      const m = Math.round((now - at) / 60000)
      if (!(m >= 1)) return t('time.now')
      if (m < 60) return fill(t('time.minutes'), { n: m })
      if (m < 60 * 24) return fill(t('time.hours'), { n: Math.round(m / 60) })
      return fill(t('time.days'), { n: Math.round(m / 1440) })
    }

    /**
     * The unlit nodes standing between the learner and `targetId`, target
     * included, in a learnable order: each step's prerequisites are lit or come
     * earlier. Shallow foundations first.
     */
    function learningRoute(nodes, targetId) {
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
      if (!byId[targetId] || byId[targetId].mastery >= 1) return []
      const need = new Set()
      const walk = id => {
        const n = byId[id]
        if (!n || need.has(id) || n.mastery >= 1) return
        need.add(id)
        n.prerequisites.forEach(walk)
      }
      walk(targetId)
      const depth = {}
      const depthOf = id => {
        if (depth[id] !== undefined) return depth[id]
        depth[id] = 0
        const pre = byId[id].prerequisites.filter(p => need.has(p))
        depth[id] = pre.length ? 1 + Math.max(...pre.map(depthOf)) : 0
        return depth[id]
      }
      const order = nodes.map(n => n.id).filter(id => need.has(id))
      order.forEach(depthOf)
      const done = new Set()
      const out = []
      while (out.length < order.length) {
        const ready = order.filter(id => !done.has(id) && byId[id].prerequisites.every(p => !need.has(p) || done.has(p)))
        if (ready.length === 0) break // cycle guard; the Host rejects cycles
        ready.sort((a, b) => depth[a] - depth[b] || (byId[b].weak ? 1 : 0) - (byId[a].weak ? 1 : 0))
        done.add(ready[0])
        out.push(ready[0])
      }
      return out
    }

    /** The node to study next: the first step toward the first unfinished goal, else one due for review. */
    function recommend(nodes, goalIds) {
      const sinks = nodes.filter(n => !nodes.some(m => m.prerequisites.includes(n.id))).map(n => n.id)
      for (const id of goalIds.length ? goalIds : sinks) {
        const route = learningRoute(nodes, id)
        if (route.length) return route[0]
      }
      const now = Date.now()
      const due = nodes.find(n => fading(n, now))
      return due ? due.id : null
    }

    const NODE_TYPES = ['concept', 'theorem', 'method', 'proof_idea', 'skill']

    /** Today's review queue: points that need shoring up first, then lit points whose review is due (oldest first). */
    function reviewQueue(nodes, now) {
      return nodes
        .filter(n => n.weak || fading(n, now))
        .sort((a, b) => (b.weak ? 1 : 0) - (a.weak ? 1 : 0) || (a.reviewedAt || 0) - (b.reviewedAt || 0))
    }

    function reviewPrompt(t, due) {
      return fill(t('prompt.reviewBatch'), { list: due.map(n => `${richToPlain(n.name)}（${n.id}）`).join('、'), n: due.length })
    }

    // ---- export -------------------------------------------------------------

    const EXPORT_FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif'
    const EXPORT_MEDAL = ['', '#c8834c', '#93a4bd', '#eeb031']
    const EXPORT_TINT = ['', '#f7e9dc', '#e8eef6', '#fcf1d4']

    /** Card corner radii per knowledge type (matches the .tt-shape-* styles). */
    function exportRadii(type, h) {
      if (type === 'theorem') return 5
      if (type === 'proof_idea') return [22, 5, 22, 5]
      if (type === 'skill') return h / 2
      return 15
    }

    /** Badge outline per knowledge type (matches the .tt-bshape-* styles). */
    function exportBadgePath(c, type, x, y, r) {
      c.beginPath()
      if (type === 'theorem') c.roundRect(x - r, y - r, 2 * r, 2 * r, 9)
      else if (type === 'method') { const d = r * 1.2; c.moveTo(x, y - d); c.lineTo(x + d, y); c.lineTo(x, y + d); c.lineTo(x - d, y); c.closePath() }
      else if (type === 'proof_idea') c.roundRect(x - r, y - r, 2 * r, 2 * r, [r, 5, r, 5])
      else if (type === 'skill') c.roundRect(x - r, y - r, 2 * r, 2 * r, [r, r, r * 1.3, r * 1.3])
      else c.arc(x, y, r, 0, Math.PI * 2)
    }

    function fitText(c, text, max) {
      if (c.measureText(text).width <= max) return text
      let s = text
      while (s.length > 1 && c.measureText(s + '…').width > max) s = s.slice(0, -1)
      return s + '…'
    }

    function wrapText(c, text, max, lines) {
      const out = []
      let line = ''
      for (const ch of Array.from(text)) {
        if (c.measureText(line + ch).width > max && line) {
          out.push(line)
          line = ch
          if (out.length === lines) break
        } else line += ch
      }
      if (out.length < lines && line) out.push(line)
      if (out.length === lines && out.join('').length < text.length) out[lines - 1] = fitText(c, out[lines - 1] + '…', max)
      return out
    }

    /** Draw the whole tree on a canvas (light theme) and save it as PNG; also copies it when allowed. */
    async function exportPng(t, title, nodes, goalIds) {
      const { coords, width, height } = layout(nodes)
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
      const hooks = nodes.some(n => n.hook)
      const cardH = hooks ? NODE_H + 38 : NODE_H
      const rowH = NODE_H + GAP_Y
      const layers = Math.round((height - NODE_H) / rowH) + 1
      const pad = 48
      const headH = 104
      const footH = 46
      const contentH = layers * cardH + (layers - 1) * GAP_Y
      const W = Math.max(width + pad * 2, 640)
      const H = headH + contentH + footH + 24
      const ox = (W - width) / 2
      const pos = id => ({ x: ox + coords[id].x, y: headH + Math.round(coords[id].y / rowH) * (cardH + GAP_Y) })
      const scale = clamp(Math.min(2, 8000 / W, 8000 / H), 0.5, 2)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(W * scale)
      canvas.height = Math.round(H * scale)
      const c = canvas.getContext('2d')
      c.scale(scale, scale)
      c.fillStyle = '#f7f8fa'
      c.fillRect(0, 0, W, H)
      c.fillStyle = '#dfe3ea'
      for (let x = 11; x < W; x += 22) for (let y = headH - 10; y < H - footH; y += 22) { c.beginPath(); c.arc(x, y, 1, 0, Math.PI * 2); c.fill() }
      // Header
      const s = stats(nodes)
      c.textBaseline = 'alphabetic'
      c.fillStyle = '#1f2329'
      c.font = `700 24px ${EXPORT_FONT}`
      c.fillText(fitText(c, title, W - pad * 2), pad, 50)
      c.font = `400 13px ${EXPORT_FONT}`
      c.fillStyle = '#5f6672'
      const meta = `${fill(t('progress'), { lit: s.lit, total: s.total })}   ${fill(t('frontier'), { n: s.frontier })}   ${fill(t('medal.summary'), { b: s.medals[1], s: s.medals[2], g: s.medals[3] })}`
      c.fillText(meta, pad, 76)
      c.fillStyle = '#e6e8ec'
      c.beginPath(); c.roundRect(pad, 86, 220, 6, 3); c.fill()
      const grad = c.createLinearGradient(pad, 0, pad + 220, 0)
      grad.addColorStop(0, '#c8834c'); grad.addColorStop(1, '#eeb031')
      c.fillStyle = grad
      c.beginPath(); c.roundRect(pad, 86, Math.max(6, 220 * (s.total ? s.lit / s.total : 0)), 6, 3); c.fill()
      // Edges
      c.lineCap = 'round'
      nodes.forEach(n => n.prerequisites.forEach(p => {
        if (!byId[p]) return
        const a = pos(p)
        const b = pos(n.id)
        const x1 = a.x + NODE_W / 2
        const y1 = a.y + cardH
        const x2 = b.x + NODE_W / 2
        const y2 = b.y
        const my = (y1 + y2) / 2
        const fromLit = byId[p].mastery >= 1
        const toLit = n.mastery >= 1
        c.setLineDash(fromLit && toLit ? [] : fromLit ? [7, 7] : [3, 6])
        c.strokeStyle = fromLit && toLit ? EXPORT_MEDAL[Math.min(byId[p].mastery, n.mastery)] : fromLit ? '#4d6bfe' : '#b8bec8'
        c.lineWidth = fromLit && toLit ? 2.6 : fromLit ? 2.2 : 1.5
        c.beginPath(); c.moveTo(x1, y1); c.bezierCurveTo(x1, my, x2, my, x2, y2); c.stroke()
      }))
      c.setLineDash([])
      // Nodes
      nodes.forEach(n => {
        const { x, y } = pos(n.id)
        const state = stateOf(n, byId)
        const m = n.mastery || 0
        c.save()
        if (state === 'lit') { c.shadowColor = EXPORT_MEDAL[m]; c.shadowBlur = 14 }
        const radii = exportRadii(n.type, cardH)
        c.beginPath(); c.roundRect(x, y, NODE_W, cardH, radii)
        if (state === 'lit') {
          const g = c.createLinearGradient(x, y, x + NODE_W, y + cardH)
          g.addColorStop(0, EXPORT_TINT[m]); g.addColorStop(0.75, '#ffffff')
          c.fillStyle = g
        } else c.fillStyle = state === 'available' ? '#eef1ff' : '#f1f2f4'
        c.fill()
        c.restore()
        c.setLineDash(state === 'available' ? [5, 4] : [])
        c.lineWidth = goalIds.has(n.id) ? 2.4 : 1.5
        c.strokeStyle = n.weak ? '#f08a24' : state === 'lit' ? EXPORT_MEDAL[m] : state === 'available' ? '#4d6bfe' : '#d5d9df'
        c.lineWidth = n.type === 'theorem' ? Math.max(c.lineWidth, 2) : c.lineWidth
        c.beginPath(); c.roundRect(x, y, NODE_W, cardH, radii); c.stroke()
        if (n.type === 'method') {
          c.fillStyle = c.strokeStyle
          c.beginPath(); c.roundRect(x, y + 6, 5, cardH - 12, 2.5); c.fill()
        }
        c.setLineDash([])
        // Badge
        const bx = x + 26
        const by = y + NODE_H / 2
        c.fillStyle = state === 'lit' ? EXPORT_MEDAL[m] : state === 'available' ? '#dfe5ff' : '#e6e8ec'
        exportBadgePath(c, n.type, bx, by, 17); c.fill()
        c.fillStyle = state === 'lit' ? '#ffffff' : state === 'available' ? '#4d6bfe' : '#8f959e'
        c.font = `700 15px ${EXPORT_FONT}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText(state === 'lit' ? '★' : state === 'available' ? '✦' : goalIds.has(n.id) ? '⚑' : '•', bx, by + 1)
        c.textAlign = 'left'
        c.textBaseline = 'alphabetic'
        // Text
        const tx = x + 52
        const tw = NODE_W - 52 - 10
        c.fillStyle = state === 'locked' ? '#5f6672' : '#1f2329'
        c.font = `650 12.5px ${EXPORT_FONT}`
        const lines = wrapText(c, richToPlain(n.name), tw, 2)
        const top = y + NODE_H / 2 - (lines.length === 2 ? 12 : 4)
        lines.forEach((line, i) => c.fillText(line, tx, top + i * 15))
        c.font = `400 11px ${EXPORT_FONT}`
        c.fillStyle = state === 'lit' ? EXPORT_MEDAL[m] : '#8f959e'
        c.fillText(fitText(c, state === 'lit' ? t(`level.${m}`) : `${t(`type.${n.type}`)} · ${t(`state.${state}`)}`, tw), tx, top + lines.length * 15 + 1)
        if (hooks && n.hook) {
          c.fillStyle = state === 'locked' ? '#8f959e' : '#8a5a00'
          c.font = `400 10.5px ${EXPORT_FONT}`
          const hookLines = wrapText(c, `💡 ${richToPlain(n.hook)}`, NODE_W - 20, 2)
          hookLines.forEach((line, i) => c.fillText(line, x + 10, y + NODE_H + 4 + i * 14))
        }
        if (goalIds.has(n.id)) {
          c.font = `700 10.5px ${EXPORT_FONT}`
          const label = t('flag.goal')
          const lw = c.measureText(label).width + 16
          c.fillStyle = '#eeb031'
          c.beginPath(); c.roundRect(x + NODE_W - lw - 12, y - 9, lw, 18, 9); c.fill()
          c.fillStyle = '#5b3a00'
          c.fillText(label, x + NODE_W - lw - 4, y + 4)
        }
      })
      // Footer
      c.font = `400 12px ${EXPORT_FONT}`
      c.fillStyle = '#8f959e'
      c.fillText(`${t('export.footer')} · ${new Date().toLocaleDateString()}`, pad, H - 22)
      const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
      let copied = false
      try {
        if (navigator.clipboard && typeof ClipboardItem === 'function') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          copied = true
        }
      } catch {}
      try {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${t('export.filename')}-${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'tree'}.png`
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 15000)
        return 'downloaded'
      } catch (error) {
        if (copied) return 'copied'
        throw error
      }
    }

    // ---- goal library (left panel) -------------------------------------------
    // Every snapshot a conversation shows is remembered per goal, so the left
    // panel can list goals without a Host round trip.

    const libraryListeners = new Set()
    let libraryCache = null

    function readLibrary() {
      try {
        // Fall back to the cache written under the plugin's former name.
        const value = JSON.parse(localStorage.getItem(LIBRARY_KEY) || localStorage.getItem('dsh-skilltree.library.v1') || localStorage.getItem('dsh-plugin-techtree.library.v1') || 'null')
        if (value && typeof value === 'object' && value.goals && typeof value.goals === 'object') return value
      } catch {}
      return { goals: {} }
    }

    function library() {
      if (libraryCache === null) libraryCache = readLibrary()
      return libraryCache
    }

    function rememberSnapshot(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.goals)) return
      const current = library()
      const goals = Object.assign({}, current.goals)
      let changed = false
      snapshot.goals.forEach(goal => {
        if (!goal || typeof goal.id !== 'string') return
        const nodes = closure(snapshot.nodes, goal.id)
        if (nodes.length === 0) return
        const previous = goals[goal.id]
        if (previous && JSON.stringify(previous.nodes) === JSON.stringify(nodes) && previous.goal.name === goal.name) return
        goals[goal.id] = { goal: { id: goal.id, name: goal.name }, nodes, at: Date.now() }
        changed = true
      })
      if (!changed) return
      libraryCache = { goals }
      try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(libraryCache)) } catch {}
      libraryListeners.forEach(fn => fn())
    }

    /** Replace the cached map with the Host's copy; listeners hear only real changes. */
    function applyHostLibrary(data) {
      if (!data || !Array.isArray(data.goals)) return
      const goals = {}
      data.goals.forEach(e => {
        if (e && e.goal && typeof e.goal.id === 'string' && Array.isArray(e.nodes) && e.nodes.length) {
          goals[e.goal.id] = { goal: { id: e.goal.id, name: e.goal.name }, nodes: e.nodes, at: e.at || 0 }
        }
      })
      if (JSON.stringify(goals) === JSON.stringify(library().goals)) return
      libraryCache = { goals }
      try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(libraryCache)) } catch {}
      libraryListeners.forEach(fn => fn())
    }

    function useLibrary() {
      const [value, setValue] = useState(library)
      useEffect(() => {
        const update = () => setValue(library())
        const onStorage = event => {
          if (event.key !== LIBRARY_KEY) return
          libraryCache = null
          update()
        }
        libraryListeners.add(update)
        if (typeof window.addEventListener === 'function') window.addEventListener('storage', onStorage)
        return () => {
          libraryListeners.delete(update)
          if (typeof window.removeEventListener === 'function') window.removeEventListener('storage', onStorage)
        }
      }, [])
      return value
    }

    // ---- components ---------------------------------------------------------

    function send(inputActions, text) {
      inputActions.setDraft(text)
      inputActions.submit()
    }

    function GoalForm({ t, onGoal }) {
      const [goal, setGoal] = useState('')
      const submit = event => {
        event.preventDefault()
        const value = goal.trim()
        if (!value) return
        onGoal(fill(t('goal.prompt'), { goal: value }))
        setGoal('')
      }
      return h('form', { className: 'tt-form', onSubmit: submit },
        h('label', { className: 'tt-input-wrap' },
          h(SparkIcon, { size: 15 }),
          h('input', {
            className: 'tt-input', value: goal, placeholder: t('goal.placeholder'),
            'aria-label': t('goal.placeholder'), onChange: e => setGoal(e.target.value),
          })),
        h('button', { type: 'submit', className: 'tt-btn tt-btn-primary', disabled: goal.trim() === '' }, t('goal.submit')))
    }

    function ProgressRing({ lit, total, size }) {
      const s = size || 52
      const mini = s < 32
      const stroke = mini ? 3 : 5
      const r = s / 2 - stroke / 2 - 1
      const c = 2 * Math.PI * r
      const ratio = total ? lit / total : 0
      return h('div', { className: 'tt-ring', style: { width: s, height: s }, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': lit },
        h('svg', { width: s, height: s, viewBox: `0 0 ${s} ${s}`, 'aria-hidden': true },
          h('defs', null, h('linearGradient', { id: 'tt-ring-grad', x1: 0, y1: 0, x2: 1, y2: 1 },
            h('stop', { offset: '0%', stopColor: '#c8834c' }), h('stop', { offset: '100%', stopColor: '#eeb031' }))),
          h('circle', { cx: s / 2, cy: s / 2, r, fill: 'none', stroke: 'var(--tt-bg2)', strokeWidth: stroke }),
          h('circle', { cx: s / 2, cy: s / 2, r, fill: 'none', stroke: 'url(#tt-ring-grad)', strokeWidth: stroke, strokeLinecap: 'round', strokeDasharray: c, strokeDashoffset: c * (1 - ratio) })),
        mini ? null : h('b', null, `${Math.round(ratio * 100)}%`))
    }

    function Hero({ t, title, nodes, extra, onReview }) {
      const s = stats(nodes)
      const due = reviewQueue(nodes, Date.now())
      const review = due.length && onReview
        ? h('button', { type: 'button', className: 'tt-review', title: due.map(n => richToPlain(n.name)).join('、'), onClick: () => onReview(due) },
          h(ClockIcon), fill(t('review.today'), { n: due.length }))
        : null
      return h('div', { className: 'tt-hero' },
        h(ProgressRing, { lit: s.lit, total: s.total }),
        h('div', { className: 'tt-hero-text' },
          h('div', { className: 'tt-goal', title }, title),
          h('div', { className: 'tt-meta' },
            h('span', null, fill(t('progress'), { lit: s.lit, total: s.total })),
            h('span', null, fill(t('frontier'), { n: s.frontier })),
            h('span', { className: 'tt-medals' }, [1, 2, 3].map(level => h('span', { key: level, className: 'tt-medal', title: t(`level.${level}`) },
              h('i', { style: { background: ['', '#c8834c', '#93a4bd', '#eeb031'][level] } }), `${t(`medal.${level}`)} ${s.medals[level]}`))))),
        review,
        extra || null)
    }

    /**
     * Pannable, zoomable stage. Drag anywhere (also on nodes) to pan; a drag
     * suppresses the click it would otherwise produce. Wheel zooms around the
     * cursor (trackpad two-finger scroll pans, pinch zooms). `camera` receives
     * flyTo/fit so the stage can move the view; `focus` is the canvas point the
     * automatic fit zooms in on when the whole tree would be too small to read.
     * `children` may be a function of the current view.
     */
    function Viewport({ t, width, height, fitKey, focus, camera, children, overlay, tools }) {
      const ref = useRef(null)
      const [view, setView] = useState({ x: 24, y: 24, k: 1 })
      const [dragging, setDragging] = useState(false)
      const viewRef = useRef(view)
      const drag = useRef(null)
      const touched = useRef(false)
      const suppress = useRef(false)
      const anim = useRef(0)
      const focusRef = useRef(focus)
      focusRef.current = focus

      const put = useCallback(v => {
        viewRef.current = v
        setView(v)
      }, [])
      const stop = () => {
        if (anim.current && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(anim.current)
        anim.current = 0
      }
      const update = fn => {
        stop()
        put(fn(viewRef.current))
      }

      const fitView = useCallback(() => {
        const el = ref.current
        if (!el || !el.clientWidth || !el.clientHeight) return null
        // Room for the legend / zoom bar above and the hint below.
        const padX = 28
        const padTop = 92
        const padBottom = 40
        const k = clamp(Math.min((el.clientWidth - padX * 2) / width, (el.clientHeight - padTop - padBottom) / height, 1), MIN_ZOOM, 1)
        return { k, x: (el.clientWidth - width * k) / 2, y: Math.max(padTop, padTop + (el.clientHeight - padTop - padBottom - height * k) / 2) }
      }, [width, height])

      /** Center canvas point (cx, cy) at zoom k; animated unless instant. */
      const flyTo = useCallback((cx, cy, options) => {
        const el = ref.current
        if (!el || !el.clientWidth) return
        const opts = options || {}
        touched.current = true
        const from = viewRef.current
        const k = clamp(opts.k !== undefined ? opts.k : Math.max(from.k, 0.8), MIN_ZOOM, MAX_ZOOM)
        const anchorY = opts.anchorY !== undefined ? opts.anchorY : 0.45
        const to = { k, x: el.clientWidth / 2 - cx * k, y: el.clientHeight * anchorY - cy * k }
        stop()
        const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
        if (opts.instant || reduce || typeof requestAnimationFrame !== 'function') { put(to); return }
        const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
        const duration = 520
        const step = now => {
          const p = clamp((now - start) / duration, 0, 1)
          const e = 1 - Math.pow(1 - p, 3)
          // Ease zoom in log space so zooming feels even.
          const kk = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e)
          put({ k: kk, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e })
          anim.current = p < 1 ? requestAnimationFrame(step) : 0
        }
        anim.current = requestAnimationFrame(step)
      }, [put])

      const fit = useCallback(smart => {
        const v = fitView()
        if (!v) return
        const f = focusRef.current
        if (smart && f && v.k < 0.62) {
          const el = ref.current
          put({ k: 0.9, x: el.clientWidth / 2 - f.x * 0.9, y: el.clientHeight * 0.42 - f.y * 0.9 })
        } else put(v)
      }, [fitView, put])

      /** Bring a canvas point into the upper part of the view (above the detail card) when it is not already there. */
      const reveal = (cx, cy) => {
        const el = ref.current
        if (!el || !el.clientWidth) return
        const v = viewRef.current
        const sx = cx * v.k + v.x
        const sy = cy * v.k + v.y
        if (sx > 40 && sx < el.clientWidth - 40 && sy > 70 && sy < el.clientHeight * 0.42) return
        flyTo(cx, cy, { k: v.k, anchorY: 0.28 })
      }
      if (camera) camera.current = { flyTo, reveal, fit: () => { touched.current = false; stop(); fit(false) } }

      const zoomAt = useCallback((px, py, factor) => {
        touched.current = true
        stop()
        const v = viewRef.current
        const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM)
        put({ k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) })
      }, [put])

      const zoomCenter = factor => {
        const el = ref.current
        if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor)
      }

      // Released on unmount too, so an interrupted drag never leaves the page unselectable.
      useEffect(() => () => { lockSelection(false); stop() }, [])

      // Fit when the tree changes, and on resize until the learner moves the view.
      useEffect(() => {
        touched.current = false
        fit(true)
        const el = ref.current
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => { if (!touched.current) fit(true) })
        observer.observe(el)
        return () => observer.disconnect()
      }, [fitKey, fit])

      // Wheel needs a non-passive listener to keep the page from scrolling.
      useEffect(() => {
        const el = ref.current
        if (!el) return undefined
        const onWheel = event => {
          event.preventDefault()
          const rect = el.getBoundingClientRect()
          // A mouse wheel moves in notches (wheelDelta multiples of 120, or line/page mode); with
          // display scaling its pixel delta is fractional, so the delta alone cannot tell it apart.
          const notch = typeof event.wheelDeltaY === 'number' && event.wheelDeltaY !== 0 && event.wheelDeltaY % 120 === 0
          const mouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && (notch || Math.abs(event.deltaY) >= 50))
          if (event.ctrlKey || event.metaKey || mouseWheel) {
            zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-clamp(event.deltaY, -60, 60) * (event.ctrlKey ? 0.01 : 0.004)))
          } else {
            touched.current = true
            update(v => ({ k: v.k, x: v.x - event.deltaX, y: v.y - event.deltaY }))
          }
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [zoomAt])

      const onPointerDown = event => {
        if (event.button !== 0) return
        if (event.target.closest && event.target.closest('.tt-overlay, .tt-card')) return
        // Keep the browser from starting a text selection (or a native drag) that
        // would follow the pointer out of the canvas; focus the canvas ourselves.
        if (event.pointerType === 'mouse') {
          event.preventDefault()
          if (ref.current && typeof ref.current.focus === 'function') ref.current.focus({ preventScroll: true })
        }
        stop()
        drag.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x: viewRef.current.x, y: viewRef.current.y, moved: false }
      }
      const onPointerMove = event => {
        const d = drag.current
        if (!d || d.id !== event.pointerId) return
        const dx = event.clientX - d.sx
        const dy = event.clientY - d.sy
        if (!d.moved) {
          if (Math.hypot(dx, dy) < 4) return
          d.moved = true
          touched.current = true
          setDragging(true)
          lockSelection(true)
          try { ref.current.setPointerCapture(event.pointerId) } catch {}
        }
        put({ k: viewRef.current.k, x: d.x + dx, y: d.y + dy })
      }
      const endDrag = event => {
        const d = drag.current
        if (!d || d.id !== event.pointerId) return
        drag.current = null
        lockSelection(false)
        if (d.moved) {
          suppress.current = true
          setTimeout(() => { suppress.current = false }, 0)
          setDragging(false)
        }
      }
      const onClickCapture = event => {
        if (!suppress.current) return
        event.stopPropagation()
        event.preventDefault()
      }
      const onDoubleClick = event => {
        if (event.target.closest && event.target.closest('.tt-node, .tt-overlay, .tt-card')) return
        touched.current = false
        stop()
        fit(false)
      }
      const onKeyDown = event => {
        if (event.target !== ref.current) return
        const stepPx = 60
        const moves = { ArrowLeft: [stepPx, 0], ArrowRight: [-stepPx, 0], ArrowUp: [0, stepPx], ArrowDown: [0, -stepPx] }
        if (moves[event.key]) {
          event.preventDefault()
          touched.current = true
          update(v => ({ k: v.k, x: v.x + moves[event.key][0], y: v.y + moves[event.key][1] }))
        } else if (event.key === '+' || event.key === '=') zoomCenter(1.2)
        else if (event.key === '-') zoomCenter(1 / 1.2)
        else if (event.key === '0') { touched.current = false; stop(); fit(false) }
      }

      const grid = 22 * view.k
      return h(React.Fragment, null,
        h('div', {
          ref, tabIndex: 0, className: 'tt-viewport' + (dragging ? ' tt-dragging' : ''),
          style: { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` },
          onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag,
          onClickCapture, onDoubleClick, onKeyDown,
        },
        h('div', { className: 'tt-canvas', style: { width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` } },
          typeof children === 'function' ? children(view) : children)),
        h('div', { className: 'tt-overlay tt-zoom' },
          tools || null,
          h('button', { type: 'button', className: 'tt-icon-btn', title: t('view.zoomOut'), 'aria-label': t('view.zoomOut'), onClick: () => zoomCenter(1 / 1.25) }, h(MinusIcon)),
          h('span', { className: 'tt-zoom-val' }, `${Math.round(view.k * 100)}%`),
          h('button', { type: 'button', className: 'tt-icon-btn', title: t('view.zoomIn'), 'aria-label': t('view.zoomIn'), onClick: () => zoomCenter(1.25) }, h(PlusIcon)),
          h('button', { type: 'button', className: 'tt-icon-btn', title: t('view.fit'), 'aria-label': t('view.fit'), onClick: () => { touched.current = false; stop(); fit(false) } }, h(FitIcon))),
        overlay)
    }

    function lockSelection(on) {
      try {
        document.documentElement.classList.toggle('tt-grabbing', on)
        if (on) window.getSelection().removeAllRanges()
      } catch {}
    }

    function Badge({ state, node, isGoal }) {
      const icon = state === 'lit' ? h(StarIcon) : state === 'available' ? h(SparkIcon, { size: 16 }) : isGoal ? h(FlagIcon) : h(LockIcon)
      const shape = `tt-bshape-${NODE_TYPES.includes(node.type) ? node.type : 'concept'}`
      const cls = state === 'lit' ? `tt-badge tt-badge-lit tt-m-${node.mastery}` : state === 'available' ? 'tt-badge tt-badge-available' : isGoal ? 'tt-badge tt-badge-goal' : 'tt-badge'
      return h('span', { className: `${cls} ${shape}` }, h('span', { className: 'tt-badge-icon' }, icon),
        node.weak ? h('i', { className: 'tt-dot tt-dot-weak' }) : fading(node, Date.now()) ? h('i', { className: 'tt-dot tt-dot-fading' }) : null)
    }

    /** Small badge-shaped swatch per knowledge type, for the legend. */
    function TypeLegend({ t, nodes }) {
      const present = NODE_TYPES.filter(type => nodes.some(n => (n.type || 'concept') === type))
      if (present.length < 2) return null
      return h('div', { className: 'tt-legend-row' }, present.map(type => h('span', { key: type, className: 'tt-pill' },
        h('span', { className: `tt-mini tt-bshape-${type}` }), t(`type.${type}`))))
    }

    const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315]

    /** Nodes and edges of one tree, plus the hook bubble, in canvas coordinates. */
    function Graph({ t, nodes, goalIds, selected, hover, onSelect, onHover, now, coords, routeSteps, recommended, celebrate, view }) {
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
      const focus = selected && byId[selected] ? related(nodes, selected) : null
      const width = Math.max(...nodes.map(n => coords[n.id].x + NODE_W), NODE_W)
      const height = Math.max(...nodes.map(n => coords[n.id].y + NODE_H), NODE_H)
      const medalColor = ['', '#c8834c', '#93a4bd', '#eeb031']
      const onRoute = id => routeSteps && routeSteps[id] !== undefined
      const edges = []
      nodes.forEach(n => n.prerequisites.forEach(p => {
        if (!coords[p]) return
        const a = coords[p]
        const b = coords[n.id]
        const x1 = a.x + NODE_W / 2
        const y1 = a.y + NODE_H
        const x2 = b.x + NODE_W / 2
        const y2 = b.y
        const my = (y1 + y2) / 2
        const fromLit = byId[p].mastery >= 1
        const toLit = n.mastery >= 1
        const route = onRoute(n.id) && (onRoute(p) || fromLit)
        const dim = !route && focus && !(focus.has(p) && focus.has(n.id))
        const kind = fromLit && toLit ? 'lit' : fromLit ? 'flow' : 'locked'
        const ignite = celebrate && celebrate.ids.has(p)
        edges.push(h('path', {
          key: `${p}>${n.id}`,
          className: `tt-edge tt-edge-${kind}` + (route ? ' tt-edge-route' : '') + (ignite ? ' tt-edge-ignite' : '') + (dim ? ' tt-edge-dim' : ''),
          d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`,
          stroke: kind === 'lit' && !route ? medalColor[Math.min(byId[p].mastery, n.mastery)] : undefined,
        }))
      }))
      const bubbleId = hover && byId[hover] && byId[hover].hook ? hover : null
      const bubbleScale = view ? clamp(1 / view.k, 1, 2.4) : 1
      const bubbleBelow = bubbleId !== null && coords[bubbleId].y < NODE_H
      return h(React.Fragment, null,
        h('svg', { className: 'tt-edges', width, height, 'aria-hidden': true }, edges),
        nodes.map(n => {
          const state = stateOf(n, byId)
          const isGoal = goalIds.has(n.id)
          const fade = fading(n, now)
          const lit = celebrate && celebrate.ids.has(n.id)
          const cls = ['tt-node', `tt-shape-${NODE_TYPES.includes(n.type) ? n.type : 'concept'}`,
            state === 'lit' ? `tt-lit-${n.mastery}` : `tt-${state}`,
            fade ? 'tt-fading' : '',
            n.weak ? 'tt-weak' : '',
            isGoal ? 'tt-goal-node' : '',
            selected === n.id ? 'tt-selected' : '',
            onRoute(n.id) ? 'tt-on-route' : '',
            focus && !focus.has(n.id) && !onRoute(n.id) ? 'tt-dim' : '',
            lit ? 'tt-celebrate' : '',
          ].filter(Boolean).join(' ')
          const sub = state === 'lit' ? t(`level.${n.mastery}`) : `${t(`type.${n.type}`)} · ${t(`state.${state}`)}`
          const flags = [n.weak ? t('flag.weak') : '', fade ? t('flag.fading') : ''].filter(Boolean)
          return h('button', {
            key: lit ? `${n.id}:${celebrate.key}` : n.id, type: 'button', className: cls, 'data-node': n.id,
            style: { left: coords[n.id].x, top: coords[n.id].y },
            'aria-label': n.hook ? `${richToPlain(n.name)}：${richToPlain(n.hook)}` : richToPlain(n.name),
            'aria-pressed': selected === n.id,
            onClick: () => onSelect(selected === n.id ? null : n.id),
            onPointerEnter: event => { if (event.pointerType !== 'touch') onHover(n.id) },
            onPointerLeave: () => onHover(null),
          },
          isGoal ? h('span', { className: 'tt-goal-tag' }, t('flag.goal')) : null,
          onRoute(n.id) ? h('span', { className: 'tt-step' }, routeSteps[n.id] + 1) : null,
          recommended === n.id ? h('span', { className: 'tt-rec' }, h('i', null, '▼'), t('flag.recommended')) : null,
          h(Badge, { state, node: n, isGoal }),
          h('span', { className: 'tt-node-text' },
            h('span', { className: 'tt-node-name' }, h(Rich, { text: n.name })),
            h('span', { className: 'tt-node-sub' }, flags.length ? `${sub} · ${flags.join(' · ')}` : sub)),
          lit ? h('span', { className: 'tt-burst', 'aria-hidden': true }, SPARKS.map(a => h('i', { key: a, style: { '--a': `${a}deg` } }))) : null)
        }),
        bubbleId ? h('div', {
          key: `bubble:${bubbleId}`, className: 'tt-bubble' + (bubbleBelow ? ' tt-bubble-below' : ''),
          style: bubbleBelow
            ? { left: coords[bubbleId].x + NODE_W / 2, top: coords[bubbleId].y + NODE_H + 10, transform: `translate(-50%, 0) scale(${bubbleScale})` }
            : { left: coords[bubbleId].x + NODE_W / 2, top: coords[bubbleId].y - (recommended === bubbleId ? 26 : 10), transform: `translate(-50%, -100%) scale(${bubbleScale})` },
        }, h('b', null, '💡'), h(Rich, { text: byId[bubbleId].hook }),
        Array.isArray(byId[bubbleId].glossary) && byId[bubbleId].glossary.length ? h('span', { className: 'tt-bubble-gloss' },
          byId[bubbleId].glossary.slice(0, 3).map((g, i) => h(React.Fragment, { key: i },
            h('span', { className: 'tt-gloss-term' }, h(Rich, { text: g.term })),
            h('span', null, h(Rich, { text: g.meaning }))))) : null) : null)
    }

    function Detail({ t, node, nodes, onJump, onClose, act, now, routeIds }) {
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
      const state = stateOf(node, byId)
      const unlocks = nodes.filter(n => n.prerequisites.includes(node.id))
      const tags = [
        h('span', { key: 'type', className: 'tt-tag' }, t(`type.${node.type}`)),
        state === 'lit'
          ? h('span', { key: 'state', className: `tt-tag tt-tag-medal tt-m-${node.mastery}` }, t(`level.${node.mastery}`))
          : h('span', { key: 'state', className: 'tt-tag' }, t(`state.${state}`)),
      ]
      if (node.weak) tags.push(h('span', { key: 'weak', className: 'tt-tag tt-tag-warn' }, t('flag.weak')))
      if (fading(node, now)) tags.push(h('span', { key: 'fade', className: 'tt-tag tt-tag-warn' }, t('flag.fading')))
      if (node.est_minutes) tags.push(h('span', { key: 'min', className: 'tt-tag' }, fill(t('detail.minutes'), { n: node.est_minutes })))
      const chip = n => h('button', { key: n.id, type: 'button', className: 'tt-link', onClick: () => onJump(n.id) }, h(Rich, { text: n.name }))
      const links = (label, list) => h('div', { className: 'tt-links' },
        h('span', null, `${label}：`),
        list.length ? list.map(chip) : h('span', null, t('detail.none')))
      const vars = { name: richToPlain(node.name), id: node.id }
      const route = routeIds.map(id => byId[id]).filter(Boolean)
      const routeText = route.map((n, i) => `${i + 1}. ${richToPlain(n.name)}（${n.id}）`).join(' → ')
      const actions = []
      if (state === 'locked') {
        actions.push(h('button', { key: 'route', type: 'button', className: 'tt-btn tt-btn-primary', onClick: () => act(fill(t('prompt.route'), { ...vars, route: routeText })) }, t('action.route')))
        actions.push(h('button', { key: 'skip', type: 'button', className: 'tt-btn tt-btn-skip', onClick: () => act(fill(t('prompt.skip'), vars)) }, h(BoltIcon), t('action.skip')))
      } else if (state === 'available') {
        actions.push(h('button', { key: 'learn', type: 'button', className: 'tt-btn tt-btn-primary', onClick: () => act(fill(t('prompt.learn'), vars)) }, t('action.learn')))
        actions.push(h('button', { key: 'check', type: 'button', className: 'tt-btn', onClick: () => act(fill(t('prompt.check'), vars)) }, t('action.check')))
      } else {
        actions.push(h('button', { key: 'review', type: 'button', className: 'tt-btn tt-btn-primary', onClick: () => act(fill(t('prompt.review'), vars)) }, t('action.review')))
        if (node.mastery < 3) actions.push(h('button', { key: 'check', type: 'button', className: 'tt-btn', onClick: () => act(fill(t('prompt.check'), vars)) }, t('action.levelUp')))
      }
      return h('div', { className: 'tt-card', role: 'dialog', 'aria-label': node.name },
        h('div', { className: 'tt-card-head' },
          h(Badge, { state, node, isGoal: false }),
          h('div', { className: 'tt-card-title' }, h(Rich, { text: node.name })),
          h('button', { type: 'button', className: 'tt-icon-btn', title: t('detail.close'), 'aria-label': t('detail.close'), onClick: onClose }, h(CloseIcon))),
        node.hook ? h('div', { className: 'tt-hook' }, h('span', null, '💡'), h('div', null, h(Rich, { text: node.hook }))) : null,
        h('div', { className: 'tt-tags' }, tags),
        node.summary ? h('p', null, h(Rich, { text: node.summary })) : null,
        Array.isArray(node.glossary) && node.glossary.length ? h('div', { className: 'tt-glossary' },
          h('div', { className: 'tt-glossary-title' }, t('detail.glossary')),
          node.glossary.map((g, i) => h('div', { key: i, className: 'tt-gloss-row' },
            h('span', { className: 'tt-gloss-term' }, h(Rich, { text: g.term })),
            h('span', { className: 'tt-gloss-meaning' }, h(Rich, { text: g.meaning }))))) : null,
        route.length > 1 ? h('div', { className: 'tt-route' },
          h('div', { className: 'tt-route-title' }, fill(t('detail.route'), { n: route.length })),
          h('div', { className: 'tt-route-list' }, route.map((n, i) => h('button', { key: n.id, type: 'button', className: 'tt-route-step', onClick: () => onJump(n.id) }, h('b', null, i + 1), h(Rich, { text: n.name }))))) : null,
        links(t('detail.prereqs'), node.prerequisites.map(id => byId[id]).filter(Boolean)),
        links(t('detail.unlocks'), unlocks),
        h('div', { className: 'tt-actions' }, actions))
    }

    /** Toasts for nodes that lit up and nodes that became learnable. */
    function useCelebrations(t, nodes, camera, coords) {
      const previous = useRef(null)
      const [celebrate, setCelebrate] = useState(null)
      const [toasts, setToasts] = useState([])
      useEffect(() => {
        const before = previous.current
        const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
        previous.current = Object.fromEntries(nodes.map(n => [n.id, n.mastery || 0]))
        if (before === null) return undefined
        const raised = nodes.filter(n => (n.mastery || 0) >= 1 && (n.mastery || 0) > (before[n.id] || 0))
        if (raised.length === 0) return undefined
        const wasLit = id => (before[id] || 0) >= 1
        const unlocked = nodes.filter(n => (n.mastery || 0) < 1 && stateOf(n, byId) === 'available'
          && !(n.prerequisites.every(wasLit) && n.prerequisites.every(p => before[p] !== undefined)))
        const key = Date.now()
        setCelebrate({ ids: new Set(raised.map(n => n.id)), key })
        const messages = raised.map(n => fill(t('toast.lit'), { name: richToPlain(n.name), level: t(`level.${n.mastery}`) }))
        if (unlocked.length) messages.push(fill(t('toast.unlocked'), { n: unlocked.length, names: unlocked.slice(0, 3).map(n => richToPlain(n.name)).join('、') + (unlocked.length > 3 ? '…' : '') }))
        setToasts(list => list.concat(messages.map((text, i) => ({ id: `${key}:${i}`, text, kind: i < raised.length ? 'lit' : 'unlock' }))).slice(-4))
        const first = coords[raised[0].id]
        if (first && camera.current) camera.current.flyTo(first.x + NODE_W / 2, first.y + NODE_H / 2)
        const timer = setTimeout(() => setCelebrate(c => (c && c.key === key ? null : c)), 2400)
        const toastTimer = setTimeout(() => setToasts(list => list.filter(x => !x.id.startsWith(`${key}:`))), 4200)
        return () => { clearTimeout(timer); clearTimeout(toastTimer) }
      }, [nodes])
      const notify = useCallback(text => {
        const id = `n${Date.now()}`
        setToasts(list => list.concat([{ id, text, kind: 'info' }]).slice(-4))
        setTimeout(() => setToasts(list => list.filter(x => x.id !== id)), 3000)
      }, [])
      return { celebrate, toasts, notify }
    }

    /** Tree canvas with legend, tools, the selected node's card and toasts. */
    function Stage({ t, title, nodes, goalIds, act, fitKey }) {
      const [selected, setSelected] = useState(null)
      const [hover, setHover] = useState(null)
      const camera = useRef(null)
      const now = Date.now()
      const byId = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])
      const { coords, width, height } = useMemo(() => layout(nodes), [nodes])
      const recommended = useMemo(() => recommend(nodes, [...goalIds]), [nodes, goalIds])
      const current = selected && byId[selected] ? byId[selected] : null
      const routeIds = useMemo(() => (current && current.mastery < 1 ? learningRoute(nodes, current.id) : []), [nodes, current])
      const routeSteps = routeIds.length > 1 ? Object.fromEntries(routeIds.map((id, i) => [id, i])) : null
      const { celebrate, toasts, notify } = useCelebrations(t, nodes, camera, coords)
      const center = id => ({ x: coords[id].x + NODE_W / 2, y: coords[id].y + NODE_H / 2 })
      const jump = id => {
        setSelected(id)
        const c = center(id)
        // Keep the node above the detail card.
        if (camera.current) camera.current.flyTo(c.x, c.y, { anchorY: 0.3 })
      }
      const pick = id => {
        setSelected(id)
        if (id && camera.current) {
          const c = center(id)
          camera.current.reveal(c.x, c.y)
        }
      }
      const locate = () => {
        if (!recommended) return
        const c = center(recommended)
        if (camera.current) camera.current.flyTo(c.x, c.y, { k: 1 })
      }
      const doExport = () => {
        exportPng(t, title, nodes, goalIds).then(
          how => notify(t(how === 'copied' ? 'toast.copied' : 'toast.exported')),
          () => notify(t('toast.exportFailed')))
      }
      const legend = h('div', { className: 'tt-overlay tt-legend' },
        h('div', { className: 'tt-legend-row' },
          h('span', { className: 'tt-pill' }, h('i', { style: { background: 'linear-gradient(135deg,#c8834c,#eeb031)' } }), t('legend.lit')),
          h('span', { className: 'tt-pill' }, h('i', { style: { border: '1.5px dashed var(--tt-brand)' } }), t('legend.available')),
          h('span', { className: 'tt-pill' }, h('i', { style: { background: 'var(--tt-line)' } }), t('legend.locked'))),
        h(TypeLegend, { t, nodes }))
      const tools = h(React.Fragment, null,
        recommended ? h('button', { type: 'button', className: 'tt-icon-btn', title: t('action.recommend'), 'aria-label': t('action.recommend'), onClick: locate }, h(TargetIcon)) : null,
        h('button', { type: 'button', className: 'tt-icon-btn', title: t('action.export'), 'aria-label': t('action.export'), onClick: doExport }, h(DownloadIcon)),
        h('span', { className: 'tt-zoom-sep' }))
      return h('div', { className: 'tt-stage' },
        h(Viewport, {
          t, width, height, fitKey, camera, tools,
          focus: recommended ? center(recommended) : null,
          overlay: h(React.Fragment, null,
            legend,
            toasts.length ? h('div', { className: 'tt-overlay tt-toasts', role: 'status' }, toasts.map(x => h('div', { key: x.id, className: `tt-toast tt-toast-${x.kind}` }, x.kind === 'lit' ? h(StarIcon) : x.kind === 'unlock' ? h(SparkIcon, { size: 15 }) : null, x.text))) : null,
            current
              ? h(Detail, { key: current.id, t, node: current, nodes, onJump: jump, onClose: () => setSelected(null), act, now, routeIds })
              : h('div', { className: 'tt-overlay tt-hint' }, t('view.hint'))),
        }, view => h(Graph, {
          t, nodes, goalIds, selected: current ? selected : null, hover, onSelect: pick, onHover: setHover,
          now, coords, routeSteps, recommended, celebrate, view,
        })))
    }

    function Empty({ t, body }) {
      return h('div', { className: 'tt-empty' },
        h('div', { className: 'tt-empty-icon' }, h(TreeIcon, { size: 34 })),
        h('b', null, t('empty.title')),
        h('p', null, body || t('empty.body')))
    }

    /** Right-Sidebar page: the current conversation's tree. */
    function TreeBody(props) {
      const { t, useProjection, inputActions } = props
      const snapshot = useProjection('techtree')
      useEffect(() => { rememberSnapshot(snapshot) }, [snapshot])
      const nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : EMPTY
      const goals = snapshot && Array.isArray(snapshot.goals) ? snapshot.goals : EMPTY
      const goalKey = goals.map(g => g.id).join(',')
      const goalIds = useMemo(() => new Set(goals.map(g => g.id)), [goalKey])
      const act = text => send(inputActions, text)
      const title = goals.map(g => g.name).join(' · ')
      return h('div', { className: 'tt-scope tt-root' },
        h(Style),
        h(GoalForm, { t, onGoal: act }),
        nodes.length === 0
          ? h(Empty, { t })
          : h(React.Fragment, null,
            h(Hero, {
              t, title, nodes, onReview: due => act(reviewPrompt(t, due)),
              extra: h('button', { type: 'button', className: 'tt-icon-btn', title: t('action.refresh'), 'aria-label': t('action.refresh'), onClick: () => act(t('prompt.refresh')) }, h(RefreshIcon)),
            }),
            h(Stage, { t, title, nodes, goalIds, act, fitKey: `${goalKey}:${nodes.length}` })))
    }

    /** Live copy of the learner's whole map, read from the Host; falls back to the cache. */
    function useHostLibrary() {
      const [sync, setSync] = useState({ status: 'loading', at: 0 })
      const load = useCallback(async () => {
        try {
          const response = await fetch(new URL(LIBRARY_ROUTE, document.baseURI).href, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          applyHostLibrary(await response.json())
          setSync({ status: 'ok', at: Date.now() })
        } catch {
          setSync(s => ({ status: 'offline', at: s.at }))
        }
      }, [])
      useEffect(() => {
        if (typeof fetch !== 'function' || typeof document === 'undefined') return undefined
        load()
        const visible = () => document.visibilityState !== 'hidden'
        const onFocus = () => { if (visible()) load() }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onFocus)
        const timer = setInterval(() => { if (visible()) load() }, LIBRARY_POLL_MS)
        return () => {
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onFocus)
          clearInterval(timer)
        }
      }, [load])
      return { sync, reload: load }
    }

    /** Left-Sidebar main panel: every goal in the learner's map. */
    function MainPage(props) {
      const t = props.t || boundT
      const lib = useLibrary()
      const { sync, reload } = useHostLibrary()
      const entries = Object.values(lib.goals).sort((a, b) => b.at - a.at)
      const [picked, setPicked] = useState(null)
      const entry = entries.find(e => e.goal.id === picked) || entries[0] || null
      const start = text => props.startSession(text)
      const resume = text => start(`${fill(t('prompt.resume'), { goal: entry.goal.name, goalId: entry.goal.id })}${text}`)
      const now = Date.now()
      const entryId = entry ? entry.goal.id : ''
      const goalIds = useMemo(() => new Set(entryId ? [entryId] : []), [entryId])
      const syncText = sync.status === 'ok' ? `${t('sync.ok')} · ${ago(t, sync.at, now).trim()}` : t(`sync.${sync.status}`)
      return h('div', { className: 'tt-scope tt-page' },
        h(Style),
        h('aside', { className: 'tt-aside' },
          h('div', { className: 'tt-page-title' }, h('span', null, h(TreeIcon, { size: 30 })), t('page.title')),
          h('p', { className: 'tt-page-sub' }, t('page.subtitle')),
          h(GoalForm, { t, onGoal: start }),
          h('div', { className: 'tt-section' },
            h('span', null, t('library.title')),
            h('button', { type: 'button', className: 'tt-sync tt-sync-' + sync.status, title: t('action.refresh'), onClick: reload }, h('i'), syncText)),
          entries.length === 0
            ? h('div', { className: 'tt-note' }, t('library.empty'))
            : h('div', { className: 'tt-lib' }, entries.map(e => {
              const s = stats(e.nodes)
              return h('button', {
                key: e.goal.id, type: 'button', className: 'tt-lib-item',
                'aria-current': entry && entry.goal.id === e.goal.id ? 'true' : 'false',
                onClick: () => setPicked(e.goal.id),
              },
              h('span', { className: 'tt-lib-name' }, h('span', null, e.goal.name), reviewQueue(e.nodes, now).length ? h('b', { className: 'tt-chip-due' }, fill(t('review.short'), { n: reviewQueue(e.nodes, now).length })) : null),
              h('span', { className: 'tt-bar' }, h('i', { style: { width: `${s.total ? (s.lit / s.total) * 100 : 0}%` } })),
              h('span', { className: 'tt-lib-row' }, h('span', null, fill(t('progress'), { lit: s.lit, total: s.total })), h('span', null, fill(t('medal.summary'), { b: s.medals[1], s: s.medals[2], g: s.medals[3] }))))
            })),
          sync.status === 'offline' && entries.length ? h('div', { className: 'tt-note' }, t('library.note')) : null),
        h('main', { className: 'tt-main' },
          entry === null
            ? h(Empty, { t, body: t('library.empty') })
            : h(React.Fragment, null,
              h(Hero, {
                t, title: entry.goal.name, nodes: entry.nodes, onReview: due => resume(reviewPrompt(t, due)),
                extra: h('button', { type: 'button', className: 'tt-btn tt-btn-primary', onClick: () => resume(t('prompt.continue')) }, t('action.continue')),
              }),
              h(Stage, { key: entry.goal.id, t, title: entry.goal.name, nodes: entry.nodes, goalIds, act: resume, fitKey: `${entry.goal.id}:${entry.nodes.length}` }))))
    }

    function TreeTitle({ useTabInfo }) {
      const { tab } = useTabInfo()
      return h(React.Fragment, null, h(TreeIcon, { size: 14 }), ' ', tab.title)
    }

    function NavIcon({ size }) {
      return h(TreeIcon, { size: size || 16 })
    }

    function ProgressChip({ t, useProjection, openTree }) {
      const snapshot = useProjection('techtree')
      useEffect(() => { rememberSnapshot(snapshot) }, [snapshot])
      if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) return null
      const s = stats(snapshot.nodes)
      const due = reviewQueue(snapshot.nodes, Date.now()).length
      const goal = snapshot.goals.map(g => richToPlain(g.name)).join(' · ')
      return h('div', { className: 'tt-scope' }, h(Style), h('button', {
        type: 'button', className: 'tt-chip', title: t('chip.open'), onClick: openTree,
      }, h(ProgressRing, { lit: s.lit, total: s.total, size: 20 }), h('span', null, `${goal} · ${fill(t('progress'), { lit: s.lit, total: s.total })}`),
      due ? h('b', { className: 'tt-chip-due' }, fill(t('review.short'), { n: due })) : null))
    }

    let boundT = key => key

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }))
        const t = ctx.locale.bind(NS)
        boundT = t
        // Optional: absent outside the full workspace UI, so never a hard dependency.
        const workspace = () => {
          try { return typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : ctx.uiWorkspace } catch { return undefined }
        }
        const startSession = prompt => {
          const ws = workspace()
          if (ws && typeof ws.startSession === 'function') ws.startSession(undefined, { prompt, whenDraftExists: 'replace' })
        }
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: PLUGIN_ID,
          kind: KIND,
          keepMounted: true,
          title: () => t('type.label'),
          guide: [{
            id: 'techtree',
            order: 60,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: TreeIcon,
          }],
        }))
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: PLUGIN_ID, locale: NS },
          TreeBody,
        )))
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: PLUGIN_ID },
          TreeTitle,
        )))
        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
          {
            name: 'conversation.composer.dock', id: PLUGIN_ID, order: 50, locale: NS,
            inject: () => ({ openTree: () => ctx.sidebarRight.openTab(KIND) }),
          },
          ProgressChip,
        )))
        // Left Sidebar entry "天赋树" and the main panel it opens.
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: PLUGIN_ID, locale: NS, inject: () => ({ startSession }) },
          MainPage,
        )))
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: PLUGIN_ID, order: 20, locale: NS, label: () => t('nav.label') },
          NavIcon,
        )))
      },
    }
  },
})
