// geocode.js：只负责"把地址变成经纬度"（地理编码 geocoding）
// 用的是 OpenStreetMap 的免费服务 Nominatim。使用规则：每秒最多查 1 次、不能边打字边查
// 所以只在用户打完字时才查，并且查过的地址会记住，不再重复查询

const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';

// 只在波士顿周边找（西, 北, 东, 南），避免输入 "1 Main St" 找到别的城市
const BOSTON_VIEWBOX = '-71.20,42.40,-71.00,42.30';

// 查过的地址：key 是小写的地址文字，value 是 { latitude, longitude, label }，找不到时是 null
const geocodeCache = {};

// 把地址变成经纬度
// 输入：用户输入的地址文字
// 输出：{ latitude, longitude, label }；找不到时是 null
async function geocodeAddress(text) {
  const key = text.trim().toLowerCase();
  if (key in geocodeCache) {
    return geocodeCache[key];
  }

  const params = new URLSearchParams({
    q: text,
    format: 'json',
    limit: '1',
    viewbox: BOSTON_VIEWBOX,
    bounded: '1' // 只返回 viewbox 范围里的结果
  });

  try {
    const response = await fetch(GEOCODE_URL + '?' + params);
    if (!response.ok) {
      return null; // 服务器出错：不记进缓存，下次还可以再试
    }
    const results = await response.json();

    let found = null;
    if (results.length > 0) {
      found = {
        latitude: Number(results[0].lat),
        longitude: Number(results[0].lon),
        // display_name 很长（"1200, Commonwealth Avenue, Allston, Boston, ..."），只留前两段
        label: results[0].display_name.split(',').slice(0, 2).join(',')
      };
    }
    geocodeCache[key] = found; // 找到和确定找不到，都记下来
    return found;
  } catch (error) {
    return null; // 网络出错：同样不记，下次再试
  }
}

// 用户把大头针拖到了新位置：更新记住的坐标，之后再算这个地址就用新位置
function adjustGeocode(text, latitude, longitude) {
  const key = text.trim().toLowerCase();
  if (geocodeCache[key]) {
    geocodeCache[key].latitude = latitude;
    geocodeCache[key].longitude = longitude;
  }
}

console.log('geocode.js loaded');
