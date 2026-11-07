import { db, currentUser } from "./script.js";

let refreshQueue = [];
let currentRefreshIndex = 0;
let activeRefreshData = null;

export function openRefreshModeModal(dataAll) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('kanji-register-form-container').classList.add('hidden');
  document.getElementById('timeline-register-form-container').classList.add('hidden');
  document.getElementById('refresh-mode-container').classList.remove('hidden');

  document.getElementById('refresh-config-pane').classList.remove('hidden');
  document.getElementById('refresh-player-pane').classList.add('hidden');

  // 教科・教材のチェックボックス構築
  const subjects = new Set();
  const materials = [
    { key: 'questionTables', name: '一問一答' },
    { key: 'kanjiTables', name: '漢字' },
    { key: 'collections', name: '問題集' }
  ];

  Object.values(dataAll).forEach(arr => {
    if (Array.isArray(arr)) {
      arr.forEach(item => {
        if (item.subject) subjects.add(item.subject);
      });
    }
  });

  const subjContainer = document.getElementById('refresh-subject-checkboxes');
  subjContainer.innerHTML = '';
  subjects.forEach(sub => {
    const lbl = document.createElement('label');
    lbl.className = "flex items-center gap-1 cursor-pointer bg-white px-2 py-1 border rounded shadow-2xs";
    lbl.innerHTML = `<input type="checkbox" value="${sub}" checked class="refresh-subj-chk"/><span>${sub}</span>`;
    subjContainer.appendChild(lbl);
  });

  const matContainer = document.getElementById('refresh-material-checkboxes');
  matContainer.innerHTML = '';
  materials.forEach(mat => {
    const lbl = document.createElement('label');
    lbl.className = "flex items-center gap-1 cursor-pointer bg-white px-2 py-1 border rounded shadow-2xs";
    lbl.innerHTML = `<input type="checkbox" value="${mat.key}" checked class="refresh-mat-chk"/><span>${mat.name}</span>`;
    matContainer.appendChild(lbl);
  });

  window._globalDataAll = dataAll;
}

document.getElementById('exit-refresh-btn').addEventListener('click', () => {
  document.getElementById('refresh-mode-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
});

document.getElementById('start-refresh-session-btn').addEventListener('click', () => {
  const selectedSubjects = Array.from(document.querySelectorAll('.refresh-subj-chk:checked')).map(c => c.value);
  const selectedMaterials = Array.from(document.querySelectorAll('.refresh-mat-chk:checked')).map(c => c.value);

  const dataAll = window._globalDataAll;
  let candidates = [];

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // 各教材を走査して間隔反復ティア判定を行う
  if (selectedMaterials.includes('questionTables') && dataAll.questionTables) {
    dataAll.questionTables.filter(t => !t.isDeleted && selectedSubjects.includes(t.subject)).forEach((table, tIdx) => {
      if (table.items) {
        table.items.forEach((item, iIdx) => {
          const tier = getSpacedRepetitionTier(table.id, item.id, now, ONE_DAY_MS);
          if (tier > 0) {
            candidates.push({
              tier,
              materialOrder: 0,
              regOrder: tIdx * 1000 + iIdx,
              question: item.question,
              answer: item.answer + (item.explanation ? `\n解説: ${item.explanation}` : ''),
              tableId: table.id,
              itemId: item.id
            });
          }
        });
      }
    });
  }

  if (selectedMaterials.includes('kanjiTables') && dataAll.kanjiTables) {
    dataAll.kanjiTables.filter(k => !k.isDeleted && selectedSubjects.includes(k.subject)).forEach((table, tIdx) => {
      if (table.passages) {
        table.passages.forEach((p, pIdx) => {
          if (p.subItems) {
            p.subItems.forEach((sub, sIdx) => {
              const tier = getSpacedRepetitionTier(table.id, sub.id, now, ONE_DAY_MS);
              if (tier > 0) {
                candidates.push({
                  tier,
                  materialOrder: 1,
                  regOrder: tIdx * 1000 + pIdx * 10 + sIdx,
                  question: `次の文章の傍線部「${sub.targetWord}」の${sub.direction}を答えよ。\n\n${p.passageText}`,
                  answer: `解答: ${sub.reading || sub.targetWord}`,
                  tableId: table.id,
                  itemId: sub.id
                });
              }
            });
          }
        });
      }
    });
  }

  // 重要度順（ティア昇順: 1が最重要） -> 教材順 -> 登録順
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.materialOrder !== b.materialOrder) return a.materialOrder - b.materialOrder;
    return a.regOrder - b.regOrder;
  });

  refreshQueue = candidates;
  currentRefreshIndex = 0;

  if (refreshQueue.length === 0) {
    alert("現在解きなおし対象となる問題はありません！素晴らしいです！");
    return;
  }

  document.getElementById('refresh-config-pane').classList.add('hidden');
  document.getElementById('refresh-player-pane').classList.remove('hidden');

  renderRefreshCurrentItem();
});

// 間隔反復ティア判定ロジック
// 1: 前回間違えた問題（即時解き直し以外）
// 2: 連続正解1回、かつ前回から1日経過
// 3: 連続正解2回、かつ前回から3日経過
// 4: 連続正解3回、かつ前回から7日経過
// 5: 連続正解4回、かつ前回から20日経過
function getSpacedRepetitionTier(tableId, itemId, now, ONE_DAY_MS) {
  const key = `sr_${tableId}_${itemId}`;
  const data = JSON.parse(localStorage.getItem(key));
  if (!data) return 0; // 未解答・正解のみなら対象外

  const elapsedDays = (now - data.lastTime) / ONE_DAY_MS;

  if (data.streak === 0) {
    // 即時解き直し（直近5分以内など）はノーカンとする場合
    if (now - data.lastTime < 5 * 60 * 1000) return 0;
    return 1;
  } else if (data.streak === 1 && elapsedDays >= 1) {
    return 2;
  } else if (data.streak === 2 && elapsedDays >= 3) {
    return 3;
  } else if (data.streak === 3 && elapsedDays >= 7) {
    return 4;
  } else if (data.streak >= 4 && elapsedDays >= 20) {
    return 5;
  }
  return 0;
}

function renderRefreshCurrentItem() {
  if (currentRefreshIndex >= refreshQueue.length) {
    alert("選択した範囲の解きなおしがすべて完了しました！お疲れ様でした 🎉");
    document.getElementById('refresh-mode-container').classList.add('hidden');
    document.getElementById('view-mode-container').classList.remove('hidden');
    return;
  }

  activeRefreshData = refreshQueue[currentRefreshIndex];
  document.getElementById('refresh-progress-badge').innerText = `問題 ${currentRefreshIndex + 1} / ${refreshQueue.length}`;
  document.getElementById('refresh-tier-badge').innerText = `優先度ティア: ${activeRefreshData.tier}`;
  document.getElementById('refresh-question-box').innerText = activeRefreshData.question;
  document.getElementById('refresh-answer-text').innerText = activeRefreshData.answer;

  document.getElementById('refresh-answer-area').classList.add('hidden');
  document.getElementById('refresh-show-ans-btn').classList.remove('hidden');
  document.getElementById('refresh-grade-buttons').classList.add('hidden');
}

document.getElementById('refresh-show-ans-btn').addEventListener('click', () => {
  document.getElementById('refresh-answer-area').classList.remove('hidden');
  document.getElementById('refresh-show-ans-btn').classList.add('hidden');
  document.getElementById('refresh-grade-buttons').classList.remove('hidden');
});

document.getElementById('refresh-correct-btn').addEventListener('click', () => {
  updateSpacedRecord(activeRefreshData.tableId, activeRefreshData.itemId, true);
  currentRefreshIndex++;
  renderRefreshCurrentItem();
});

document.getElementById('refresh-incorrect-btn').addEventListener('click', () => {
  updateSpacedRecord(activeRefreshData.tableId, activeRefreshData.itemId, false);
  currentRefreshIndex++;
  renderRefreshCurrentItem();
});

function updateSpacedRecord(tableId, itemId, isCorrect) {
  const key = `sr_${tableId}_${itemId}`;
  let data = JSON.parse(localStorage.getItem(key)) || { streak: 0, lastTime: 0 };
  const now = Date.now();
  if (isCorrect) {
    data.streak += 1;
    data.lastTime = now;
  } else {
    data.streak = 0;
    data.lastTime = now;
  }
  localStorage.setItem(key, JSON.stringify(data));
}
