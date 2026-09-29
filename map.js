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

// 在地图上画 A → B 的连线，颜色跟结论一致
// 输入：起点对象、终点对象、结论（'green' / 'yellow' / 'red'）
// 输出：地图上出现一条虚线，并缩放到能看到两个点
function drawRouteLine(fromPlace, toPlace, verdict) {
  clearRouteLine();

  const lineColors = {
    green: '#1e8e3e',
    yellow: '#e8a200',
    red: '#d93025'
  };

  routeLine = L.polyline(
    [
      [fromPlace.latitude, fromPlace.longitude],
      [toPlace.latitude, toPlace.longitude]
    ],
    {
      color: lineColors[verdict],
      weight: 4,
      dashArray: '8 8' // 虚线：提醒用户这是直线距离，不是真实步行路线
    }
  ).addTo(map);

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
    const box = L.DomUtil.create('div', 'map-legend');

    let html = '<div class="legend-title">Show on map</div>';
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
