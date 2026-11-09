import { db, currentUser } from "./script.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let activeTimelineData = null;

// --- 年表 リスト描画（サイドバー） ---
export function renderTimelineList(tables) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  container.innerHTML = tables.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">年表がありません。</p>' : '';
  tables.forEach(t => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border bg-purple-50 hover:bg-purple-100 border-purple-300 cursor-pointer text-xs transition space-y-2';
    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-purple-900 truncate">${t.title}</span>
        <div class="flex gap-1">
          <button class="edit-timeline text-blue-600 font-bold">編集</button>
          <button class="del-timeline text-red-500 font-bold">削除</button>
        </div>
      </div>
      <div class="text-[10px] text-purple-700">教科: ${t.subject || '未設定'} | 出来事数: ${t.items ? t.items.length : 0}件</div>
      <button class="view-timeline-btn w-full bg-purple-600 hover:bg-purple-700 text-white py-1.5 rounded font-bold">年表を見る 📜</button>
    `;
    item.querySelector('.view-timeline-btn').addEventListener('click', (e) => { e.stopPropagation(); openTimelineView(t); });
    item.querySelector('.edit-timeline').addEventListener('click', (e) => { e.stopPropagation(); openTimelineRegisterForm(t); });
    
    // 💡 削除ボタン（ゴミ箱移動）
    item.querySelector('.del-timeline').addEventListener('click', async (e) => { 
      e.stopPropagation(); 
      if (confirm(`年表「${t.title}」をゴミ箱に移動しますか？`)) {
        await setDoc(doc(db, "users", currentUser.uid, "timelineTables", t.id), { isDeleted: true }, { merge: true });
      }
    });
    container.appendChild(item);
  });
}

function openTimelineView(tableData) {
  activeTimelineData = tableData;
  openTimelineRegisterForm(tableData);
}

const btnNavTimelineReg = document.getElementById('btn-nav-timeline-register');
if (btnNavTimelineReg) {
  btnNavTimelineReg.addEventListener('click', () => openTimelineRegisterForm(null));
}

const cancelTimelineRegBtn = document.getElementById('cancel-timeline-register-btn');
if (cancelTimelineRegBtn) {
  cancelTimelineRegBtn.addEventListener('click', closeTimelineRegisterForm);
}

function openTimelineRegisterForm(timelineData = null) {
  // 修正: 存在しない 'register-form-container' を削除し、他のファイルと合わせた安全な一括非表示処理に変更
  ['view-mode-container', 'collection-player-container', 'table-player-container', 'kanji-player-container', 'refresh-mode-container', 'table-register-form-container', 'kanji-register-form-container', 'timeline-register-form-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const timelineRegContainer = document.getElementById('timeline-register-form-container');
  if (timelineRegContainer) timelineRegContainer.classList.remove('hidden');

  const editingTimelineId = document.getElementById('editing-timeline-id');
  if (editingTimelineId) editingTimelineId.value = timelineData ? timelineData.id : '';
  const timelineNameInput = document.getElementById('timeline-name-input');
  if (timelineNameInput) timelineNameInput.value = timelineData ? timelineData.title : '';
  const timelineSubjectInput = document.getElementById('timeline-subject-input');
  if (timelineSubjectInput) timelineSubjectInput.value = timelineData ? (timelineData.subject || "") : "";
  
  let items = timelineData ? timelineData.items || [] : [createEmptyTimelineItem()];
  sortTimelineItems(items);
  renderTimelineRows(items);
}

function closeTimelineRegisterForm() {
  const timelineRegContainer = document.getElementById('timeline-register-form-container');
  if (timelineRegContainer) timelineRegContainer.classList.add('hidden');
  const viewModeContainer = document.getElementById('view-mode-container');
  if (viewModeContainer) viewModeContainer.classList.remove('hidden');
}

function createEmptyTimelineItem() {
  return {
    id: `tl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    year: "",
    month: "",
    day: "",
    event: ""
  };
}

function sortTimelineItems(items) {
  items.sort((a, b) => {
    const yA = parseInt(a.year) || 0;
    const yB = parseInt(b.year) || 0;
    if (yA !== yB) return yA - yB;

    const mA = parseInt(a.month) || 0;
    const mB = parseInt(b.month) || 0;
    if (mA !== mB) return mA - mB;

    const dA = parseInt(a.day) || 0;
    const dB = parseInt(b.day) || 0;
    return dA - dB;
  });
}

function renderTimelineRows(items) {
  const tbody = document.getElementById('timeline-table-tbody'); if (!tbody) return;
  tbody.innerHTML = '';

  items.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.className = "border-b hover:bg-slate-100 timeline-row-item";
    tr.dataset.itemId = item.id;

    tr.innerHTML = `
      <td class="p-2 text-center text-gray-400 cursor-grab font-bold align-middle drag-handle select-none" title="ドラッグして移動">≡</td>
      <td class="p-2 text-center font-bold text-gray-500 row-index align-middle">${index + 1}</td>
      <td class="p-2"><input type="number" class="w-full border rounded p-1 tl-year-input font-bold" placeholder="例: 1603, -200" value="${item.year !== undefined ? item.year : ''}"/></td>
      <td class="p-2"><input type="number" min="1" max="12" class="w-full border rounded p-1 text-center tl-month-input" placeholder="月" value="${item.month || ''}"/></td>
      <td class="p-2"><input type="number" min="1" max="31" class="w-full border rounded p-1 text-center tl-day-input" placeholder="日" value="${item.day || ''}"/></td>
      <td class="p-2"><input type="text" class="w-full border rounded p-1 tl-event-input" placeholder="出来事の内容..." value="${item.event || ''}"/></td>
      <td class="p-2 text-center">
        <button type="button" class="tl-row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">削除</button>
      </td>
    `;

    const handle = tr.querySelector('.drag-handle');
    if (handle) {
      handle.addEventListener('mousedown', () => tr.setAttribute('draggable', 'true'));
      handle.addEventListener('mouseup', () => tr.removeAttribute('draggable'));
    }
    tr.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.id);
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
        const allRows = Array.from(tbody.querySelectorAll('tr'));
        const draggedIdx = allRows.indexOf(draggingTr);
        const targetIdx = allRows.indexOf(tr);
        if (draggedIdx < targetIdx) {
          tbody.insertBefore(draggingTr, tr.nextSibling);
        } else {
          tbody.insertBefore(draggingTr, tr);
        }
        reindexTimelineRows();
      }
    });

    tr.querySelector('.tl-row-del-btn').addEventListener('click', () => {
      tr.remove();
      reindexTimelineRows();
    });

    tbody.appendChild(tr);
  });
}

function reindexTimelineRows() {
  document.querySelectorAll('#timeline-table-tbody tr').forEach((r, idx) => {
    const idxEl = r.querySelector('.row-index');
    if (idxEl) idxEl.innerText = idx + 1;
  });
}

function collectCurrentTimelineItems() {
  const tbody = document.getElementById('timeline-table-tbody');
  if (!tbody) return [];
  const rows = tbody.querySelectorAll('tr.timeline-row-item');
  const items = [];

  rows.forEach(tr => {
    const itemId = tr.dataset.itemId;
    const yearInput = tr.querySelector('.tl-year-input');
    const monthInput = tr.querySelector('.tl-month-input');
    const dayInput = tr.querySelector('.tl-day-input');
    const eventInput = tr.querySelector('.tl-event-input');

    items.push({
      id: itemId,
      year: yearInput ? yearInput.value.trim() : "",
      month: monthInput ? monthInput.value.trim() : "",
      day: dayInput ? dayInput.value.trim() : "",
      event: eventInput ? eventInput.value.trim() : ""
    });
  });

  sortTimelineItems(items);
  return items;
}

const addTimelineRowBtn = document.getElementById('add-timeline-row-btn');
if (addTimelineRowBtn) {
  addTimelineRowBtn.addEventListener('click', () => {
    const currentItems = collectCurrentTimelineItems();
    currentItems.push(createEmptyTimelineItem());
    renderTimelineRows(currentItems);
  });
}

const saveTimelineDocBtn = document.getElementById('save-timeline-doc-btn');
if (saveTimelineDocBtn) {
  saveTimelineDocBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    const titleInput = document.getElementById('timeline-name-input');
    const title = titleInput ? titleInput.value.trim() : "";
    if (!title) { alert("年表のタイトルを入力してください。"); return; }
    const subjectInput = document.getElementById('timeline-subject-input');
    const subject = subjectInput ? subjectInput.value.trim() : "未設定";

    const items = collectCurrentTimelineItems();
    if (items.length === 0) { alert("少なくとも1つ以上の年表項目を入力してください。"); return; }

    const editingTimelineIdEl = document.getElementById('editing-timeline-id');
    const timelineId = editingTimelineIdEl && editingTimelineIdEl.value ? editingTimelineIdEl.value : `timeline_${Date.now()}`;
    
    await setDoc(doc(db, "users", currentUser.uid, "timelineTables", timelineId), { title, subject, items, updatedAt: Date.now() }, { merge: true });
    alert("年表を保存しました！"); 
    closeTimelineRegisterForm();
  });
}
