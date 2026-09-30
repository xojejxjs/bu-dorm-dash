// schedule.js：只负责"课表截图 / 课表文字 → 课程列表"
// 图片用 Tesseract.js 在浏览器里识别（OCR），图片不会上传到任何服务器

// ===== 第一步：图片 → 带位置的文字片段 =====

// 识别一张课表图片
// 输入：图片文件、进度回调（收到 0～1 之间的数字）
// 输出：文字片段数组 [{ text, x, x0, x1, y, h, words }]（见 flattenOcrLines）
async function readScheduleImage(file, onProgress) {
  // createWorker('eng')：准备一个英文识别器。第一次会下载约 10 MB 的识别模型，之后浏览器会缓存
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: function (message) {
      if (message.status === 'recognizing text' && onProgress) {
        onProgress(message.progress);
      }
    }
  });

  try {
    // 第三个参数 { blocks: true }：除了纯文字，还要每一行、每个单词的位置
    const result = await worker.recognize(file, {}, { blocks: true, text: true });
    return flattenOcrLines(result.data);
  } finally {
    await worker.terminate(); // 用完就关掉，释放内存
  }
}

// 去掉 OCR 的"杂质"：课表格子右上角的小黑方块 ■ 常被认成 "[]"、"|" 之类的符号
function cleanText(text) {
  // 课表格子角上的小黑方块，OCR 可能认成 [] ■ | {} ®  ©，都去掉
  return text.replace(/[\[\]■□|{}®©]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// 把 Tesseract 的结果摊平成"文字片段"的数组
//
// 为什么要切成片段：日历里同一高度、左右并排的几个格子，OCR 常常会读成"一整行"，比如
//   "2 Silber Way WED 130   2 Silber Way WED 130   2 Silber Way WED 130"
// 同一个格子里的单词挨得很近，不同列之间有一大段空白。所以按单词之间的空隙把一行切开，
// 每一段就是一个格子里的一行文字，并记下它的位置（用来判断在哪一列、哪一天）
function flattenOcrLines(data) {
  // 先把 OCR 的每一行和它的单词取出来
  const rawLines = [];
  (data.blocks || []).forEach(function (block) {
    (block.paragraphs || []).forEach(function (paragraph) {
      (paragraph.lines || []).forEach(function (line) {
        rawLines.push({
          text: line.text,
          bbox: line.bbox,
          y: (line.bbox.y0 + line.bbox.y1) / 2,
          height: line.bbox.y1 - line.bbox.y0,
          words: (line.words || []).filter(function (w) { return w.text.trim() !== ''; })
        });
      });
    });
  });

  // 没有位置信息（比如旧版本的 Tesseract）：退回到纯文字，按换行拆开
  if (rawLines.length === 0) {
    return data.text ? textToLines(data.text) : [];
  }

  // 第一遍：按单词之间的大空隙切开（主要是为了先找到表头的日期）
  const byGaps = splitLinesByGaps(rawLines);

  // 第二遍：如果找到了表头日期，就按日期所在的列来切，比猜空隙大小可靠得多
  const dayColumns = findDayColumns(byGaps);
  const segments = dayColumns.length >= 2 ? splitLinesByColumns(rawLines, dayColumns) : byGaps;

  return segments.filter(function (s) { return s.text !== ''; });
}

// 按空隙切：两个单词之间的空隙超过 1.5 倍行高（正常字间距的好几倍），就认为跨到了另一个格子
function splitLinesByGaps(rawLines) {
  const segments = [];
  rawLines.forEach(function (line) {
    if (line.words.length === 0) {
      segments.push(makeSegment(line.text, line.bbox.x0, line.bbox.x1, line.y, line.height, []));
      return;
    }
    const gapLimit = Math.max(line.height * 1.5, 20);
    let current = [line.words[0]];
    for (let i = 1; i < line.words.length; i++) {
      const gap = line.words[i].bbox.x0 - line.words[i - 1].bbox.x1;
      if (gap > gapLimit) {
        segments.push(segmentFromWords(current, line.y, line.height));
        current = [];
      }
      current.push(line.words[i]);
    }
    segments.push(segmentFromWords(current, line.y, line.height));
  });
  return segments;
}

// 按列切：相邻两个日期的中点就是两列的分界线；每个单词看它的中心落在哪一列
// 第一列左边的内容（比如时间轴上的 "8 AM"）单独成一组，不会粘到课名上
function splitLinesByColumns(rawLines, dayColumns) {
  const xs = dayColumns.map(function (d) { return d.x; });
  const halfWidth = (xs[1] - xs[0]) / 2;
  // 分界线：[第一列左边界, 第1和第2列中点, ..., 最后一列右边界]
  const borders = [xs[0] - halfWidth];
  for (let i = 1; i < xs.length; i++) {
    borders.push((xs[i - 1] + xs[i]) / 2);
  }
  borders.push(xs[xs.length - 1] + halfWidth);

  // 两个单词之间的空白里，有没有一条列分界线（左右各留 8 像素误差）
  // 分界线只会落在格子之间的空白里，不会落在一个单词中间，所以只在这种空白处切
  function borderInGap(left, right) {
    return borders.some(function (b) {
      return b > left.bbox.x1 - 8 && b < right.bbox.x0 + 8;
    });
  }

  const segments = [];
  rawLines.forEach(function (line) {
    if (line.words.length === 0) {
      segments.push(makeSegment(line.text, line.bbox.x0, line.bbox.x1, line.y, line.height, []));
      return;
    }
    let current = [line.words[0]];
    for (let i = 1; i < line.words.length; i++) {
      const left = line.words[i - 1];
      const right = line.words[i];
      const gap = right.bbox.x0 - left.bbox.x1;
      // 切开的条件：空白里有列分界线（而且比正常字间距大一点），或者空白本身就特别大
      if ((borderInGap(left, right) && gap > line.height * 0.3) || gap > line.height * 1.5) {
        segments.push(segmentFromWords(current, line.y, line.height));
        current = [];
      }
      current.push(right);
    }
    segments.push(segmentFromWords(current, line.y, line.height));
  });
  return segments;
}

function segmentFromWords(words, y, height) {
  const text = words.map(function (w) { return w.text; }).join(' ');
  return makeSegment(text, words[0].bbox.x0, words[words.length - 1].bbox.x1, y, height, words);
}

// 一个文字片段：text 文字；x0～x1 左右边界；x 中心；y 纵向位置；h 行高；words 单词（找表头日期用）
function makeSegment(text, x0, x1, y, height, words) {
  return { text: cleanText(text), x: (x0 + x1) / 2, x0: x0, x1: x1, y: y, h: height, words: words };
}

// 纯文字（用户粘贴的）→ 片段。没有位置，所以认不出星期几，只能按上下行的顺序找
function textToLines(text) {
  return text.split('\n')
    .map(function (t) { return { text: cleanText(t), x: null, x0: null, x1: null, y: null, h: null, words: [] }; })
    .filter(function (line) { return line.text !== ''; });
}

// ===== 第二步：文字片段 → 课程 =====

// 时间，比如 "8:00 - 9:15 am"、"2:30-3:20 pm"
const TIME_PATTERN = /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*(am|pm)/i;

// 课号，比如 "CDSDS 110 (LEC)"、"CASMA 123 LEC"、"CASCH 171 PLB"
// BU 的课号是 5 个字母（学院 3 个 + 系 2 个，CAS + MA = CASMA），这样 "CAS 216" 这种教室不会被当成课号
const COURSE_PATTERN = /^([A-Z]{5})\s?(\d{3}[A-Z]?)\s*(?:\(?([A-Z]{3})\)?)?/;

// 课名前面可能粘上了左边时间轴的 "8 AM"、"PM"，去掉
function cleanTitle(text) {
  return text.replace(/^(\d{1,2}\s*)?(AM|PM)\b\s*/i, '').trim();
}

// 一段结尾的"楼宇代码 + 教室号"，比如 "... CAS B25A"、"... CDS 164"
const LOCATION_PATTERN = /(?:^|\s)([A-Z]{2,4})\s+([A-Z]?\d{1,4}[A-Z]?)\s*$/;

// 日历表头的日期，比如 "SEP 28"，或星期 "MON"
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// ===== 找楼：先按楼宇代码，找不到再按地址 =====

// 把地址文字拆成 { from, to, street }，比如 "685-725 Comm Ave CAS 211" → { 685, 725, 'commonwealth ave' }
// 缩写统一成同一种写法，这样 "Comm Ave"、"Commonwealth Avenue" 都能和 data.json 里的地址对上
function parseAddress(text) {
  let t = text.toLowerCase().replace(/[–—]/g, '-');
  t = t.replace(/\bcomm\.?\s+ave\.?/g, 'commonwealth ave')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd')
    .replace(/\./g, '');
  const m = t.match(/(\d+)(?:\s*-\s*(\d+))?\s+([a-z'’]+(?:\s+[a-z'’]+)*?)\s+(ave|st|rd|way|mall|dr|blvd)\b/);
  if (!m) {
    return null;
  }
  return { from: Number(m[1]), to: Number(m[2] || m[1]), street: m[3] + ' ' + m[4] };
}

// 按地址找楼：同一条街、门牌号范围有重叠就算对上
// 有好几个对上时（比如 "685-725 Comm Ave" 同时包括 CAS 的 725 和 Warren 的 700），
// 优先教学楼，再优先门牌号正好是范围两端的那个
function findPlaceByAddress(text, placeIndex) {
  const target = parseAddress(text);
  if (!target) {
    return undefined;
  }
  const seen = new Set();
  const candidates = [];
  placeIndex.forEach(function (entry) {
    const place = entry.place;
    if (seen.has(place.id) || !place.address) {
      return;
    }
    seen.add(place.id);
    const address = parseAddress(place.address);
    if (address && address.street === target.street &&
        address.from <= target.to && target.from <= address.to) {
      const score = (place.type === 'academic' ? 0 : 10) +
        (address.from === target.from || address.to === target.to ? 0 : 1);
      candidates.push({ place: place, score: score });
    }
  });
  candidates.sort(function (a, b) { return a.score - b.score; });
  return candidates.length > 0 ? candidates[0].place : undefined;
}

// 判断一段文字是不是"上课地点"，是的话认出是哪栋楼
// 输出：{ place, code, room }；不是地点时返回 null
function matchLocation(text, placeIndex) {
  // 1. 结尾是"楼宇代码 + 教室号"，而且代码在我们的代码表里：最准确
  const m = text.match(LOCATION_PATTERN);
  if (m) {
    const place = findPlace(placeIndex, m[1].toUpperCase(), false);
    if (place) {
      return { place: place, code: m[1].toUpperCase(), room: m[2].toUpperCase() };
    }
  }
  // 2. 代码认不出（比如 OCR 把 CAS 认错了）：按地址找
  const byAddress = findPlaceByAddress(text, placeIndex);
  if (byAddress) {
    const room = text.match(/\s([A-Z]?\d{1,4}[A-Z]?)\s*$/);
    return { place: byAddress, code: byAddress.code || '', room: room ? room[1].toUpperCase() : '' };
  }
  return null;
}

// 统一时间的写法："2:30-3:20 pm" 和 "2:30 - 3:20 pm" 当成同一个，方便合并
function normalizeTime(match) {
  return `${match[1]} - ${match[2]} ${match[3].toLowerCase()}`;
}

// 找出表头的每一天，以及它在图片里的横坐标
// 只有"整段文字就是一个日期"才算表头，比如 "SEP 28"、"MON"、"Monday 9/28"
// （不能只看有没有这个词：Wheelock 的楼宇代码 "WED" 会被误认成星期三）
// 输出：[{ label: 'SEP 28', x: 572 }, ...]，按从左到右排好
function findDayColumns(segments) {
  const monthDay = new RegExp('^(' + MONTHS.join('|') + ')[A-Z]*\\.?\\s+(\\d{1,2})$', 'i');
  const weekday = new RegExp('^(' + WEEKDAYS.join('|') + ')[A-Z]*\\.?(\\s+\\d{1,2}(/\\d{1,2})?)?$', 'i');

  const days = [];
  segments.forEach(function (segment) {
    if (segment.x === null) {
      return;
    }
    const m = segment.text.match(monthDay);
    const w = segment.text.match(weekday);
    if (m) {
      days.push({ label: m[1].toUpperCase() + ' ' + m[2], x: segment.x });
    } else if (w) {
      days.push({ label: w[1].toUpperCase(), x: segment.x });
    }
  });
  days.sort(function (a, b) { return a.x - b.x; });
  return days;
}

// 找出和某个片段"在同一个格子里"的其他片段，按离它的远近排好
// 有位置：横向有重叠（同一列），纵向在 5 行以内，而且在它上面（direction = -1）或下面（direction = 1）
// 没有位置（粘贴的文字）：就按上下行的顺序
function neighborsInCell(segments, index, direction) {
  const self = segments[index];

  if (self.x === null) {
    const result = [];
    for (let k = index + direction; k >= 0 && k < segments.length && result.length < 4; k += direction) {
      result.push(segments[k]);
    }
    return result;
  }

  return segments
    .filter(function (other) {
      const sameColumn = other.x0 < self.x1 && other.x1 > self.x0;
      const dy = (other.y - self.y) * direction;
      return other !== self && sameColumn && dy > 0 && dy < self.h * 6;
    })
    .sort(function (a, b) { return Math.abs(a.y - self.y) - Math.abs(b.y - self.y); })
    .slice(0, 4);
}

// 这个片段在哪一天：看它的横坐标离哪个表头日期最近
function dayOf(segment, dayColumns) {
  if (dayColumns.length === 0 || segment.x === null) {
    return '';
  }
  let best = dayColumns[0];
  dayColumns.forEach(function (d) {
    if (Math.abs(d.x - segment.x) < Math.abs(best.x - segment.x)) {
      best = d;
    }
  });
  return best.label;
}

// 从文字片段里找出所有课程
// 输入：片段数组、地点搜索索引（用来确认楼宇代码是真实存在的）
// 输出：{ located, unlocated }
//   located：  有地点的课 [{ title, course, section, time, code, room, place, days: ['SEP 28', ...] }]，同一门课的多次上课会合并
//   unlocated：有课号、但没有地点的课（比如线上课）[{ title, course, section, time }]，交给用户决定：填地点，或者跳过
function parseSchedule(segments, placeIndex) {
  const dayColumns = findDayColumns(segments);
  const classes = [];
  const usedCourses = new Set(); // 已经和某个地点配上对的课号片段，第二轮不再重复找

  segments.forEach(function (segment, i) {
    // 这一段是不是上课地点：先按楼宇代码认，认不出再按地址认
    const location = matchLocation(segment.text, placeIndex);
    if (!location) {
      return;
    }

    // 往上找同一格子里的：时间、课号、课名。碰到上一门课的地点就停
    let time = '';
    let course = '';
    let section = '';
    let title = '';
    for (const above of neighborsInCell(segments, i, -1)) {
      if (matchLocation(above.text, placeIndex)) {
        break; // 已经到了上一门课
      }
      const timeMatch = above.text.match(TIME_PATTERN);
      const courseMatch = above.text.match(COURSE_PATTERN);
      if (!time && timeMatch) {
        time = normalizeTime(timeMatch);
      } else if (!course && courseMatch) {
        course = courseMatch[1] + ' ' + courseMatch[2];
        section = courseMatch[3] || '';
        usedCourses.add(above);
      } else if (!title && course) {
        title = cleanTitle(above.text);
      }
    }

    const day = dayOf(segment, dayColumns);
    classes.push({
      title: title || course || 'Class',
      course: course,
      section: section,
      time: time,
      code: location.code,
      room: location.room,
      place: location.place,
      days: day ? [day] : []
    });
  });

  // 合并：同一门课、同一时间、同一教室，只是日期不同 → 一条
  const merged = [];
  classes.forEach(function (c) {
    const same = merged.find(function (m) {
      return m.course === c.course && m.section === c.section && m.time === c.time &&
        m.code === c.code && m.room === c.room;
    });
    if (same) {
      c.days.forEach(function (d) {
        if (!same.days.includes(d)) {
          same.days.push(d);
        }
      });
    } else {
      merged.push(c);
    }
  });

  // 日期按表头从左到右的顺序排
  const dayOrder = dayColumns.map(function (d) { return d.label; });
  merged.forEach(function (c) {
    c.days.sort(function (a, b) { return dayOrder.indexOf(a) - dayOrder.indexOf(b); });
  });

  // 第二轮：有课号、但没配上地点的课（比如 "AI at BU / XRGAI 500 (IND)"，线上课没有教室）
  // 不自动放到地图上，只收集起来，交给用户决定
  const unlocated = [];
  segments.forEach(function (segment, i) {
    const courseMatch = segment.text.match(COURSE_PATTERN);
    if (!courseMatch || usedCourses.has(segment) || matchLocation(segment.text, placeIndex)) {
      return;
    }
    const course = courseMatch[1] + ' ' + courseMatch[2];
    const section = courseMatch[3] || '';

    // 同一门课（课号和类型都一样）只问一次；已经有地点的也不再问
    const known = merged.concat(unlocated).some(function (c) {
      return c.course === course && c.section === section;
    });
    if (known) {
      return;
    }

    // 课名在上面一行，时间在下面一行
    const above = neighborsInCell(segments, i, -1)[0];
    const below = neighborsInCell(segments, i, 1)[0];
    const timeMatch = below ? below.text.match(TIME_PATTERN) : null;

    unlocated.push({
      title: above ? cleanTitle(above.text) : course,
      course: course,
      section: section,
      time: timeMatch ? normalizeTime(timeMatch) : ''
    });
  });

  return { located: merged, unlocated: unlocated };
}

console.log('schedule.js loaded');
