// map.js：只负责和地图有关的事情
// （这段代码原来写在 index.html 的 <script> 里，现在搬到这里）

// L 是 Leaflet 库暴露出来的全局对象，所有地图功能都从这里开始
// L.map('map', ...) 表示：把地图画在 id="map" 的那个 div 里
const map = L.map('map', {
  center: [42.3505, -71.1075], // 地图初始中心点：[纬度, 经度]，这里先用 Warren Towers 附近
  zoom: 15 // 缩放级别，数字越大看到的范围越小、细节越多
});

// 添加地图的"底图"图层——没有这一步，地图容器是空白的
// 这里用的是 OpenStreetMap 提供的免费地图瓦片，不需要 API key
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors' // 使用免费地图要求保留这行版权说明
}).addTo(map);

// 去掉右下角的 "Leaflet" 前缀，只保留地图数据的版权说明
map.attributionControl.setPrefix(false);

// ===== 地图上的点：显示还是隐藏 =====

// 所有圆点都登记在这里：{ id, type, marker }。创建时先不放上地图，由 refreshMarkers 决定显示哪些
const markerEntries = [];

// 图例里勾选了哪些类别。默认只显示宿舍；想连宿舍也默认隐藏，就改成 new Set()
const visibleTypes = new Set(['dorm']);

// 当前"被选中"的地点 id。被选中的地点不管类别有没有勾选，都一定显示
const pinnedIds = {
  from: null,      // Route check 的起点
  to: null,        // Route check 的终点
  rank: null,      // 排名选的那栋楼
  highlight: null  // 当前框起来的地点
};

// 记录某一类"选中"变成了哪个地点（没选时传 null），然后刷新地图
function pinPlace(slot, id) {
  pinnedIds[slot] = id || null;
  refreshMarkers();
}

// 按规则逐个决定圆点显示还是隐藏：类别被勾选，或者这个点正被选中，就显示
function refreshMarkers() {
  const pinned = Object.values(pinnedIds);

  markerEntries.forEach(function (entry) {
    const shouldShow = visibleTypes.has(entry.type) || pinned.includes(entry.id);
    const isShown = map.hasLayer(entry.marker);

    if (shouldShow && !isShown) {
      entry.marker.addTo(map);
    } else if (!shouldShow && isShown) {
      map.removeLayer(entry.marker);
    }
  });
}

// 把所有宿舍画到地图上
// 输入：dorms 数组（来自 data.json）
// 输出：每个宿舍一个红色圆点（登记到 markerEntries，由 refreshMarkers 决定是否显示）
function addDormMarkers(dorms) {
  dorms.forEach(function (dorm) {
    // forEach 会对数组里的每一项执行一次这个函数，dorm 就是"当前这一个宿舍"
    const marker = L.circleMarker([dorm.latitude, dorm.longitude], {
      radius: 9,
      color: 'white',       // 边框颜色
      weight: 2,            // 边框粗细
      fillColor: '#cc0000', // 宿舍：红色
      fillOpacity: 0.9
    })
      .bindTooltip(dorm.name) // 鼠标悬停时显示名字
      .on('click', function () {
        // 点击这个 marker 时执行：把"当前这个宿舍"交给 showDormInfo（在 app.js 里）
        showDormInfo(dorm);
        highlightPlace(dorm);
      });

    markerEntries.push({ id: dorm.id, type: 'dorm', marker: marker });
  });
  refreshMarkers();
}

// 每种地点类型对应的颜色（key 就是 data.json 里的 type）
// 紫色而不是绿色：绿色已经用在路线的 🟢 结论上，避免混淆
const TYPE_COLORS = {
  academic: '#1f6feb',   // 教学楼：蓝色
  recreation: '#8e44ad', // 健身 / 娱乐：紫色
  dining: '#f28c28',     // 食堂：橙色
  student_life: '#12a39a' // 学生服务（GSU、ISSO 等）：青绿色
};
const DEFAULT_TYPE_COLOR = '#666666'; // data.json 里出现没定义过的 type 时用灰色

// 把所有教学楼画到地图上（逻辑和宿舍一样，颜色按 type 决定）
function addBuildingMarkers(buildings) {
  buildings.forEach(function (building) {
    // 查表：type 是 'recreation' 就取紫色；表里没有这个 type，就用默认灰色
    const fillColor = TYPE_COLORS[building.type] || DEFAULT_TYPE_COLOR;

    const marker = L.circleMarker([building.latitude, building.longitude], {
      radius: 7,
      color: 'white',
      weight: 2,
      fillColor: fillColor,
      fillOpacity: 0.9
    })
      .bindTooltip(building.name)
      .on('click', function () {
        highlightPlace(building);
      });

    markerEntries.push({ id: building.id, type: building.type, marker: marker });
  });
  refreshMarkers();
}

// 当前画在地图上的路线。一次只保留一条，所以用一个变量记住它，下次画之前先删掉
let routeLine = null;

// 在地图上画 A → B 的路线（统一一种醒目的颜色）
// 输入：起点对象、终点对象、结论（'green' / 'yellow' / 'red'）
// 输出：地图上出现一条虚线，并缩放到能看到两个点
// 输入：起点、终点、结论，以及可选的 path（后端返回的沿街道路线）
// 有 path：画实线，沿着街道走；没有 path：画虚线直线，只表示方向
// 路线统一用导航软件那种风格：亮蓝色主线 + 深蓝色边框
// 深蓝边框把路线和米色建筑、黄色道路、绿色公园都隔开，在哪种背景上都看得清
// 结论（🟢🟡🔴）只显示在左侧结果框里，不再用路线颜色表示
const ROUTE_COLOR = '#4a9dff';        // 主线：亮蓝色
const ROUTE_BORDER_COLOR = '#1558c0'; // 边框：深蓝色

function drawRouteLine(fromPlace, toPlace, verdict, path) {
  clearRouteLine();

  // 有 path：沿街道的实线；没有：起点到终点的直线，用虚线表示"这不是真实路线"
  const points = (path && path.length > 1)
    ? path
    : [[fromPlace.latitude, fromPlace.longitude], [toPlace.latitude, toPlace.longitude]];
  const dash = (path && path.length > 1) ? null : '8 10';

  // 描边技巧：底下一条更宽的深蓝线当边框，上面一条亮蓝线当主线
  const casing = L.polyline(points, { color: ROUTE_BORDER_COLOR, weight: 9, opacity: 1, dashArray: dash });
  const line = L.polyline(points, { color: ROUTE_COLOR, weight: 5, opacity: 1, dashArray: dash });

  // featureGroup：把两条线当成一个整体，一起添加、一起删除，还能一起算范围
  routeLine = L.featureGroup([casing, line]).addTo(map);

  // 自动缩放，让整条线都在视野里；padding 留出边距，点不会贴着地图边缘
  map.fitBounds(routeLine.getBounds(), { padding: [60, 60] });
}

// 把地图上的路线删掉（如果有的话）
function clearRouteLine() {
  if (routeLine !== null) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
}

// 让地图平滑地飞到某个地点
// 输入：一个地点对象（宿舍或教学楼）
function focusPlace(place) {
  map.flyTo([place.latitude, place.longitude], 17);
  highlightPlace(place);
}

// 建筑轮廓：key 是地点 id，value 是轮廓各个角的 [纬度, 经度]（来自 shapes.json）
let buildingShapes = {};

// app.js 读完 shapes.json 后调用，把轮廓交给地图
function setBuildingShapes(shapes) {
  buildingShapes = shapes;
}

// 当前框出来的建筑。和路线一样，一次只保留一个
let highlightLayer = null;

const HIGHLIGHT_STYLE = {
  color: '#cc0000',     // 边框：BU 红
  weight: 3,
  fillColor: '#cc0000',
  fillOpacity: 0.15,
  interactive: false    // 框只用来看，不接收点击，这样不会挡住下面的圆点
};

// 把某个地点所在的建筑框起来
// 输入：一个地点对象
// 输出：地图上出现一个按建筑形状画的红框；没有轮廓数据时画一个圆圈代替
function highlightPlace(place) {
  if (highlightLayer !== null) {
    map.removeLayer(highlightLayer);
  }

  const shape = buildingShapes[place.id];
  if (shape) {
    highlightLayer = L.polygon(shape, HIGHLIGHT_STYLE);
  } else {
    // 没有轮廓（比如 Bay State Road 这种代表一段街的点）：画一个 40 米半径的虚线圆
    highlightLayer = L.circle([place.latitude, place.longitude],
      Object.assign({ radius: 40, dashArray: '6 6' }, HIGHLIGHT_STYLE));
  }

  highlightLayer.addTo(map);
  highlightLayer.bringToBack(); // 放到圆点下面一层，圆点不会被框的颜色盖住

  pinPlace('highlight', place.id); // 框起来的地点一定要显示它的圆点
}

// ===== 用户输入的地址：可以拖动的大头针 =====

// From、To 各最多一个地址大头针
const addressMarkers = { from: null, to: null };

// 在地图上放（或移动）一个地址大头针
// 输入：'from' 或 'to'、地址地点对象、拖动结束后要执行的函数（会收到新的纬度、经度）
function showAddressMarker(slot, place, onMoved) {
  const position = [place.latitude, place.longitude];

  // 每次都重新创建：保证名字和"拖完以后做什么"都对应当前这个地址
  clearAddressMarker(slot);

  // L.marker 是 Leaflet 默认的蓝色大头针；draggable: true 让用户可以拖动
  const marker = L.marker(position, { draggable: true })
    .bindTooltip(place.name + ' — drag to adjust')
    .addTo(map);

  // 'dragend'：用户松开鼠标、拖动结束时触发
  marker.on('dragend', function () {
    const latLng = marker.getLatLng();
    onMoved(latLng.lat, latLng.lng);
  });

  addressMarkers[slot] = marker;
}

// 移除一个地址大头针（这个输入框现在不是地址了）
function clearAddressMarker(slot) {
  if (addressMarkers[slot]) {
    map.removeLayer(addressMarkers[slot]);
    addressMarkers[slot] = null;
  }
}

// ===== 我的课：在地图上标出上课的楼 =====

// 所有"我的课"标记放在一个图层组里，方便一次性清掉或重新画
const classLayer = L.featureGroup().addTo(map);

// 在地图上标出上课的楼：每栋楼一个深色圆形标记，里面的数字是在这栋楼上几门课
// 输入：[{ place, classes: [课程, ...] }]
// 输入：[{ place, classes, color }]，color 是这栋楼在列表和地图上共用的颜色
function showClassMarkers(groups) {
  classLayer.clearLayers();

  groups.forEach(function (group) {
    // 标签直接写清楚意思："CAS · 3 classes"，不用鼠标悬停也能看懂
    const count = group.classes.length;
    const shortName = group.place.code || group.place.name;
    const label = `${shortName} · ${count} ${count === 1 ? 'class' : 'classes'}`;

    // divIcon：用一小段 HTML 当标记的图案
    // 标签宽度随文字变化，所以不固定大小，用 CSS 把标签的中心移到楼的位置上
    const icon = L.divIcon({
      className: 'class-pin-wrapper',
      html: `<div class="class-label" style="background:${group.color}">${label}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    });

    // 鼠标悬停时显示：楼名 + 每门课的课号、时间、教室
    const lines = group.classes.map(function (c) {
      return `${c.course} ${c.section} · ${c.time} · ${c.code} ${c.room}`;
    });
    const tooltip = `<strong>${group.place.name}</strong><br>${lines.join('<br>')}`;

    // classCount：标签挤在一起时，课多的楼优先显示完整标签
    L.marker([group.place.latitude, group.place.longitude], { icon: icon, classCount: count, zIndexOffset: count * 100 })
      .bindTooltip(tooltip)
      .on('click', function () {
        highlightPlace(group.place);
      })
      .addTo(classLayer);
  });

  // 缩放地图，让所有上课的楼都在视野里
  if (groups.length > 0) {
    map.fitBounds(classLayer.getBounds(), { padding: [60, 60], maxZoom: 17 });
  }
  layoutClassLabels();
}

// 几栋楼离得很近（比如 CAS、CDS、MCS），或者手机屏幕小时，标签会叠在一起看不清
// 办法：课多的楼先放完整标签；后面的如果会和已经放好的标签重叠，就缩成一个同色的小圆点
// 放大地图后楼之间隔开了，圆点会自动变回完整标签。点圆点或者鼠标悬停，仍然能看到这栋楼的课
function layoutClassLabels() {
  const markers = classLayer.getLayers().slice().sort(function (a, b) {
    return b.options.classCount - a.options.classCount;
  });
  const placed = []; // 已经放好的完整标签占的位置
  markers.forEach(function (marker) {
    const label = marker.getElement() && marker.getElement().querySelector('.class-label');
    if (!label) {
      return;
    }
    label.classList.remove('compact');
    const box = label.getBoundingClientRect();
    const overlaps = placed.some(function (other) {
      return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
    });
    if (overlaps) {
      label.classList.add('compact');
    } else {
      placed.push(box);
    }
  });
}

// 缩放结束后重新排一次（放大时楼之间的距离变大，重叠可能消失）
map.on('zoomend', layoutClassLabels);

// 清掉"我的课"标记
function clearClassMarkers() {
  classLayer.clearLayers();
}

// 确认 / 编辑时的"预览"标记：空心、虚线、带问号，表示"还没确认"
let classPreviewMarker = null;

// 在地图上预览用户正在选的那栋楼，并把地图移过去
function showClassPreview(place) {
  clearClassPreview();
  const icon = L.divIcon({
    className: 'class-pin-wrapper',
    html: '<div class="class-pin class-pin-preview">?</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  classPreviewMarker = L.marker([place.latitude, place.longitude], { icon: icon, interactive: false }).addTo(map);
  map.flyTo([place.latitude, place.longitude], Math.max(map.getZoom(), 16));
}

function clearClassPreview() {
  if (classPreviewMarker) {
    map.removeLayer(classPreviewMarker);
    classPreviewMarker = null;
  }
}

// 图例里的每一类：type 对应 data.json 里的 type（宿舍用 'dorm'）
const LEGEND_ITEMS = [
  { type: 'dorm', label: 'Dorm', color: '#cc0000' },
  { type: 'academic', label: 'Academic', color: TYPE_COLORS.academic },
  { type: 'recreation', label: 'Recreation', color: TYPE_COLORS.recreation },
  { type: 'dining', label: 'Dining', color: TYPE_COLORS.dining },
  { type: 'student_life', label: 'Student Life', color: TYPE_COLORS.student_life }
];

// 在地图右下角加一个图例。每一类前面有勾选框，勾上才在地图上显示这一类
function addLegend() {
  const legend = L.control({ position: 'bottomright' });

  // Leaflet 把图例放到地图上时，会调用 onAdd，要求返回一个 HTML 元素
  legend.onAdd = function () {
    // 用 <details>：点标题可以收起 / 展开。手机屏幕小，默认收起，免得挡住地图
    const box = L.DomUtil.create('details', 'map-legend');
    box.open = !window.matchMedia('(max-width: 768px)').matches;

    let html = '<summary class="legend-title">Show on map</summary>';
    LEGEND_ITEMS.forEach(function (item) {
      const checked = visibleTypes.has(item.type) ? 'checked' : '';
      html += `
        <label>
          <input type="checkbox" data-type="${item.type}" ${checked}>
          <span class="legend-dot" style="background:${item.color}"></span>${item.label}
        </label>
      `;
    });
    box.innerHTML = html;

    // 不让图例上的点击、滚动传到地图上（否则勾选时地图会跟着拖动或缩放）
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);

    // 勾选变化：更新 visibleTypes，然后刷新地图上的点
    box.addEventListener('change', function (event) {
      const type = event.target.dataset.type;
      if (event.target.checked) {
        visibleTypes.add(type);
      } else {
        visibleTypes.delete(type);
      }
      refreshMarkers();
    });

    return box;
  };

  legend.addTo(map);
}

addLegend();

console.log('map.js loaded');
