// tabs.js：左边的三个标签页（My week / Find a dorm / Route check）
//
// 一次只显示一个标签页，左边就不会一长串什么都有
// 地图也跟着变：在 My week 里，宿舍的点变淡，"我的课"更突出

const TAB_NAMES = ['week', 'dorm', 'route'];

// 切换到某个标签页
// 输入：'week'、'dorm' 或 'route'
function showTab(name) {
  TAB_NAMES.forEach(function (tab) {
    const selected = tab === name;
    document.getElementById('tab-' + tab).hidden = !selected;
    document.getElementById('tab-btn-' + tab).setAttribute('aria-selected', String(selected));
  });
  // 地图容器上记下当前是哪个标签页，style.css 根据它决定哪些点变淡
  const mapBox = document.getElementById('map');
  TAB_NAMES.forEach(function (tab) {
    mapBox.classList.toggle('tab-' + tab, tab === name);
  });
  // 换了标签页，左边从头开始看
  document.getElementById('sidebar').scrollTop = 0;
}

// 现在是哪个标签页
function currentTab() {
  return TAB_NAMES.find(function (tab) {
    return !document.getElementById('tab-' + tab).hidden;
  });
}

function initTabs() {
  document.querySelector('.tabs').addEventListener('click', function (event) {
    const button = event.target.closest('button[data-tab]');
    if (button) {
      showTab(button.dataset.tab);
    }
  });
  showTab('week');
}

console.log('tabs.js loaded');
