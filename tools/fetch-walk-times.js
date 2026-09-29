// tools/fetch-walk-times.js：一次性工具脚本，不属于网页本身
// 作用：用 OpenRouteService 的 Matrix 服务，算出 data.json 里所有地点两两之间的真实步行时间和距离，
//       保存到 walk-times.json。网页之后直接查这张表，不需要再调用任何服务，也不需要 key
// 运行方法（在 bu-dorm-distance 文件夹里）：node tools/fetch-walk-times.js
// 什么时候需要重新运行：data.json 里加了新地点、或者改了坐标之后

const fs = require('fs');

// 从 .env 读取 key（.env 已经写进 .gitignore，不会被上传）
process.loadEnvFile('.env');
const API_KEY = process.env.ORS_API_KEY;
if (!API_KEY) {
  console.log('No ORS_API_KEY found in .env');
  process.exit(1);
}

const MATRIX_URL = 'https://api.openrouteservice.org/v2/matrix/foot-walking';
const MAX_CELLS_PER_REQUEST = 3500; // 免费版：一次请求最多算 3500 个格子（起点数 × 终点数）

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// 算一批起点到所有终点的时间和距离
// 输入：所有地点的坐标、这一批起点在数组里的位置
// 输出：{ durations: [[秒]], distances: [[米]] }，每行对应一个起点
async function fetchMatrix(locations, sourceIndexes) {
  const response = await fetch(MATRIX_URL, {
    method: 'POST',
    headers: {
      'Authorization': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      locations: locations,       // 注意：OpenRouteService 要求 [经度, 纬度] 的顺序，和 Leaflet 相反
      sources: sourceIndexes,     // 这一批的起点
      metrics: ['duration', 'distance'],
      units: 'm'
    })
  });

  if (!response.ok) {
    // 把服务器返回的错误说明打印出来，方便排查（里面不会包含 key）
    throw new Error('HTTP ' + response.status + ': ' + (await response.text()));
  }
  return response.json();
}

async function main() {
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const places = data.dorms.concat(data.buildings);

  const ids = places.map(function (p) { return p.id; });
  const locations = places.map(function (p) { return [p.longitude, p.latitude]; });

  // 每一批最多几个起点：保证 起点数 × 终点数 不超过 3500
  const batchSize = Math.floor(MAX_CELLS_PER_REQUEST / places.length);
  const seconds = [];
  const meters = [];

  for (let start = 0; start < places.length; start += batchSize) {
    const sourceIndexes = [];
    for (let i = start; i < Math.min(start + batchSize, places.length); i++) {
      sourceIndexes.push(i);
    }
    console.log(`requesting rows ${start + 1}–${start + sourceIndexes.length} of ${places.length}...`);

    const result = await fetchMatrix(locations, sourceIndexes);

    // 取整：秒和米都不需要小数；走不通的路线服务会返回 null，原样保留
    result.durations.forEach(function (row) {
      seconds.push(row.map(function (v) { return v === null ? null : Math.round(v); }));
    });
    result.distances.forEach(function (row) {
      meters.push(row.map(function (v) { return v === null ? null : Math.round(v); }));
    });

    await wait(2000); // 免费版每分钟最多 40 次，分批时稍微等一下
  }

  const output = {
    source: 'OpenRouteService foot-walking matrix',
    generated: new Date().toISOString().slice(0, 10),
    ids: ids,
    seconds: seconds,
    meters: meters
  };
  fs.writeFileSync('walk-times.json', JSON.stringify(output));

  const missing = seconds.flat().filter(function (v) { return v === null; }).length;
  console.log(`done: ${places.length} × ${places.length} walking times saved to walk-times.json` +
    (missing ? ` (${missing} routes not found)` : ''));
}

main().catch(function (error) {
  console.log('failed:', error.message);
  process.exit(1);
});
