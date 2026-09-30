// schedule.js：只负责"课表截图 / 课表文字 → 课程列表"
// 图片用 Tesseract.js 在浏览器里识别（OCR），图片不会上传到任何服务器

// ===== 第一步：图片 → 带位置的文字行 =====

// 识别一张课表图片
// 输入：图片文件、进度回调（收到 0～1 之间的数字）
// 输出：[{ text, x, y }]：每一行文字，以及它在图片里的位置（x 是这一行中心的横坐标）
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
    // 第三个参数 { blocks: true }：除了纯文字，还要每一块、每一行文字的位置
    const result = await worker.recognize(file, {}, { blocks: true, text: true });
    return flattenOcrLines(result.data);
  } finally {
    await worker.terminate(); // 用完就关掉，释放内存
  }
}

// 把 Tesseract 的结果（块 → 段落 → 行）摊平成一个"行"的数组
function flattenOcrLines(data) {
  const lines = [];
  (data.blocks || []).forEach(function (block, b) {
    (block.paragraphs || []).forEach(function (paragraph, p) {
      // 同一个段落里的行，标上同一个编号（日历里一个格子通常识别成一个段落）
      const groupId = b + '-' + p;
      (paragraph.lines || []).forEach(function (line) {
        lines.push({
          text: line.text.trim(),
          x: (line.bbox.x0 + line.bbox.x1) / 2, // 这一行中心的横坐标，用来判断在哪一天那一列
          y: (line.bbox.y0 + line.bbox.y1) / 2,
          words: line.words || [],
          group: groupId
        });
      });
    });
  });

  // 没有位置信息（比如旧版本的 Tesseract）：退回到纯文字，按换行拆开
  if (lines.length === 0 && data.text) {
    return textToLines(data.text);
  }
  return lines.filter(function (line) { return line.text !== ''; });
}

// 纯文字（用户粘贴的，或 OCR 没给位置）→ 行。没有位置，所以认不出星期几
function textToLines(text) {
  return text.split('\n')
    .map(function (t) { return { text: t.trim(), x: null, y: null, words: [], group: null }; })
    .filter(function (line) { return line.text !== ''; });
}

// ===== 第二步：文字行 → 课程 =====

// 时间，比如 "8:00 - 9:15 am"、"1:25 - 2:15 pm"
const TIME_PATTERN = /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*(am|pm)/i;

// 课号，比如 "CDSDS 110 (LEC)"、"SHAHF 150 (IND)"
const COURSE_PATTERN = /^([A-Z]{3,6})\s?(\d{3}[A-Z]?)\s*(?:\((\w{2,4})\))?/;

// 一行结尾的"楼宇代码 + 教室号"，比如 "... CAS B25A"、"... CDS 164"
const LOCATION_PATTERN = /(?:^|\s)([A-Z]{2,4})\s+([A-Z]?\d{1,4}[A-Z]?)\s*$/;

// 日历表头的日期，比如 "SEP 28"，或星期 "MON"
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// 找出表头的每一天，以及它在图片里的横坐标
// 输出：[{ label: 'SEP 28', x: 572 }, ...]，按从左到右排好
function findDayColumns(lines) {
  const days = [];
  lines.forEach(function (line) {
    const words = line.words.length > 0 ? line.words : [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i].text.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const next = words[i + 1] ? words[i + 1].text.replace(/[^0-9]/g, '') : '';
      const center = (words[i].bbox.x0 + (words[i + 1] || words[i]).bbox.x1) / 2;

      if (MONTHS.includes(word) && next.length >= 1 && next.length <= 2) {
        days.push({ label: word + ' ' + next, x: center, y: line.y });
        i++; // 月份和日期是两个词，跳过日期那个
      } else if (WEEKDAYS.includes(word.slice(0, 3)) && word.length <= 9) {
        days.push({ label: word.slice(0, 3), x: (words[i].bbox.x0 + words[i].bbox.x1) / 2, y: line.y });
      }
    }
  });
  days.sort(function (a, b) { return a.x - b.x; });
  return days;
}

// 从文字行里找出所有课程
// 输入：行数组、地点搜索索引（用来确认楼宇代码是真实存在的）
// 输出：{ located, unlocated }
//   located：  有地点的课 [{ title, course, section, time, code, room, place, days: ['SEP 28', ...] }]，同一门课的多次上课会合并
//   unlocated：有课号、但没有地点的课（比如线上课）[{ title, course, section, time }]，交给用户决定：填地点，或者跳过
function parseSchedule(lines, placeIndex) {
  const dayColumns = findDayColumns(lines);
  const classes = [];
  const usedCourseLines = new Set(); // 已经和某个地点配上对的课号行，第二轮不再重复找

  lines.forEach(function (line, i) {
    const location = line.text.match(LOCATION_PATTERN);
    if (!location) {
      return;
    }
    const code = location[1].toUpperCase();
    const place = findPlace(placeIndex, code, false); // 只认我们代码表里有的楼
    if (!place) {
      return;
    }

    // 往上找（最多 4 行，且在同一个格子里）：时间、课号、课名
    let time = '';
    let course = '';
    let section = '';
    let title = '';
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      const above = lines[k];
      if (line.group && above.group !== line.group) {
        break; // 已经到了别的格子
      }
      const timeMatch = above.text.match(TIME_PATTERN);
      const courseMatch = above.text.match(COURSE_PATTERN);
      if (!time && timeMatch) {
        time = timeMatch[0].replace(/\s+/g, ' ');
      } else if (!course && courseMatch) {
        course = courseMatch[1] + ' ' + courseMatch[2];
        section = courseMatch[3] || '';
        usedCourseLines.add(k);
      } else if (!title && course) {
        title = above.text;
      }
    }

    // 这一格在哪一天：看它的横坐标离哪个日期最近
    let day = '';
    if (dayColumns.length > 0 && line.x !== null) {
      let best = dayColumns[0];
      dayColumns.forEach(function (d) {
        if (Math.abs(d.x - line.x) < Math.abs(best.x - line.x)) {
          best = d;
        }
      });
      day = best.label;
    }

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

  // 第二轮：有课号、但没配上地点的课（比如 "AI at BU / XRGAI 500 (IND)"，线上课没有教室）
  // 不自动放到地图上，只收集起来，交给用户决定
  const unlocated = [];
  lines.forEach(function (line, i) {
    const courseMatch = line.text.match(COURSE_PATTERN);
    if (!courseMatch || usedCourseLines.has(i)) {
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

    // 课名在上一行，时间在下一行（都要在同一个格子里）
    const above = lines[i - 1];
    const below = lines[i + 1];
    const sameCell = function (other) { return other && (!line.group || other.group === line.group); };
    const timeMatch = sameCell(below) ? below.text.match(TIME_PATTERN) : null;

    unlocated.push({
      title: sameCell(above) ? above.text : course,
      course: course,
      section: section,
      time: timeMatch ? timeMatch[0].replace(/\s+/g, ' ') : ''
    });
  });

  return { located: merged, unlocated: unlocated };
}

console.log('schedule.js loaded');
