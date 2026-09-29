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

// 读取 shapes.json（建筑轮廓）。这个文件只是锦上添花：
// 读不到也不影响网站其他功能，所以出错时返回空对象，而不是让整个页面报错
async function loadShapes() {
  try {
    const response = await fetch('shapes.json');
    if (!response.ok) {
      return {};
    }
    return await response.json();
  } catch (error) {
    console.log('shapes.json not loaded, using circles instead');
    return {};
  }
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
    tourHtml = `<a href="${dorm.tour_360_url}" target="_blank">Open tour</a>`;
  }

  // 设施：数组为空或者根本没有这个字段时，这一行整个不显示
  let amenitiesHtml = '';
  if (dorm.amenities && dorm.amenities.length > 0) {
    amenitiesHtml = `<p><strong>Amenities:</strong> ${dorm.amenities.join(', ')}</p>`;
  }

  // 分楼：有才显示
  let unitsHtml = '';
  if (dorm.units && dorm.units.length > 0) {
    unitsHtml = `<p><strong>Buildings:</strong> ${dorm.units.join(', ')}</p>`;
  }

  // 覆盖的地址（Bay State Road 这类"一个点代表一段街"的宿舍）：有才显示
  let addressesHtml = '';
  if (dorm.addresses && dorm.addresses.length > 0) {
    addressesHtml = `<p><strong>Addresses included:</strong> ${dorm.addresses.join(', ')}</p>`;
  }

  // 官方页面：有才显示
  let officialHtml = '';
  if (dorm.official_url) {
    officialHtml = `<p><a href="${dorm.official_url}" target="_blank">Official BU Housing page →</a></p>`;
  }

  // 3. 拼出一段 HTML，替换掉元素原来的内容
  infoBox.innerHTML = `
    <h3>${dorm.name}</h3>
    ${unitsHtml}
    ${imageHtml}
    ${addressesHtml}
    <p>${dorm.description}</p>
    <p><strong>Room types:</strong> ${dorm.room_types.join(', ')}</p>
    ${amenitiesHtml}
    <p><strong>Floor plan:</strong> ${floorPlanHtml}</p>
    <p><strong>Virtual tour:</strong> ${tourHtml}</p>
    ${officialHtml}
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
    if (dorm.units && dorm.units.length > 0) {
      // 有分楼的宿舍（如 Warren）：每座楼一个选项，名字和选宿舍系统一致
      // value 都是同一个宿舍 id，因为它们在地图上是同一个点，距离一样
      dorm.units.forEach(function (unit) {
        html += `<option value="${dorm.id}">${unit}</option>`;
      });
    } else {
      html += `<option value="${dorm.id}">${dorm.name}</option>`;
    }
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
  // 先向上取整再判断：页面上显示的分钟数和判断用的分钟数永远是同一个，不会出现"显示 10 分钟却说够 9.5 分钟"
  const minutes = Math.ceil(route.minutes);

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

  // 两端都是教学楼才叫"课间"；有宿舍参与时用中性说法
  let timeText = `You have ${gapMinutes} min`;
  if (isBetweenClasses(fromPlace, toPlace)) {
    timeText = `Time between classes: ${gapMinutes} min`;
  }

  box.className = 'verdict-' + result.verdict; // 换背景色
  box.innerHTML = `
    <p><strong>${fromPlace.name} → ${toPlace.name}</strong></p>
    <p>Straight-line distance: ${formatDistance(result.meters)}</p>
    <p>Estimated walk: ~${Math.ceil(result.minutes)} min</p>
    <p>${timeText} → ${verdictText[result.verdict]}</p>
  `;
}

// 判断这段路是不是"两节课之间"：起点和终点都选好、并且都是教学楼
// 输入：起点对象、终点对象（还没选时是 undefined）
// 输出：true / false
function isBetweenClasses(fromPlace, toPlace) {
  return Boolean(fromPlace && toPlace &&
    fromPlace.kind === 'building' && toPlace.kind === 'building');
}

// 换输入框上面那句话
// 输入：起点对象、终点对象
function updateGapLabel(fromPlace, toPlace) {
  let text = 'Minutes you have to get there';
  if (isBetweenClasses(fromPlace, toPlace)) {
    text = 'Minutes between classes';
  }
  document.getElementById('gap-label').textContent = text;
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

  // 选中的起点、终点一定显示在地图上（没选时是空字符串，pinPlace 会当作"没有"）
  pinPlace('from', fromId);
  pinPlace('to', toId);
  const gapMinutes = Number(document.getElementById('gap-input').value);

  // 先清掉旧的线；如果下面因为输入不完整提前 return，地图上就不会留下过时的线
  clearRouteLine();

  // 先找到两个地点，并马上更新标签文字（不用等所有检查都通过）
  const fromPlace = findPlaceById(places, fromId);
  const toPlace = findPlaceById(places, toId);
  updateGapLabel(fromPlace, toPlace);

  if (fromId === '' || toId === '') {
    showRouteMessage('Choose a starting point and a destination to see the walking time.');
    return;
  }
  if (fromId === toId) {
    showRouteMessage('Start and destination are the same place.');
    return;
  }
  if (!(gapMinutes > 0)) {
    showRouteMessage('Enter a number of minutes greater than 0.');
    return;
  }

  const result = checkRoute(fromPlace, toPlace, gapMinutes);
  console.log('Route result:', result);
  showRouteResult(result, fromPlace, toPlace, gapMinutes);
  drawRouteLine(fromPlace, toPlace, result.verdict);
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
    // data-dorm-id：把宿舍 id 藏在元素上，点击时靠它知道点的是哪个宿舍
    html += `
      <li class="rank-item" data-dorm-id="${item.dorm.id}">
        <strong>${item.dorm.name}</strong><br>
        <span class="rank-detail">${formatDistance(item.meters)}, ~${Math.ceil(item.minutes)} min walk</span><br>
        <span class="rank-detail">Room types: ${item.dorm.room_types.join(', ')}</span>
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
  pinPlace('rank', buildingId); // 排名选的那栋楼一定显示在地图上

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

// 建立搜索索引：把每个宿舍所有可能被搜的名字都列出来，每个名字指回它的宿舍
// 输入：dorms 数组
// 输出：[{ label: 'StuVi', dorm: 10 Buick Street 的对象 }, ...]
function buildSearchIndex(dorms) {
  const index = [];
  dorms.forEach(function (dorm) {
    // 官方名字、地址、分楼、覆盖的地址、别名，全部可以搜
    const labels = [dorm.name, dorm.address]
      .concat(dorm.units, dorm.addresses, dorm.aliases);

    labels.forEach(function (label) {
      index.push({ label: label, dorm: dorm });
    });
  });
  return index;
}

// 把索引里的名字放进 datalist，作为打字时的候选项
// 候选列表只放每个宿舍的正式名字，一个宿舍一条，保持简洁
// （地址、俗称、门牌号不列出来，但输入后按回车仍然能搜到，因为它们都在搜索索引里）
function renderSearchOptions(dorms) {
  let html = '';
  dorms.forEach(function (dorm) {
    html += `<option value="${dorm.name}"></option>`;
  });
  document.getElementById('dorm-search-options').innerHTML = html;
}

// 根据用户输入找宿舍：先找完全一样的名字，找不到再找"包含"这段文字的
// 输入：索引、用户输入的文字
// 输出：找到的宿舍对象；找不到时是 undefined
function findDorm(index, query) {
  const q = query.trim().toLowerCase(); // 去掉首尾空格、统一小写，"warren " 也能找到 "Warren"

  const exact = index.find(function (entry) {
    return entry.label.toLowerCase() === q;
  });
  if (exact) {
    return exact.dorm;
  }

  const partial = index.find(function (entry) {
    return entry.label.toLowerCase().includes(q);
  });
  if (partial) {
    return partial.dorm;
  }

  return undefined;
}

// 程序入口：页面加载后从这里开始执行
async function main() {
  const data = await loadData();
  setBuildingShapes(await loadShapes());

  // 把数据交给 map.js 里的函数，画到地图上
  addDormMarkers(data.dorms);
  addBuildingMarkers(data.buildings);

  // 宿舍和教学楼合并成一个"所有地点"数组，后面按 id 查找时用
  // 给每个地点标上它是宿舍还是教学楼。合并成一个数组以后，靠这个字段还能分辨出来
  data.dorms.forEach(function (dorm) {
    dorm.kind = 'dorm';
  });
  data.buildings.forEach(function (building) {
    building.kind = 'building';
  });

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

  // 宿舍搜索框
  const searchIndex = buildSearchIndex(data.dorms);
  renderSearchOptions(data.dorms);

  // 'change'：按回车、或者从候选项里点选一个时触发（不是每打一个字都触发）
  document.getElementById('dorm-search').addEventListener('change', function (event) {
    const query = event.target.value;
    const message = document.getElementById('dorm-search-message');

    if (query.trim() === '') {
      message.textContent = '';
      return;
    }

    const dorm = findDorm(searchIndex, query);
    if (dorm === undefined) {
      // 用 textContent 而不是 innerHTML：query 是用户打的字，不能当 HTML 执行
      message.textContent = `No dorm matches "${query}".`;
      return;
    }

    message.textContent = '';
    showDormInfo(dorm);
    focusPlace(dorm);
  });

  // 点击排名里的宿舍：显示详情 + 地图飞过去
  // 监听挂在外层 #results 上，因为里面的列表每次排名都会重新生成
  document.getElementById('results').addEventListener('click', function (event) {
    // event.target 是实际被点到的元素（可能是名字、距离文字……）
    // closest 从它开始往外找，找到最近的 .rank-item，也就是整个这一项
    const item = event.target.closest('.rank-item');
    if (item === null) {
      return; // 点到的是标题或空白处，不是某个宿舍
    }

    const dorm = findPlaceById(data.dorms, item.dataset.dormId);
    showDormInfo(dorm);
    focusPlace(dorm);

    // Dorm info 在侧边栏顶部；滚动过去，让用户看到信息已经更新
    document.getElementById('dorm-panel').scrollIntoView({ behavior: 'smooth' });
  });
}

main();
