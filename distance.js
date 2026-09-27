// distance.js：只负责距离和步行时间的计算
// 这里的函数不读网页、不改网页，只做"输入数字 → 输出数字"

const EARTH_RADIUS_METERS = 6371000; // 地球平均半径：6371 公里
const DETOUR_FACTOR = 1.3;           // 绕路系数：人要沿街走，实际路程约为直线的 1.3 倍
const WALK_SPEED_METERS_PER_MIN = 80; // 步行速度：约 80 米/分钟（≈ 4.8 公里/小时）

// 角度 → 弧度（三角函数 Math.sin / Math.cos 只认弧度）
function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

// Haversine 公式：计算地球表面两点之间的直线距离
// 输入：点 1 的纬度、经度，点 2 的纬度、经度
// 输出：距离（米）
function getDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

// 直线距离 → 预计步行时间
// 输入：直线距离（米）
// 输出：预计步行分钟数
function getWalkMinutes(meters) {
  const walkingMeters = meters * DETOUR_FACTOR;
  return walkingMeters / WALK_SPEED_METERS_PER_MIN;
}

const METERS_PER_MILE = 1609.34;
const FEET_PER_METER = 3.28084;

// 把距离转换成美国习惯的显示文字（计算仍然用米，只有显示时才转换）
// 输入：距离（米）
// 输出：文字，例如 "300 ft" 或 "0.62 mi"
function formatDistance(meters) {
  const miles = meters / METERS_PER_MILE;

  // 不到 0.1 英里（约 160 米）时，用英尺更直观
  if (miles < 0.1) {
    return Math.round(meters * FEET_PER_METER) + ' ft';
  }
  return miles.toFixed(2) + ' mi';
}

console.log('distance.js loaded');
