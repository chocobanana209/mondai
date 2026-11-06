import { db, currentUser } from "./script.js";
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let activeKanjiData = null;
let kanjiExerciseQueue = [], kanjiRetryQueue = [], currentKanjiIndex = 0, kanjiTotalCount = 0, isKanjiRetryLoop = false;

export function renderKanjiTableList(tables) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  container.innerHTML = tables.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">漢字問題表がありません。</p>' : '';
  tables.forEach(t => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border bg-amber-50 hover:bg-amber-100 border-amber-300 cursor-pointer text-xs transition space-y-2';
    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-amber-900 truncate">${t.title}</span>
        <div class="flex gap-1">
          <button class="edit-kanji text-blue-600 font-bold">編集</button>
          <button class="del-kanji text-red-500 font-bold">削除</button>
        </div>
      </div>
      <div class="text-[10px] text-amber-700">教科: ${t.subject || '未設定'} | 文章問題数: ${t.passages ? t.passages.length : 0}問</div>
      <button class="start-kanji-exercise-btn w-full bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded font-bold">漢字演習を始める ✍️</button>
    `;
    item.querySelector('.start-kanji-exercise-btn').addEventListener('click', (e) => { e.stopPropagation(); openKanjiConfigModal(t); });
    item.querySelector('.edit-kanji').addEventListener('click', (e) => { e.stopPropagation(); openKanjiRegisterForm(t); });
    item.querySelector('.del-kanji').addEventListener('click', async (e) => { e.stopPropagation(); await deleteDoc(doc(db, "users", currentUser.uid, "kanjiTables", t.id)); });
    container.appendChild(item);
  });
}

document.getElementById('btn-nav-kanji-register').addEventListener('click', () => openKanjiRegisterForm(null));
document.getElementById('cancel-kanji-register-btn').addEventListener('click', closeKanjiRegisterForm);

function openKanjiRegisterForm(kanjiData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.add('hidden');
  document.getElementById('refresh-mode-container').classList.add('hidden');
  document.getElementById('timeline-register-form-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('kanji-register-form-container').classList.remove('hidden');

  document.getElementById('editing-kanji-id').value = kanjiData ? kanjiData.id : '';
  document.getElementById('kanji-name-input').value = kanjiData ? kanjiData.title : '';
  document.getElementById('kanji-subject-input').value = kanjiData ? (kanjiData.subject || "") : "";
  renderKanjiTableRows(kanjiData ? kanjiData.passages || [] : [createEmptyKanjiPassageItem()]);
}

function closeKanjiRegisterForm() {
  document.getElementById('kanji-register-form-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
}

function createEmptyKanjiPassageItem() {
  return {
    id: `passage_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    passageText: "",
    subItems: [
      { id: `sub_${Date.now()}_1`, targetWord: "", reading: "", direction: "読み書き" }
    ]
  };
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  const newHeight = Math.min(Math.max(textarea.scrollHeight + 4, 60), 300);
  textarea.style.height = newHeight + 'px';
  
  if (textarea.scrollHeight > 300) {
    textarea.style.overflowY = 'auto';
  } else {
    textarea.style.overflowY = 'hidden';
  }
}

function renderKanjiTableRows(passages) {
  const tbody = document.getElementById('kanji-table-tbody'); if (!tbody) return;
  tbody.innerHTML = '';

  passages.forEach((passage, pIndex) => {
    const subItems = passage.subItems && passage.subItems.length > 0 ? passage.subItems : [{ id: `sub_${Date.now()}`, targetWord: "", reading: "", direction: "読み書き" }];
    
    subItems.forEach((sub, sIndex) => {
      const tr = document.createElement('tr');
      tr.className = "border-b hover:bg-slate-100 kanji-row-item";
      tr.dataset.passageId = passage.id;
      tr.dataset.subId = sub.id;

      let leftCellsHtml = '';
      if (sIndex === 0) {
        leftCellsHtml = `
          <td class="p-2 text-center text-gray-400 cursor-grab font-bold align-middle drag-handle select-none" title="ドラッグして移動" rowspan="${subItems.length}">≡</td>
          <td class="p-2 text-center font-bold text-gray-500 row-index align-middle" rowspan="${subItems.length}">${pIndex + 1}</td>
          <td class="p-2 align-middle" rowspan="${subItems.length}">
            <textarea class="w-full border rounded p-2 kanji-passage-input font-serif leading-relaxed resize-none min-h-[60px] max-h-[300px]" placeholder="文章全体を入力...">${passage.passageText || ''}</textarea>
          </td>
        `;
      }

      tr.innerHTML = `
        ${leftCellsHtml}
        <td class="p-2"><input type="text" class="w-full border rounded p-1 kanji-word-input" placeholder="傍線部(漢字)" value="${sub.targetWord || ''}"/></td>
        <td class="p-2"><input type="text" class="w-full border rounded p-1 kanji-reading-input" placeholder="読み仮名(カンマ区切り)" value="${sub.reading || ''}"/></td>
        <td class="p-2 text-center">
          <select class="w-full border rounded p-1 kanji-dir-select bg-white">
            <option value="読み書き" ${sub.direction === '読み書き' ? 'selected' : ''}>読み書き</option>
            <option value="読み" ${sub.direction === '読み' ? 'selected' : ''}>読み</option>
            <option value="書き" ${sub.direction === '書き' ? 'selected' : ''}>書き</option>
          </select>
        </td>
        <td class="p-2 text-center">
          <button type="button" class="kanji-row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">削除</button>
        </td>
      `;

      if (sIndex === 0) {
        const textarea = tr.querySelector('.kanji-passage-input');
        if (textarea) {
          setTimeout(() => autoResizeTextarea(textarea), 0);
          textarea.addEventListener('input', () => autoResizeTextarea(textarea));
        }

        const handle = tr.querySelector('.drag-handle');
        if (handle) {
          handle.addEventListener('mousedown', () => tr.setAttribute('draggable', 'true'));
          handle.addEventListener('mouseup', () => tr.removeAttribute('draggable'));
          tr.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', passage.id);
            tr.classList.add('opacity-40');
          });
          tr.addEventListener('dragend', () => {
            tr.classList.remove('opacity-40');
            tr.removeAttribute('draggable');
          });
          tr.addEventListener('dragover', (e) => e.preventDefault());
          tr.addEventListener('drop', (e) => {
            e.preventDefault();
            const draggingTr = tbody.querySelector('.opacity-40');
            if (draggingTr && draggingTr !== tr) {
              const currentPassages = collectCurrentKanjiPassages();
              renderKanjiTableRows(currentPassages);
            }
          });
        }
      }

      tr.querySelector('.kanji-row-del-btn').addEventListener('click', () => deleteKanjiSubItem(passage.id, sub.id));
      tbody.appendChild(tr);
    });

    const addRowTr = document.createElement('tr');
    addRowTr.className = "bg-amber-50/50 border-b";
    addRowTr.innerHTML = `
      <td colspan="7" class="p-2 text-center">
        <button type="button" class="add-sub-btn bg-amber-200 hover:bg-amber-300 text-amber-900 px-4 py-1.5 rounded text-xs font-bold shadow-sm transition">+ この文章に傍線部を追加する</button>
      </td>
    `;
    addRowTr.querySelector('.add-sub-btn').addEventListener('click', () => {
      const currentPassages = collectCurrentKanjiPassages();
      const targetP = currentPassages.find(p => p.id === passage.id);
      if (targetP) {
        targetP.subItems.push({ id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, targetWord: "", reading: "", direction: "読み書き" });
      }
      renderKanjiTableRows(currentPassages);
    });
    tbody.appendChild(addRowTr);
  });
}

function deleteKanjiSubItem(passageId, subId) {
  const currentPassages = collectCurrentKanjiPassages();
  const targetP = currentPassages.find(p => p.id === passageId);
  if (targetP) {
    targetP.subItems = targetP.subItems.filter(s => s.id !== subId);
    if (targetP.subItems.length === 0) {
      const filtered = currentPassages.filter(p => p.id !== passageId);
      renderKanjiTableRows(filtered.length > 0 ? filtered : [createEmptyKanjiPassageItem()]);
    } else {
      renderKanjiTableRows(currentPassages);
    }
  }
}

function collectCurrentKanjiPassages() {
  const tbody = document.getElementById('kanji-table-tbody');
  if (!tbody) return [];
  const rows = tbody.querySelectorAll('tr.kanji-row-item');
  const passageMap = new Map();

  rows.forEach(tr => {
    const passageId = tr.dataset.passageId;
    const subId = tr.dataset.subId;
    const passageInput = tr.querySelector('.kanji-passage-input');
    const wordInput = tr.querySelector('.kanji-word-input');
    const readingInput = tr.querySelector('.kanji-reading-input');
    const dirSelect = tr.querySelector('.kanji-dir-select');

    if (!passageMap.has(passageId)) {
      passageMap.set(passageId, {
        id: passageId,
        passageText: passageInput ? passageInput.value.trim() : "",
        subItems: []
      });
    }

    if (passageInput && passageInput.value.trim() !== "") {
      passageMap.get(passageId).passageText = passageInput.value.trim();
    }

    if (wordInput || readingInput) {
      passageMap.get(passageId).subItems.push({
        id: subId,
        targetWord: wordInput ? wordInput.value.trim() : "",
        reading: readingInput ? readingInput.value.trim() : "",
        direction: dirSelect ? dirSelect.value : "読み書き"
      });
    }
  });

  return Array.from(passageMap.values());
}

document.getElementById('add-kanji-row-btn').addEventListener('click', () => {
  const currentPassages = collectCurrentKanjiPassages();
  currentPassages.push(createEmptyKanjiPassageItem());
  renderKanjiTableRows(currentPassages);
});

document.getElementById('save-kanji-doc-btn').addEventListener('click', async () => {
  if (!currentUser) return;
  const title = document.getElementById('kanji-name-input').value.trim();
  if (!title) { alert("タイトルを入力してください。"); return; }
  const subject = document.getElementById('kanji-subject-input').value.trim() || "未設定";

  const passages = collectCurrentKanjiPassages();
  if (passages.length === 0) { alert("少なくとも1つ以上の文章問題を入力してください。"); return; }

  const kanjiId = document.getElementById('editing-kanji-id').value || `kanji_${Date.now()}`;
  await setDoc(doc(db, "users", currentUser.uid, "kanjiTables", kanjiId), { title, subject, passages, updatedAt: Date.now() }, { merge: true });
  alert("漢字問題を保存しました！"); closeKanjiRegisterForm();
});

function openKanjiConfigModal(tableData) {
  activeKanjiData = tableData;
  document.getElementById('kanji-config-modal').classList.remove('hidden');
}
document.getElementById('close-kanji-config-modal').addEventListener('click', () => document.getElementById('kanji-config-modal').classList.add('hidden'));

document.getElementById('start-kanji-exercise-btn').addEventListener('click', () => {
  const order = document.getElementById('kanji-config-order-select').value;
  const scope = document.getElementById('kanji-config-scope-select').value;
  const dirFilter = document.getElementById('kanji-config-dir-select').value;

  let passagesList = [...activeKanjiData.passages];

  if (dirFilter !== 'all') {
    passagesList = passagesList.map(p => ({
      ...p,
      subItems: p.subItems.filter(sub => {
        if (sub.direction === '読み書き') return true;
        return sub.direction === dirFilter;
      })
    })).filter(p => p.subItems.length > 0);
  }

  if (scope === 'mistaken') {
    passagesList = passagesList.filter(p => {
      return p.subItems.some(sub => localStorage.getItem(`kanji_hist_${activeKanjiData.id}_${sub.id}`) === 'incorrect');
    });
    if (passagesList.length === 0) { alert("間違えた漢字問題がありません。"); return; }
  }

  if (order === 'random') passagesList.sort(() => Math.random() - 0.5);

  kanjiExerciseQueue = passagesList; kanjiRetryQueue = []; currentKanjiIndex = 0; kanjiTotalCount = kanjiExerciseQueue.length; isKanjiRetryLoop = false;
  
  document.getElementById('kanji-config-modal').classList.add('hidden');
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('refresh-mode-container').classList.add('hidden');
  document.getElementById('timeline-register-form-container').classList.add('hidden');
  document.getElementById('kanji-register-form-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.remove('hidden');
  document.getElementById('kanji-exercise-content').classList.remove('hidden');
  document.getElementById('kanji-exercise-result').classList.add('hidden');
  renderKanjiExerciseCurrentItem();
});

function hiraganaToKatakana(str) {
  return str.replace(/[\u3041-\u3096]/g, match => String.fromCharCode(match.charCodeAt(0) + 0x60));
}

function renderKanjiExerciseCurrentItem() {
  if (currentKanjiIndex >= kanjiExerciseQueue.length) {
    if (kanjiRetryQueue.length > 0) {
      kanjiExerciseQueue = [...kanjiRetryQueue]; kanjiRetryQueue = []; currentKanjiIndex = 0; isKanjiRetryLoop = true;
      alert("リトライ周回を開始します！"); renderKanjiExerciseCurrentItem(); return;
    }
    document.getElementById('kanji-exercise-content').classList.add('hidden');
    document.getElementById('kanji-exercise-result').classList.remove('hidden');
    document.getElementById('kanji-result-summary').innerText = `全 ${kanjiTotalCount} 文の漢字演習を完了しました！`;
    return;
  }

  const passageItem = kanjiExerciseQueue[currentKanjiIndex];
  document.getElementById('kanji-progress-count').innerText = `文章 ${currentKanjiIndex + 1} / ${kanjiExerciseQueue.length}`;
  document.getElementById('kanji-loop-badge').innerText = isKanjiRetryLoop ? "🔥 リトライ周回" : "通常周回";

  let formattedPassage = passageItem.passageText || "";
  const hasMultiple = passageItem.subItems && passageItem.subItems.length > 1;

  passageItem.resolvedDirections = passageItem.resolvedDirections || {};
  passageItem.resolvedReadings = passageItem.resolvedReadings || {};

  if (passageItem.subItems) {
    const processedWords = new Set();

    passageItem.subItems.forEach((sub, idx) => {
      if (sub.targetWord) {
        let currentDir = sub.direction;
        if (currentDir === '読み書き') {
          currentDir = Math.random() < 0.5 ? '読み' : '書き';
        }
        passageItem.resolvedDirections[sub.id] = currentDir;

        const readingsArray = (sub.reading || "").split(',').map(s => s.trim()).filter(Boolean);
        const chosenReading = readingsArray.length > 0 ? readingsArray[Math.floor(Math.random() * readingsArray.length)] : sub.targetWord;
        passageItem.resolvedReadings[sub.id] = chosenReading;

        const escapedWord = sub.targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedWord, 'g');

        let matchCount = 0;
        formattedPassage = formattedPassage.replace(regex, (match) => {
          matchCount++;
          if (matchCount === 1 && !processedWords.has(sub.targetWord)) {
            processedWords.add(sub.targetWord);
            let displayWord = sub.targetWord;
            if (currentDir === '書き') {
              displayWord = hiraganaToKatakana(chosenReading);
            }
            const badge = hasMultiple ? `(${idx + 1})` : '';
            return `<span class="kanji-target-underline"><b>${badge}${displayWord}</b></span>`;
          } else {
            let repeatWord = sub.targetWord;
            if (currentDir === '書き') {
              repeatWord = hiraganaToKatakana(chosenReading);
            }
            return repeatWord;
          }
        });
      }
    });
  }

  const passageContainer = document.getElementById('kanji-ex-passage');
  passageContainer.className = "text-base font-serif text-slate-900 leading-relaxed p-4 bg-white border rounded-lg kanji-passage-box";
  passageContainer.innerHTML = formattedPassage;

  const ansArea = document.getElementById('kanji-ex-answer-area');
  const subItemsContainer = document.getElementById('kanji-sub-items-container');
  subItemsContainer.innerHTML = '';
  
  passageItem.subItems.forEach((sub, idx) => {
    const subId = sub.id;
    const resolvedDir = passageItem.resolvedDirections[subId] || '読み';
    const chosenReading = passageItem.resolvedReadings[subId] || sub.reading || sub.targetWord;
    
    let ansText = resolvedDir === '読み' ? (sub.reading || sub.targetWord) : sub.targetWord;
    if (resolvedDir === '書き') {
      ansText = hiraganaToKatakana(chosenReading);
    }

    const ansTypeStr = resolvedDir === '読み' ? 'ひらがな' : 'カタカナ';
    const numberPrefix = `(${idx + 1})`;

    const rowDiv = document.createElement('div');
    rowDiv.className = "flex items-center justify-between p-2.5 bg-white border rounded-lg text-xs gap-3";
    rowDiv.innerHTML = `
      <div class="flex items-center gap-2 truncate">
        <span class="font-bold text-slate-700 w-6 flex-shrink-0">${numberPrefix}</span>
        <span class="font-bold text-slate-900 truncate">「${sub.targetWord}」 [${resolvedDir}]</span>
        <span class="text-emerald-700 font-semibold ml-2">答え (${ansTypeStr}): <b>${ansText}</b></span>
      </div>
      <div class="flex gap-1 flex-shrink-0">
        <button type="button" class="px-3 py-1 rounded text-xs font-bold transition kanji-sub-correct bg-slate-100 hover:bg-green-600 hover:text-white text-slate-700 border" data-sub-id="${subId}">⭕ 正解</button>
        <button type="button" class="px-3 py-1 rounded text-xs font-bold transition kanji-sub-incorrect bg-slate-100 hover:bg-red-600 hover:text-white text-slate-700 border" data-sub-id="${subId}">❌ 誤答</button>
      </div>
    `;

    rowDiv.querySelector('.kanji-sub-correct').addEventListener('click', (e) => {
      localStorage.setItem(`kanji_hist_${activeKanjiData.id}_${subId}`, 'correct');
      localStorage.removeItem(`kanji_mistake_time_${activeKanjiData.id}_${subId}`);
      e.target.className = "px-3 py-1 rounded text-xs font-bold bg-green-600 text-white border border-green-600";
      e.target.nextElementSibling.className = "px-3 py-1 rounded text-xs font-bold bg-slate-100 text-slate-700 border";
    });

    rowDiv.querySelector('.kanji-sub-incorrect').addEventListener('click', (e) => {
      localStorage.setItem(`kanji_hist_${activeKanjiData.id}_${subId}`, 'incorrect');
      localStorage.setItem(`kanji_mistake_time_${activeKanjiData.id}_${subId}`, Date.now());
      e.target.className = "px-3 py-1 rounded text-xs font-bold bg-red-600 text-white border border-red-600";
      e.target.previousElementSibling.className = "px-3 py-1 rounded text-xs font-bold bg-slate-100 text-slate-700 border";
      if (!kanjiRetryQueue.includes(passageItem)) kanjiRetryQueue.push(passageItem);
    });

    subItemsContainer.appendChild(rowDiv);
  });

  ansArea.classList.add('hidden');
  document.getElementById('kanji-ex-show-ans-btn').classList.remove('hidden');
  
  const oldNextBtn = document.getElementById('kanji-next-passage-btn');
  if (oldNextBtn) oldNextBtn.remove();
}

document.getElementById('kanji-ex-show-ans-btn').addEventListener('click', () => {
  document.getElementById('kanji-ex-answer-area').classList.remove('hidden');
  document.getElementById('kanji-ex-show-ans-btn').classList.add('hidden');
  
  let nextBtn = document.getElementById('kanji-next-passage-btn');
  if (!nextBtn) {
    nextBtn = document.createElement('button');
    nextBtn.id = 'kanji-next-passage-btn';
    nextBtn.className = "w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg text-sm transition mt-4 shadow-sm";
    nextBtn.innerText = "次の文章へ進む ➡";
    nextBtn.onclick = () => {
      nextBtn.remove();
      currentKanjiIndex++;
      renderKanjiExerciseCurrentItem();
    };
    document.getElementById('kanji-exercise-content').appendChild(nextBtn);
  }
});

document.getElementById('restart-kanji-ex-btn').addEventListener('click', () => openKanjiConfigModal(activeKanjiData));
document.getElementById('exit-kanji-player-btn').addEventListener('click', () => {
  document.getElementById('kanji-player-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
});
