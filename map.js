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

// 把所有宿舍画到地图上
// 输入：dorms 数组（来自 data.json）
// 输出：地图上每个宿舍出现一个红色圆点
function addDormMarkers(dorms) {
  dorms.forEach(function (dorm) {
    // forEach 会对数组里的每一项执行一次这个函数，dorm 就是"当前这一个宿舍"
    L.circleMarker([dorm.latitude, dorm.longitude], {
      radius: 9,
      color: 'white',       // 边框颜色
      weight: 2,            // 边框粗细
      fillColor: '#cc0000', // 宿舍：红色
      fillOpacity: 0.9
    })
      .bindTooltip(dorm.name) // 鼠标悬停时显示名字
      .addTo(map)
      .on('click', function () {
        // 点击这个 marker 时执行：把"当前这个宿舍"交给 showDormInfo（在 app.js 里）
        showDormInfo(dorm);
      });
  });
}

// 把所有教学楼画到地图上（逻辑和上面一样，只是颜色不同）
function addBuildingMarkers(buildings) {
  buildings.forEach(function (building) {
    L.circleMarker([building.latitude, building.longitude], {
      radius: 7,
      color: 'white',
      weight: 2,
      fillColor: '#1f6feb', // 教学楼：蓝色
      fillOpacity: 0.9
    })
      .bindTooltip(building.name)
      .addTo(map);
  });
}

console.log('map.js loaded');
