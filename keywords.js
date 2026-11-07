import { db, currentUser } from "./script.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let activeTableData = null;
let exerciseQueue = [], retryQueue = [], currentExerciseIndex = 0, exerciseTotalCount = 0, isRetryLoop = false;
let activeModalRowId = null, activeModalType = 'question';

const DEFAULT_COL_WIDTHS = {
  drag: "36px",
  index: "36px",
  question: "35%",
  qimg: "42px",
  answer: "18%",
  choice: "52px",
  wrong: "14%",
  cimg: "42px",
  imp: "70px",
  exp: "18%",
  action: "42px"
};

export function renderTableList(tables, hiddenUnits) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  const activeTables = tables.filter(t => !t.isDeleted && !(t.unit && hiddenUnits.has(t.unit)));
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
        教科: ${t.subject || '未設定'} ${t.unit ? `| 単元: ${t.unit}` : ''} | 問題数: ${t.items ? t.items.length : 0}問
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
  document.getElementById('table-config-modal').classList.remove('hidden');
}

document.getElementById('close-table-config-modal').addEventListener('click', () => {
  document.getElementById('table-config-modal').classList.add('hidden');
});

document.getElementById('start-table-exercise-btn').addEventListener('click', () => {
  const order = document.getElementById('config-order-select').value;
  const scope = document.getElementById('config-scope-select').value;
  const limit = parseInt(document.getElementById('config-limit-input').value) || 10;

  let items = [...activeTableData.items];
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

  document.getElementById('table-config-modal').classList.add('hidden');
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.add('hidden');
  document.getElementById('refresh-mode-container').classList.add('hidden');
  document.getElementById('timeline-register-form-container').classList.add('hidden');
  document.getElementById('kanji-register-form-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.remove('hidden');
  document.getElementById('table-exercise-content').classList.remove('hidden');
  document.getElementById('table-exercise-result').classList.add('hidden');

  renderTableExerciseCurrentItem();
});

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
    document.getElementById('table-exercise-content').classList.add('hidden');
    document.getElementById('table-exercise-result').classList.remove('hidden');
    document.getElementById('table-result-summary').innerText = `全 ${exerciseTotalCount} 問の一問一答演習を完了しました！`;
    return;
  }

  const item = exerciseQueue[currentExerciseIndex];
  document.getElementById('table-progress-count').innerText = `問題 ${currentExerciseIndex + 1} / ${exerciseQueue.length}`;
  document.getElementById('table-loop-badge').innerText = isRetryLoop ? "🔥 リトライ周回" : "通常周回";
  document.getElementById('t-ex-question').innerText = item.question || "";
  
  const imgArea = document.getElementById('t-ex-q-image-area');
  if (item.questionImage) {
    imgArea.innerHTML = `<img src="${item.questionImage}" class="max-h-48 rounded mx-auto mt-2"/>`;
  } else {
    imgArea.innerHTML = '';
  }

  const choicesArea = document.getElementById('t-ex-choices-area');
  if (item.isChoiceMode && item.wrongChoices) {
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
        document.getElementById('t-ex-show-ans-btn').click();
      };
      grid.appendChild(btn);
    });
    choicesArea.appendChild(grid);
  } else {
    choicesArea.classList.add('hidden');
    choicesArea.innerHTML = '';
  }

  document.getElementById('t-ex-answer').innerText = item.answer || "";
  document.getElementById('t-ex-explanation').innerText = item.explanation || "（解説なし）";

  document.getElementById('t-ex-answer-area').classList.add('hidden');
  document.getElementById('t-ex-show-ans-btn').classList.remove('hidden');
  document.getElementById('t-ex-grade-buttons').classList.add('hidden');
}

document.getElementById('t-ex-show-ans-btn').addEventListener('click', () => {
  document.getElementById('t-ex-answer-area').classList.remove('hidden');
  document.getElementById('t-ex-show-ans-btn').classList.add('hidden');
  document.getElementById('t-ex-grade-buttons').classList.remove('hidden');
});

document.getElementById('t-ex-correct-btn').addEventListener('click', () => {
  const item = exerciseQueue[currentExerciseIndex];
  // 履歴と連続正解数の更新（間隔反復用）
  updateSpacedRepetitionRecord(activeTableData.id, item.id, true);
  currentExerciseIndex++;
  renderTableExerciseCurrentItem();
});

document.getElementById('t-ex-incorrect-btn').addEventListener('click', () => {
  const item = exerciseQueue[currentExerciseIndex];
  updateSpacedRepetitionRecord(activeTableData.id, item.id, false);
  if (!retryQueue.includes(item)) retryQueue.push(item);
  currentExerciseIndex++;
  renderTableExerciseCurrentItem();
});

// 間隔反復・連続正解数の記録ヘルパー
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

document.getElementById('restart-table-ex-btn').addEventListener('click', () => openTableConfigModal(activeTableData));
document.getElementById('exit-table-player-btn').addEventListener('click', () => {
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
});

const btnNavTableReg = document.getElementById('btn-nav-table-register');
if (btnNavTableReg) {
  btnNavTableReg.addEventListener('click', () => openTableRegisterForm(null));
}

const cancelTableRegBtn = document.getElementById('cancel-table-register-btn');
if (cancelTableRegBtn) {
  cancelTableRegBtn.addEventListener('click', closeTableRegisterForm);
}

function openTableRegisterForm(tableData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.add('hidden');
  document.getElementById('refresh-mode-container').classList.add('hidden');
  document.getElementById('timeline-register-form-container').classList.add('hidden');
  document.getElementById('kanji-register-form-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.remove('hidden');

  document.getElementById('editing-table-id').value = tableData ? tableData.id : '';
  document.getElementById('table-name-input').value = tableData ? tableData.title : '';
  document.getElementById('table-subject-input').value = tableData ? (tableData.subject || "") : "";
  const unitInput = document.getElementById('table-unit-input');
  if (unitInput) unitInput.value = tableData ? (tableData.unit || "") : "";
  document.getElementById('table-importances-input').value = tableData && tableData.importances ? tableData.importances.join(', ') : "高, 中, 低";
  
  applyColumnWidths();
  initTableResizers();

  renderTableRows(tableData ? tableData.items || [] : [createEmptyRowItem()]);
}

function closeTableRegisterForm() {
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
}

function createEmptyRowItem() {
  return { id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, question: "", questionImage: "", answer: "", isChoiceMode: false, wrongChoices: "", choiceImage: "", importance: "中", explanation: "" };
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
    <td class="p-1"><textarea rows="1" class="w-full border rounded p-1 row-q text-xs auto-expand" placeholder="問題...">${item.question || ''}</textarea></td>
    <td class="p-1 text-center"><button type="button" class="row-img-btn w-7 h-7 rounded text-xs font-bold transition flex items-center justify-center mx-auto ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}" title="問題画像添付">${hasImg ? '🖼️' : '+'}</button></td>
    <td class="p-1"><textarea rows="1" class="w-full border rounded p-1 row-a text-xs auto-expand" placeholder="解答(カンマ区切り)">${item.answer || ''}</textarea></td>
    <td class="p-1 text-center"><input type="checkbox" class="row-choice-chk w-4 h-4 rounded cursor-pointer" ${item.isChoiceMode ? 'checked' : ''} title="選択肢形式にする"/></td>
    <td class="p-1"><input type="text" class="w-full border rounded p-1 row-wrong text-xs" placeholder="誤答(カンマ区切り)" value="${item.wrongChoices || ''}"/></td>
    <td class="p-1 text-center"><button type="button" class="row-choice-img-btn w-7 h-7 rounded text-xs font-bold transition flex items-center justify-center mx-auto ${hasChoiceImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}" title="選択肢画像添付">${hasChoiceImg ? '🖼️' : '+'}</button></td>
    <td class="p-1 text-center"><select class="w-full border rounded p-1 row-imp bg-white text-xs">${importances.map(imp => `<option value="${imp}" ${item.importance === imp ? 'selected' : ''}>${imp}</option>`).join('')}</select></td>
    <td class="p-1"><textarea rows="1" class="w-full border rounded p-1 row-exp text-xs auto-expand" placeholder="解説...">${item.explanation || ''}</textarea></td>
    <td class="p-1 text-center"><button type="button" class="row-del-btn text-red-500 hover:text-red-700 font-bold p-1 rounded hover:bg-red-50 text-sm" title="削除">🗑️</button></td>
  `;

  // 自動伸縮の適用
  wrapper.querySelectorAll('textarea.auto-expand').forEach(ta => {
    setTimeout(() => autoResizeTextarea(ta), 0);
    ta.addEventListener('input', () => autoResizeTextarea(ta));
  });

  const handle = wrapper.querySelector('.drag-handle');
  handle.addEventListener('mousedown', () => wrapper.setAttribute('draggable', 'true'));
  handle.addEventListener('mouseup', () => wrapper.removeAttribute('draggable'));

  wrapper.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', item.id);
    wrapper.classList.add('opacity-40');
  });
  wrapper.addEventListener('dragend', () => {
    wrapper.classList.remove('opacity-40');
    wrapper.removeAttribute('draggable');
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
    }
  });

  wrapper.querySelector('.row-img-btn').addEventListener('click', () => openQaImageModal(item.id, wrapper.dataset.imgData, 'question'));
  wrapper.querySelector('.row-choice-img-btn').addEventListener('click', () => openQaImageModal(item.id, wrapper.dataset.choiceImgData, 'choice'));
  wrapper.querySelector('.row-del-btn').addEventListener('click', () => { wrapper.remove(); reindexTableRows(); });
  tbody.appendChild(wrapper);
}

function reindexTableRows() {
  document.querySelectorAll('#qa-table-tbody tr').forEach((r, idx) => {
    const idxEl = r.querySelector('.row-index');
    if (idxEl) idxEl.innerText = idx + 1;
  });
}

const addQaQuickRowBtn = document.getElementById('add-qa-quick-row-btn');
if (addQaQuickRowBtn) {
  addQaQuickRowBtn.addEventListener('click', () => {
    const q = prompt("【短問追加】問題文を入力してください:");
    if (!q || !q.trim()) return;
    const a = prompt("【短問追加】解答を入力してください:");
    if (!a || !a.trim()) return;

    const tbody = document.getElementById('qa-table-tbody');
    const importancesInput = document.getElementById('table-importances-input');
    const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];
    
    const newItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      question: q.trim(),
      questionImage: "",
      answer: a.trim(),
      isChoiceMode: false,
      wrongChoices: "",
      choiceImage: "",
      importance: "中",
      explanation: ""
    };
    
    appendRowToTable(newItem, tbody ? tbody.children.length : 0, importances);
  });
}

const addQaRowBtn = document.getElementById('add-qa-row-btn');
if (addQaRowBtn) {
  addQaRowBtn.addEventListener('click', () => {
    const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
    const importancesInput = document.getElementById('table-importances-input');
    const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];
    let defaultExp = "";
    if (tbody.children.length > 0) defaultExp = tbody.lastElementChild.querySelector('.row-exp').value;

    const newItem = createEmptyRowItem();
    newItem.explanation = defaultExp;
    appendRowToTable(newItem, tbody.children.length, importances);
  });
}

const saveTableDocBtn = document.getElementById('save-table-doc-btn');
if (saveTableDocBtn) {
  saveTableDocBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    const title = document.getElementById('table-name-input').value.trim();
    if (!title) { alert("タイトルを入力してください。"); return; }
    const subject = document.getElementById('table-subject-input').value.trim() || "未設定";
    const unitInput = document.getElementById('table-unit-input');
    const unit = unitInput ? unitInput.value.trim() : "";

    const importances = document.getElementById('table-importances-input').value.split(',').map(s => s.trim()).filter(Boolean);
    const items = [];
    document.querySelectorAll('#qa-table-tbody tr').forEach(tr => {
      const qArea = tr.querySelector('.row-q');
      const aArea = tr.querySelector('.row-a');
      const chkBox = tr.querySelector('.row-choice-chk');
      const wrongInput = tr.querySelector('.row-wrong');
      const impArea = tr.querySelector('.row-imp');
      const expArea = tr.querySelector('.row-exp');
      if (qArea) {
        items.push({
          id: tr.dataset.itemId,
          question: qArea.value.trim(),
          questionImage: tr.dataset.imgData || "",
          answer: aArea ? aArea.value.trim() : "",
          isChoiceMode: chkBox ? chkBox.checked : false,
          wrongChoices: wrongInput ? wrongInput.value.trim() : "",
          choiceImage: tr.dataset.choiceImgData || "",
          importance: impArea ? impArea.value : "中",
          explanation: expArea ? expArea.value.trim() : ""
        });
      }
    });

    const tableId = document.getElementById('editing-table-id').value || `table_${Date.now()}`;
    await setDoc(doc(db, "users", currentUser.uid, "questionTables", tableId), { title, subject, unit, importances, items, updatedAt: Date.now(), isDeleted: false }, { merge: true });
    alert("一問一答表を保存しました！"); closeTableRegisterForm();
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
  document.getElementById('modal-target-row-id').value = rowId;
  document.getElementById('modal-target-type').value = type;
  document.getElementById('qa-modal-title').innerText = type === 'choice' ? "選択肢画像の添付" : "問題画像の添付";
  
  const preview = document.getElementById('qa-modal-img-preview');
  if (imgData) preview.innerHTML = `<img src="${imgData}" class="max-h-32 mx-auto rounded"/>`;
  else preview.innerHTML = `<span class="text-gray-400 text-xs">画像未選択</span>`;
  document.getElementById('qa-image-modal').classList.remove('hidden');
}

const closeQaImgModal = document.getElementById('close-qa-img-modal');
if (closeQaImgModal) closeQaImgModal.addEventListener('click', () => document.getElementById('qa-image-modal').classList.add('hidden'));

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
    }
    document.getElementById('qa-image-modal').classList.add('hidden');
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
      document.getElementById('qa-modal-img-preview').innerHTML = `<img src="${base64}" class="max-h-32 mx-auto rounded"/>`;
      const tr = document.querySelector(`tr[data-item-id="${activeModalRowId}"]`);
      if (tr) {
        if (activeModalType === 'choice') tr.dataset.choiceImgData = base64;
        else tr.dataset.imgData = base64;
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
    }
    document.getElementById('qa-image-modal').classList.add('hidden');
  });
}
