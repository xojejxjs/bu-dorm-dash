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

// 几份课表里相同的课（比如刚认识的同专业同学：导入她的课表，看看你们是不是上同一门课、甚至同一个 section）
// 输入：[{ schedule, items }]
// 输出：[{ course, title, entries: [{ name, meetings }], together }]，按课号排好
//   entries：这门课出现在哪几份课表里，每份课表里是哪几个时段
//   together：所有这几份课表里时间完全一样的时段（同一个 section），没有就是空数组
function commonClasses(columns) {
  const byCourse = {};
  columns.forEach(function (col) {
    col.items.forEach(function (c) {
      if (c.status === 'skipped' || !c.course) {
        return;
      }
      const key = c.course.toUpperCase();
      if (!byCourse[key]) {
        byCourse[key] = { course: c.course, title: c.title, entries: [] };
      }
      let entry = byCourse[key].entries.find(function (e) { return e.schedule === col.schedule; });
      if (!entry) {
        entry = { schedule: col.schedule, name: col.schedule.name, meetings: [] };
        byCourse[key].entries.push(entry);
      }
      entry.meetings.push(c);
    });
  });

  return Object.keys(byCourse).sort().map(function (key) {
    return byCourse[key];
  }).filter(function (group) {
    return group.entries.length >= 2; // 至少两份课表里都有，才算"相同的课"
  }).map(function (group) {
    // 第一份课表里的时段，在其他每一份里都找得到一模一样的（同一个 section、同一个时间）
    const others = group.entries.slice(1);
    group.together = group.entries[0].meetings.filter(function (m) {
      return others.every(function (e) {
        return e.meetings.some(function (o) { return sameMeeting(m, o); });
      });
    });
    return group;
  });
}

// "相同的课"那一块的 HTML
function renderCommonClasses(columns) {
  const groups = commonClasses(columns);
  let html = '<div class="compare-common"><h4>Classes in common</h4>';
  if (groups.length === 0) {
    html += '<p class="hint">No classes in common.</p>';
  } else {
    html += '<ul class="common-list">';
    groups.forEach(function (group) {
      const names = group.entries.map(function (e) { return escapeHtml(e.name); }).join(', ');
      let detail;
      if (group.together.length > 0) {
        // 同一个时段：一起上课
        const when = group.together.map(function (m) {
          return escapeHtml(shortWhen(m) + (m.place ? ' · ' + classWhere(m) : ''));
        }).join('; ');
        detail = `<span class="common-same">✓ Same time: ${when}</span>`;
      } else {
        detail = '<span class="common-diff">Same course, different times</span>';
      }
      html += `<li><strong>${escapeHtml(group.title)}</strong> <span class="common-code">${escapeHtml(group.course)}</span>
        <span class="common-in">In: ${names}</span>${detail}</li>`;
    });
    html += '</ul>';
  }
  return html + '</div>';
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
    return { schedule: schedule, items: items, stats: scheduleStats(items) };
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
  html += '</tbody></table></div>';
  html += renderCommonClasses(columns);
  html += `
    <p class="hint compare-note">Walking / week adds up every walk between back-to-back classes, including long breaks.
      Tap a name to switch to that schedule.
      Tip: save a friend's calendar file as a new schedule to see the classes you share. It stays in your browser.</p>
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
