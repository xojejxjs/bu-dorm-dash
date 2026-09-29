// route-api.js：只负责向我们自己的后端要"真实步行路线"
// 后端（backend/main.py）保管 API key，浏览器永远看不到 key

// 后端在哪里：
// - 本地开发（网页在 localhost）：后端在 localhost:8001
// - 线上网站：后端还没部署，先不用（设成 null，网站就和以前一样只用提前算好的表和直线估算）
// 以后后端部署上线，只要把 null 换成后端的网址
const BACKEND_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8001'
  : null;

// 向后端要一条路线
// 输入：起点对象、终点对象（都要有 latitude / longitude）
// 输出：{ meters, seconds, path }，path 是沿街道的一串 [纬度, 经度]；后端不可用或出错时返回 null
async function fetchRealRoute(fromPlace, toPlace) {
  if (!BACKEND_URL) {
    return null;
  }

  // 如果地点有 entrance（入口坐标），用入口算路线，和 walk-times.json 保持一致
  const from = fromPlace.entrance || [fromPlace.latitude, fromPlace.longitude];
  const to = toPlace.entrance || [toPlace.latitude, toPlace.longitude];

  const params = new URLSearchParams({
    from_lat: from[0], from_lng: from[1],
    to_lat: to[0], to_lng: to[1]
  });

  try {
    // AbortSignal.timeout：超过 15 秒还没回来就放弃，免得页面一直等
    const response = await fetch(`${BACKEND_URL}/api/route?${params}`, {
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      return null; // 后端返回了错误（400 / 500 / 502），就当没有真实路线
    }
    return await response.json();
  } catch (error) {
    // 连不上后端（没启动、断网、超时）：不报错，网站照常用估算
    console.log('Backend not available, keeping the estimate');
    return null;
  }
}

console.log('route-api.js loaded');
