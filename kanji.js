import { db, currentUser, closeAllEditorsAndSync } from "./script.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let activeKanjiData = null;
let kanjiExerciseQueue = [], kanjiRetryQueue = [], kanjiTotalCount = 0, isKanjiRetryLoop = false;
export let hiddenUnits = new Set();

export function renderKanjiTableList(tables, passedHiddenUnits) {
  if (passedHiddenUnits) hiddenUnits = passedHiddenUnits;
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

const cancelKanjiRegBtn = document.getElementById('cancel-kanji-register-btn');
if (cancelKanjiRegBtn) {
  cancelKanjiRegBtn.addEventListener('click', closeKanjiRegisterForm);
}

export function openKanjiRegisterForm(kanjiData = null) {
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

  renderKanjiTableRows(kanjiData ? kanjiData.passages || [] : [createEmptyKanjiPassageItem("")]);
  setupKanjiAutoSaveListeners();
}

function closeKanjiRegisterForm() {
  saveKanjiDocSilently();
  const kanjiReg = document.getElementById('kanji-register-form-container');
  if (kanjiReg) kanjiReg.classList.add('hidden');
  const viewMode = document.getElementById('view-mode-container');
  if (viewMode) viewMode.classList.remove('hidden');

  closeAllEditorsAndSync();
}

function createEmptyKanjiPassageItem(unit = "") {
  return {
    id: `passage_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    unit: unit,
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
      const isLastSubItem = sIndex === subItems.length - 1;
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
          <div class="flex items-center justify-center gap-1">
            <button type="button" class="kanji-row-del-btn text-red-500 hover:text-red-700 font-bold px-1.5 py-1 text-xs bg-red-50 rounded" title="削除">🗑️</button>
            ${isLastSubItem ? `<button type="button" class="kanji-add-sub-inline-btn bg-amber-200 hover:bg-amber-300 text-amber-900 font-bold px-2 py-1 text-xs rounded shadow-xs" title="傍線部を追加">+</button>` : ''}
          </div>
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

      if (isLastSubItem) {
        tr.querySelector('.kanji-add-sub-inline-btn')?.addEventListener('click', () => {
          const currentPassages = collectCurrentKanjiPassages();
          const targetP = currentPassages.find(p => p.id === passage.id);
          if (targetP) {
            targetP.subItems.push({ id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, targetWord: "", reading: "", direction: "読み書き" });
          }
          renderKanjiTableRows(currentPassages);
          saveKanjiDocSilently();
        });
      }

      tbody.appendChild(tr);
    });
  });
}

function deleteKanjiSubItem(passageId, subId) {
  const currentPassages = collectCurrentKanjiPassages();
  const targetP = currentPassages.find(p => p.id === passageId);
  if (targetP) {
    targetP.subItems = targetP.subItems.filter(s => s.id !== subId);
    if (targetP.subItems.length === 0) {
      const filtered = currentPassages.filter(p => p.id !== passageId);
      const lastUnit = currentPassages.length > 0 ? currentPassages[currentPassages.length - 1].unit : "";
      renderKanjiTableRows(filtered.length > 0 ? filtered : [createEmptyKanjiPassageItem(lastUnit)]);
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
    const lastUnit = currentPassages.length > 0 ? (currentPassages[currentPassages.length - 1].unit || "") : "";
    currentPassages.push(createEmptyKanjiPassageItem(lastUnit));
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

  const unitSelect = document.getElementById('kanji-config-scope-unit-select');
  if (unitSelect) {
    const units = [...new Set((tableData.passages || []).map(p => p.unit).filter(Boolean))];
    unitSelect.innerHTML = '<option value="all">すべての単元</option>';
    units.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.innerText = u;
      unitSelect.appendChild(opt);
    });
  }
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
    const unitScope = document.getElementById('kanji-config-scope-unit-select')?.value || 'all';
    const scope = document.getElementById('kanji-config-scope-select')?.value || 'all';
    const dirFilter = document.getElementById('kanji-config-dir-select')?.value || 'all';
    const limitSetting = document.getElementById('kanji-config-limit-select')?.value || '20';

    let passagesList = [...activeKanjiData.passages];
    passagesList = passagesList.filter(p => !p.unit || !hiddenUnits.has(p.unit));

    if (unitScope !== 'all') {
      passagesList = passagesList.filter(p => p.unit === unitScope);
    }

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

    if (limitSetting !== 'all') {
      const limitCount = parseInt(limitSetting) || 20;
      passagesList = passagesList.slice(0, limitCount);
    }

    kanjiExerciseQueue = passagesList; kanjiRetryQueue = []; kanjiTotalCount = kanjiExerciseQueue.length; isKanjiRetryLoop = false;
  
    if (kanjiExerciseQueue.length === 0) {
      alert("条件に一致する問題がありません。");
      return;
    }

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

    if (window.innerWidth < 768) {
      const sb = document.getElementById('sidebar');
      if (sb) sb.classList.add('collapsed');
    }

    renderKanjiExerciseAllPassages();
  });
}

function hiraganaToKatakana(str) {
  return str.replace(/[\u3041-\u3096]/g, match => String.fromCharCode(match.charCodeAt(0) + 0x60));
}

function renderKanjiExerciseAllPassages() {
  const container = document.getElementById('kanji-all-passages-container');
  if (!container) return;
  container.innerHTML = '';

  const prog = document.getElementById('kanji-progress-count');
  if (prog) prog.innerText = `全 ${kanjiExerciseQueue.length} 文章`;
  const loopBadge = document.getElementById('kanji-loop-badge');
  if (loopBadge) loopBadge.innerText = isKanjiRetryLoop ? "🔥 リトライ周回" : "通常周回";

  kanjiExerciseQueue.forEach((passageItem, pIdx) => {
    passageItem.resolvedDirections = passageItem.resolvedDirections || {};
    passageItem.resolvedReadings = passageItem.resolvedReadings || {};

    let formattedPassage = passageItem.passageText || "";
    const hasMultiple = passageItem.subItems && passageItem.subItems.length > 1;
    const processedWords = new Set();

    if (passageItem.subItems) {
      passageItem.subItems.forEach((sub, sIdx) => {
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
          formattedPassage = formattedPassage.replace(regex, () => {
            matchCount++;
            if (matchCount === 1 && !processedWords.has(sub.targetWord)) {
              processedWords.add(sub.targetWord);
              
              let displayWord = "";
              if (currentDir === '読み') {
                displayWord = sub.targetWord;
              } else {
                displayWord = hiraganaToKatakana(chosenReading);
              }

              const badge = hasMultiple ? `(${sIdx + 1})` : '';
              return `<span class="kanji-target-underline"><b>${badge}${displayWord}</b></span>`;
            } else {
              let repeatWord = "";
              if (currentDir === '読み') {
                repeatWord = sub.targetWord;
              } else {
                repeatWord = hiraganaToKatakana(chosenReading);
              }
              return repeatWord;
            }
          });
        }
      });
    }

    const card = document.createElement('div');
    card.className = "bg-white border rounded-xl p-4 shadow-xs space-y-3";
    
    card.innerHTML = `
      <div class="flex justify-between items-center border-b pb-1.5">
        <span class="font-bold text-xs text-amber-900 bg-amber-100 px-2 py-0.5 rounded">文章 ${pIdx + 1} ${passageItem.unit ? `(${passageItem.unit})` : ''}</span>
      </div>
      <div class="text-sm font-serif text-slate-900 leading-relaxed kanji-passage-box p-2.5 bg-slate-50/50 rounded-lg border">
        ${formattedPassage}
      </div>
      <div class="space-y-1.5 border-t pt-2 sub-items-container"></div>
    `;

    const subContainer = card.querySelector('.sub-items-container');
    passageItem.subItems.forEach((sub, sIdx) => {
      const subId = sub.id;
      const resolvedDir = passageItem.resolvedDirections[subId] || '読み';
      const chosenReading = passageItem.resolvedReadings[subId] || sub.reading || sub.targetWord;
      
      let ansText = "";
      let ansTypeStr = "";
      if (resolvedDir === '読み') {
        ansText = sub.reading || sub.targetWord;
        ansTypeStr = 'ひらがな';
      } else {
        ansText = sub.targetWord;
        ansTypeStr = '漢字';
      }

      const numberPrefix = `(${sIdx + 1})`;

      const row = document.createElement('div');
      row.className = "flex items-center justify-between p-2 bg-slate-50/70 border rounded-lg text-xs gap-2";
      row.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="font-bold text-slate-700">${numberPrefix} [${resolvedDir}]</span>
        </div>
        
        <div class="flex items-center gap-2 ml-auto">
          <span class="single-ans-text hidden text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
            ${ansText} <span class="text-[10px] font-normal text-emerald-600">(${ansTypeStr})</span>
          </span>
          
          <div class="flex gap-1">
            <button type="button" class="px-2.5 py-1 rounded text-xs font-bold transition kanji-sub-correct bg-white hover:bg-green-600 hover:text-white text-slate-700 border shadow-xs" data-sub-id="${subId}">⭕ 正解</button>
            <button type="button" class="px-2.5 py-1 rounded text-xs font-bold transition kanji-sub-incorrect bg-white hover:bg-red-600 hover:text-white text-slate-700 border shadow-xs" data-sub-id="${subId}">❌ 誤答</button>
          </div>
        </div>
      `;

      row.querySelector('.kanji-sub-correct').addEventListener('click', (e) => {
        e.target.className = "px-2.5 py-1 rounded text-xs font-bold bg-green-600 text-white border border-green-600 shadow-xs";
        e.target.nextElementSibling.className = "px-2.5 py-1 rounded text-xs font-bold bg-white text-slate-700 border shadow-xs";
      });

      row.querySelector('.kanji-sub-incorrect').addEventListener('click', (e) => {
        e.target.className = "px-2.5 py-1 rounded text-xs font-bold bg-red-600 text-white border border-red-600 shadow-xs";
        e.target.previousElementSibling.className = "px-2.5 py-1 rounded text-xs font-bold bg-white text-slate-700 border shadow-xs";
        if (!kanjiRetryQueue.includes(passageItem)) kanjiRetryQueue.push(passageItem);
      });

      subContainer.appendChild(row);
    });

    container.appendChild(card);
  });
}

const kanjiAllShowAnsBtn = document.getElementById('kanji-all-show-ans-btn');
if (kanjiAllShowAnsBtn) {
  kanjiAllShowAnsBtn.addEventListener('click', () => {
    document.querySelectorAll('.single-ans-text').forEach(el => el.classList.remove('hidden'));
  });
}

const kanjiFinishExBtn = document.getElementById('kanji-finish-ex-btn');
if (kanjiFinishExBtn) {
  kanjiFinishExBtn.addEventListener('click', () => {
    if (kanjiRetryQueue.length > 0) {
      kanjiExerciseQueue = [...kanjiRetryQueue];
      kanjiRetryQueue = [];
      isKanjiRetryLoop = true;
      alert("誤答があったため、リトライ周回を開始します！");
      renderKanjiExerciseAllPassages();
    } else {
      const content = document.getElementById('kanji-exercise-content');
      if (content) content.classList.add('hidden');
      const result = document.getElementById('kanji-exercise-result');
      if (result) result.classList.remove('hidden');
      const summary = document.getElementById('kanji-result-summary');
      if (summary) summary.innerText = `全 ${kanjiTotalCount} 文章の漢字演習を完了しました！全問正解です！🎉`;
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

    if (window.innerWidth < 768) {
      const sb = document.getElementById('sidebar');
      if (sb) sb.classList.remove('collapsed');
    }
  });
}
