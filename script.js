import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, query, orderBy, onSnapshot, deleteDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = { apiKey: "AIzaSyAat1qoigRFAQtIwCHweMeO6P0qTmR10_8", authDomain: "mondai-choco.firebaseapp.com", projectId: "mondai-choco", appId: "1:41081435290:web:f5237845a870e11e719b23" };
let app, auth, db, currentUser = null, selectedDocId = null, currentDocData = null, allDocuments = [], allCollections = [], allTables = [], currentMainView = 'documents';
let collectionPlayList = [], collectionPlayIndex = 0, isPlayingCollection = false, isContinuousAnswerOn = false;
let activeTableData = null, exerciseQueue = [], retryQueue = [], currentExerciseIndex = 0, exerciseTotalCount = 0, isRetryLoop = false;
let lastDeletedRowData = null;

try {
  app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app);
  enableIndexedDbPersistence(db).catch(err => console.warn(err.code));
  setPersistence(auth, browserLocalPersistence);
} catch (e) { console.error(e); }

onAuthStateChanged(auth, async (user) => {
  currentUser = user; updateAuthUI(user);
  if (user) { await user.getIdToken(true); setupRealtimeListeners(); } else { detachRealtimeListeners(); clearDocumentView(); }
});

function updateAuthUI(user) {
  const authStatus = document.getElementById('auth-status');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const userInfo = document.getElementById('user-info');
  const userPhoto = document.getElementById('user-photo');
  const userName = document.getElementById('user-name');
  const mainContent = document.getElementById('main-content');
  const headerMenuBtn = document.getElementById('header-menu-btn');

  if (user) {
    if (authStatus) {
      authStatus.innerText = "ログイン中";
      authStatus.className = "px-2 py-0.5 bg-green-100 text-green-800 rounded text-[10px] font-semibold";
    }
    if (loginBtn) loginBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.remove('hidden');
    if (headerMenuBtn) headerMenuBtn.classList.remove('hidden');
    if (userPhoto) userPhoto.src = user.photoURL || '';
    if (userName) userName.innerText = user.displayName || user.email;
    if (mainContent) mainContent.classList.remove('opacity-50', 'pointer-events-none');
  } else {
    if (authStatus) {
      authStatus.innerText = "未ログイン";
      authStatus.className = "px-2 py-0.5 bg-gray-100 text-gray-800 rounded text-[10px] font-semibold";
    }
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (userInfo) userInfo.classList.add('hidden');
    if (headerMenuBtn) headerMenuBtn.classList.add('hidden');
    if (mainContent) mainContent.classList.add('opacity-50', 'pointer-events-none');
  }
}

document.getElementById('login-btn').addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()));
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('collapsed'));

document.getElementById('nav-docs').addEventListener('click', () => { currentMainView = 'documents'; setActiveNavTab('nav-docs'); renderCurrentView(); });
document.getElementById('nav-collections').addEventListener('click', () => { currentMainView = 'collections'; setActiveNavTab('nav-collections'); renderCurrentView(); });
document.getElementById('nav-tables').addEventListener('click', () => { currentMainView = 'tables'; setActiveNavTab('nav-tables'); renderCurrentView(); });

function setActiveNavTab(tabId) {
  ['nav-docs', 'nav-collections', 'nav-tables'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.className = id === tabId ? "flex-1 py-1.5 font-bold text-blue-600 bg-white rounded shadow-sm text-xs" : "flex-1 py-1.5 font-medium text-gray-500 hover:text-gray-700 text-xs";
    }
  });
}

function setupRealtimeListeners() {
  detachRealtimeListeners();
  if (!currentUser) return;
  onSnapshot(query(collection(db, "users", currentUser.uid, "documents"), orderBy("updatedAt", "desc")), snap => {
    allDocuments = []; snap.forEach(d => allDocuments.push({ id: d.id, ...d.data() })); if (currentMainView === 'documents') renderCurrentView();
  });
  onSnapshot(query(collection(db, "users", currentUser.uid, "collections"), orderBy("updatedAt", "desc")), snap => {
    allCollections = []; snap.forEach(d => allCollections.push({ id: d.id, ...d.data() })); if (currentMainView === 'collections') renderCurrentView();
  });
  onSnapshot(query(collection(db, "users", currentUser.uid, "questionTables"), orderBy("updatedAt", "desc")), snap => {
    allTables = []; snap.forEach(d => allTables.push({ id: d.id, ...d.data() })); if (currentMainView === 'tables') renderCurrentView();
  });
}

function detachRealtimeListeners() {}
function renderCurrentView() {
  if (currentMainView === 'documents') renderDocumentList(allDocuments);
  else if (currentMainView === 'collections') renderCollectionList(allCollections);
  else if (currentMainView === 'tables') renderTableList(allTables);
}

function renderDocumentList(docs) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  container.innerHTML = docs.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題がありません。</p>' : '';
  docs.forEach(data => {
    const item = document.createElement('div');
    item.className = `p-2.5 rounded-lg border cursor-pointer text-xs transition ${data.id === selectedDocId ? 'bg-blue-50 border-blue-400 font-semibold' : 'bg-white hover:bg-slate-50'}`;
    item.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="truncate font-bold">${data.title}</span><div class="flex gap-1"><button class="edit-btn text-blue-500">編集</button><button class="del-btn text-red-400">削除</button></div></div>`;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('del-btn') || e.target.classList.contains('edit-btn')) return;
      selectDocument(data);
    });
    item.querySelector('.del-btn').addEventListener('click', async (e) => { e.stopPropagation(); await deleteDoc(doc(db, "users", currentUser.uid, "documents", data.id)); });
    item.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openRegisterForm(data); });
    container.appendChild(item);
  });
}

function renderTableList(tables) {
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

// --- 一問一答表エディタ（並び替え対応版） ---
document.getElementById('btn-nav-table-register').addEventListener('click', () => openTableRegisterForm(null));
document.getElementById('cancel-table-register-btn').addEventListener('click', closeTableRegisterForm);

function openTableRegisterForm(tableData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.add('hidden');
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
  return { id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, question: "", questionImage: "", answer: "", importance: "中", explanation: "" };
}

function renderTableRows(items) {
  const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
  tbody.innerHTML = '';
  const importancesInput = document.getElementById('table-importances-input');
  const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];

  items.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.className = "border-b hover:bg-slate-100"; tr.dataset.itemId = item.id; tr.dataset.imgData = item.questionImage || ""; tr.draggable = true;
    const hasImg = item.questionImage && item.questionImage.length > 0;

    tr.innerHTML = `
      <td class="p-2 text-center text-gray-400 cursor-grab font-bold">↕</td>
      <td class="p-2 text-center font-bold text-gray-500 row-index">${index + 1}</td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題...">${item.question || ''}</textarea></td>
      <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasImg ? '画像付(変)' : '画像追加'}</button></td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答...">${item.answer || ''}</textarea></td>
      <td class="p-2 text-center"><select class="w-full border rounded p-1 row-imp bg-white">${importances.map(imp => `<option value="${imp}" ${item.importance === imp ? 'selected' : ''}>${imp}</option>`).join('')}</select></td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-exp" placeholder="解説...">${item.explanation || ''}</textarea></td>
      <td class="p-2 text-center"><button type="button" class="row-del-btn text-red-500 font-bold">✕</button></td>
    `;

    let draggedRow = null;
    tr.addEventListener('dragstart', () => { draggedRow = tr; tr.classList.add('opacity-40'); });
    tr.addEventListener('dragend', () => { tr.classList.remove('opacity-40'); draggedRow = null; });
    tr.addEventListener('dragover', (e) => e.preventDefault());
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedRow && draggedRow !== tr) {
        const allRows = Array.from(tbody.querySelectorAll('tr'));
        const draggedIdx = allRows.indexOf(draggedRow);
        const targetIdx = allRows.indexOf(tr);
        if (draggedIdx < targetIdx) tbody.insertBefore(draggedRow, tr.nextSibling);
        else tbody.insertBefore(draggedRow, tr);
        reindexTableRows();
      }
    });

    tr.querySelector('.row-img-btn').addEventListener('click', () => openQaImageModal(item.id, tr.dataset.imgData));
    tr.querySelector('.row-del-btn').addEventListener('click', () => {
      lastDeletedRowData = { question: tr.querySelector('.row-q').value, questionImage: tr.dataset.imgData || "", answer: tr.querySelector('.row-a').value, importance: tr.querySelector('.row-imp').value, explanation: tr.querySelector('.row-exp').value };
      tr.remove(); reindexTableRows(); showUndoNotification();
    });
    setupTableKeyboardNavigation(tr);
    tbody.appendChild(tr);
  });
}

function showUndoNotification() {
  let notif = document.getElementById('undo-toast');
  if (!notif) {
    notif = document.createElement('div'); notif.id = 'undo-toast'; notif.className = 'fixed bottom-5 right-5 bg-slate-800 text-white text-xs px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-3';
    document.body.appendChild(notif);
  }
  notif.innerHTML = `<span>行を削除しました</span><button id="undo-del-btn" class="bg-blue-600 px-2 py-1 rounded font-bold">元に戻す</button>`;
  notif.classList.remove('hidden');
  document.getElementById('undo-del-btn').onclick = () => { if (lastDeletedRowData) { addRowToTable(lastDeletedRowData); lastDeletedRowData = null; notif.classList.add('hidden'); } };
  setTimeout(() => notif.classList.add('hidden'), 5000);
}

function addRowToTable(initialData = null) {
  const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
  const importancesInput = document.getElementById('table-importances-input');
  const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];
  let defaultExp = "";
  if (!initialData && tbody.children.length > 0) defaultExp = tbody.lastElementChild.querySelector('.row-exp').value;

  const newItemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const tr = document.createElement('tr'); tr.className = "border-b hover:bg-slate-100"; tr.dataset.itemId = newItemId; tr.dataset.imgData = initialData ? initialData.questionImage : ""; tr.draggable = true;
  const hasImg = (initialData ? initialData.questionImage : "").length > 0;

  tr.innerHTML = `
    <td class="p-2 text-center text-gray-400 cursor-grab font-bold">↕</td>
    <td class="p-2 text-center font-bold text-gray-500 row-index">${tbody.children.length + 1}</td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題...">${initialData ? initialData.question : ''}</textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasImg ? '画像付(変)' : '画像追加'}</button></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答...">${initialData ? initialData.answer : ''}</textarea></td>
    <td class="p-2 text-center"><select class="w-full border rounded p-1 row-imp bg-white">${importances.map(i => `<option value="${i}" ${initialData && initialData.importance === i ? 'selected' : ''}>${i}</option>`).join('')}</select></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-exp" placeholder="解説...">${initialData ? initialData.explanation : defaultExp}</textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-del-btn text-red-500 font-bold">✕</button></td>
  `;

  tr.addEventListener('dragstart', () => tr.classList.add('opacity-40'));
  tr.addEventListener('dragend', () => tr.classList.remove('opacity-40'));
  tr.addEventListener('dragover', (e) => e.preventDefault());
  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    reindexTableRows();
  });

  tr.querySelector('.row-img-btn').addEventListener('click', () => openQaImageModal(newItemId, tr.dataset.imgData));
  tr.querySelector('.row-del-btn').addEventListener('click', () => {
    lastDeletedRowData = { question: tr.querySelector('.row-q').value, questionImage: tr.dataset.imgData || "", answer: tr.querySelector('.row-a').value, importance: tr.querySelector('.row-imp').value, explanation: tr.querySelector('.row-exp').value };
    tr.remove(); reindexTableRows(); showUndoNotification();
  });
  setupTableKeyboardNavigation(tr);
  tbody.appendChild(tr);
}

function reindexTableRows() {
  document.querySelectorAll('#qa-table-tbody tr').forEach((r, idx) => {
    const idxEl = r.querySelector('.row-index');
    if (idxEl) idxEl.innerText = idx + 1;
  });
}

const addRowBtn = document.getElementById('add-qa-row-btn');
if (addRowBtn) addRowBtn.addEventListener('click', () => addRowToTable(null));

function setupTableKeyboardNavigation(tr) {
  const inputs = tr.querySelectorAll('.row-q, .row-a, .row-imp, .row-exp');
  inputs.forEach((input, colIdx) => {
    input.addEventListener('keydown', (e) => {
      const focusable = ['.row-q', '.row-a', '.row-imp', '.row-exp'];
      let target = null;
      if (e.key === 'ArrowRight' && colIdx < focusable.length - 1) target = tr.querySelector(focusable[colIdx + 1]);
      else if (e.key === 'ArrowLeft' && colIdx > 0) target = tr.querySelector(focusable[colIdx - 1]);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const targetTr = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
        if (targetTr) target = targetTr.querySelector(focusable[colIdx]);
      }
      if (target) { e.preventDefault(); target.focus(); }
    });
  });
}

const saveTableBtn = document.getElementById('save-table-doc-btn');
if (saveTableBtn) {
  saveTableBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    const titleEl = document.getElementById('table-name-input');
    const title = titleEl ? titleEl.value.trim() : "";
    if (!title) { alert("タイトルを入力してください。"); return; }

    const importancesInput = document.getElementById('table-importances-input');
    const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];
    const items = [];
    document.querySelectorAll('#qa-table-tbody tr').forEach(tr => {
      const q = tr.querySelector('.row-q');
      const a = tr.querySelector('.row-a');
      const imp = tr.querySelector('.row-imp');
      const exp = tr.querySelector('.row-exp');
      items.push({
        id: tr.dataset.itemId,
        question: q ? q.value.trim() : "",
        questionImage: tr.dataset.imgData || "",
        answer: a ? a.value.trim() : "",
        importance: imp ? imp.value : "中",
        explanation: exp ? exp.value.trim() : ""
      });
    });

    const editingTableIdEl = document.getElementById('editing-table-id');
    const tableId = (editingTableIdEl && editingTableIdEl.value) ? editingTableIdEl.value : `table_${Date.now()}`;
    await setDoc(doc(db, "users", currentUser.uid, "questionTables", tableId), { title, importances, items, updatedAt: Date.now() }, { merge: true });
    alert("保存しました！"); closeTableRegisterForm();
  });
}

// --- 演習関連 ---
function openTableConfigModal(tableData) {
  activeTableData = tableData;
  const modal = document.getElementById('table-config-modal');
  if (modal) modal.classList.remove('hidden');
}

const closeConfigModalBtn = document.getElementById('close-table-config-modal');
if (closeConfigModalBtn) closeConfigModalBtn.addEventListener('click', () => {
  const modal = document.getElementById('table-config-modal');
  if (modal) modal.classList.add('hidden');
});

const startExBtn = document.getElementById('start-table-exercise-btn');
if (startExBtn) {
  startExBtn.addEventListener('click', () => {
    const orderEl = document.getElementById('config-order-select');
    const scopeEl = document.getElementById('config-scope-select');
    const limitEl = document.getElementById('config-limit-input');
    
    const order = orderEl ? orderEl.value : 'sequential';
    const scope = scopeEl ? scopeEl.value : 'all';
    const limit = limitEl ? (parseInt(limitEl.value) || 10) : 10;
    let items = [...activeTableData.items];

    if (scope === 'mistaken') {
      items = items.filter(item => localStorage.getItem(`qa_hist_${activeTableData.id}_${item.id}`) === 'incorrect');
      if (items.length === 0) { alert("間違えた問題がありません。"); return; }
    }
    if (order === 'random') items.sort(() => Math.random() - 0.5);

    exerciseQueue = items.slice(0, limit); retryQueue = []; currentExerciseIndex = 0; exerciseTotalCount = exerciseQueue.length; isRetryLoop = false;
    
    const configModal = document.getElementById('table-config-modal');
    if (configModal) configModal.classList.add('hidden');

    const viewContainer = document.getElementById('view-mode-container');
    const tableRegContainer = document.getElementById('table-register-form-container');
    const tablePlayerContainer = document.getElementById('table-player-container');
    const exContent = document.getElementById('table-exercise-content');
    const exResult = document.getElementById('table-exercise-result');

    if (viewContainer) viewContainer.classList.add('hidden');
    if (tableRegContainer) tableRegContainer.classList.add('hidden');
    if (tablePlayerContainer) tablePlayerContainer.classList.remove('hidden');
    if (exContent) exContent.classList.remove('hidden');
    if (exResult) exResult.classList.add('hidden');
    
    renderExerciseCurrentItem();
  });
}

function renderExerciseCurrentItem() {
  if (currentExerciseIndex >= exerciseQueue.length) {
    if (retryQueue.length > 0) {
      exerciseQueue = [...retryQueue]; retryQueue = []; currentExerciseIndex = 0; isRetryLoop = true;
      alert("リトライ周回を開始します！"); renderExerciseCurrentItem(); return;
    }
    const exContent = document.getElementById('table-exercise-content');
    const exResult = document.getElementById('table-exercise-result');
    const summary = document.getElementById('table-result-summary');

    if (exContent) exContent.classList.add('hidden');
    if (exResult) exResult.classList.remove('hidden');
    if (summary) summary.innerText = `全 ${exerciseTotalCount} 問完了しました！`;
    return;
  }
  const item = exerciseQueue[currentExerciseIndex];
  
  const progressCount = document.getElementById('table-progress-count');
  const loopBadge = document.getElementById('table-loop-badge');
  const exQuestion = document.getElementById('t-ex-question');
  const exQImgArea = document.getElementById('t-ex-q-image-area');
  const exAnswerArea = document.getElementById('t-ex-answer-area');
  const exShowAnsBtn = document.getElementById('t-ex-show-ans-btn');
  const exGradeButtons = document.getElementById('t-ex-grade-buttons');
  const exAnswer = document.getElementById('t-ex-answer');
  const exExplanation = document.getElementById('t-ex-explanation');

  if (progressCount) progressCount.innerText = `問題 ${currentExerciseIndex + 1} / ${exerciseQueue.length}`;
  if (loopBadge) {
    loopBadge.innerText = isRetryLoop ? "🔥 リトライ周回" : "通常周回";
    loopBadge.className = isRetryLoop ? "px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold" : "px-2 py-0.5 bg-blue-100 text-blue-800 rounded";
  }
  if (exQuestion) exQuestion.innerText = item.question;
  if (exQImgArea) exQImgArea.innerHTML = item.questionImage ? `<img src="${item.questionImage}" class="max-h-40 rounded mx-auto mt-2"/>` : '';
  if (exAnswerArea) exAnswerArea.classList.add('hidden');
  if (exShowAnsBtn) exShowAnsBtn.classList.remove('hidden');
  if (exGradeButtons) exGradeButtons.classList.add('hidden');
  if (exAnswer) exAnswer.innerText = item.answer;
  if (exExplanation) exExplanation.innerText = item.explanation || "解説なし";
}

const showAnsBtn = document.getElementById('t-ex-show-ans-btn');
if (showAnsBtn) {
  showAnsBtn.addEventListener('click', () => {
    const ansArea = document.getElementById('t-ex-answer-area');
    const gradeBtns = document.getElementById('t-ex-grade-buttons');
    if (ansArea) ansArea.classList.remove('hidden');
    if (showAnsBtn) showAnsBtn.classList.add('hidden');
    if (gradeBtns) gradeBtns.classList.remove('hidden');
  });
}

const correctBtn = document.getElementById('t-ex-correct-btn');
if (correctBtn) {
  correctBtn.addEventListener('click', () => {
    if (activeTableData && exerciseQueue[currentExerciseIndex]) {
      localStorage.setItem(`qa_hist_${activeTableData.id}_${exerciseQueue[currentExerciseIndex].id}`, 'correct');
    }
    currentExerciseIndex++; 
    renderExerciseCurrentItem();
  });
}

const incorrectBtn = document.getElementById('t-ex-incorrect-btn');
if (incorrectBtn) {
  incorrectBtn.addEventListener('click', () => {
    if (activeTableData && exerciseQueue[currentExerciseIndex]) {
      localStorage.setItem(`qa_hist_${activeTableData.id}_${exerciseQueue[currentExerciseIndex].id}`, 'incorrect');
    }
    retryQueue.push(exerciseQueue[currentExerciseIndex]);
    currentExerciseIndex++; 
    renderExerciseCurrentItem();
  });
}

const restartExBtn = document.getElementById('restart-table-ex-btn');
if (restartExBtn) restartExBtn.addEventListener('click', () => openTableConfigModal(activeTableData));

const exitPlayerBtn = document.getElementById('exit-table-player-btn');
if (exitPlayerBtn) {
  exitPlayerBtn.addEventListener('click', () => {
    const playerContainer = document.getElementById('table-player-container');
    const viewContainer = document.getElementById('view-mode-container');
    if (playerContainer) playerContainer.classList.add('hidden');
    if (viewContainer) viewContainer.classList.remove('hidden');
  });
}

// 画像モーダル関連
let modalTargetItemId = null, modalSelectedImageBase64 = "";
function openQaImageModal(itemId, currentBase64) {
  modalTargetItemId = itemId; modalSelectedImageBase64 = currentBase64 || "";
  const modal = document.getElementById('qa-image-modal');
  const preview = document.getElementById('qa-modal-img-preview');
  if (modal) modal.classList.remove('hidden');
  if (preview) {
    preview.innerHTML = modalSelectedImageBase64 ? `<img src="${modalSelectedImageBase64}" class="max-h-32 mx-auto rounded"/>` : `<span class="text-gray-400 text-xs">画像未選択</span>`;
  }
}

const closeImgModalBtn = document.getElementById('close-qa-img-modal');
if (closeImgModalBtn) closeImgModalBtn.addEventListener('click', () => {
  const modal = document.getElementById('qa-image-modal');
  if (modal) modal.classList.add('hidden');
});

const modalFileInput = document.getElementById('qa-modal-file-input');
if (modalFileInput) {
  modalFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const buffer = await file.arrayBuffer();
    modalSelectedImageBase64 = `data:${file.type};base64,${await arrayBufferToBase64(buffer)}`;
    const preview = document.getElementById('qa-modal-img-preview');
    if (preview) preview.innerHTML = `<img src="${modalSelectedImageBase64}" class="max-h-32 mx-auto rounded"/>`;
  });
}

const removeImgBtn = document.getElementById('qa-img-remove-btn');
if (removeImgBtn) {
  removeImgBtn.addEventListener('click', () => {
    modalSelectedImageBase64 = "";
    const preview = document.getElementById('qa-modal-img-preview');
    if (preview) preview.innerHTML = `<span class="text-gray-400 text-xs">画像未選択</span>`;
  });
}

const saveImgBtn = document.getElementById('qa-img-save-btn');
if (saveImgBtn) {
  saveImgBtn.addEventListener('click', () => {
    const tr = document.querySelector(`tr[data-item-id="${modalTargetItemId}"]`);
    if (tr) {
      tr.dataset.imgData = modalSelectedImageBase64;
      const btn = tr.querySelector('.row-img-btn');
      if (btn) {
        btn.className = modalSelectedImageBase64 ? "row-img-btn px-2 py-1 rounded text-[10px] font-bold bg-blue-600 text-white" : "row-img-btn px-2 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700";
        btn.innerText = modalSelectedImageBase64 ? "画像付(変)" : "画像追加";
      }
    }
    const modal = document.getElementById('qa-image-modal');
    if (modal) modal.classList.add('hidden');
  });
}

function arrayBufferToBase64(buffer) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.readAsDataURL(new Blob([buffer]));
  });
}

function selectDocument(docData) {
  selectedDocId = docData.id; currentDocData = docData;
  const docTitle = document.getElementById('doc-title');
  const editBtn = document.getElementById('edit-current-btn');
  if (docTitle) docTitle.innerText = `${docData.title} ${docData.subQuestion ? '('+docData.subQuestion+')' : ''}`;
  if (editBtn) editBtn.classList.remove('hidden');
  renderContent();
}

async function renderContent() {
  if (!currentDocData) return;
  await renderPaneContent('question-display-area', currentDocData.questionText, currentDocData.questionMaterials);
  await renderPaneContent('answer-display-area', currentDocData.answerText, currentDocData.answerMaterials, "解答なし");
}

async function renderPaneContent(containerId, textVal, materials) {
  const area = document.getElementById(containerId); if (!area) return;
  area.innerHTML = '';
  if (textVal) { const d = document.createElement('div'); d.className = "content-text-box"; d.innerText = textVal; area.appendChild(d); }
  if (materials) {
    materials.forEach(item => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(new Blob([base64ToArrayBuffer(LZString.decompressFromUTF16(item.data))]));
      img.className = "content-image my-2"; area.appendChild(img);
    });
  }
}

function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function clearDocumentView() {
  selectedDocId = null; currentDocData = null;
  const docTitle = document.getElementById('doc-title');
  if (docTitle) docTitle.innerText = '左のリストから選択してください';
}
