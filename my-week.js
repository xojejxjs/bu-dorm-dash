// my-week.js：课间步行分析
//
// 导入课表以后，自动找出每天"上完一节、接着上下一节"的两节课，
// 算出课间有几分钟、走过去要几分钟，判断来不来得及（🟢 / 🟡 / 🔴）
// 用户不用自己去 Route check 里一对一对地选

const LONG_BREAK_MINUTES = 60; // 课间超过这么久，就不算"赶课"，收进折叠区

// 找出一周里所有"相邻两节课"之间的步行
// 输入：所有课（myClasses.items）
// 输出：{ walks, unchecked }
//   walks：[{ from, to, days, gap, kind, route }]，已经排好序（最需要注意的在最上面）
//     kind：'clash'（时间冲突）、'same'（同一栋楼）、'long'（课间很长）、'walk'（要走过去）
//     route：只有 kind 是 'walk' 时才有，是 judgeRoute 的结果 { meters, minutes, verdict, isEstimate }
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

  return { walks: walks, unchecked: unchecked };
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
