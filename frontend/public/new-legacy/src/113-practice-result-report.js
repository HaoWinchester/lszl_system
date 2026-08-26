'use strict';

;(function (global) {
  const BAND_COLORS = Object.freeze({
    needsImprovement: '#e83b68',
    belowTarget: '#f7bd2f',
    target: '#74c3b8',
    aboveTarget: '#15958f',
  })
  const BAND_LABELS = Object.freeze({
    needsImprovement: '需要提升',
    belowTarget: '低于目标',
    target: '达到目标',
    aboveTarget: '高于目标',
  })
  const DOMAIN_LABELS = Object.freeze({
    people: '人员',
    process: '流程',
    'business-environment': '商业环境',
  })

  function text(value) { return String(value == null ? '' : value) }
  function escapeHTML(value) {
    return text(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char])
  }
  function number(value) { const result = Number(value); return Number.isFinite(result) ? result : 0 }
  function point(cx, cy, radius, angle) {
    const radians = (angle - 90) * Math.PI / 180
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) }
  }
  function slicePath(cx, cy, radius, start, end) {
    const first = point(cx, cy, radius, start)
    const last = point(cx, cy, radius, end)
    return `M ${cx} ${cy} L ${first.x.toFixed(2)} ${first.y.toFixed(2)} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${last.x.toFixed(2)} ${last.y.toFixed(2)} Z`
  }
  function durationLabel(ms) {
    const seconds = Math.max(0, Math.floor(number(ms) / 1000))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const rest = seconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  function pieMarkup(report) {
    const weights = report?.domainWeights || {}
    const domains = report?.domains || {}
    const entries = Object.keys(DOMAIN_LABELS).map(domain => ({ domain, weight: Math.max(0, number(weights[domain])) }))
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0) || 100
    let angle = 0
    const paths = []
    const labels = []
    entries.forEach((entry) => {
      const size = entry.weight / total * 360
      const end = angle + size
      const mid = angle + size / 2
      const band = domains?.[entry.domain]?.performanceBand || 'target'
      const color = BAND_COLORS[band] || BAND_COLORS.target
      const inner = point(280, 184, 116, mid)
      const elbow = point(280, 184, 143, mid)
      const right = Math.cos((mid - 90) * Math.PI / 180) >= 0
      const lineEndX = right ? 500 : 60
      const anchor = right ? 'start' : 'end'
      const textX = right ? lineEndX + 8 : lineEndX - 8
      paths.push(`<path d="${slicePath(280, 184, 112, angle, end)}" fill="${color}" stroke="#fff" stroke-width="3"><title>${escapeHTML(DOMAIN_LABELS[entry.domain])} ${entry.weight}% · ${escapeHTML(BAND_LABELS[band] || band)}</title></path>`)
      labels.push(`<polyline points="${inner.x.toFixed(1)},${inner.y.toFixed(1)} ${elbow.x.toFixed(1)},${elbow.y.toFixed(1)} ${lineEndX},${elbow.y.toFixed(1)}" fill="none" stroke="#8c96a4" stroke-width="2"/><text x="${textX}" y="${(elbow.y + 5).toFixed(1)}" text-anchor="${anchor}">${escapeHTML(DOMAIN_LABELS[entry.domain])} ${entry.weight}%</text>`)
      angle = end
    })
    return `<svg class="practice-report-pie" viewBox="0 0 560 368" role="img" aria-label="PMP 领域占比与表现等级">${paths.join('')}${labels.join('')}</svg>`
  }
  function legendMarkup() {
    return `<ul class="practice-report-legend">${Object.keys(BAND_LABELS).map(band => `<li><i style="--band-color:${BAND_COLORS[band]}"></i>${BAND_LABELS[band]}</li>`).join('')}</ul>`
  }
  function bandScaleMarkup(report) {
    const bands = report?.bands || {}
    const points = [0, number(bands.needsImprovement || 50), number(bands.belowTarget || 60), number(bands.target || 80), 100]
    return Object.keys(BAND_LABELS).map((band, index) => {
      const width = Math.max(0, points[index + 1] - points[index])
      return `<span class="practice-report-band-segment" style="--band-color:${BAND_COLORS[band]};flex:${width} 0 0">${BAND_LABELS[band]}</span>`
    }).join('')
  }
  function domainRows(report) {
    const domains = report?.domains || {}
    return Object.keys(DOMAIN_LABELS).map((domain) => {
      const row = domains[domain] || {}
      const band = row.performanceBand || 'target'
      return `<tr><th>${DOMAIN_LABELS[domain]}</th><td>${number(row.weight ?? report?.domainWeights?.[domain])}%</td><td>${number(row.correct)} / ${number(row.total)}</td><td>${number(row.scorePercent).toFixed(2).replace(/\.00$/, '')}%</td><td><span class="practice-report-band" style="--band-color:${BAND_COLORS[band] || BAND_COLORS.target}">${BAND_LABELS[band] || band}</span></td></tr>`
    }).join('')
  }

  function render(root, report, options = {}) {
    if (!root || !report || report.official !== false) return false
    root.classList.add('has-practice-report')
    const counts = report.counts || {}
    const score = number(report.scorePercent)
    const resultClass = report.passed ? 'is-pass' : 'is-fail'
    const questionNumbers = options.questionNumbers || {}
    const wrongIds = Array.isArray(report.wrongQuestionIds) ? report.wrongQuestionIds : []
    const wrongButtons = wrongIds.map((id) => {
      const label = questionNumbers[id] ? `第 ${questionNumbers[id]} 题` : text(id)
      return `<button type="button" data-review-question="${escapeHTML(id)}" aria-label="回看${escapeHTML(label)}">${escapeHTML(label)}</button>`
    }).join('')
    root.innerHTML = `<article class="practice-result-report">
      <header class="practice-report-header"><img class="practice-report-logo" src="/assets/logo.jpg" alt="幻谱"/><div><span>HUANPU SIMULATION REPORT</span><h1>幻谱 PMP 模拟成绩分析报告</h1></div></header>
      <section class="practice-report-meta"><div><span>学员</span><strong>${escapeHTML(report.learner || '当前学员')}</strong></div><div><span>试卷</span><strong>${escapeHTML(report.paperName || 'PMP 模拟练习')}</strong></div><div><span>日期</span><strong>${escapeHTML(report.examDate || report.completedAt || '')}</strong></div><div><span>报告编号</span><strong>${escapeHTML(report.reportNumber || report.sessionId || '')}</strong></div></section>
      <section class="practice-report-overall ${resultClass}"><div><span>OVERALL PERFORMANCE</span><h2>${escapeHTML(report.resultLabel || `模拟考试结果：${report.passed ? 'PASS' : 'FAIL'}`)}</h2><p>本结果按本次会话的冻结规则生成。</p></div><div class="practice-report-score"><strong>${score.toFixed(2).replace(/\.00$/, '')}</strong><span>模拟分 / 100${report.maxScore ? ` · ${number(report.rawScore)} / ${number(report.maxScore)} 原始分` : ''}</span></div></section>
      <section class="practice-report-band-scale" aria-label="总体表现区间"><div class="practice-report-band-track">${bandScaleMarkup(report)}<i style="left:${Math.max(0, Math.min(100, score))}%" aria-label="你的模拟分 ${score}"></i></div></section>
      <section class="practice-report-counts"><div><span>总题数</span><strong>${number(counts.total)}</strong></div><div><span>答对</span><strong>${number(counts.correct)}</strong></div><div><span>答错</span><strong>${number(counts.wrong)}</strong></div><div><span>未答</span><strong>${number(counts.unanswered)}</strong></div><div><span>正确率</span><strong>${number(report.accuracyPercent ?? score).toFixed(2).replace(/\.00$/, '')}%</strong></div><div><span>累计用时</span><strong>${durationLabel(report.durationMs)}</strong></div></section>
      <section class="practice-report-breakdown"><header><span>EXAM BREAKDOWN</span><h2>考试领域分析</h2><p>扇区大小代表领域占比，颜色代表本领域的模拟表现等级。</p>${legendMarkup()}</header>${pieMarkup(report)}</section>
      <section class="practice-report-domains"><h2>各领域成绩</h2><div class="practice-report-table-scroll"><table class="practice-report-domain-table"><thead><tr><th>领域</th><th>占比</th><th>答对 / 总数</th><th>得分率</th><th>表现</th></tr></thead><tbody>${domainRows(report)}</tbody></table></div></section>
      <section class="practice-report-wrong"><div><h2>本次错题</h2><p>${wrongIds.length ? `共 ${wrongIds.length} 道，点击题号只读回看答案与解析。` : '本次作答没有错题。'}</p></div><div class="practice-report-wrong-list">${wrongButtons}</div></section>
      <section class="practice-report-next"><h2>下一步建议</h2><ul>${(Array.isArray(report.recommendations) ? report.recommendations : []).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul></section>
      <p class="practice-report-disclaimer">${escapeHTML(report.disclaimer || '幻谱模拟判定，不代表 PMI 官方考试成绩')}</p>
      <footer class="practice-report-actions"><button type="button" class="practice-primary-btn" data-report-again="true">再练一次</button><button type="button" class="practice-secondary-btn" data-report-lobby="true">返回大厅</button></footer>
      <div class="practice-report-page">${escapeHTML(report.pageNumber || '1 / 1')}</div>
    </article>`
    root.querySelectorAll('[data-review-question]').forEach(button => button.addEventListener('click', () => options.onReviewWrong?.(button.dataset.reviewQuestion)))
    root.querySelector('[data-report-again]')?.addEventListener('click', () => options.onAgain?.())
    root.querySelector('[data-report-lobby]')?.addEventListener('click', () => options.onLobby?.())
    return true
  }

  global.KGPracticeResultReport = Object.freeze({ render, BAND_COLORS })
})(window)
