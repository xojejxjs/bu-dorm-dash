// my-week.js：课间步行分析
//
// 导入课表以后，自动找出每天"上完一节、接着上下一节"的两节课，
// 算出课间有几分钟、走过去要几分钟，判断来不来得及（🟢 / 🟡 / 🔴）
// 用户不用自己去 Route check 里一对一对地选

const LONG_BREAK_MINUTES = 60; // 课间超过这么久，就不算"赶课"，收进折叠区

// 最近一次算出来的步行列表：点某一行时，按行上的编号（data-walk）找到是哪一段
let shownWalks = [];

// 找出一周里所有"相邻两节课"之间的步行
// 输入：所有课（myClasses.items）
// 输出：{ walks, checked, unchecked }
//   walks：[{ from, to, days, gap, kind, route }]，已经排好序（最需要注意的在最上面）
//     kind：'clash'（时间冲突）、'same'（同一栋楼）、'long'（课间很长）、'walk'（要走过去）
//     route：只有 kind 是 'walk' 时才有，是 judgeRoute 的结果 { meters, minutes, verdict, isEstimate }
//   checked：检查了的课（确定了地点、有时间和星期）
//   unchecked：没法检查的课（还没有地点，或者没有上课时间 / 星期）
function findClassWalks(items) {
  const checkable = [];
  const unchecked = [];
  items.forEach(function (c) {
    if (c.status === 'skipped') {
      return; // 用户自己跳过的课，不算，也不提
    }
    if (c.status === 'confirmed' && c.place && c.start != null && c.end != null && c.days.length > 0) {
      checkable.push(c);
    } else {
      unchecked.push(c);
    }
  });

  // 1. 每天把课按开始时间排好，取相邻的两节
  const walks = [];
  DAY_ORDER.forEach(function (day) {
    const today = checkable
      .filter(function (c) { return c.days.includes(day); })
      .sort(function (a, b) { return a.start - b.start || a.end - b.end; });

    for (let i = 1; i < today.length; i++) {
      const prev = today[i - 1];
      const next = today[i];
      const gap = next.start - prev.end;

      // 2. 同一对课、同样的课间：每周出现在好几天（比如周一三五），合成一行
      const same = walks.find(function (w) {
        return w.from === prev && w.to === next && w.gap === gap;
      });
      if (same) {
        same.days.push(day);
      } else {
        walks.push(describeWalk(prev, next, gap, day));
      }
    }
  });

  // 3. 排序：冲突 → 🔴 → 🟡 → 🟢 → 课间很长；同一级里，按星期和时间
  walks.sort(function (a, b) {
    return walkRank(a) - walkRank(b) ||
      DAY_ORDER.indexOf(a.days[0]) - DAY_ORDER.indexOf(b.days[0]) ||
      a.from.end - b.from.end;
  });

  return { walks: walks, checked: checkable, unchecked: unchecked };
}

// 判断一对相邻的课属于哪种情况
// 输入：前一节课、后一节课、课间分钟数、星期几
// 输出：{ from, to, days, gap, kind, route }
function describeWalk(prev, next, gap, day) {
  const walk = { from: prev, to: next, days: [day], gap: gap, kind: 'walk', route: null };
  if (gap < 0) {
    walk.kind = 'clash';  // 后一节在前一节下课之前就开始了
  } else if (prev.place.id === next.place.id) {
    walk.kind = 'same';   // 同一栋楼，不用走
  } else if (gap > LONG_BREAK_MINUTES) {
    walk.kind = 'long';   // 课间很长，不用赶
  } else {
    // 和 Route check 用同一套规则：先查表，查不到就直线估算（isEstimate）
    walk.route = judgeRoute(measureRoute(prev.place, next.place), gap);
  }
  return walk;
}

// 排序用的等级：数字越小越靠前
function walkRank(walk) {
  if (walk.kind === 'clash') {
    return 0;
  }
  if (walk.kind === 'walk') {
    return { red: 1, yellow: 2, green: 3 }[walk.route.verdict];
  }
  if (walk.kind === 'same') {
    return 3; // 和 🟢 同一级
  }
  return 4;   // 'long'
}

// ===== 显示 =====

// 在 My classes 下面显示 "Your walks between classes"
// renderMyClasses() 每次最后都会调用它，所以课表一变，这里就重新算
function renderClassWalks() {
  const box = document.getElementById('class-walks');
  const result = findClassWalks(myClasses.items);
  shownWalks = result.walks;

  // 还没有课（或者全都跳过了）：什么都不显示
  if (result.checked.length === 0 && result.unchecked.length === 0) {
    box.innerHTML = '';
    return;
  }

  const urgent = result.walks.filter(function (w) { return w.kind !== 'long'; });
  const long = result.walks.filter(function (w) { return w.kind === 'long'; });

  let html = '<h3>Your walks between classes</h3>';

  if (result.walks.length > 0) {
    // 先给结论：一行总结，一眼看出有没有问题
    html += renderWalkSummary(urgent);
    html += `<p class="hint">Each day, from one class to the next. 🟢 means at least ${BUFFER_MINUTES} min to spare.</p>`;
  } else if (result.checked.length > 0) {
    html += '<p class="hint">No back-to-back classes on the same day, so there are no walks to check.</p>';
  } else {
    html += '<p class="hint">Confirm where your classes are above, then the walks between them show up here.</p>';
  }

  // 1. 要注意的：冲突、🔴、🟡、🟢（已经按这个顺序排好）
  if (urgent.length > 0) {
    html += '<ul class="walk-list">' + urgent.map(renderWalkRow).join('') + '</ul>';
    html += '<p class="hint">Tap a walk to see the route on the map.</p>';
  }

  // 2. 课间很长的：不用赶，折叠起来
  if (long.length > 0) {
    html += `<details class="walk-long"><summary>Longer breaks, over ${LONG_BREAK_MINUTES} min (${long.length})</summary>
      <ul class="walk-list">${long.map(renderWalkRow).join('')}</ul></details>`;
  }

  // 3. 没法检查的课：说出来，不然用户会以为"没显示 = 没问题"
  if (result.unchecked.length > 0) {
    const names = result.unchecked.map(function (c) {
      return `${escapeHtml(c.title)} (${uncheckedReason(c)})`;
    });
    html += `<p class="hint walk-unchecked">Not checked yet: ${names.join(', ')}.</p>`;
  }

  box.innerHTML = html;
}

// 一行：星期和时间 / 从哪门课 / 到哪门课 / 课间多久、走多久、结论
function renderWalkRow(walk) {
  const from = walk.from;
  const to = walk.to;
  const days = walk.days.join(', ');

  let icon;
  let color;
  let when = `${formatClock(from.end)} → ${formatClock(to.start)}`;
  let detail;

  if (walk.kind === 'clash') {
    icon = '⚠️';
    color = 'clash';
    when = `${formatClock(from.start)}–${formatClock(from.end)} and ${formatClock(to.start)}–${formatClock(to.end)}`;
    detail = `Time clash: these overlap by ${-walk.gap} min`;
  } else if (walk.kind === 'same') {
    icon = '🟢';
    color = 'green';
    detail = `${walk.gap} min break · same building, no walk needed`;
  } else if (walk.kind === 'long') {
    icon = '🟢';
    color = 'long';
    detail = `${formatBreak(walk.gap)} break`;
  } else {
    const route = walk.route;
    icon = { green: '🟢', yellow: '🟡', red: '🔴' }[route.verdict];
    color = route.verdict;
    // 估算要说清楚，不能让它看起来像真实路线
    const walkText = `~${route.minutes} min walk${route.isEstimate ? ' (estimate)' : ''}`;
    detail = `${walk.gap} min break · ${walkText} · ${spareText(walk.gap - route.minutes)}`;
  }

  const content = `
      <span class="walk-when">${icon} ${escapeHtml(days)} · ${escapeHtml(when)}</span>
      <strong>${escapeHtml(from.title)} <span class="walk-where">${escapeHtml(classWhere(from))}</span></strong>
      <strong>→ ${escapeHtml(to.title)} <span class="walk-where">${escapeHtml(classWhere(to))}</span></strong>
      <span class="walk-detail">${escapeHtml(detail)}</span>`;

  // 时间冲突：没有课间可以走，不能点
  if (walk.kind === 'clash') {
    return `<li><div class="walk-row walk-${color}">${content}</div></li>`;
  }
  // 其他的做成按钮：点了在 Route check 里显示这段路（用 button，键盘 Tab + 回车也能用）
  const index = shownWalks.indexOf(walk);
  return `<li><button type="button" class="walk-row walk-${color}" data-walk="${index}">${content}
      <span class="walk-show">Show route on map ›</span></button></li>`;
}

// 点了某一行：Route check 里填好这两节课和课间分钟数，地图上画出路线，然后滚到结果
function handleWalkClick(event) {
  const row = event.target.closest('button[data-walk]');
  if (!row) {
    return;
  }
  const walk = shownWalks[Number(row.dataset.walk)];
  if (!walk) {
    return;
  }
  // 在地图上画出这段路（Route check 也会填好，切过去就能看到详细结果）
  // 留在 My week 里不跳走：这一行本身已经写了结论；地图在旁边（手机上在上面）
  fillRouteCheck(walk.from, walk.to, walk.gap);
  document.querySelectorAll('#class-walks .walk-row.selected').forEach(function (el) {
    el.classList.remove('selected');
  });
  row.classList.add('selected');
}

// 一行总结：🔴 1 can't make · 🟡 1 tight · 🟢 2 fine（还有时间冲突的话也写上）
// 每一项数的是"一行"，也就是同一对课（一周里重复的算一行）
function renderWalkSummary(walks) {
  function count(test) {
    return walks.filter(test).length;
  }
  const clash = count(function (w) { return w.kind === 'clash'; });
  const red = count(function (w) { return w.kind === 'walk' && w.route.verdict === 'red'; });
  const yellow = count(function (w) { return w.kind === 'walk' && w.route.verdict === 'yellow'; });
  const green = count(function (w) { return w.kind === 'same' || (w.kind === 'walk' && w.route.verdict === 'green'); });

  const parts = [];
  if (clash > 0) {
    parts.push(`<span class="summary-item summary-clash">⚠️ ${clash} time ${clash === 1 ? 'clash' : 'clashes'}</span>`);
  }
  parts.push(`<span class="summary-item summary-red">🔴 ${red} can't make</span>`);
  parts.push(`<span class="summary-item summary-yellow">🟡 ${yellow} tight</span>`);
  parts.push(`<span class="summary-item summary-green">🟢 ${green} fine</span>`);
  return `<p class="walk-summary">${parts.join('')}</p>`;
}

// 只需要绑定一次：#class-walks 里面的内容每次都会重画，但它本身不变（事件委托）
function initClassWalks() {
  document.getElementById('class-walks').addEventListener('click', handleWalkClick);
}

// 走到以后还剩几分钟 → 一句话（和 judgeRoute 用的是同一个"剩余分钟"）
function spareText(spare) {
  if (spare < 0) {
    return `${-spare} min late`;
  }
  if (spare === 0) {
    return 'just on time';
  }
  return `${spare} min to spare`;
}

// 145 → "2 hr 25 min"；不到 1 小时就只写分钟
function formatBreak(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) {
    return `${m} min`;
  }
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

// 为什么这门课没法检查
function uncheckedReason(c) {
  if (c.status !== 'confirmed' || !c.place) {
    return 'no location yet';
  }
  if (c.start == null || c.end == null) {
    return 'no class time';
  }
  return 'no class days';
}
