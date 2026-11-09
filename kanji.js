import { db, currentUser } from "./script.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let activeKanjiData = null;
let kanjiExerciseQueue = [], kanjiRetryQueue = [], currentKanjiIndex = 0, kanjiTotalCount = 0, isKanjiRetryLoop = false;

export function renderKanjiTableList(tables, hiddenUnits) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  const activeTables = tables.filter(t => !t.isDeleted);
  container.innerHTML = activeTables.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">漢字問題表がありません。</p>' : '';
  
  activeTables.forEach(t => {
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
      <div class="text-[10px] text-amber-700">教科: ${t.subject || '未設定'} | 文章数: ${t.passages ? t.passages.length : 0}問 ${t.description ? `| ${t.description}` : ''}</div>
      <button class="start-kanji-exercise-btn w-full bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded font-bold">漢字演習を始める ✍️</button>
    `;
    item.querySelector('.start-kanji-exercise-btn').addEventListener('click', (e) => { e.stopPropagation(); openKanjiConfigModal(t); });
    item.querySelector('.edit-kanji').addEventListener('click', (e) => { e.stopPropagation(); openKanjiRegisterForm(t); });
    item.querySelector('.del-kanji').addEventListener('click', async (e) => { 
      e.stopPropagation(); 
      if (confirm(`漢字問題「${t.title}」をゴミ箱に移動しますか？`)) {
        await setDoc(doc(db, "users", currentUser.uid, "kanjiTables", t.id), { isDeleted: true }, { merge: true });
      }
    });
    container.appendChild(item);
  });
}

const btnNavKanjiReg = document.getElementById('btn-nav-kanji-register');
if (btnNavKanjiReg) {
  btnNavKanjiReg.addEventListener('click', () => openKanjiRegisterForm(null));
}

const cancelKanjiRegBtn = document.getElementById('cancel-kanji-register-btn');
if (cancelKanjiRegBtn) {
  cancelKanjiRegBtn.addEventListener('click', closeKanjiRegisterForm);
}

function openKanjiRegisterForm(kanjiData = null) {
  ['view-mode-container', 'collection-player-container', 'table-player-container', 'kanji-player-container', 'refresh-mode-container', 'timeline-register-form-container', 'table-register-form-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const kanjiReg = document.getElementById('kanji-register-form-container');
  if (kanjiReg) kanjiReg.classList.remove('hidden');

  const kanjiId = kanjiData ? kanjiData.id : `kanji_${Date.now()}`;
  const editingKanjiId = document.getElementById('editing-kanji-id');
  if (editingKanjiId) editingKanjiId.value = kanjiId;
  const kanjiNameInput = document.getElementById('kanji-name-input');
  if (kanjiNameInput) kanjiNameInput.value = kanjiData ? kanjiData.title : '';
  const kanjiSubjectInput = document.getElementById('kanji-subject-input');
  if (kanjiSubjectInput) kanjiSubjectInput.value = kanjiData ? (kanjiData.subject || "") : "";
  const descInput = document.getElementById('kanji-desc-input');
  if (descInput) descInput.value = kanjiData ? (kanjiData.description || "") : "";

  renderKanjiTableRows(kanjiData ? kanjiData.passages || [] : [createEmptyKanjiPassageItem()]);
  setupKanjiAutoSaveListeners();
}

function closeKanjiRegisterForm() {
  saveKanjiDocSilently();
  const kanjiReg = document.getElementById('kanji-register-form-container');
  if (kanjiReg) kanjiReg.classList.add('hidden');
  const viewMode = document.getElementById('view-mode-container');
  if (viewMode) viewMode.classList.remove('hidden');
}

function createEmptyKanjiPassageItem() {
  return {
    id: `passage_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    unit: "",
    passageText: "",
    subItems: [{ id: `sub_${Date.now()}_1`, targetWord: "", reading: "", direction: "読み書き" }]
  };
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + 4) + 'px';
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
            <input type="text" class="w-full border rounded p-1 kanji-unit-input text-xs" placeholder="単元名..." value="${passage.unit || ''}"/>
          </td>
          <td class="p-2 align-middle" rowspan="${subItems.length}">
            <textarea class="w-full border rounded p-2 kanji-passage-input font-serif leading-relaxed auto-expand text-xs" placeholder="文章全体を入力...">${passage.passageText || ''}</textarea>
          </td>
        `;
      }

      tr.innerHTML = `
        ${leftCellsHtml}
        <td class="p-2"><input type="text" class="w-full border rounded p-1 kanji-word-input text-xs" placeholder="傍線部(漢字)" value="${sub.targetWord || ''}"/></td>
        <td class="p-2"><input type="text" class="w-full border rounded p-1 kanji-reading-input text-xs" placeholder="読み仮名(カンマ区切り)" value="${sub.reading || ''}"/></td>
        <td class="p-2 text-center">
          <select class="w-full border rounded p-1 kanji-dir-select bg-white text-xs">
            <option value="読み書き" ${sub.direction === '読み書き' ? 'selected' : ''}>読み書き</option>
            <option value="読み" ${sub.direction === '読み' ? 'selected' : ''}>読み</option>
            <option value="書き" ${sub.direction === '書き' ? 'selected' : ''}>書き</option>
          </select>
        </td>
        <td class="p-2 text-center">
          <button type="button" class="kanji-row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">🗑️</button>
        </td>
      `;

      if (sIndex === 0) {
        const textarea = tr.querySelector('.kanji-passage-input');
        if (textarea) {
          setTimeout(() => autoResizeTextarea(textarea), 0);
          textarea.addEventListener('input', () => {
            autoResizeTextarea(textarea);
            saveKanjiDocSilently();
          });
        }
      }

      tr.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', saveKanjiDocSilently);
        el.addEventListener('change', saveKanjiDocSilently);
      });

      tr.querySelector('.kanji-row-del-btn').addEventListener('click', () => {
        deleteKanjiSubItem(passage.id, sub.id);
        saveKanjiDocSilently();
      });
      tbody.appendChild(tr);
    });

    const addRowTr = document.createElement('tr');
    addRowTr.className = "bg-amber-50/50 border-b";
    addRowTr.innerHTML = `
      <td colspan="8" class="p-2 text-center">
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
      saveKanjiDocSilently();
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
    const unitInput = tr.querySelector('.kanji-unit-input');
    const passageInput = tr.querySelector('.kanji-passage-input');
    const wordInput = tr.querySelector('.kanji-word-input');
    const readingInput = tr.querySelector('.kanji-reading-input');
    const dirSelect = tr.querySelector('.kanji-dir-select');

    if (!passageMap.has(passageId)) {
      passageMap.set(passageId, {
        id: passageId,
        unit: unitInput ? unitInput.value.trim() : "",
        passageText: passageInput ? passageInput.value.trim() : "",
        subItems: []
      });
    }

    if (unitInput && unitInput.value.trim() !== "") {
      passageMap.get(passageId).unit = unitInput.value.trim();
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

let kanjiAutoSaveTimer = null;
function saveKanjiDocSilently() {
  if (!currentUser) return;
  clearTimeout(kanjiAutoSaveTimer);
  kanjiAutoSaveTimer = setTimeout(async () => {
    const kanjiId = document.getElementById('editing-kanji-id')?.value;
    if (!kanjiId) return;
    const title = document.getElementById('kanji-name-input')?.value.trim() || "無題の漢字問題";
    const subject = document.getElementById('kanji-subject-input')?.value.trim() || "未設定";
    const description = document.getElementById('kanji-desc-input')?.value.trim() || "";

    const passages = collectCurrentKanjiPassages();
    if (passages.length === 0) return;

    await setDoc(doc(db, "users", currentUser.uid, "kanjiTables", kanjiId), { title, subject, description, passages, updatedAt: Date.now(), isDeleted: false }, { merge: true });
  }, 300);
}

function setupKanjiAutoSaveListeners() {
  ['kanji-name-input', 'kanji-subject-input', 'kanji-desc-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener('input', saveKanjiDocSilently);
      el.addEventListener('input', saveKanjiDocSilently);
    }
  });
}

const addKanjiRowBtn = document.getElementById('add-kanji-row-btn');
if (addKanjiRowBtn) {
  addKanjiRowBtn.addEventListener('click', () => {
    const currentPassages = collectCurrentKanjiPassages();
    currentPassages.push(createEmptyKanjiPassageItem());
    renderKanjiTableRows(currentPassages);
    saveKanjiDocSilently();
  });
}

const saveKanjiDocBtn = document.getElementById('save-kanji-doc-btn');
if (saveKanjiDocBtn) {
  saveKanjiDocBtn.addEventListener('click', () => {
    saveKanjiDocSilently();
    closeKanjiRegisterForm();
  });
}

function openKanjiConfigModal(tableData) {
  activeKanjiData = tableData;
  const modal = document.getElementById('kanji-config-modal');
  if (modal) modal.classList.remove('hidden');
}

const closeKanjiConfigModalBtn = document.getElementById('close-kanji-config-modal');
if (closeKanjiConfigModalBtn) {
  closeKanjiConfigModalBtn.addEventListener('click', () => {
    const modal = document.getElementById('kanji-config-modal');
    if (modal) modal.classList.add('hidden');
  });
}

const startKanjiExerciseBtn = document.getElementById('start-kanji-exercise-btn');
if (startKanjiExerciseBtn) {
  startKanjiExerciseBtn.addEventListener('click', () => {
    const order = document.getElementById('kanji-config-order-select')?.value || 'normal';
    const scope = document.getElementById('kanji-config-scope-select')?.value || 'all';
    const dirFilter = document.getElementById('kanji-config-dir-select')?.value || 'all';

    let passagesList = [...activeKanjiData.passages];
    passagesList = passagesList.filter(p => !p.unit || !hiddenUnits.has(p.unit));

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
  
    const configModal = document.getElementById('kanji-config-modal');
    if (configModal) configModal.classList.add('hidden');

    ['view-mode-container', 'collection-player-container', 'table-player-container', 'refresh-mode-container', 'timeline-register-form-container', 'table-register-form-container', 'kanji-register-form-container'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    const kanjiPlayer = document.getElementById('kanji-player-container');
    if (kanjiPlayer) kanjiPlayer.classList.remove('hidden');
    const kanjiExContent = document.getElementById('kanji-exercise-content');
    if (kanjiExContent) kanjiExContent.classList.remove('hidden');
    const kanjiExResult = document.getElementById('kanji-exercise-result');
    if (kanjiExResult) kanjiExResult.classList.add('hidden');

    renderKanjiExerciseCurrentItem();
  });
}

function hiraganaToKatakana(str) {
  return str.replace(/[\u3041-\u3096]/g, match => String.fromCharCode(match.charCodeAt(0) + 0x60));
}

function renderKanjiExerciseCurrentItem() {
  if (currentKanjiIndex >= kanjiExerciseQueue.length) {
    if (kanjiRetryQueue.length > 0) {
      kanjiExerciseQueue = [...kanjiRetryQueue]; kanjiRetryQueue = []; currentKanjiIndex = 0; isKanjiRetryLoop = true;
      alert("リトライ周回を開始します！"); renderKanjiExerciseCurrentItem(); return;
    }
    const content = document.getElementById('kanji-exercise-content');
    if (content) content.classList.add('hidden');
    const result = document.getElementById('kanji-exercise-result');
    if (result) result.classList.remove('hidden');
    const summary = document.getElementById('kanji-result-summary');
    if (summary) summary.innerText = `全 ${kanjiTotalCount} 文の漢字演習を完了しました！`;
    return;
  }

  const passageItem = kanjiExerciseQueue[currentKanjiIndex];
  const prog = document.getElementById('kanji-progress-count');
  if (prog) prog.innerText = `文章 ${currentKanjiIndex + 1} / ${kanjiExerciseQueue.length}`;
  const unitBadge = document.getElementById('kanji-item-unit-badge');
  if (unitBadge) unitBadge.innerText = passageItem.unit ? `単元: ${passageItem.unit}` : '単元なし';
  const loopBadge = document.getElementById('kanji-loop-badge');
  if (loopBadge) loopBadge.innerText = isKanjiRetryLoop ? "🔥 リトライ周回" : "通常周回";

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
  if (passageContainer) {
    passageContainer.className = "text-base font-serif text-slate-900 leading-relaxed p-4 bg-white border rounded-lg kanji-passage-box";
    passageContainer.innerHTML = formattedPassage;
  }

  const ansArea = document.getElementById('kanji-ex-answer-area');
  const subItemsContainer = document.getElementById('kanji-sub-items-container');
  if (subItemsContainer) {
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
        e.target.className = "px-3 py-1 rounded text-xs font-bold bg-green-600 text-white border border-green-600";
        e.target.nextElementSibling.className = "px-3 py-1 rounded text-xs font-bold bg-slate-100 text-slate-700 border";
      });

      rowDiv.querySelector('.kanji-sub-incorrect').addEventListener('click', (e) => {
        e.target.className = "px-3 py-1 rounded text-xs font-bold bg-red-600 text-white border border-red-600";
        e.target.previousElementSibling.className = "px-3 py-1 rounded text-xs font-bold bg-slate-100 text-slate-700 border";
        if (!kanjiRetryQueue.includes(passageItem)) kanjiRetryQueue.push(passageItem);
      });

      subItemsContainer.appendChild(rowDiv);
    });
  }

  if (ansArea) ansArea.classList.add('hidden');
  const showAnsBtn = document.getElementById('kanji-ex-show-ans-btn');
  if (showAnsBtn) showAnsBtn.classList.remove('hidden');
  
  const oldNextBtn = document.getElementById('kanji-next-passage-btn');
  if (oldNextBtn) oldNextBtn.remove();
}

const kanjiExShowAnsBtn = document.getElementById('kanji-ex-show-ans-btn');
if (kanjiExShowAnsBtn) {
  kanjiExShowAnsBtn.addEventListener('click', () => {
    const ansArea = document.getElementById('kanji-ex-answer-area');
    if (ansArea) ansArea.classList.remove('hidden');
    kanjiExShowAnsBtn.classList.add('hidden');
    
    let nextBtn = document.getElementById('kanji-next-passage-btn');
    if (!nextBtn) {
      nextBtn = document.createElement('button');
      nextBtn.id = 'kanji-next-passage-btn';
      nextBtn.className = "w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-lg text-sm transition mt-4 shadow-sm";
      nextBtn.innerText = "次の文章へ進む ➡";
      nextBtn.onclick = () => {
        nextBtn.remove();
        currentKanjiIndex++;
        renderKanjiExerciseCurrentItem();
      };
      const exContent = document.getElementById('kanji-exercise-content');
      if (exContent) exContent.appendChild(nextBtn);
    }
  });
}

const restartKanjiExBtn = document.getElementById('restart-kanji-ex-btn');
if (restartKanjiExBtn) restartKanjiExBtn.addEventListener('click', () => openKanjiConfigModal(activeKanjiData));

const exitKanjiPlayerBtn = document.getElementById('exit-kanji-player-btn');
if (exitKanjiPlayerBtn) {
  exitKanjiPlayerBtn.addEventListener('click', () => {
    const kanjiPlayer = document.getElementById('kanji-player-container');
    if (kanjiPlayer) kanjiPlayer.classList.add('hidden');
    const viewMode = document.getElementById('view-mode-container');
    if (viewMode) viewMode.classList.remove('hidden');
  });
}
