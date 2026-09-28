// tools/fetch-shapes.js：一次性工具脚本，不属于网页本身
// 作用：从 OpenStreetMap 下载 BU 周边所有建筑的轮廓，找出每个地点落在哪栋楼里，保存到 shapes.json
// 运行方法（在 bu-dorm-distance 文件夹里）：node tools/fetch-shapes.js
// 什么时候需要重新运行：data.json 里加了新地点、或者改了坐标之后

const fs = require('fs');

const OVERPASS_URL = 'https://overpass.private.coffee/api/interpreter';

// BU 周边的范围：南, 西, 北, 东（包括 Fenway Campus 和 West Campus）
const BBOX = '42.340,-71.125,42.356,-71.088';

// 一个坐标点是否在多边形里面（射线法：从点向右画一条线，数穿过边界几次，奇数次就在里面）
function isInside(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const crosses = (latI > lat) !== (latJ > lat) &&
      lng < (lngJ - lngI) * (lat - latI) / (latJ - latI) + lngI;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

// 多边形面积（平方米，粗略），用来在几个候选里比较大小
function areaSqm(polygon) {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j][1] * polygon[i][0] - polygon[i][1] * polygon[j][0];
  }
  // 1 度纬度 ≈ 111 km；在 BU 这里 1 度经度 ≈ 82 km
  return Math.abs(sum / 2) * 111000 * 82000;
}

// 点到多边形最近顶点的距离（米，粗略）
function distanceToPolygon(lat, lng, polygon) {
  return Math.min(...polygon.map(function (p) {
    return Math.hypot((p[0] - lat) * 111000, (p[1] - lng) * 82000);
  }));
}

// 给一个地点挑一栋楼：
// 1. 优先找"包含这个点"的楼；有好几个时，优先有名字的，再挑最小的（最具体的那栋）
// 2. 都不包含时，找 30 米内最近的楼
function pickBuilding(place, buildings) {
  const lat = place.latitude;
  const lng = place.longitude;

  const containing = buildings.filter(function (b) { return isInside(lat, lng, b.points); });
  if (containing.length > 0) {
    containing.sort(function (a, b) {
      if (Boolean(a.name) !== Boolean(b.name)) {
        return a.name ? -1 : 1; // 有名字的排前面
      }
      return a.area - b.area;
    });
    return containing[0];
  }

  const nearby = buildings
    .map(function (b) { return { building: b, distance: distanceToPolygon(lat, lng, b.points) }; })
    .filter(function (x) { return x.distance <= 30; })
    .sort(function (a, b) { return a.distance - b.distance; });
  return nearby.length > 0 ? nearby[0].building : null;
}

async function main() {
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

  console.log('downloading all buildings around BU (one request, may take a minute)...');
  const query = `[out:json][timeout:120];way["building"](${BBOX});out geom;`;
  const response = await fetch(OVERPASS_URL + '?data=' + encodeURIComponent(query), {
    headers: { 'User-Agent': 'bu-housing-tool (student project)' }
  });
  if (!response.ok) {
    console.log('download failed, HTTP', response.status);
    return;
  }
  const elements = (await response.json()).elements;

  const buildings = elements.filter(function (e) { return e.geometry; }).map(function (e) {
    const points = e.geometry.map(function (p) {
      return [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))];
    });
    return { name: e.tags && e.tags.name, points: points, area: areaSqm(points) };
  });
  console.log('downloaded', buildings.length, 'buildings');

  const shapes = {};
  data.dorms.concat(data.buildings).forEach(function (place) {
    // "一个点代表一段街"的宿舍（Bay State Road）不框单栋楼，否则会误导
    if (place.addresses && place.addresses.length > 0) {
      console.log('skip (street group):', place.name);
      return;
    }
    const building = pickBuilding(place, buildings);
    if (building) {
      shapes[place.id] = building.points;
      console.log('ok:', place.name, '->', building.name || '(unnamed)', Math.round(building.area) + ' m²');
    } else {
      console.log('NOT FOUND:', place.name);
    }
  });

  fs.writeFileSync('shapes.json', JSON.stringify(shapes));
  console.log('done:', Object.keys(shapes).length, 'shapes saved to shapes.json');
}

main();
