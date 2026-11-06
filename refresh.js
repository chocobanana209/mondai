import { db, currentUser } from "./script.js";

let refreshQueue = [];
let currentRefreshIndex = 0;
let activeRefreshSubject = "";

// 誤答リフレッシュのメイン画面を開く（教科選択一覧の構築）
export function openRefreshModeModal(allDocuments, allTables, allKanjiTables) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.add('hidden');
  document.getElementById('timeline-register-form-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('kanji-register-form-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('refresh-mode-container').classList.remove('hidden');

  document.getElementById('refresh-config-pane').classList.remove('hidden');
  document.getElementById('refresh-player-pane').classList.add('hidden');

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const subjectMap = new Map(); // 教科ごとの間違え問題数を集計

  // 1. 通常問題のチェック
  allDocuments.forEach(doc => {
    const subj = doc.subject || "未設定";
    const histKey = `doc_mistake_time_${doc.id}`;
    const mistakeTime = parseInt(localStorage.getItem(histKey)) || 0;
    const isIncorrect = (doc.stats?.incorrect || 0) > 0;

    if (isIncorrect && mistakeTime > 0 && (now - mistakeTime >= ONE_DAY_MS)) {
      if (!subjectMap.has(subj)) subjectMap.set(subj, []);
      subjectMap.get(subj).push({ type: 'doc', data: doc });
    }
  });

  // 2. 一問一答表のチェック
  allTables.forEach(t => {
    const subj = t.subject || "未設定";
    if (t.items) {
      t.items.forEach(item => {
        const histKey = `qa_hist_${t.id}_${item.id}`;
        const timeKey = `qa_mistake_time_${t.id}_${item.id}`;
        const status = localStorage.getItem(histKey);
        const mistakeTime = parseInt(localStorage.getItem(timeKey)) || 0;

        if (status === 'incorrect' && mistakeTime > 0 && (now - mistakeTime >= ONE_DAY_MS)) {
          if (!subjectMap.has(subj)) subjectMap.set(subj, []);
          subjectMap.get(subj).push({ type: 'qa', tableTitle: t.title, tableId: t.id, item });
        }
      });
    }
  });

  // 3. 漢字問題のチェック
  allKanjiTables.forEach(kt => {
    const subj = kt.subject || "未設定";
    if (kt.passages) {
      kt.passages.forEach(p => {
        if (p.subItems) {
          p.subItems.forEach(sub => {
            const histKey = `kanji_hist_${kt.id}_${sub.id}`;
            const timeKey = `kanji_mistake_time_${kt.id}_${sub.id}`;
            const status = localStorage.getItem(histKey);
            const mistakeTime = parseInt(localStorage.getItem(timeKey)) || 0;

            if (status === 'incorrect' && mistakeTime > 0 && (now - mistakeTime >= ONE_DAY_MS)) {
              if (!subjectMap.has(subj)) subjectMap.set(subj, []);
              subjectMap.get(subj).push({ type: 'kanji', tableTitle: kt.title, tableId: kt.id, passage: p, subItem: sub });
            }
          });
        }
      });
    }
  });

  // 教科選択ボタンを描画
  const listContainer = document.getElementById('refresh-subject-list');
  listContainer.innerHTML = '';

  if (subjectMap.size === 0) {
    listContainer.innerHTML = `<p class="text-xs text-slate-400 italic col-span-2 p-4 text-center">現在、間違えてから1日以上経過した復習対象の問題はありません！素晴らしいです 🎉</p>`;
    return;
  }

  subjectMap.forEach((problems, subject) => {
    const btn = document.createElement('button');
    btn.className = "p-3 border rounded-lg bg-rose-50 hover:bg-rose-100 border-rose-200 text-left text-xs font-bold text-rose-900 flex justify-between items-center transition shadow-xs";
    btn.innerHTML = `<span>📚 教科: ${subject}</span> <span class="bg-rose-600 text-white px-2 py-0.5 rounded-full text-[10px]">${problems.length}問</span>`;
    btn.addEventListener('click', () => startRefreshSession(subject, problems));
    listContainer.appendChild(btn);
  });
}

function startRefreshSession(subject, problems) {
  activeRefreshSubject = subject;
  refreshQueue = [...problems].sort(() => Math.random() - 0.5); // シャッフル
  currentRefreshIndex = 0;

  document.getElementById('refresh-config-pane').classList.add('hidden');
  document.getElementById('refresh-player-pane').classList.remove('hidden');
  document.getElementById('refresh-subject-badge').innerText = `教科: ${subject}`;

  renderRefreshCurrentItem();
}

function renderRefreshCurrentItem() {
  if (currentRefreshIndex >= refreshQueue.length) {
    alert(`「${activeRefreshSubject}」の誤答リフレッシュセッションが完了しました！お疲れ様でした 🌟`);
    document.getElementById('refresh-player-pane').classList.add('hidden');
    document.getElementById('refresh-config-pane').classList.remove('hidden');
    return;
  }

  const current = refreshQueue[currentRefreshIndex];
  document.getElementById('refresh-progress-badge').innerText = `問題 ${currentRefreshIndex + 1} / ${refreshQueue.length}`;
  
  const qBox = document.getElementById('refresh-question-box');
  const aText = document.getElementById('refresh-answer-text');

  qBox.innerHTML = '';
  aText.innerHTML = '';

  if (current.type === 'doc') {
    qBox.innerHTML = `<div class="font-bold text-xs text-rose-600 mb-1">【通常問題】 ${current.data.title}</div><div class="whitespace-pre-wrap">${current.data.questionText || '問題文なし'}</div>`;
    aText.innerHTML = `<div class="whitespace-pre-wrap">${current.data.answerText || '解答解説なし'}</div>`;
  } else if (current.type === 'qa') {
    qBox.innerHTML = `<div class="font-bold text-xs text-emerald-600 mb-1">【一問一答: ${current.tableTitle}】</div><div class="font-bold">${current.item.question}</div>`;
    aText.innerHTML = `<div><b>解答:</b> ${current.item.answer}</div><div class="text-xs text-slate-600 mt-1"><b>解説:</b> ${current.item.explanation || 'なし'}</div>`;
  } else if (current.type === 'kanji') {
    qBox.innerHTML = `<div class="font-bold text-xs text-amber-600 mb-1">【漢字: ${current.tableTitle}】</div><div class="font-serif">文章中の「${current.subItem.targetWord}」の読み書き</div>`;
    aText.innerHTML = `<div><b>正解読み:</b> ${current.subItem.reading}</div>`;
  }

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
  // 正解したので誤答履歴（タイムスタンプ）をクリア
  const current = refreshQueue[currentRefreshIndex];
  if (current.type === 'doc') {
    localStorage.removeItem(`doc_mistake_time_${current.data.id}`);
  } else if (current.type === 'qa') {
    localStorage.setItem(`qa_hist_${current.tableId}_${current.item.id}`, 'correct');
    localStorage.removeItem(`qa_mistake_time_${current.tableId}_${current.item.id}`);
  } else if (current.type === 'kanji') {
    localStorage.setItem(`kanji_hist_${current.tableId}_${current.subItem.id}`, 'correct');
    localStorage.removeItem(`kanji_mistake_time_${current.tableId}_${current.subItem.id}`);
  }

  currentRefreshIndex++;
  renderRefreshCurrentItem();
});

document.getElementById('refresh-incorrect-btn').addEventListener('click', () => {
  // 再び間違えたので現在時刻を更新してキューの最後尾へ
  const current = refreshQueue[currentRefreshIndex];
  const now = Date.now();
  if (current.type === 'doc') {
    localStorage.setItem(`doc_mistake_time_${current.data.id}`, now);
  } else if (current.type === 'qa') {
    localStorage.setItem(`qa_mistake_time_${current.tableId}_${current.item.id}`, now);
  } else if (current.type === 'kanji') {
    localStorage.setItem(`kanji_mistake_time_${current.tableId}_${current.subItem.id}`, now);
  }

  refreshQueue.push(current); // 再挑戦用に後ろに追加
  currentRefreshIndex++;
  renderRefreshCurrentItem();
});

document.getElementById('exit-refresh-btn').addEventListener('click', () => {
  document.getElementById('refresh-mode-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
});
