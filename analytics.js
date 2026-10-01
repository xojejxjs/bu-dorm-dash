// analytics.js：只负责"访问统计 + 反馈链接"
//
// 访问统计用 GoatCounter（index.html 里加载它的脚本）：不用 cookie，不收集名字、邮箱
// 我们只记"发生了什么事"，比如 "import-ics"、"route-check"，绝不发送课表内容、文件名或输入的地址
// 本地测试（localhost）时 GoatCounter 默认不统计，所以自己测试不会把数字弄乱

// 反馈问卷（Google Form）的链接。填上以后，标题栏才会出现 Feedback 按钮
const FEEDBACK_URL = '';

// 记一次事件。GoatCounter 还没加载好（或者被浏览器插件挡住）时，什么都不做
function trackEvent(name) {
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path: name, title: name, event: true });
  }
}

// Feedback 按钮：有链接才显示
function initFeedbackLink() {
  const link = document.getElementById('feedback-link');
  if (FEEDBACK_URL) {
    link.href = FEEDBACK_URL;
    link.hidden = false;
  }
}

// 用"事件委托"在整个页面上监听：不用改其他文件，统计的代码都集中在这里
function initEventTracking() {
  document.addEventListener('click', function (event) {
    const target = event.target.closest('#sample-button, #feedback-link, [data-action="sample-route"]');
    if (!target) {
      return;
    }
    if (target.id === 'sample-button') {
      trackEvent('try-sample');
    } else if (target.id === 'feedback-link') {
      trackEvent('feedback-click');
    } else {
      trackEvent('sample-route');
    }
  });

  document.addEventListener('change', function (event) {
    const id = event.target.id;
    // 导入课表：只记文件的种类（ics / image / pdf…），不记文件名和内容
    if (id === 'schedule-file') {
      Array.from(event.target.files).forEach(function (file) {
        trackEvent('import-' + fileKind(file));
      });
    }
    // 查路线：起点、终点都填好了才算一次
    if ((id === 'from-input' || id === 'to-input') &&
        document.getElementById('from-input').value && document.getElementById('to-input').value) {
      trackEvent('route-check');
    }
  });

  document.addEventListener('input', function (event) {
    if (event.target.id === 'rank-select') {
      trackEvent('dorm-ranking');
    }
  });
}

initFeedbackLink();
initEventTracking();

console.log('analytics.js loaded');
