// course-guess.js：只负责"根据课号推测上课地点"
// 课表里没写教室的课，用课号前缀推测：前 3 个字母是学院，后 2 个字母是系（BU 官方规则）
// 例：CASCH 171 → CAS（文理学院）+ CH（化学系）
// 来源：https://www.bu.edu/academics/bulletin/abbreviations-and-symbols/
//
// 推测永远只是"建议"：界面上会把所有候选楼都列出来，由用户点开、看清楚说明后自己选择

// 学院代码 → 学院全名（显示给用户看，解释"为什么推测这里"）
const SCHOOL_NAMES = {
  CAS: 'College of Arts & Sciences',
  CDS: 'Faculty of Computing & Data Sciences',
  CFA: 'College of Fine Arts',
  CGS: 'College of General Studies',
  COM: 'College of Communication',
  ENG: 'College of Engineering',
  KHC: 'Kilachand Honors College',
  LAW: 'School of Law',
  QST: 'Questrom School of Business', // 官方页面写 "Questrom"，课号里一般用 QST
  SAR: 'Sargent College',
  SHA: 'School of Hospitality Administration',
  SSW: 'School of Social Work',
  STH: 'School of Theology',
  WED: 'Wheelock College of Education & Human Development'
};

// 学院 → 学院主楼（在我们 data.json 里怎么找到它：楼宇代码，或正式名字）
// 没列出来的学院（MET、SPH、MED、GMS、SDM、HUB、XRG、SUM 等）不推测：要么不在主校区，要么没有固定的楼
const SCHOOL_BUILDINGS = {
  CAS: 'CAS',
  CDS: 'CDS',
  CFA: 'CFA',
  CGS: 'CGS',
  COM: 'COM',
  ENG: 'ENG',
  KHC: 'Kilachand Hall',
  LAW: 'LAW',
  QST: 'HAR',
  SAR: 'SAR',
  SHA: 'SHA',
  SSW: 'SSW',
  STH: 'STH',
  WED: 'WED'
};

// 学院 + 系 → 这个系的课通常在哪栋楼（比学院主楼更具体）
// ⚠ 这是根据常识的推测，不保证准确，所以界面上会和学院主楼一起列出来让用户选
const DEPARTMENT_BUILDINGS = {
  CASCH: { building: 'SCI', subject: 'Chemistry' },
  CASPY: { building: 'SCI', subject: 'Physics' },
  CASMA: { building: 'MCS', subject: 'Mathematics' },
  CASCS: { building: 'CDS', subject: 'Computer Science' },
  CASBI: { building: 'LSE', subject: 'Biology' },
  CASPS: { building: 'PSY', subject: 'Psychological & Brain Sciences' }
};

// 推测一门课可能在哪些楼
// 输入：课号（比如 "CASCH 171"）、地点搜索索引
// 输出：候选楼的数组 [{ place, reason }]，最多两个：系对应的楼、学院主楼；推测不出来时是空数组
function guessLocations(course, placeIndex) {
  const prefix = course.replace(/\s.*/, '').toUpperCase(); // "CASCH 171" → "CASCH"
  const school = prefix.slice(0, 3);                        // "CAS"
  const candidates = [];

  // 1. 按系推测（更具体）
  const department = DEPARTMENT_BUILDINGS[prefix];
  if (department) {
    const place = findPlace(placeIndex, department.building, false);
    if (place) {
      candidates.push({
        place: place,
        reason: `${prefix} is ${department.subject}, usually taught in this building`
      });
    }
  }

  // 2. 按学院推测：学院主楼
  if (SCHOOL_BUILDINGS[school]) {
    const place = findPlace(placeIndex, SCHOOL_BUILDINGS[school], false);
    const alreadyListed = candidates.some(function (c) { return place && c.place.id === place.id; });
    if (place && !alreadyListed) {
      candidates.push({
        place: place,
        reason: `${school} = ${SCHOOL_NAMES[school]}; this is the college's main building`
      });
    }
  }

  return candidates;
}

console.log('course-guess.js loaded');
