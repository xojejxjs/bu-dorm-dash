// my-classes.js：只负责 "My classes" 区域的显示和交互
//
// 每门课都有一个状态：
//   confirmed：确定了地点（从课表读到的，或用户确认过的）→ 显示在地图上
//   guess：    课表没写地点，但根据课号能推测出候选楼 → 需要用户点开、看清楚后自己选
//   none：     课表没写地点，也推测不出来（比如线上课）→ 用户可以填地点，或跳过
//   skipped：  用户跳过的 → 收进 "Skipped"，随时可以恢复
//
// 原则：只有"读到的"可以直接上地图；"猜的"一定要用户确认。任何操作都能 Edit、Undo、Restore

const myClasses = {
  items: [],        // 所有课
  placeIndex: null, // 地点搜索索引（app.js 建好后传进来）
  openId: null,     // 当前展开（正在确认 / 编辑）的是哪门课
  undo: null        // 上一步之前的样子，用来 Undo
};
let nextClassId = 1;
let toastTimer = null;

// ===== 工具函数 =====

// 把文字里的 < > & 等符号换成安全的写法，再放进 innerHTML
// 课名是从用户的图片里识别出来的，不能当成 HTML 执行
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 把用户输入的地点文字变成地点："CAS 211"（楼宇代码 + 教室）或者地点名 "GSU"、"Mugar"
// 输出：{ place, room }；空的或找不到时是 null
function resolveLocationText(text, placeIndex) {
  if (text.trim() === '') {
    return null;
  }
  const classroom = parseClassroom(text);
  if (classroom) {
    const building = findPlace(placeIndex, classroom.code, false);
    return building ? { place: building, room: classroom.room } : null;
  }
  const place = findPlace(placeIndex, text, true);
  return place ? { place: place, room: '' } : null;
}

// 把地点显示成一行文字：楼名 · room 211
function locationLabel(place, room) {
  return escapeHtml(place.name) + (room ? ` · room ${escapeHtml(room)}` : '');
}

// 每栋楼的颜色：地图上的标签和列表里的卡片用同一种颜色，一眼就能对上
// 避开了地图上已经用过的颜色（宿舍红、教学楼蓝、娱乐紫、食堂橙、学生服务青绿、路线蓝）
const BUILDING_COLORS = ['#d81b60', '#2e7d32', '#6d4c41', '#455a64', '#827717', '#283593', '#bf360c', '#37474f'];
const buildingColors = {}; // 楼的 id → 颜色。记住已经分配的，确认别的课时颜色不会变

function buildingColor(place) {
  if (!buildingColors[place.id]) {
    const used = Object.keys(buildingColors).length;
    buildingColors[place.id] = BUILDING_COLORS[used % BUILDING_COLORS.length];
  }
  return buildingColors[place.id];
}

// 一门课的"身份"：课号 + 类型 + 时间都一样，就是同一门课（用来合并多张截图的结果）
function classKey(c) {
  return [c.course, c.section, c.time].join('|');
}

// ===== 状态变化 =====

// 记下现在的样子，以便 Undo；然后执行修改、重新显示、弹出提示
function changeWithUndo(message, change) {
  myClasses.undo = myClasses.items.map(function (item) {
    return Object.assign({}, item, { days: item.days.slice() });
  });
  change();
  myClasses.openId = null;
  clearClassPreview();
  renderMyClasses();
  showToast(message);
}

// 把 parseSchedule 的结果加进来（以后上传多张截图时，也用它合并）
function addParsedSchedule(result) {
  const incoming = [];

  result.located.forEach(function (c) {
    incoming.push(Object.assign({}, c, { status: 'confirmed', source: 'schedule' }));
  });

  result.unlocated.forEach(function (c) {
    const candidates = guessLocations(c.course, myClasses.placeIndex);
    incoming.push(Object.assign({}, c, {
      days: c.days || [],
      place: null,
      room: '',
      candidates: candidates,
      status: candidates.length > 0 ? 'guess' : 'none',
      source: null
    }));
  });

  incoming.forEach(function (c) {
    const existing = myClasses.items.find(function (item) { return classKey(item) === classKey(c); });
    if (!existing) {
      c.id = nextClassId++;
      myClasses.items.push(c);
      return;
    }
    // 同一门课：合并上课日期；如果新截图里读到了地点，而原来还没确定，就用读到的地点
    c.days.forEach(function (d) {
      if (!existing.days.includes(d)) {
        existing.days.push(d);
      }
    });
    if (c.status === 'confirmed' && existing.status !== 'confirmed') {
      Object.assign(existing, { place: c.place, room: c.room, status: 'confirmed', source: 'schedule' });
    }
  });

  renderMyClasses();
}

// ===== 显示 =====

function renderMyClasses() {
  const items = myClasses.items;
  const list = document.getElementById('schedule-list');
  const status = document.getElementById('schedule-status');

  const confirmed = items.filter(function (c) { return c.status === 'confirmed'; });
  const review = items.filter(function (c) { return c.status === 'guess' || c.status === 'none'; });
  const skipped = items.filter(function (c) { return c.status === 'skipped'; });

  if (items.length === 0) {
    status.textContent = "Couldn't find any classes. Try a clearer screenshot, or paste the text instead.";
    list.innerHTML = '';
    clearClassMarkers();
    return;
  }

  // 地图：只放确定了地点的课，同一栋楼的课合成一个标记；每栋楼一种颜色，列表里的卡片也用这个颜色
  const groups = [];
  confirmed.forEach(function (c) {
    let group = groups.find(function (g) { return g.place.id === c.place.id; });
    if (!group) {
      group = { place: c.place, classes: [], color: buildingColor(c.place) };
      groups.push(group);
    }
    group.classes.push(c);
  });
  showClassMarkers(groups);
  status.textContent = `${confirmed.length} classes on your map in ${groups.length} buildings. ` +
    'Each label on the map shows a building and how many of your classes meet there.';

  let html = '';

  // 1. 需要确认的放最上面，并有一个醒目的提示
  if (review.length > 0) {
    html += `<div class="review-banner">⚠ ${review.length} ${review.length === 1 ? 'class needs' : 'classes need'} your check before ${review.length === 1 ? 'it is' : 'they are'} on your map.</div>`;
    html += '<ul class="class-list">' + review.map(renderCard).join('') + '</ul>';
  }

  // 2. 已经确定的
  if (confirmed.length > 0) {
    html += '<ul class="class-list">' + confirmed.map(renderCard).join('') + '</ul>';
  }

  // 3. 跳过的：折叠起来，可以恢复
  if (skipped.length > 0) {
    html += `<details class="skipped-list"><summary>Skipped (${skipped.length})</summary><ul class="class-list">`;
    skipped.forEach(function (c) {
      html += `
        <li class="class-card skipped" data-id="${c.id}">
          <strong>${escapeHtml(c.title)}</strong>
          <span class="rank-detail">${escapeHtml(c.course)} ${escapeHtml(c.section)}</span>
          <button type="button" class="link-button" data-action="restore">Restore</button>
        </li>`;
    });
    html += '</ul></details>';
  }

  list.innerHTML = html;
}

// 课名下面那一行：课号、时间、日期
function classMetaLine(c) {
  const parts = [`${escapeHtml(c.course)} ${escapeHtml(c.section)}`];
  if (c.time) {
    parts.push(escapeHtml(c.time));
  }
  if (c.days.length > 0) {
    parts.push(escapeHtml(c.days.join(', ')));
  }
  return `<span class="rank-detail">${parts.join(' · ')}</span>`;
}

// 一门课的卡片：展开时显示确认 / 编辑的界面，收起时显示简要信息
function renderCard(c) {
  if (myClasses.openId === c.id) {
    return renderEditor(c);
  }

  if (c.status === 'confirmed') {
    const badge = c.source === 'schedule'
      ? '<span class="badge badge-schedule">From your schedule</span>'
      : '<span class="badge badge-user">Confirmed by you</span>';
    return `
      <li class="class-card confirmed" data-id="${c.id}" style="border-left-color:${buildingColor(c.place)}">
        ${badge}
        <strong>${escapeHtml(c.title)}</strong>
        ${classMetaLine(c)}<br>
        <span class="rank-detail"><span class="color-dot" style="background:${buildingColor(c.place)}"></span>${locationLabel(c.place, c.room)}</span>
        <button type="button" class="link-button edit-button" data-action="open">Edit</button>
      </li>`;
  }

  // 需要确认的：收起时只说"可能在哪"，必须点 Review 才能看到详细信息并确认
  const hint = c.status === 'guess'
    ? `No room listed. Possible: ${c.candidates.map(function (o) { return escapeHtml(o.place.code || o.place.name); }).join(' or ')}.`
    : "No room listed, and we can't guess one (online class?).";
  return `
    <li class="class-card review" data-id="${c.id}">
      <span class="badge badge-review">❓ Needs your check</span>
      <strong>${escapeHtml(c.title)}</strong>
      ${classMetaLine(c)}
      <p class="card-note">${hint}</p>
      <button type="button" class="primary-button" data-action="open">Review</button>
    </li>`;
}

// 展开后的确认 / 编辑界面
function renderEditor(c) {
  const isEdit = c.status === 'confirmed';

  // 选项：编辑时第一个是"当前地点"；推测的候选楼；最后是"别的地方"（自己输入）
  const options = [];
  if (isEdit) {
    options.push({ value: 'current', place: c.place, room: c.room, note: 'Current location' });
  }
  (c.candidates || []).forEach(function (o, i) {
    if (!isEdit || o.place.id !== c.place.id) {
      options.push({ value: 'guess-' + i, place: o.place, room: '', note: 'Why: ' + o.reason });
    }
  });

  let optionsHtml = '';
  options.forEach(function (o) {
    const checked = o.value === 'current' ? 'checked' : '';
    optionsHtml += `
      <label class="location-option">
        <input type="radio" name="location-${c.id}" value="${o.value}" ${checked}>
        <span>
          <strong>${locationLabel(o.place, o.room)}</strong><br>
          <span class="rank-detail">${escapeHtml(o.place.address || '')}</span><br>
          <span class="option-note">${escapeHtml(o.note)}</span>
        </span>
      </label>`;
  });
  optionsHtml += `
    <label class="location-option">
      <input type="radio" name="location-${c.id}" value="other">
      <span>
        <strong>Somewhere else</strong>
        <input type="search" class="other-location" list="place-options" placeholder="e.g. CAS 211, SCI 107, GSU">
        <span class="other-preview option-note"></span>
      </span>
    </label>`;

  const intro = isEdit
    ? 'Change where this class meets.'
    : (c.status === 'guess'
      ? "Your schedule doesn't list a room for this class. Here's where it might be — <strong>check your schedule</strong> and pick the right one."
      : "Your schedule doesn't list a room, and we can't guess one. If it meets in person, tell us where. If it's online, skip it.");

  return `
    <li class="class-card editing" data-id="${c.id}" data-mode="${isEdit ? 'edit' : 'review'}">
      <strong>${escapeHtml(c.title)}</strong>
      ${classMetaLine(c)}
      <p class="card-note">${intro}</p>
      <div class="location-options">${optionsHtml}</div>
      <button type="button" class="primary-button" data-action="confirm" disabled>Choose a location above</button>
      <div class="secondary-actions">
        <button type="button" class="link-button" data-action="skip">${isEdit ? 'Remove from my map' : "It's online · Skip"}</button>
        <button type="button" class="link-button" data-action="cancel">Cancel</button>
      </div>
    </li>`;
}

// ===== 展开的卡片里：当前选了哪个地点 =====

// 读出展开卡片里用户选的地点
// 输出：{ place, room }；还没选、或者"别的地方"还没填对时是 null
function readSelection(card, item) {
  const radio = card.querySelector('input[type="radio"]:checked');
  if (!radio) {
    return null;
  }
  if (radio.value === 'current') {
    return { place: item.place, room: item.room };
  }
  if (radio.value.startsWith('guess-')) {
    return { place: item.candidates[Number(radio.value.slice(6))].place, room: '' };
  }
  return resolveLocationText(card.querySelector('.other-location').value, myClasses.placeIndex);
}

// 根据选择，更新确认按钮：没选好就是灰的点不了；选好了，按钮上直接写出"确认的是哪里"
function updateConfirmButton(card) {
  const item = findItem(card);
  const selection = readSelection(card, item);
  const button = card.querySelector('[data-action="confirm"]');
  const preview = card.querySelector('.other-preview');
  const otherText = card.querySelector('.other-location').value;

  // "别的地方"输入框下面，实时显示认出来的是哪里
  if (otherText.trim() === '') {
    preview.textContent = '';
  } else {
    const found = resolveLocationText(otherText, myClasses.placeIndex);
    preview.textContent = found
      ? '→ ' + found.place.name + (found.room ? ', room ' + found.room : '')
      : "→ Can't find that yet. Try a building code like SCI 107.";
  }

  if (selection) {
    const verb = card.dataset.mode === 'edit' ? 'Save' : 'Confirm';
    button.disabled = false;
    button.textContent = `✓ ${verb}: ${selection.place.name}${selection.room ? ' ' + selection.room : ''}`;
    showClassPreview(selection.place); // 地图上用空心问号标出来，让用户看到选的是哪栋楼
  } else {
    button.disabled = true;
    button.textContent = 'Choose a location above';
    clearClassPreview();
  }
}

function findItem(card) {
  const id = Number(card.dataset.id);
  return myClasses.items.find(function (c) { return c.id === id; });
}

// ===== 事件 =====

function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }
  const card = button.closest('[data-id]');
  const item = findItem(card);
  const action = button.dataset.action;

  if (action === 'open') {
    myClasses.openId = item.id;
    renderMyClasses();
    const opened = document.querySelector(`#schedule-list [data-id="${item.id}"]`);
    if (opened) {
      updateConfirmButton(opened);
    }
  } else if (action === 'cancel') {
    myClasses.openId = null;
    clearClassPreview();
    renderMyClasses();
  } else if (action === 'confirm') {
    const selection = readSelection(card, item);
    if (!selection) {
      return; // 按钮是灰的时候本来就点不了，这里再保险一次
    }
    changeWithUndo(`${item.title} → ${selection.place.name}`, function () {
      Object.assign(item, {
        place: selection.place,
        room: selection.room,
        code: selection.place.code || '',
        status: 'confirmed',
        source: item.source === 'schedule' && card.dataset.mode === 'edit' &&
          selection.place === item.place && selection.room === item.room ? 'schedule' : 'user'
      });
    });
  } else if (action === 'skip') {
    changeWithUndo(`Skipped ${item.title}`, function () {
      item.statusBeforeSkip = item.status;
      item.status = 'skipped';
    });
  } else if (action === 'restore') {
    changeWithUndo(`Restored ${item.title}`, function () {
      item.status = item.statusBeforeSkip || (item.candidates && item.candidates.length > 0 ? 'guess' : 'none');
    });
  }
}

// 选项变化、在"别的地方"里打字：更新确认按钮
function handleListInput(event) {
  const card = event.target.closest('.class-card.editing');
  if (!card) {
    return;
  }
  // 在"别的地方"输入框里打字，就自动选中"别的地方"这个选项
  if (event.target.classList.contains('other-location')) {
    card.querySelector('input[type="radio"][value="other"]').checked = true;
  }
  updateConfirmButton(card);
}

// ===== 撤销提示 =====

function showToast(message) {
  const toast = document.getElementById('class-toast');
  toast.innerHTML = `<span>${escapeHtml(message)}</span> <button type="button" class="link-button" id="undo-button">Undo</button>`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.hidden = true; }, 8000);
}

function undoLastChange() {
  if (!myClasses.undo) {
    return;
  }
  myClasses.items = myClasses.undo;
  myClasses.undo = null;
  myClasses.openId = null;
  document.getElementById('class-toast').hidden = true;
  renderMyClasses();
}

// ===== 读取课表 =====

async function handleScheduleImage(file) {
  const status = document.getElementById('schedule-status');
  status.textContent = 'Loading the text reader (first time takes a few seconds)…';
  try {
    const lines = await readScheduleImage(file, function (progress) {
      status.textContent = `Reading your schedule… ${Math.round(progress * 100)}%`;
    });
    console.log('OCR lines:', lines.map(function (l) { return l.text; }));
    addParsedSchedule(parseSchedule(lines, myClasses.placeIndex));
  } catch (error) {
    console.log('OCR failed:', error);
    status.textContent = "Couldn't read this image. Try another screenshot, or paste the text instead.";
  }
}

// app.js 在地点索引建好之后调用：把事件都接上
function initMyClasses(placeIndex) {
  myClasses.placeIndex = placeIndex;

  document.getElementById('schedule-file').addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (file) {
      handleScheduleImage(file);
    }
  });

  document.getElementById('schedule-text-button').addEventListener('click', function () {
    const text = document.getElementById('schedule-text').value;
    addParsedSchedule(parseSchedule(textToLines(text), placeIndex));
  });

  const list = document.getElementById('schedule-list');
  list.addEventListener('click', handleListClick);
  list.addEventListener('input', handleListInput);  // 在"别的地方"输入框里打字
  list.addEventListener('change', handleListInput); // 选了某个单选项

  document.getElementById('class-toast').addEventListener('click', function (event) {
    if (event.target.id === 'undo-button') {
      undoLastChange();
    }
  });
}

console.log('my-classes.js loaded');
