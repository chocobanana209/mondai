import { db, currentUser } from "./script.js";
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let activeTableData = null;
let exerciseQueue = [], retryQueue = [], currentExerciseIndex = 0, exerciseTotalCount = 0, isRetryLoop = false;
let activeModalRowId = null, activeModalType = 'question';

export function renderTableList(tables) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  container.innerHTML = tables.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">一問一答表がありません。</p>' : '';
  tables.forEach(t => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border bg-emerald-50 hover:bg-emerald-100 border-emerald-300 cursor-pointer text-xs transition space-y-2';
    item.innerHTML = `<div class="flex justify-between items-center"><span class="font-bold text-emerald-900 truncate">${t.title}</span><div class="flex gap-1"><button class="edit-table text-blue-600 font-bold">編集</button><button class="del-table text-red-500 font-bold">削除</button></div></div><div class="text-[10px] text-emerald-700">問題数: ${t.items ? t.items.length : 0}問</div><button class="start-exercise-btn w-full bg-emerald-600 text-white py-1.5 rounded font-bold">演習を始める 🎯</button>`;
    item.querySelector('.start-exercise-btn').addEventListener('click', (e) => { e.stopPropagation(); openTableConfigModal(t); });
    item.querySelector('.edit-table').addEventListener('click', (e) => { e.stopPropagation(); openTableRegisterForm(t); });
    item.querySelector('.del-table').addEventListener('click', async (e) => { e.stopPropagation(); await deleteDoc(doc(db, "users", currentUser.uid, "questionTables", t.id)); });
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
  document.getElementById('timeline-register-form-container').classList.add('hidden');
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
    
    // 正解をカンマ区切りで複数取得し、ランダムに1つ代表を選ぶか、複数正解に対応させる
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
        // 複数正解のいずれかに含まれているか判定
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
  localStorage.setItem(`qa_hist_${activeTableData.id}_${item.id}`, 'correct');
  currentExerciseIndex++;
  renderTableExerciseCurrentItem();
});

document.getElementById('t-ex-incorrect-btn').addEventListener('click', () => {
  const item = exerciseQueue[currentExerciseIndex];
  localStorage.setItem(`qa_hist_${activeTableData.id}_${item.id}`, 'incorrect');
  if (!retryQueue.includes(item)) retryQueue.push(item);
  currentExerciseIndex++;
  renderTableExerciseCurrentItem();
});

document.getElementById('restart-table-ex-btn').addEventListener('click', () => openTableConfigModal(activeTableData));
document.getElementById('exit-table-player-btn').addEventListener('click', () => {
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
});

document.getElementById('btn-nav-table-register').addEventListener('click', () => openTableRegisterForm(null));
document.getElementById('cancel-table-register-btn').addEventListener('click', closeTableRegisterForm);

function openTableRegisterForm(tableData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.add('hidden');
  document.getElementById('timeline-register-form-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('kanji-register-form-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.remove('hidden');

  document.getElementById('editing-table-id').value = tableData ? tableData.id : '';
  document.getElementById('table-name-input').value = tableData ? tableData.title : '';
  document.getElementById('table-importances-input').value = tableData && tableData.importances ? tableData.importances.join(', ') : "高, 中, 低";
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
    const wrapper = document.createElement('tr');
    wrapper.className = "border-b relative overflow-hidden group";
    wrapper.dataset.itemId = item.id;
    wrapper.dataset.imgData = item.questionImage || "";
    wrapper.dataset.choiceImgData = item.choiceImage || "";
    
    const hasImg = (item.questionImage || "").length > 0;
    const hasChoiceImg = (item.choiceImage || "").length > 0;

    wrapper.innerHTML = `
      <td class="p-2 text-center text-gray-400 cursor-grab font-bold drag-handle select-none" title="ドラッグして移動">≡</td>
      <td class="p-2 text-center font-bold text-gray-500 row-index">${index + 1}</td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題...">${item.question || ''}</textarea></td>
      <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasImg ? '画像付(変)' : '画像追加'}</button></td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答(複数可:カンマ区切り)">${item.answer || ''}</textarea></td>
      <td class="p-2 text-center"><input type="checkbox" class="row-choice-chk w-4 h-4 rounded cursor-pointer" ${item.isChoiceMode ? 'checked' : ''} title="選択肢形式にする"/></td>
      <td class="p-2"><input type="text" class="w-full border rounded p-1 row-wrong" placeholder="誤答をカンマ区切り" value="${item.wrongChoices || ''}"/></td>
      <td class="p-2 text-center"><button type="button" class="row-choice-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasChoiceImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasChoiceImg ? '画像付(変)' : '画像追加'}</button></td>
      <td class="p-2 text-center"><select class="w-full border rounded p-1 row-imp bg-white">${importances.map(imp => `<option value="${imp}" ${item.importance === imp ? 'selected' : ''}>${imp}</option>`).join('')}</select></td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-exp" placeholder="解説...">${item.explanation || ''}</textarea></td>
      <td class="p-2 text-center"><button type="button" class="row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">削除</button></td>
    `;

    // 💡 スムーズなドラッグ＆ドロップ処理の適用
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
  });
}

function reindexTableRows() {
  document.querySelectorAll('#qa-table-tbody tr').forEach((r, idx) => {
    const idxEl = r.querySelector('.row-index');
    if (idxEl) idxEl.innerText = idx + 1;
  });
}

document.getElementById('add-qa-row-btn').addEventListener('click', () => {
  const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
  const importancesInput = document.getElementById('table-importances-input');
  const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];
  let defaultExp = "";
  if (tbody.children.length > 0) defaultExp = tbody.lastElementChild.querySelector('.row-exp').value;

  const newItemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wrapper = document.createElement('tr'); 
  wrapper.className = "border-b"; 
  wrapper.dataset.itemId = newItemId; 
  wrapper.dataset.imgData = "";
  wrapper.dataset.choiceImgData = "";

  wrapper.innerHTML = `
    <td class="p-2 text-center text-gray-400 cursor-grab font-bold drag-handle select-none" title="ドラッグして移動">≡</td>
    <td class="p-2 text-center font-bold text-gray-500 row-index">${tbody.children.length + 1}</td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題..."></textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700">画像追加</button></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答(複数可:カンマ区切り)"></textarea></td>
    <td class="p-2 text-center"><input type="checkbox" class="row-choice-chk w-4 h-4 rounded cursor-pointer" title="選択肢形式にする"/></td>
    <td class="p-2"><input type="text" class="w-full border rounded p-1 row-wrong" placeholder="誤答をカンマ区切り"/></td>
    <td class="p-2 text-center"><button type="button" class="row-choice-img-btn px-2 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700">画像追加</button></td>
    <td class="p-2 text-center"><select class="w-full border rounded p-1 row-imp bg-white">${importances.map(i => `<option value="${i}">${i}</option>`).join('')}</select></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-exp" placeholder="解説...">${defaultExp}</textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">削除</button></td>
  `;

  // 新規追加行にも同様のドラッグ機能を付与
  const handle = wrapper.querySelector('.drag-handle');
  handle.addEventListener('mousedown', () => wrapper.setAttribute('draggable', 'true'));
  handle.addEventListener('mouseup', () => wrapper.removeAttribute('draggable'));
  wrapper.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', newItemId);
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

  wrapper.querySelector('.row-img-btn').addEventListener('click', () => openQaImageModal(newItemId, wrapper.dataset.imgData, 'question'));
  wrapper.querySelector('.row-choice-img-btn').addEventListener('click', () => openQaImageModal(newItemId, wrapper.dataset.choiceImgData, 'choice'));
  wrapper.querySelector('.row-del-btn').addEventListener('click', () => { wrapper.remove(); reindexTableRows(); });
  tbody.appendChild(wrapper);
}

document.getElementById('save-table-doc-btn').addEventListener('click', async () => {
  if (!currentUser) return;
  const title = document.getElementById('table-name-input').value.trim();
  if (!title) { alert("タイトルを入力してください。"); return; }

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
  await setDoc(doc(db, "users", currentUser.uid, "questionTables", tableId), { title, importances, items, updatedAt: Date.now() }, { merge: true });
  alert("一問一答表を保存しました！"); closeTableRegisterForm();
});

function openQaImageModal(rowId, imgData, type = 'question') {
  activeModalRowId = rowId;
  activeModalType = type;
  document.getElementById('modal-target-row-id').value = rowId;
  document.getElementById('modal-target-type').value = type;
  document.getElementById('qa-modal-title').innerText = type === 'choice' ? "選択肢画像の添付" : "問題画像の添付";
  
  const preview = document.getElementById('qa-modal-img-preview');
  if (imgData) {
    preview.innerHTML = `<img src="${imgData}" class="max-h-32 mx-auto rounded"/>`;
  } else {
    preview.innerHTML = `<span class="text-gray-400 text-xs">画像未選択</span>`;
  }
  document.getElementById('qa-image-modal').classList.remove('hidden');
}

document.getElementById('close-qa-img-modal').addEventListener('click', () => document.getElementById('qa-image-modal').classList.add('hidden'));
document.getElementById('qa-img-remove-btn').addEventListener('click', () => {
  const tr = document.querySelector(`tr[data-item-id="${activeModalRowId}"]`);
  if (tr) {
    if (activeModalType === 'choice') {
      tr.dataset.choiceImgData = "";
      const btn = tr.querySelector('.row-choice-img-btn');
      if (btn) { btn.className = "row-choice-img-btn px-2 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700"; btn.innerText = "画像追加"; }
    } else {
      tr.dataset.imgData = "";
      const btn = tr.querySelector('.row-img-btn');
      if (btn) { btn.className = "row-img-btn px-2 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700"; btn.innerText = "画像追加"; }
    }
  }
  document.getElementById('qa-image-modal').classList.add('hidden');
});

document.getElementById('qa-modal-file-input').addEventListener('change', async (e) => {
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

document.getElementById('qa-img-save-btn').addEventListener('click', () => {
  const tr = document.querySelector(`tr[data-item-id="${activeModalRowId}"]`);
  if (tr) {
    if (activeModalType === 'choice') {
      const hasImg = (tr.dataset.choiceImgData || "").length > 0;
      const btn = tr.querySelector('.row-choice-img-btn');
      if (btn) { btn.className = `row-choice-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`; btn.innerText = hasImg ? '画像付(変)' : '画像追加'; }
    } else {
      const hasImg = (tr.dataset.imgData || "").length > 0;
      const btn = tr.querySelector('.row-img-btn');
      if (btn) { btn.className = `row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`; btn.innerText = hasImg ? '画像付(変)' : '画像追加'; }
    }
  }
  document.getElementById('qa-image-modal').classList.add('hidden');
});
