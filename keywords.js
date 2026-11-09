import { db, currentUser } from "./script.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let activeTableData = null;
let exerciseQueue = [], retryQueue = [], currentExerciseIndex = 0, exerciseTotalCount = 0, isRetryLoop = false;
let activeModalRowId = null, activeModalType = 'question';
export let hiddenUnits = new Set(); // 👈 未定義エラーを防ぐために追加

const DEFAULT_COL_WIDTHS = {
  drag: "36px",
  index: "36px",
  unit: "16%",
  question: "32%",
  qimg: "42px",
  answer: "16%",
  wrong: "16%",
  cimg: "42px",
  imp: "70px",
  exp: "16%",
  action: "42px"
};

export function renderTableList(tables, passedHiddenUnits) {
  if (passedHiddenUnits) hiddenUnits = passedHiddenUnits;
  const container = document.getElementById('sidebar-list'); if (!container) return;
  const activeTables = tables.filter(t => !t.isDeleted);
  container.innerHTML = activeTables.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">一問一答表がありません。</p>' : '';
  
  activeTables.forEach(t => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border bg-emerald-50 hover:bg-emerald-100 border-emerald-300 cursor-pointer text-xs transition space-y-2';
    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-emerald-900 truncate">${t.title}</span>
        <div class="flex gap-1">
          <button class="edit-table text-blue-600 font-bold">編集</button>
          <button class="del-table text-red-500 font-bold">削除</button>
        </div>
      </div>
      <div class="text-[10px] text-emerald-700">
        教科: ${t.subject || '未設定'} | 問題数: ${t.items ? t.items.length : 0}問 ${t.description ? `| ${t.description}` : ''}
      </div>
      <button class="start-exercise-btn w-full bg-emerald-600 text-white py-1.5 rounded font-bold">演習を始める 🎯</button>
    `;
    item.querySelector('.start-exercise-btn').addEventListener('click', (e) => { e.stopPropagation(); openTableConfigModal(t); });
    item.querySelector('.edit-table').addEventListener('click', (e) => { e.stopPropagation(); openTableRegisterForm(t); });
    item.querySelector('.del-table').addEventListener('click', async (e) => { 
      e.stopPropagation(); 
      if (confirm(`一問一答表「${t.title}」をゴミ箱に移動しますか？`)) {
        await setDoc(doc(db, "users", currentUser.uid, "questionTables", t.id), { isDeleted: true }, { merge: true });
      }
    });
    container.appendChild(item);
  });
}

function openTableConfigModal(tableData) {
  activeTableData = tableData;
  const modal = document.getElementById('table-config-modal');
  if (modal) modal.classList.remove('hidden');
}

const closeTableConfigModalBtn = document.getElementById('close-table-config-modal');
if (closeTableConfigModalBtn) {
  closeTableConfigModalBtn.addEventListener('click', () => {
    const modal = document.getElementById('table-config-modal');
    if (modal) modal.classList.add('hidden');
  });
}

const startTableExerciseBtn = document.getElementById('start-table-exercise-btn');
if (startTableExerciseBtn) {
  startTableExerciseBtn.addEventListener('click', () => {
    const order = document.getElementById('config-order-select')?.value || 'normal';
    const scope = document.getElementById('config-scope-select')?.value || 'all';
    const limit = parseInt(document.getElementById('config-limit-input')?.value) || 10;

    let items = [...activeTableData.items];
    items = items.filter(item => !item.unit || !hiddenUnits.has(item.unit));

    if (scope === 'mistaken') {
      items = items.filter(item => localStorage.getItem(`qa_hist_${activeTableData.id}_${item.id}`) === 'incorrect');
      if (items.length === 0) { alert("間違えた問題がありません。"); return; }
    }

    if (order === 'random') items.sort(() => Math.random() - 0.5);
    exerciseQueue = items.slice(0, limit);
    retryQueue = [];
    currentExerciseIndex = 0;
    exerciseTotalCount = exerciseQueue.length;
    isRetryLoop = false;

    const configModal = document.getElementById('table-config-modal');
    if (configModal) configModal.classList.add('hidden');

    ['view-mode-container', 'collection-player-container', 'kanji-player-container', 'refresh-mode-container', 'timeline-register-form-container', 'kanji-register-form-container', 'table-register-form-container'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    const tablePlayer = document.getElementById('table-player-container');
    if (tablePlayer) tablePlayer.classList.remove('hidden');
    const tableExContent = document.getElementById('table-exercise-content');
    if (tableExContent) tableExContent.classList.remove('hidden');
    const tableExResult = document.getElementById('table-exercise-result');
    if (tableExResult) tableExResult.classList.add('hidden');

    renderTableExerciseCurrentItem();
  });
}

function renderTableExerciseCurrentItem() {
  if (currentExerciseIndex >= exerciseQueue.length) {
    if (retryQueue.length > 0) {
      exerciseQueue = [...retryQueue];
      retryQueue = [];
      currentExerciseIndex = 0;
      isRetryLoop = true;
      alert("リトライ周回を開始します！");
      renderTableExerciseCurrentItem();
      return;
    }
    const content = document.getElementById('table-exercise-content');
    if (content) content.classList.add('hidden');
    const result = document.getElementById('table-exercise-result');
    if (result) result.classList.remove('hidden');
    const summary = document.getElementById('table-result-summary');
    if (summary) summary.innerText = `全 ${exerciseTotalCount} 問の一問一答演習を完了しました！`;
    return;
  }

  const item = exerciseQueue[currentExerciseIndex];
  const progressCount = document.getElementById('table-progress-count');
  if (progressCount) progressCount.innerText = `問題 ${currentExerciseIndex + 1} / ${exerciseQueue.length}`;
  const unitBadge = document.getElementById('table-item-unit-badge');
  if (unitBadge) unitBadge.innerText = item.unit ? `単元: ${item.unit}` : '単元なし';
  const loopBadge = document.getElementById('table-loop-badge');
  if (loopBadge) loopBadge.innerText = isRetryLoop ? "🔥 リトライ周回" : "通常周回";
  const qEl = document.getElementById('t-ex-question');
  if (qEl) qEl.innerText = item.question || "";
  
  const imgArea = document.getElementById('t-ex-q-image-area');
  if (imgArea) {
    if (item.questionImage) {
      imgArea.innerHTML = `<img src="${item.questionImage}" class="max-h-48 rounded mx-auto mt-2"/>`;
    } else {
      imgArea.innerHTML = '';
    }
  }

  const choicesArea = document.getElementById('t-ex-choices-area');
  const hasWrongChoices = item.wrongChoices && item.wrongChoices.trim().length > 0;

  if (choicesArea) {
    if (hasWrongChoices) {
      choicesArea.classList.remove('hidden');
      choicesArea.innerHTML = `<div class="text-xs font-bold text-slate-500 mb-1">選択肢：</div>`;
      
      const correctList = (item.answer || "").split(',').map(s => s.trim()).filter(Boolean);
      const primaryCorrect = correctList.length > 0 ? correctList[0] : "";
      const wrongList = item.wrongChoices.split(',').map(s => s.trim()).filter(Boolean);
      
      let allChoices = [{ text: primaryCorrect, isCorrect: true, img: item.choiceImage || "" }];
      wrongList.forEach(w => allChoices.push({ text: w, isCorrect: false, img: "" }));
      allChoices.sort(() => Math.random() - 0.5);

      const grid = document.createElement('div');
      grid.className = "grid grid-cols-1 sm:grid-cols-2 gap-2";
      allChoices.forEach((ch, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = "p-3 border rounded-lg bg-white hover:bg-slate-50 text-left text-xs font-medium flex items-center gap-3 transition shadow-xs";
        btn.innerHTML = `<span class="font-bold text-blue-600">${idx + 1}.</span> <span>${ch.text}</span> ${ch.img ? `<img src="${ch.img}" class="max-h-12 ml-auto rounded"/>` : ''}`;
        btn.onclick = () => {
          grid.querySelectorAll('button').forEach(b => b.disabled = true);
          const isMatched = correctList.some(c => c === ch.text);
          if (isMatched) {
            btn.className = "p-3 border-2 border-green-500 rounded-lg bg-green-50 text-left text-xs font-bold flex items-center gap-3";
          } else {
            btn.className = "p-3 border-2 border-red-500 rounded-lg bg-red-50 text-left text-xs font-bold flex items-center gap-3";
          }
          const showAnsBtn = document.getElementById('t-ex-show-ans-btn');
          if (showAnsBtn) showAnsBtn.click();
        };
        grid.appendChild(btn);
      });
      choicesArea.appendChild(grid);
    } else {
      choicesArea.classList.add('hidden');
      choicesArea.innerHTML = '';
    }
  }

  const ansEl = document.getElementById('t-ex-answer');
  if (ansEl) ansEl.innerText = item.answer || "";
  const expEl = document.getElementById('t-ex-explanation');
  if (expEl) expEl.innerText = item.explanation || "（解説なし）";

  const ansArea = document.getElementById('t-ex-answer-area');
  if (ansArea) ansArea.classList.add('hidden');
  const showAnsBtn = document.getElementById('t-ex-show-ans-btn');
  if (showAnsBtn) showAnsBtn.classList.remove('hidden');
  const gradeBtns = document.getElementById('t-ex-grade-buttons');
  if (gradeBtns) gradeBtns.classList.add('hidden');
}

const tExShowAnsBtn = document.getElementById('t-ex-show-ans-btn');
if (tExShowAnsBtn) {
  tExShowAnsBtn.addEventListener('click', () => {
    const ansArea = document.getElementById('t-ex-answer-area');
    if (ansArea) ansArea.classList.remove('hidden');
    tExShowAnsBtn.classList.add('hidden');
    const gradeBtns = document.getElementById('t-ex-grade-buttons');
    if (gradeBtns) gradeBtns.classList.remove('hidden');
  });
}

const tExCorrectBtn = document.getElementById('t-ex-correct-btn');
if (tExCorrectBtn) {
  tExCorrectBtn.addEventListener('click', () => {
    const item = exerciseQueue[currentExerciseIndex];
    if (item && activeTableData) updateSpacedRepetitionRecord(activeTableData.id, item.id, true);
    currentExerciseIndex++;
    renderTableExerciseCurrentItem();
  });
}

const tExIncorrectBtn = document.getElementById('t-ex-incorrect-btn');
if (tExIncorrectBtn) {
  tExIncorrectBtn.addEventListener('click', () => {
    const item = exerciseQueue[currentExerciseIndex];
    if (item && activeTableData) updateSpacedRepetitionRecord(activeTableData.id, item.id, false);
    if (item && !retryQueue.includes(item)) retryQueue.push(item);
    currentExerciseIndex++;
    renderTableExerciseCurrentItem();
  });
}

function updateSpacedRepetitionRecord(tableId, itemId, isCorrect) {
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

const restartTableExBtn = document.getElementById('restart-table-ex-btn');
if (restartTableExBtn) restartTableExBtn.addEventListener('click', () => openTableConfigModal(activeTableData));

const exitTablePlayerBtn = document.getElementById('exit-table-player-btn');
if (exitTablePlayerBtn) {
  exitTablePlayerBtn.addEventListener('click', () => {
    const tablePlayer = document.getElementById('table-player-container');
    if (tablePlayer) tablePlayer.classList.add('hidden');
    const viewMode = document.getElementById('view-mode-container');
    if (viewMode) viewMode.classList.remove('hidden');
  });
}

const btnNavTableReg = document.getElementById('btn-nav-table-register');
if (btnNavTableReg) {
  btnNavTableReg.addEventListener('click', () => openTableRegisterForm(null));
}

const cancelTableRegBtn = document.getElementById('cancel-table-register-btn');
if (cancelTableRegBtn) {
  cancelTableRegBtn.addEventListener('click', closeTableRegisterForm);
}

function openTableRegisterForm(tableData = null) {
  ['view-mode-container', 'collection-player-container', 'table-player-container', 'kanji-player-container', 'refresh-mode-container', 'timeline-register-form-container', 'kanji-register-form-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const tableReg = document.getElementById('table-register-form-container');
  if (tableReg) tableReg.classList.remove('hidden');

  const tableId = tableData ? tableData.id : `table_${Date.now()}`;
  const editingIdEl = document.getElementById('editing-table-id');
  if (editingIdEl) editingIdEl.value = tableId;
  const tableNameInput = document.getElementById('table-name-input');
  if (tableNameInput) tableNameInput.value = tableData ? tableData.title : '';
  const tableSubInput = document.getElementById('table-subject-input');
  if (tableSubInput) tableSubInput.value = tableData ? (tableData.subject || "") : "";
  const descInput = document.getElementById('table-desc-input');
  if (descInput) descInput.value = tableData ? (tableData.description || "") : "";
  const impInput = document.getElementById('table-importances-input');
  if (impInput) impInput.value = tableData && tableData.importances ? tableData.importances.join(', ') : "高, 中, 低";
  
  applyColumnWidths();
  initTableResizers();

  renderTableRows(tableData ? tableData.items || [] : [createEmptyRowItem()]);
  setupAutoSaveListeners();
}

function closeTableRegisterForm() {
  saveTableDocSilently();
  const tableReg = document.getElementById('table-register-form-container');
  if (tableReg) tableReg.classList.add('hidden');
  const viewMode = document.getElementById('view-mode-container');
  if (viewMode) viewMode.classList.remove('hidden');
}

function createEmptyRowItem() {
  return { id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, unit: "", question: "", questionImage: "", answer: "", wrongChoices: "", choiceImage: "", importance: "中", explanation: "" };
}

function renderTableRows(items) {
  const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
  tbody.innerHTML = '';
  const importancesInput = document.getElementById('table-importances-input');
  const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];

  items.forEach((item, index) => {
    appendRowToTable(item, index, importances);
  });
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + 4) + 'px';
}

function appendRowToTable(item, index, importances) {
  const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
  const wrapper = document.createElement('tr');
  wrapper.className = "border-b relative overflow-hidden group";
  wrapper.dataset.itemId = item.id;
  wrapper.dataset.imgData = item.questionImage || "";
  wrapper.dataset.choiceImgData = item.choiceImage || "";
  
  const hasImg = (item.questionImage || "").length > 0;
  const hasChoiceImg = (item.choiceImage || "").length > 0;

  wrapper.innerHTML = `
    <td class="p-1 text-center text-gray-400 cursor-grab font-bold drag-handle select-none" title="ドラッグして移動">≡</td>
    <td class="p-1 text-center font-bold text-gray-500 row-index">${index + 1}</td>
    <td class="p-1"><input type="text" class="w-full border rounded p-1 row-unit text-xs" placeholder="単元名..." value="${item.unit || ''}"/></td>
    <td class="p-1"><textarea rows="1" class="w-full border rounded p-1 row-q text-xs auto-expand" placeholder="問題...">${item.question || ''}</textarea></td>
    <td class="p-1 text-center"><button type="button" class="row-img-btn w-7 h-7 rounded text-xs font-bold transition flex items-center justify-center mx-auto ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}" title="問題画像添付">${hasImg ? '🖼️' : '+'}</button></td>
    <td class="p-1"><textarea rows="1" class="w-full border rounded p-1 row-a text-xs auto-expand" placeholder="解答(カンマ区切り)">${item.answer || ''}</textarea></td>
    <td class="p-1"><input type="text" class="w-full border rounded p-1 row-wrong text-xs" placeholder="誤答(カンマ区切り)" value="${item.wrongChoices || ''}"/></td>
    <td class="p-1 text-center"><button type="button" class="row-choice-img-btn w-7 h-7 rounded text-xs font-bold transition flex items-center justify-center mx-auto ${hasChoiceImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}" title="選択肢画像添付">${hasChoiceImg ? '🖼️' : '+'}</button></td>
    <td class="p-1 text-center"><select class="w-full border rounded p-1 row-imp bg-white text-xs">${importances.map(imp => `<option value="${imp}" ${item.importance === imp ? 'selected' : ''}>${imp}</option>`).join('')}</select></td>
    <td class="p-1"><textarea rows="1" class="w-full border rounded p-1 row-exp text-xs auto-expand" placeholder="解説...">${item.explanation || ''}</textarea></td>
    <td class="p-1 text-center"><button type="button" class="row-del-btn text-red-500 hover:text-red-700 font-bold p-1 rounded hover:bg-red-50 text-sm" title="削除">🗑️</button></td>
  `;

  wrapper.querySelectorAll('textarea.auto-expand').forEach(ta => {
    setTimeout(() => autoResizeTextarea(ta), 0);
    ta.addEventListener('input', () => {
      autoResizeTextarea(ta);
      saveTableDocSilently();
    });
  });

  wrapper.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', saveTableDocSilently);
    el.addEventListener('change', saveTableDocSilently);
  });

  const handle = wrapper.querySelector('.drag-handle');
  if (handle) {
    handle.addEventListener('mousedown', () => wrapper.setAttribute('draggable', 'true'));
    handle.addEventListener('mouseup', () => wrapper.removeAttribute('draggable'));
  }

  wrapper.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', item.id);
    wrapper.classList.add('opacity-40');
  });
  wrapper.addEventListener('dragend', () => {
    wrapper.classList.remove('opacity-40');
    wrapper.removeAttribute('draggable');
    saveTableDocSilently();
  });
  wrapper.addEventListener('dragover', (e) => e.preventDefault());
  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggingRow = tbody.querySelector('.opacity-40');
    if (draggingRow && draggingRow !== wrapper) {
      const allRows = Array.from(tbody.querySelectorAll('tr'));
      const draggedIdx = allRows.indexOf(draggingRow);
      const targetIdx = allRows.indexOf(wrapper);
      if (draggedIdx < targetIdx) {
        tbody.insertBefore(draggingRow, wrapper.nextSibling);
      } else {
        tbody.insertBefore(draggingRow, wrapper);
      }
      reindexTableRows();
      saveTableDocSilently();
    }
  });

  wrapper.querySelector('.row-img-btn')?.addEventListener('click', () => openQaImageModal(item.id, wrapper.dataset.imgData, 'question'));
  wrapper.querySelector('.row-choice-img-btn')?.addEventListener('click', () => openQaImageModal(item.id, wrapper.dataset.choiceImgData, 'choice'));
  wrapper.querySelector('.row-del-btn')?.addEventListener('click', () => { 
    wrapper.remove(); 
    reindexTableRows(); 
    saveTableDocSilently();
  });
  tbody.appendChild(wrapper);
}

let autoSaveTimer = null;
function saveTableDocSilently() {
  if (!currentUser) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    const tableId = document.getElementById('editing-table-id')?.value;
    if (!tableId) return;
    const title = document.getElementById('table-name-input')?.value.trim() || "無題の一問一答";
    const subject = document.getElementById('table-subject-input')?.value.trim() || "未設定";
    const description = document.getElementById('table-desc-input')?.value.trim() || "";

    const importances = document.getElementById('table-importances-input')?.value.split(',').map(s => s.trim()).filter(Boolean) || ["高", "中", "低"];
    const items = [];
    document.querySelectorAll('#qa-table-tbody tr').forEach(tr => {
      const uInput = tr.querySelector('.row-unit');
      const qArea = tr.querySelector('.row-q');
      const aArea = tr.querySelector('.row-a');
      const wrongInput = tr.querySelector('.row-wrong');
      const impArea = tr.querySelector('.row-imp');
      const expArea = tr.querySelector('.row-exp');
      if (qArea) {
        items.push({
          id: tr.dataset.itemId,
          unit: uInput ? uInput.value.trim() : "",
          question: qArea.value.trim(),
          questionImage: tr.dataset.imgData || "",
          answer: aArea ? aArea.value.trim() : "",
          wrongChoices: wrongInput ? wrongInput.value.trim() : "",
          choiceImage: tr.dataset.choiceImgData || "",
          importance: impArea ? impArea.value : "中",
          explanation: expArea ? expArea.value.trim() : ""
        });
      }
    });

    await setDoc(doc(db, "users", currentUser.uid, "questionTables", tableId), { title, subject, description, importances, items, updatedAt: Date.now(), isDeleted: false }, { merge: true });
  }, 300);
}

function setupAutoSaveListeners() {
  ['table-name-input', 'table-subject-input', 'table-desc-input', 'table-importances-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener('input', saveTableDocSilently);
      el.addEventListener('input', saveTableDocSilently);
    }
  });
}

function reindexTableRows() {
  document.querySelectorAll('#qa-table-tbody tr').forEach((r, idx) => {
    const idxEl = r.querySelector('.row-index');
    if (idxEl) idxEl.innerText = idx + 1;
  });
}

const addQaRowBtn = document.getElementById('add-qa-row-btn');
if (addQaRowBtn) {
  addQaRowBtn.addEventListener('click', () => {
    const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
    const importancesInput = document.getElementById('table-importances-input');
    const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];
    
    let defaultUnit = "";
    let defaultImp = "中";
    let defaultExp = "";

    if (tbody.children.length > 0) {
      const lastRow = tbody.lastElementChild;
      const uInput = lastRow.querySelector('.row-unit');
      const impSelect = lastRow.querySelector('.row-imp');
      const expArea = lastRow.querySelector('.row-exp');
      if (uInput) defaultUnit = uInput.value;
      if (impSelect) defaultImp = impSelect.value;
      if (expArea) defaultExp = expArea.value;
    }

    const newItem = createEmptyRowItem();
    newItem.unit = defaultUnit;
    newItem.importance = defaultImp;
    newItem.explanation = defaultExp;
    appendRowToTable(newItem, tbody.children.length, importances);
    saveTableDocSilently();
  });
}

const saveTableDocBtn = document.getElementById('save-table-doc-btn');
if (saveTableDocBtn) {
  saveTableDocBtn.addEventListener('click', () => {
    saveTableDocSilently();
    closeTableRegisterForm();
  });
}

function applyColumnWidths() {
  const savedWidths = JSON.parse(localStorage.getItem('mondai_col_widths')) || DEFAULT_COL_WIDTHS;
  document.querySelectorAll('#qa-spread-table th[data-col]').forEach(th => {
    const col = th.dataset.col;
    if (savedWidths[col]) th.style.width = savedWidths[col];
  });
}

function initTableResizers() {
  const ths = document.querySelectorAll('#qa-spread-table th.resizable-th');
  ths.forEach(th => {
    const resizer = th.querySelector('.resizer');
    if (!resizer) return;
    let startX = 0, startWidth = 0;
    const onMouseMove = (e) => {
      const newWidth = Math.max(30, startWidth + (e.clientX - startX));
      th.style.width = `${newWidth}px`;
    };
    const onMouseUp = () => {
      resizer.classList.remove('resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const currentWidths = JSON.parse(localStorage.getItem('mondai_col_widths')) || { ...DEFAULT_COL_WIDTHS };
      currentWidths[th.dataset.col] = th.style.width;
      localStorage.setItem('mondai_col_widths', JSON.stringify(currentWidths));
    };
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = th.offsetWidth;
      resizer.classList.add('resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

const resetColWidthBtn = document.getElementById('reset-col-width-btn');
if (resetColWidthBtn) {
  resetColWidthBtn.addEventListener('click', () => {
    localStorage.removeItem('mondai_col_widths');
    applyColumnWidths();
  });
}

function openQaImageModal(rowId, imgData, type = 'question') {
  activeModalRowId = rowId;
  activeModalType = type;
  const targetRowIdEl = document.getElementById('modal-target-row-id');
  if (targetRowIdEl) targetRowIdEl.value = rowId;
  const targetTypeEl = document.getElementById('modal-target-type');
  if (targetTypeEl) targetTypeEl.value = type;
  const modalTitle = document.getElementById('qa-modal-title');
  if (modalTitle) modalTitle.innerText = type === 'choice' ? "選択肢画像の添付" : "問題画像の添付";
  
  const preview = document.getElementById('qa-modal-img-preview');
  if (preview) {
    if (imgData) preview.innerHTML = `<img src="${imgData}" class="max-h-32 mx-auto rounded"/>`;
    else preview.innerHTML = `<span class="text-gray-400 text-xs">画像未選択</span>`;
  }
  const modal = document.getElementById('qa-image-modal');
  if (modal) modal.classList.remove('hidden');
}

const closeQaImgModal = document.getElementById('close-qa-img-modal');
if (closeQaImgModal) {
  closeQaImgModal.addEventListener('click', () => {
    const modal = document.getElementById('qa-image-modal');
    if (modal) modal.classList.add('hidden');
  });
}

const qaImgRemoveBtn = document.getElementById('qa-img-remove-btn');
if (qaImgRemoveBtn) {
  qaImgRemoveBtn.addEventListener('click', () => {
    const tr = document.querySelector(`tr[data-item-id="${activeModalRowId}"]`);
    if (tr) {
      if (activeModalType === 'choice') {
        tr.dataset.choiceImgData = "";
        const btn = tr.querySelector('.row-choice-img-btn');
        if (btn) { btn.className = "row-choice-img-btn w-7 h-7 rounded text-xs font-bold bg-slate-200 text-slate-700 flex items-center justify-center mx-auto"; btn.innerText = "+"; }
      } else {
        tr.dataset.imgData = "";
        const btn = tr.querySelector('.row-img-btn');
        if (btn) { btn.className = "row-img-btn w-7 h-7 rounded text-xs font-bold bg-slate-200 text-slate-700 flex items-center justify-center mx-auto"; btn.innerText = "+"; }
      }
      saveTableDocSilently();
    }
    const modal = document.getElementById('qa-image-modal');
    if (modal) modal.classList.add('hidden');
  });
}

const qaModalFileInput = document.getElementById('qa-modal-file-input');
if (qaModalFileInput) {
  qaModalFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const base64 = uploadEvent.target.result;
      const preview = document.getElementById('qa-modal-img-preview');
      if (preview) preview.innerHTML = `<img src="${base64}" class="max-h-32 mx-auto rounded"/>`;
      const tr = document.querySelector(`tr[data-item-id="${activeModalRowId}"]`);
      if (tr) {
        if (activeModalType === 'choice') tr.dataset.choiceImgData = base64;
        else tr.dataset.imgData = base64;
        saveTableDocSilently();
      }
    };
    reader.readAsDataURL(file);
  });
}

const qaImgSaveBtn = document.getElementById('qa-img-save-btn');
if (qaImgSaveBtn) {
  qaImgSaveBtn.addEventListener('click', () => {
    const tr = document.querySelector(`tr[data-item-id="${activeModalRowId}"]`);
    if (tr) {
      if (activeModalType === 'choice') {
        const hasImg = (tr.dataset.choiceImgData || "").length > 0;
        const btn = tr.querySelector('.row-choice-img-btn');
        if (btn) { 
          btn.className = `row-choice-img-btn w-7 h-7 rounded text-xs font-bold flex items-center justify-center mx-auto ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`; 
          btn.innerText = hasImg ? '🖼️' : '+'; 
        }
      } else {
        const hasImg = (tr.dataset.imgData || "").length > 0;
        const btn = tr.querySelector('.row-img-btn');
        if (btn) { 
          btn.className = `row-img-btn w-7 h-7 rounded text-xs font-bold flex items-center justify-center mx-auto ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`; 
          btn.innerText = hasImg ? '🖼️' : '+'; 
        }
      }
      saveTableDocSilently();
    }
    const modal = document.getElementById('qa-image-modal');
    if (modal) modal.classList.add('hidden');
  });
}
