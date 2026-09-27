// app.js：主业务逻辑
// 以后会在这里：读取 data.json → 读取用户选择 → 调用距离函数 → 排序 → 更新网页

console.log('app.js loaded');

// 读取 data.json，并返回里面的数据
// async 表示这个函数里有"需要等待"的操作（读文件需要时间）
async function loadData() {
  const response = await fetch('data.json'); // 1. 向服务器请求 data.json 这个文件
  const data = await response.json();        // 2. 把文件里的文字解析成 JavaScript 对象
  return data;
}

// 把一个宿舍的信息显示到左侧 #dorm-info 区域
// 输入：一个 dorm 对象
// 输出：网页上 #dorm-info 的内容被替换
function showDormInfo(dorm) {
  // 1. 在网页里找到要修改的那个元素
  const infoBox = document.getElementById('dorm-info');

  // 2. 有些字段可能是空字符串 ""，空的就显示"暂无"，不放一个坏链接
  let imageHtml = '';
  if (dorm.image_url) {
    imageHtml = `<img src="${dorm.image_url}" alt="${dorm.name}">`;
  }

  let floorPlanHtml = 'Not available';
  if (dorm.floor_plan_url) {
    floorPlanHtml = `<a href="${dorm.floor_plan_url}" target="_blank">View floor plan</a>`;
  }

  let tourHtml = 'Not available';
  if (dorm.tour_360_url) {
    tourHtml = `<a href="${dorm.tour_360_url}" target="_blank">Open 360 tour</a>`;
  }

  // 3. 拼出一段 HTML，替换掉元素原来的内容
  infoBox.innerHTML = `
    <h3>${dorm.name}</h3>
    ${imageHtml}
    <p>${dorm.description}</p>
    <p><strong>Room types:</strong> ${dorm.room_types.join(', ')}</p>
    <p><strong>Floor plan:</strong> ${floorPlanHtml}</p>
    <p><strong>360 tour:</strong> ${tourHtml}</p>
  `;
}

// 生成下拉框的选项 HTML：宿舍一组，教学楼一组
// 输入：dorms 数组、buildings 数组
// 输出：一段 <option> 的 HTML 字符串
function buildPlaceOptions(dorms, buildings) {
  // 第一项是空选项，value="" 表示"还没选"
  let html = '<option value="">-- Select a place --</option>';

  html += '<optgroup label="Dorms">';
  dorms.forEach(function (dorm) {
    html += `<option value="${dorm.id}">${dorm.name}</option>`;
  });
  html += '</optgroup>';

  html += '<optgroup label="Buildings">';
  buildings.forEach(function (building) {
    html += `<option value="${building.id}">${building.name}</option>`;
  });
  html += '</optgroup>';

  return html;
}

// 把选项放进 From 和 To 两个下拉框（两个框的选项完全一样）
function renderPlaceSelects(dorms, buildings) {
  const optionsHtml = buildPlaceOptions(dorms, buildings);
  document.getElementById('from-select').innerHTML = optionsHtml;
  document.getElementById('to-select').innerHTML = optionsHtml;
}

// 根据 id 找到完整的地点对象
// 输入：places 数组、一个 id（例如 'cas'）
// 输出：id 相同的那个对象；找不到时是 undefined
function findPlaceById(places, id) {
  return places.find(function (place) {
    return place.id === id;
  });
}

const BUFFER_MINUTES = 3; // 缓冲时间：下课拖堂、收拾东西、找教室

// 计算两个地点之间的距离和步行时间（Step 8 和 Step 9 共用）
// 输入：起点对象、终点对象
// 输出：{ meters, minutes }
function measureRoute(fromPlace, toPlace) {
  const meters = getDistance(
    fromPlace.latitude, fromPlace.longitude,
    toPlace.latitude, toPlace.longitude
  );
  return { meters: meters, minutes: getWalkMinutes(meters) };
}

// 计算 A → B 的距离和步行时间，并判断来不来得及
// 输入：起点对象、终点对象、课间分钟数
// 输出：一个结果对象 { meters, minutes, verdict }
function checkRoute(fromPlace, toPlace, gapMinutes) {
  const route = measureRoute(fromPlace, toPlace);
  const meters = route.meters;
  const minutes = route.minutes;

  let verdict;
  if (minutes + BUFFER_MINUTES <= gapMinutes) {
    verdict = 'green';
  } else if (minutes <= gapMinutes) {
    verdict = 'yellow';
  } else {
    verdict = 'red';
  }

  return { meters: meters, minutes: minutes, verdict: verdict };
}

// 把结果显示到 #route-result
// 输入：checkRoute 的结果、起点、终点、课间分钟数
// 输出：网页上的结果区域被更新
function showRouteResult(result, fromPlace, toPlace, gapMinutes) {
  const box = document.getElementById('route-result');

  const verdictText = {
    green: '🟢 Easy — you have time to spare',
    yellow: '🟡 Tight — no room for delays',
    red: '🔴 Not enough time'
  };

  box.className = 'verdict-' + result.verdict; // 换背景色
  box.innerHTML = `
    <p><strong>${fromPlace.name} → ${toPlace.name}</strong></p>
    <p>Straight-line distance: ${formatDistance(result.meters)}</p>
    <p>Estimated walk: ~${Math.ceil(result.minutes)} min</p>
    <p>Time between classes: ${gapMinutes} min → ${verdictText[result.verdict]}</p>
  `;
}

// 在结果区域显示一句提示（没选完、输入不对时用）
function showRouteMessage(text) {
  const box = document.getElementById('route-result');
  box.className = '';
  box.innerHTML = `<p class="placeholder">${text}</p>`;
}

// 读取用户输入 → 检查 → 计算 → 显示
// 输入：所有地点的数组
function updateRoute(places) {
  const fromId = document.getElementById('from-select').value;
  const toId = document.getElementById('to-select').value;
  const gapMinutes = Number(document.getElementById('gap-input').value);

  if (fromId === '' || toId === '') {
    showRouteMessage('Choose a starting point and a destination to see the walking time.');
    return;
  }
  if (fromId === toId) {
    showRouteMessage('Start and destination are the same place.');
    return;
  }
  if (!(gapMinutes > 0)) {
    showRouteMessage('Enter a time between classes greater than 0 minutes.');
    return;
  }

  const fromPlace = findPlaceById(places, fromId);
  const toPlace = findPlaceById(places, toId);

  const result = checkRoute(fromPlace, toPlace, gapMinutes);
  console.log('Route result:', result);
  showRouteResult(result, fromPlace, toPlace, gapMinutes);
}

// 生成"排名依据"下拉框的选项：只列出教学楼（包括 FitRec）
// 输入：buildings 数组
// 输出：<option> 的 HTML 字符串
function buildBuildingOptions(buildings) {
  let html = '<option value="">-- Select a building --</option>';
  buildings.forEach(function (building) {
    html += `<option value="${building.id}">${building.name}</option>`;
  });
  return html;
}

// 计算每个宿舍到某栋楼的步行时间，并从近到远排序
// 输入：dorms 数组、一个 building 对象
// 输出：排好序的新数组，每一项是 { dorm, meters, minutes }
function rankDorms(dorms, building) {
  // map：把"宿舍数组"变成"宿舍 + 距离"的数组，一一对应
  const ranked = dorms.map(function (dorm) {
    const route = measureRoute(dorm, building);
    return { dorm: dorm, meters: route.meters, minutes: route.minutes };
  });

  // sort：按 minutes 从小到大排列
  ranked.sort(function (a, b) {
    return a.minutes - b.minutes;
  });

  return ranked;
}

// 把排名显示到 #results
// 输入：rankDorms 的结果、目标 building 对象
function showDormRanking(ranked, building) {
  let html = `<p><strong>Walking time to ${building.name}</strong></p><ol>`;

  ranked.forEach(function (item) {
    html += `
      <li>
        <strong>${item.dorm.name}</strong><br>
        <span class="rank-detail">${formatDistance(item.meters)}, ~${Math.ceil(item.minutes)} min walk</span>
      </li>
    `;
  });

  html += '</ol>';
  document.getElementById('results').innerHTML = html;
}

// 读取排名下拉框 → 计算 → 显示
// 输入：dorms 数组、buildings 数组
function updateRanking(dorms, buildings) {
  const buildingId = document.getElementById('rank-select').value;

  if (buildingId === '') {
    document.getElementById('results').innerHTML =
      '<p class="placeholder">Choose a building to rank the dorms.</p>';
    return;
  }

  const building = findPlaceById(buildings, buildingId);
  const ranked = rankDorms(dorms, building);
  console.log('Dorm ranking:', ranked);
  showDormRanking(ranked, building);
}

// 程序入口：页面加载后从这里开始执行
async function main() {
  const data = await loadData();

  // 把数据交给 map.js 里的函数，画到地图上
  addDormMarkers(data.dorms);
  addBuildingMarkers(data.buildings);

  // 宿舍和教学楼合并成一个"所有地点"数组，后面按 id 查找时用
  const places = data.dorms.concat(data.buildings);

  // 生成 From / To 下拉框
  renderPlaceSelects(data.dorms, data.buildings);

  // 监听路线区域：下拉框改选、输入框打字，都会触发 'input' 事件
  document.getElementById('route-panel').addEventListener('input', function () {
    updateRoute(places);
  });

  // 生成"排名依据"下拉框，并监听它的变化
  document.getElementById('rank-select').innerHTML = buildBuildingOptions(data.buildings);
  document.getElementById('rank-select').addEventListener('input', function () {
    updateRanking(data.dorms, data.buildings);
  });
}

main();
