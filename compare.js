// compare.js：把几份课表放在一起比较（比如 Plan A 和 Plan B）
//
// 有两份以上课表时，切换栏后面有一个 "Compare" 按钮，点开在 My week 最上面显示一张对比表
// 数字全部用现有的函数算：课间步行用 my-week.js 的 findClassWalks，和 "Your walks between classes" 一定一致

// 对比表的每一行
//   better: 'low' 表示越小越好，会标出最好的那一格；没有 better 的行只显示数字
//   （"一周几天有课""最早几点上课"没有绝对的好坏：有人喜欢早上上课）
const COMPARE_ROWS = [
  { key: 'red', label: "🔴 Can't make", better: 'low' },
  { key: 'yellow', label: '🟡 Tight', better: 'low' },
  { key: 'clash', label: '⚠️ Time clashes', better: 'low' },
  { key: 'walkMinutes', label: 'Walking / week', better: 'low' },
  { key: 'buildings', label: 'Buildings', better: 'low' },
  { key: 'days', label: 'Days on campus' },
  { key: 'earliest', label: 'Earliest class' },
  { key: 'notChecked', label: 'Not checked yet' }
];

// 算一份课表的数字
// 输入：这份课表的课（和 myClasses.items 一样的格式）
// 输出：{ red, yellow, clash, walkMinutes, estimate, buildings, days, earliest, notChecked, checked }
function scheduleStats(items) {
  const result = findClassWalks(items);
  const stats = { red: 0, yellow: 0, clash: 0, walkMinutes: 0, estimate: false };

  result.walks.forEach(function (walk) {
    if (walk.kind === 'clash') {
      stats.clash++;
    }
    if (walk.kind === 'walk' && walk.route.verdict === 'red') {
      stats.red++;
    }
    if (walk.kind === 'walk' && walk.route.verdict === 'yellow') {
      stats.yellow++;
    }
    // 一周走多少分钟：每一段路 × 一周走几次。课间很长的也算（两栋楼之间总是要走的），同一栋楼不用走
    if (walk.kind === 'walk' || walk.kind === 'long') {
      const route = walk.route || judgeRoute(measureRoute(walk.from.place, walk.to.place), walk.gap);
      stats.walkMinutes += route.minutes * walk.days.length;
      if (route.isEstimate) {
        stats.estimate = true; // 有用直线估算的路（比如自己输入的地址），数字后面标 est.
      }
    }
  });

  // 不算用户跳过的课
  const active = items.filter(function (c) { return c.status !== 'skipped'; });
  const days = new Set();
  active.forEach(function (c) {
    c.days.forEach(function (d) { days.add(d); });
  });
  const starts = active.filter(function (c) { return c.start != null; }).map(function (c) { return c.start; });

  stats.buildings = new Set(result.checked.map(function (c) { return c.place.id; })).size;
  stats.days = days.size;
  stats.earliest = starts.length > 0 ? Math.min.apply(null, starts) : null;
  stats.notChecked = result.unchecked.length;
  stats.checked = result.checked.length;
  return stats;
}

// 一格里显示的文字
function compareCellText(key, stats) {
  if (key === 'walkMinutes') {
    return `~${stats.walkMinutes} min${stats.estimate ? ' est.' : ''}`;
  }
  if (key === 'earliest') {
    return stats.earliest == null ? '—' : formatClock(stats.earliest);
  }
  return String(stats[key]);
}

// ===== 显示 =====

// 对比表（renderMyClasses() 每次都会调用它）
function renderCompare() {
  const box = document.getElementById('schedule-compare');
  if (!myClasses.compareOpen || myClasses.schedules.length < 2) {
    myClasses.compareOpen = false;
    box.innerHTML = '';
    return;
  }

  // 每份课表的数字；当前这一份的课以 myClasses.items 为准
  const columns = myClasses.schedules.map(function (schedule) {
    const items = schedule.id === myClasses.activeId ? myClasses.items : schedule.items;
    return { schedule: schedule, stats: scheduleStats(items) };
  });
  // 还没有一门能检查的课（空的、或者全都没确认地点）：这一列没有可比的数字，不参与"最好"的比较
  const comparable = columns.filter(function (col) { return col.stats.checked > 0; });

  let html = '<div class="compare-box"><div class="compare-scroll"><table class="compare-table"><thead><tr><th></th>';
  columns.forEach(function (col) {
    const current = col.schedule.id === myClasses.activeId;
    // 点表头的名字：换到那一份课表
    html += `<th><button type="button" class="compare-name${current ? ' current' : ''}" data-schedule="${col.schedule.id}"
      ${current ? 'aria-current="true"' : ''}>${escapeHtml(col.schedule.name)}</button></th>`;
  });
  html += '</tr></thead><tbody>';

  COMPARE_ROWS.forEach(function (row) {
    // 这一行最好的值：只有能比的列多于一列、而且数字不全一样时才标
    let best = null;
    if (row.better === 'low' && comparable.length > 1) {
      const values = comparable.map(function (col) { return col.stats[row.key]; });
      const min = Math.min.apply(null, values);
      if (values.some(function (v) { return v !== min; })) {
        best = min;
      }
    }
    html += `<tr><th scope="row">${row.label}</th>`;
    columns.forEach(function (col) {
      const empty = col.stats.checked === 0;
      const isBest = !empty && best !== null && col.stats[row.key] === best;
      const text = empty ? '—' : compareCellText(row.key, col.stats);
      html += `<td class="${isBest ? 'best' : ''}">${escapeHtml(text)}${isBest ? '<span class="best-tag">best</span>' : ''}</td>`;
    });
    html += '</tr>';
  });
  html += `</tbody></table></div>
    <p class="hint compare-note">Walking / week adds up every walk between back-to-back classes, including long breaks.
      Tap a name to switch to that schedule.</p>
    <button type="button" class="link-button" data-action="close-compare">Close</button></div>`;
  box.innerHTML = html;
}

// 只需要绑定一次（事件委托）
function initCompare() {
  document.getElementById('schedule-compare').addEventListener('click', function (event) {
    const name = event.target.closest('button[data-schedule]');
    if (name) {
      switchSchedule(Number(name.dataset.schedule));
      return;
    }
    if (event.target.closest('[data-action="close-compare"]')) {
      myClasses.compareOpen = false;
      renderCompare();
      renderScheduleSwitcher();
    }
  });
}

console.log('compare.js loaded');
