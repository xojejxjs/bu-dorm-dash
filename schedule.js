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
  return text.replace(/[\[\]■□|{}]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// 把 Tesseract 的结果摊平成"文字片段"的数组
//
// 为什么要切成片段：日历里同一高度、左右并排的几个格子，OCR 常常会读成"一整行"，比如
//   "2 Silber Way WED 130   2 Silber Way WED 130   2 Silber Way WED 130"
// 同一个格子里的单词挨得很近，不同列之间有一大段空白。所以按单词之间的空隙把一行切开，
// 每一段就是一个格子里的一行文字，并记下它的位置（用来判断在哪一列、哪一天）
function flattenOcrLines(data) {
  const segments = [];

  (data.blocks || []).forEach(function (block) {
    (block.paragraphs || []).forEach(function (paragraph) {
      (paragraph.lines || []).forEach(function (line) {
        const words = (line.words || []).filter(function (w) { return w.text.trim() !== ''; });
        const height = line.bbox.y1 - line.bbox.y0;
        const y = (line.bbox.y0 + line.bbox.y1) / 2;

        // 这一行没有单词位置：整行当一个片段
        if (words.length === 0) {
          segments.push(makeSegment(line.text, line.bbox.x0, line.bbox.x1, y, height, []));
          return;
        }

        // 两个单词之间的空隙超过 1.5 倍行高（正常字间距的好几倍），就认为跨到了另一个格子，从这里切开
        const gapLimit = Math.max(height * 1.5, 20);
        let current = [words[0]];
        for (let i = 1; i < words.length; i++) {
          const gap = words[i].bbox.x0 - words[i - 1].bbox.x1;
          if (gap > gapLimit) {
            segments.push(segmentFromWords(current, y, height));
            current = [];
          }
          current.push(words[i]);
        }
        segments.push(segmentFromWords(current, y, height));
      });
    });
  });

  // 没有位置信息（比如旧版本的 Tesseract）：退回到纯文字，按换行拆开
  if (segments.length === 0 && data.text) {
    return textToLines(data.text);
  }
  return segments.filter(function (s) { return s.text !== ''; });
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

// 课号，比如 "CDSDS 110 (LEC)"、"SHAHF 150 (IND)"
const COURSE_PATTERN = /^([A-Z]{3,6})\s?(\d{3}[A-Z]?)\s*(?:\((\w{2,4})\))?/;

// 一段结尾的"楼宇代码 + 教室号"，比如 "... CAS B25A"、"... CDS 164"
const LOCATION_PATTERN = /(?:^|\s)([A-Z]{2,4})\s+([A-Z]?\d{1,4}[A-Z]?)\s*$/;

// 日历表头的日期，比如 "SEP 28"，或星期 "MON"
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

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
    const location = segment.text.match(LOCATION_PATTERN);
    if (!location) {
      return;
    }
    const code = location[1].toUpperCase();
    const place = findPlace(placeIndex, code, false); // 只认我们代码表里有的楼
    if (!place) {
      return;
    }

    // 往上找同一格子里的：时间、课号、课名。碰到上一门课的地点就停
    let time = '';
    let course = '';
    let section = '';
    let title = '';
    for (const above of neighborsInCell(segments, i, -1)) {
      if (LOCATION_PATTERN.test(above.text) && findPlace(placeIndex, above.text.match(LOCATION_PATTERN)[1], false)) {
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
        title = above.text;
      }
    }

    const day = dayOf(segment, dayColumns);
    classes.push({
      title: title || course || 'Class',
      course: course,
      section: section,
      time: time,
      code: code,
      room: location[2].toUpperCase(),
      place: place,
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
    if (!courseMatch || usedCourses.has(segment)) {
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
      title: above ? above.text : course,
      course: course,
      section: section,
      time: timeMatch ? normalizeTime(timeMatch) : ''
    });
  });

  return { located: merged, unlocated: unlocated };
}

console.log('schedule.js loaded');
