import { db, currentUser } from "./script.js";

let refreshQueue = [];
let currentRefreshIndex = 0;
let activeRefreshData = null;

export function openRefreshModeModal(dataAll) {
  const containerIds = [
    'view-mode-container', 'collection-player-container', 'table-player-container',
    'kanji-player-container', 'table-register-form-container', 'kanji-register-form-container',
    'timeline-register-form-container', 'refresh-mode-container', 'refresh-config-pane', 'refresh-player-pane'
  ];
  containerIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const refreshModeContainer = document.getElementById('refresh-mode-container');
  if (refreshModeContainer) refreshModeContainer.classList.remove('hidden');
  const refreshConfigPane = document.getElementById('refresh-config-pane');
  if (refreshConfigPane) refreshConfigPane.classList.remove('hidden');

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
  if (subjContainer) {
    subjContainer.innerHTML = '';
    subjects.forEach(sub => {
      const lbl = document.createElement('label');
      lbl.className = "flex items-center gap-1 cursor-pointer bg-white px-2 py-1 border rounded shadow-2xs";
      lbl.innerHTML = `<input type="checkbox" value="${sub}" checked class="refresh-subj-chk"/><span>${sub}</span>`;
      subjContainer.appendChild(lbl);
    });
  }

  const matContainer = document.getElementById('refresh-material-checkboxes');
  if (matContainer) {
    matContainer.innerHTML = '';
    materials.forEach(mat => {
      const lbl = document.createElement('label');
      lbl.className = "flex items-center gap-1 cursor-pointer bg-white px-2 py-1 border rounded shadow-2xs";
      lbl.innerHTML = `<input type="checkbox" value="${mat.key}" checked class="refresh-mat-chk"/><span>${mat.name}</span>`;
      matContainer.appendChild(lbl);
    });
  }

  window._globalDataAll = dataAll;
}

const exitRefreshBtn = document.getElementById('exit-refresh-btn');
if (exitRefreshBtn) {
  exitRefreshBtn.addEventListener('click', () => {
    const refreshModeContainer = document.getElementById('refresh-mode-container');
    if (refreshModeContainer) refreshModeContainer.classList.add('hidden');
    const viewModeContainer = document.getElementById('view-mode-container');
    if (viewModeContainer) viewModeContainer.classList.remove('hidden');
  });
}

const startRefreshSessionBtn = document.getElementById('start-refresh-session-btn');
if (startRefreshSessionBtn) {
  startRefreshSessionBtn.addEventListener('click', () => {
    const selectedSubjects = Array.from(document.querySelectorAll('.refresh-subj-chk:checked')).map(c => c.value);
    const selectedMaterials = Array.from(document.querySelectorAll('.refresh-mat-chk:checked')).map(c => c.value);

    const dataAll = window._globalDataAll;
    let candidates = [];

    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    if (selectedMaterials.includes('questionTables') && dataAll && dataAll.questionTables) {
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

    if (selectedMaterials.includes('kanjiTables') && dataAll && dataAll.kanjiTables) {
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

    const refreshConfigPane = document.getElementById('refresh-config-pane');
    if (refreshConfigPane) refreshConfigPane.classList.add('hidden');
    const refreshPlayerPane = document.getElementById('refresh-player-pane');
    if (refreshPlayerPane) refreshPlayerPane.classList.remove('hidden');

    renderRefreshCurrentItem();
  });
}

function getSpacedRepetitionTier(tableId, itemId, now, ONE_DAY_MS) {
  const key = `sr_${tableId}_${itemId}`;
  const data = JSON.parse(localStorage.getItem(key));
  if (!data) return 0;

  const elapsedDays = (now - data.lastTime) / ONE_DAY_MS;

  if (data.streak === 0) {
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
    const refreshModeContainer = document.getElementById('refresh-mode-container');
    if (refreshModeContainer) refreshModeContainer.classList.add('hidden');
    const viewModeContainer = document.getElementById('view-mode-container');
    if (viewModeContainer) viewModeContainer.classList.remove('hidden');
    return;
  }

  activeRefreshData = refreshQueue[currentRefreshIndex];
  
  const progressBadge = document.getElementById('refresh-progress-badge');
  if (progressBadge) progressBadge.innerText = `問題 ${currentRefreshIndex + 1} / ${refreshQueue.length}`;
  
  const tierBadge = document.getElementById('refresh-tier-badge');
  if (tierBadge) tierBadge.innerText = `重要度ティア: ${activeRefreshData.tier}`;
  
  const qBox = document.getElementById('refresh-question-box');
  if (qBox) qBox.innerText = activeRefreshData.question;
  
  const aText = document.getElementById('refresh-answer-text');
  if (aText) aText.innerText = activeRefreshData.answer;

  const ansArea = document.getElementById('refresh-answer-area');
  if (ansArea) ansArea.classList.add('hidden');
  const showAnsBtn = document.getElementById('refresh-show-ans-btn');
  if (showAnsBtn) showAnsBtn.classList.remove('hidden');
  const gradeBtns = document.getElementById('refresh-grade-buttons');
  if (gradeBtns) gradeBtns.classList.add('hidden');
}

const refreshShowAnsBtn = document.getElementById('refresh-show-ans-btn');
if (refreshShowAnsBtn) {
  refreshShowAnsBtn.addEventListener('click', () => {
    const ansArea = document.getElementById('refresh-answer-area');
    if (ansArea) ansArea.classList.remove('hidden');
    refreshShowAnsBtn.classList.add('hidden');
    const gradeBtns = document.getElementById('refresh-grade-buttons');
    if (gradeBtns) gradeBtns.classList.remove('hidden');
  });
}

const refreshCorrectBtn = document.getElementById('refresh-correct-btn');
if (refreshCorrectBtn) {
  refreshCorrectBtn.addEventListener('click', () => {
    if (activeRefreshData) {
      updateSpacedRecord(activeRefreshData.tableId, activeRefreshData.itemId, true);
    }
    currentRefreshIndex++;
    renderRefreshCurrentItem();
  });
}

const refreshIncorrectBtn = document.getElementById('refresh-incorrect-btn');
if (refreshIncorrectBtn) {
  refreshIncorrectBtn.addEventListener('click', () => {
    if (activeRefreshData) {
      updateSpacedRecord(activeRefreshData.tableId, activeRefreshData.itemId, false);
    }
    currentRefreshIndex++;
    renderRefreshCurrentItem();
  });
}

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
