import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, query, orderBy, onSnapshot, deleteDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = { apiKey: "AIzaSyAat1qoigRFAQtIwCHweMeO6P0qTmR10_8", authDomain: "mondai-choco.firebaseapp.com", projectId: "mondai-choco", appId: "1:41081435290:web:f5237845a870e11e719b23" };
let app, auth, db, currentUser = null, selectedDocId = null, currentDocData = null, allDocuments = [], allCollections = [], allTables = [], allKanjiTables = [], currentMainView = 'documents';
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
    if (authStatus) { authStatus.innerText = "ログイン中"; authStatus.className = "px-2 py-0.5 bg-green-100 text-green-800 rounded text-[10px] font-semibold"; }
    if (loginBtn) loginBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.remove('hidden');
    if (headerMenuBtn) headerMenuBtn.classList.remove('hidden');
    if (userPhoto) userPhoto.src = user.photoURL || '';
    if (userName) userName.innerText = user.displayName || user.email;
    if (mainContent) mainContent.classList.remove('opacity-50', 'pointer-events-none');
  } else {
    if (authStatus) { authStatus.innerText = "未ログイン"; authStatus.className = "px-2 py-0.5 bg-gray-100 text-gray-800 rounded text-[10px] font-semibold"; }
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

document.getElementById('nav-docs').addEventListener('click', () => { currentMainView = 'documents'; isPlayingCollection = false; setActiveNavTab('nav-docs'); renderCurrentView(); clearDocumentView(); });
document.getElementById('nav-collections').addEventListener('click', () => { currentMainView = 'collections'; isPlayingCollection = false; setActiveNavTab('nav-collections'); renderCurrentView(); });
document.getElementById('nav-tables').addEventListener('click', () => { currentMainView = 'tables'; isPlayingCollection = false; setActiveNavTab('nav-tables'); renderCurrentView(); });
document.getElementById('nav-kanji').addEventListener('click', () => { currentMainView = 'kanji'; isPlayingCollection = false; setActiveNavTab('nav-kanji'); renderCurrentView(); });

function setActiveNavTab(tabId) {
  ['nav-docs', 'nav-collections', 'nav-tables', 'nav-kanji'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.className = id === tabId ? "flex-1 py-1 font-bold text-blue-600 bg-white rounded shadow-sm text-[11px]" : "flex-1 py-1 font-medium text-gray-500 hover:text-gray-700 text-[11px]";
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
  onSnapshot(query(collection(db, "users", currentUser.uid, "kanjiTables"), orderBy("updatedAt", "desc")), snap => {
    allKanjiTables = []; snap.forEach(d => allKanjiTables.push({ id: d.id, ...d.data() })); if (currentMainView === 'kanji') renderCurrentView();
  });
}

function detachRealtimeListeners() {}
function renderCurrentView() {
  if (currentMainView === 'documents') renderDocumentList(allDocuments);
  else if (currentMainView === 'collections') renderCollectionList(allCollections);
  else if (currentMainView === 'tables') renderTableList(allTables);
  else if (currentMainView === 'kanji') renderKanjiTableList(allKanjiTables);
}

function renderDocumentList(docs) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  container.innerHTML = docs.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題がありません。</p>' : '';
  docs.forEach(data => {
    const item = document.createElement('div');
    item.className = `p-2.5 rounded-lg border cursor-pointer text-xs transition ${data.id === selectedDocId && !isPlayingCollection ? 'bg-blue-50 border-blue-400 font-semibold' : 'bg-white hover:bg-slate-50'}`;
    item.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="truncate font-bold">${data.title}</span><div class="flex gap-1"><button class="edit-btn text-blue-500">編集</button><button class="del-btn text-red-400">削除</button></div></div><div class="text-[10px] text-gray-500">正解: ${data.stats?.correct || 0} / 誤答: ${data.stats?.incorrect || 0}</div>`;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('del-btn') || e.target.classList.contains('edit-btn')) return;
      if (isPlayingCollection) {
        const idx = collectionPlayList.findIndex(d => d.id === data.id);
        if (idx !== -1) { collectionPlayIndex = idx; renderCollectionPlayerCurrent(); }
        return;
      }
      selectDocument(data);
    });
    item.querySelector('.del-btn').addEventListener('click', async (e) => { e.stopPropagation(); await deleteDoc(doc(db, "users", currentUser.uid, "documents", data.id)); });
    item.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openRegisterForm(data); });
    container.appendChild(item);
  });
}

document.getElementById('create-collection-btn').addEventListener('click', () => openCollectionEditModal(null));

function renderCollectionList(collections) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  container.innerHTML = collections.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題集がありません。</p>' : '';
  collections.forEach(c => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border bg-white hover:bg-slate-50 border-slate-200 cursor-pointer text-xs transition space-y-2';
    const count = c.documentIds ? c.documentIds.length : 0;
    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-slate-800 text-sm truncate">${c.name}</span>
        <div class="flex gap-1">
          <button class="edit-coll text-blue-600 font-bold">編集</button>
          <button class="del-coll text-red-500 font-bold">削除</button>
        </div>
      </div>
      <div class="text-[10px] text-gray-500">登録問題数: ${count}問</div>
      <button class="play-coll-btn w-full bg-blue-600 text-white py-1.5 rounded font-bold">問題集をプレイ 🚀</button>
    `;
    item.querySelector('.play-coll-btn').addEventListener('click', (e) => { e.stopPropagation(); startCollectionPlay(c); });
    item.querySelector('.edit-coll').addEventListener('click', (e) => { e.stopPropagation(); openCollectionEditModal(c); });
    item.querySelector('.del-coll').addEventListener('click', async (e) => { e.stopPropagation(); await deleteDoc(doc(db, "users", currentUser.uid, "collections", c.id)); });
    container.appendChild(item);
  });
}

function openCollectionEditModal(collData) {
  document.getElementById('editing-coll-id').value = collData ? collData.id : '';
  document.getElementById('coll-name-input').value = collData ? collData.name : '';
  document.getElementById('coll-modal-title').innerText = collData ? "問題集の編集" : "新しい問題集の作成";
  
  const listEl = document.getElementById('coll-problems-checkbox-list');
  listEl.innerHTML = '';
  const selectedIds = collData && collData.documentIds ? collData.documentIds : [];

  allDocuments.forEach(doc => {
    const label = document.createElement('label');
    label.className = "flex items-center gap-2 p-1 hover:bg-white rounded cursor-pointer";
    const isChecked = selectedIds.includes(doc.id);
    label.innerHTML = `<input type="checkbox" value="${doc.id}" ${isChecked ? 'checked' : ''} class="rounded"/><span class="truncate">${doc.title}</span>`;
    listEl.appendChild(label);
  });
  document.getElementById('collection-edit-modal').classList.remove('hidden');
}

document.getElementById('close-coll-modal').addEventListener('click', () => document.getElementById('collection-edit-modal').classList.add('hidden'));
document.getElementById('save-coll-modal-btn').addEventListener('click', async () => {
  if (!currentUser) return;
  const name = document.getElementById('coll-name-input').value.trim();
  if (!name) { alert("問題集名を入力してください。"); return; }
  const checkedBoxes = document.querySelectorAll('#coll-problems-checkbox-list input[type="checkbox"]:checked');
  const documentIds = Array.from(checkedBoxes).map(b => b.value);
  const editingId = document.getElementById('editing-coll-id').value;
  const collId = editingId ? editingId : `coll_${Date.now()}`;

  await setDoc(doc(db, "users", currentUser.uid, "collections", collId), { name, documentIds, updatedAt: Date.now() }, { merge: true });
  alert("問題集を保存しました！");
  document.getElementById('collection-edit-modal').classList.add('hidden');
});

function startCollectionPlay(collData) {
  const docs = collData.documentIds.map(id => allDocuments.find(d => d.id === id)).filter(Boolean);
  if (docs.length === 0) { alert("問題集に有効な問題が含まれていません。"); return; }
  collectionPlayList = docs;
  collectionPlayIndex = 0;
  isPlayingCollection = true;

  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.remove('hidden');
  document.getElementById('collection-player-title').innerText = collData.name;
  renderCollectionPlayerCurrent();
}

function renderCollectionPlayerCurrent() {
  const docData = collectionPlayList[collectionPlayIndex];
  currentDocData = docData;
  document.getElementById('coll-progress-badge').innerText = `${collectionPlayIndex + 1} / ${collectionPlayList.length}`;
  renderPaneContentForContainer(document.getElementById('coll-q-display-area'), docData.questionText, docData.questionMaterials);
  
  const collAnsPane = document.getElementById('coll-answer-pane');
  if (isContinuousAnswerOn) {
    collAnsPane.classList.remove('hidden');
    renderPaneContentForContainer(document.getElementById('coll-a-display-area'), docData.answerText, docData.answerMaterials, "解答解説なし");
    document.getElementById('toggle-coll-answer-btn').innerText = "💡 解答解説を隠す";
  } else {
    collAnsPane.classList.add('hidden');
    document.getElementById('toggle-coll-answer-btn').innerText = "💡 解答解説を表示";
  }
}

document.getElementById('coll-next-btn').addEventListener('click', () => {
  if (collectionPlayIndex < collectionPlayList.length - 1) { collectionPlayIndex++; renderCollectionPlayerCurrent(); }
  else { alert("問題集の最後の問題です！"); }
});
document.getElementById('coll-prev-btn').addEventListener('click', () => {
  if (collectionPlayIndex > 0) { collectionPlayIndex--; renderCollectionPlayerCurrent(); }
});
document.getElementById('exit-collection-btn').addEventListener('click', () => {
  isPlayingCollection = false;
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
  clearDocumentView();
});

const answerPane = document.getElementById('answer-pane');
const toggleAnswerBtn = document.getElementById('toggle-answer-pane-btn');
document.getElementById('toggle-answer-pane-btn').addEventListener('click', () => {
  answerPane.classList.toggle('hidden');
  toggleAnswerBtn.innerText = answerPane.classList.contains('hidden') ? "💡 解答解説を表示" : "💡 解答解説を隠す";
});
document.getElementById('close-answer-pane-btn').addEventListener('click', () => {
  answerPane.classList.add('hidden');
  toggleAnswerBtn.innerText = "💡 解答解説を表示";
});

const collAnswerPane = document.getElementById('coll-answer-pane');
const toggleCollAnswerBtn = document.getElementById('toggle-coll-answer-btn');
toggleCollAnswerBtn.addEventListener('click', () => {
  collAnswerPane.classList.toggle('hidden');
  toggleCollAnswerBtn.innerText = collAnswerPane.classList.contains('hidden') ? "💡 解答解説を表示" : "💡 解答解説を隠す";
  if (!collAnswerPane.classList.contains('hidden') && currentDocData) {
    renderPaneContentForContainer(document.getElementById('coll-a-display-area'), currentDocData.answerText, currentDocData.answerMaterials, "解答解説なし");
  }
});
document.getElementById('close-coll-answer-pane-btn').addEventListener('click', () => {
  collAnswerPane.classList.add('hidden');
  toggleCollAnswerBtn.innerText = "💡 解答解説を表示";
});

document.getElementById('toggle-continuous-answer-btn').addEventListener('click', () => {
  isContinuousAnswerOn = !isContinuousAnswerOn;
  document.getElementById('continuous-status-text').innerText = isContinuousAnswerOn ? "ON" : "OFF";
  document.getElementById('continuous-status-text').className = isContinuousAnswerOn ? "text-emerald-600 font-bold" : "text-gray-500 font-semibold";
  if (isPlayingCollection) renderCollectionPlayerCurrent();
});

document.getElementById('header-menu-btn').addEventListener('click', () => {
  if (!currentDocData && !isPlayingCollection) { alert("問題を選択してください。"); return; }
  document.getElementById('stats-modal').classList.remove('hidden');
  updateModalStats();
});
document.getElementById('close-stats-modal').addEventListener('click', () => document.getElementById('stats-modal').classList.add('hidden'));

function updateModalStats() {
  const docData = currentDocData;
  if (!docData) return;
  document.getElementById('modal-target-title').innerText = docData.title;
  const container = document.getElementById('subquestion-stats-container');
  container.innerHTML = `
    <div class="space-y-3">
      <div class="flex justify-between items-center bg-green-50 p-3 rounded">
        <span class="font-bold text-green-800">⭕ 正解数</span>
        <input type="number" id="stat-correct-input" value="${docData.stats?.correct || 0}" class="w-20 border rounded p-1 text-center"/>
      </div>
      <div class="flex justify-between items-center bg-red-50 p-3 rounded">
        <span class="font-bold text-red-800">❌ 誤答数</span>
        <input type="number" id="stat-incorrect-input" value="${docData.stats?.incorrect || 0}" class="w-20 border rounded p-1 text-center"/>
      </div>
    </div>
  `;
}

document.getElementById('btn-record-commit').addEventListener('click', async () => {
  if (!currentUser || !currentDocData) return;
  const c = parseInt(document.getElementById('stat-correct-input').value) || 0;
  const i = parseInt(document.getElementById('stat-incorrect-input').value) || 0;
  currentDocData.stats = { correct: c, incorrect: i };
  await setDoc(doc(db, "users", currentUser.uid, "documents", currentDocData.id), { stats: currentDocData.stats }, { merge: true });
  alert("正誤記録を保存しました！");
  document.getElementById('stats-modal').classList.add('hidden');
});

// 一問一答表
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

document.getElementById('btn-nav-table-register').addEventListener('click', () => openTableRegisterForm(null));
document.getElementById('cancel-table-register-btn').addEventListener('click', closeTableRegisterForm);

function openTableRegisterForm(tableData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('kanji-player-container').classList.add('hidden');
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
  return { id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, question: "", questionImage: "", answer: "", importance: "中", explanation: "" };
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
    const hasImg = item.questionImage && item.questionImage.length > 0;

    wrapper.innerHTML = `
      <td class="p-2 text-center text-gray-400 cursor-grab font-bold drag-handle" title="ドラッグして移動" draggable="true">≡</td>
      <td class="p-2 text-center font-bold text-gray-500 row-index">${index + 1}</td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題...">${item.question || ''}</textarea></td>
      <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasImg ? '画像付(変)' : '画像追加'}</button></td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答...">${item.answer || ''}</textarea></td>
      <td class="p-2 text-center"><select class="w-full border rounded p-1 row-imp bg-white">${importances.map(imp => `<option value="${imp}" ${item.importance === imp ? 'selected' : ''}>${imp}</option>`).join('')}</select></td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-exp" placeholder="解説...">${item.explanation || ''}</textarea></td>
      <td class="p-2 text-center"><button type="button" class="row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">削除</button></td>
    `;

    const handle = wrapper.querySelector('.drag-handle');
    let draggedRow = null;
    handle.addEventListener('dragstart', (e) => { draggedRow = wrapper; wrapper.classList.add('opacity-40'); e.dataTransfer.effectAllowed = 'move'; });
    handle.addEventListener('dragend', () => { wrapper.classList.remove('opacity-40'); draggedRow = null; });
    wrapper.addEventListener('dragover', (e) => e.preventDefault());
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedRow && draggedRow !== wrapper) {
        const allRows = Array.from(tbody.querySelectorAll('tr'));
        const draggedIdx = allRows.indexOf(draggedRow);
        const targetIdx = allRows.indexOf(wrapper);
        if (draggedIdx < targetIdx) tbody.insertBefore(draggedRow, wrapper.nextSibling);
        else tbody.insertBefore(draggedRow, wrapper);
        reindexTableRows();
      }
    });

    wrapper.querySelector('.row-img-btn').addEventListener('click', () => openQaImageModal(item.id, wrapper.dataset.imgData));
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

const addRowBtn = document.getElementById('add-qa-row-btn');
if (addRowBtn) addRowBtn.addEventListener('click', () => addRowToTable(null));

function addRowToTable(initialData = null) {
  const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
  const importancesInput = document.getElementById('table-importances-input');
  const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];
  let defaultExp = "";
  if (!initialData && tbody.children.length > 0) defaultExp = tbody.lastElementChild.querySelector('.row-exp').value;

  const newItemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wrapper = document.createElement('tr'); wrapper.className = "border-b"; wrapper.dataset.itemId = newItemId; wrapper.dataset.imgData = initialData ? initialData.questionImage : "";
  const hasImg = (initialData ? initialData.questionImage : "").length > 0;

  wrapper.innerHTML = `
    <td class="p-2 text-center text-gray-400 cursor-grab font-bold drag-handle" title="ドラッグして移動" draggable="true">≡</td>
    <td class="p-2 text-center font-bold text-gray-500 row-index">${tbody.children.length + 1}</td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題...">${initialData ? initialData.question : ''}</textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasImg ? '画像付(変)' : '画像追加'}</button></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答...">${initialData ? initialData.answer : ''}</textarea></td>
    <td class="p-2 text-center"><select class="w-full border rounded p-1 row-imp bg-white">${importances.map(i => `<option value="${i}" ${initialData && initialData.importance === i ? 'selected' : ''}>${i}</option>`).join('')}</select></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-exp" placeholder="解説...">${initialData ? initialData.explanation : defaultExp}</textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">削除</button></td>
  `;

  wrapper.querySelector('.row-img-btn').addEventListener('click', () => openQaImageModal(newItemId, wrapper.dataset.imgData));
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
    const impArea = tr.querySelector('.row-imp');
    const expArea = tr.querySelector('.row-exp');
    if (qArea) {
      items.push({
        id: tr.dataset.itemId,
        question: qArea.value.trim(),
        questionImage: tr.dataset.imgData || "",
        answer: aArea ? aArea.value.trim() : "",
        importance: impArea ? impArea.value : "中",
        explanation: expArea ? expArea.value.trim() : ""
      });
    }
  });

  const tableId = document.getElementById('editing-table-id').value || `table_${Date.now()}`;
  await setDoc(doc(db, "users", currentUser.uid, "questionTables", tableId), { title, importances, items, updatedAt: Date.now() }, { merge: true });
  alert("保存しました！"); closeTableRegisterForm();
});

// --- 6. 漢字問題のリスト描画・エディタ・演習ロジック ---
function renderKanjiTableList(tables) {
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
      <div class="text-[10px] text-amber-700">文章問題数: ${t.passages ? t.passages.length : 0}問</div>
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
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('kanji-register-form-container').classList.remove('hidden');

  document.getElementById('editing-kanji-id').value = kanjiData ? kanjiData.id : '';
  document.getElementById('kanji-name-input').value = kanjiData ? kanjiData.title : '';
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
      { id: `sub_${Date.now()}_1`, targetWord: "", reading: "", direction: "書き" }
    ]
  };
}

function renderKanjiTableRows(passages) {
  const tbody = document.getElementById('kanji-table-tbody'); if (!tbody) return;
  tbody.innerHTML = '';

  passages.forEach((passage, pIndex) => {
    const subItems = passage.subItems && passage.subItems.length > 0 ? passage.subItems : [{ id: `sub_${Date.now()}`, targetWord: "", reading: "", direction: "書き" }];
    
    subItems.forEach((sub, sIndex) => {
      const tr = document.createElement('tr');
      tr.className = "border-b hover:bg-slate-100 kanji-row-item";
      tr.dataset.passageId = passage.id;
      tr.dataset.subId = sub.id;

      let leftCellHtml = '';
      if (sIndex === 0) {
        // 最初の行のみ rowspan を使って 1〜3列目（並び替え、#、文章）をセル結合し、HTMLの7列にピタリと合わせます
        leftCellHtml = `
          <td class="p-2 text-center text-gray-400 cursor-grab font-bold align-middle drag-handle" title="ドラッグして移動" draggable="true" rowspan="${subItems.length}">≡</td>
          <td class="p-2 text-center font-bold text-gray-500 row-index align-middle" rowspan="${subItems.length}">${pIndex + 1}</td>
          <td class="p-2 align-middle" rowspan="${subItems.length}">
            <textarea rows="4" class="w-full border rounded p-1 kanji-passage-input" placeholder="文章全体を入力...">${passage.passageText || ''}</textarea>
          </td>
        `;
      }

      tr.innerHTML = `
        ${leftCellHtml}
        <td class="p-2"><input type="text" class="w-full border rounded p-1 kanji-word-input" placeholder="傍線部(漢字)" value="${sub.targetWord || ''}"/></td>
        <td class="p-2"><input type="text" class="w-full border rounded p-1 kanji-reading-input" placeholder="読み仮名(ひらがな)" value="${sub.reading || ''}"/></td>
        <td class="p-2 text-center">
          <select class="w-full border rounded p-1 kanji-dir-select bg-white">
            <option value="読み" ${sub.direction === '読み' ? 'selected' : ''}>読み</option>
            <option value="書き" ${sub.direction === '書き' ? 'selected' : ''}>書き</option>
          </select>
        </td>
        <td class="p-2 text-center">
          <button type="button" class="kanji-row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">削除</button>
        </td>
      `;

      if (sIndex === 0) {
        const handle = tr.querySelector('.drag-handle');
        if (handle) {
          let draggedTr = null;
          handle.addEventListener('dragstart', (e) => { draggedTr = tr; tr.classList.add('opacity-40'); e.dataTransfer.effectAllowed = 'move'; });
          handle.addEventListener('dragend', () => { tr.classList.remove('opacity-40'); draggedTr = null; });
          tr.addEventListener('dragover', (e) => e.preventDefault());
          tr.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedTr && draggedTr !== tr) {
              const currentPassages = collectCurrentKanjiPassages();
              renderKanjiTableRows(currentPassages);
            }
          });
        }
      }

      tr.querySelector('.kanji-row-del-btn').addEventListener('click', () => deleteKanjiSubItem(passage.id, sub.id));
      tbody.appendChild(tr);
    });

    // 傍線追加ボタン行（colspan="7" に修正し、テーブルの7列にきれいに収まるようにしました）
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
        targetP.subItems.push({ id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, targetWord: "", reading: "", direction: "書き" });
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
        direction: dirSelect ? dirSelect.value : "書き"
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

  const passages = collectCurrentKanjiPassages();
  if (passages.length === 0) { alert("少なくとも1つ以上の文章問題を入力してください。"); return; }

  const kanjiId = document.getElementById('editing-kanji-id').value || `kanji_${Date.now()}`;
  await setDoc(doc(db, "users", currentUser.uid, "kanjiTables", kanjiId), { title, passages, updatedAt: Date.now() }, { merge: true });
  alert("漢字問題を保存しました！"); closeKanjiRegisterForm();
});

// --- 漢字問題 演習プレイヤー ---
let activeKanjiData = null, kanjiExerciseQueue = [], kanjiRetryQueue = [], currentKanjiIndex = 0, kanjiTotalCount = 0, isKanjiRetryLoop = false;

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
      subItems: p.subItems.filter(sub => sub.direction === dirFilter)
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
  document.getElementById('kanji-dir-label').innerText = "同時出題";

  let formattedPassage = passageItem.passageText || "";
  const hasMultiple = passageItem.subItems && passageItem.subItems.length > 1;

  if (passageItem.subItems) {
    const seenWords = new Set();

    passageItem.subItems.forEach((sub, idx) => {
      if (sub.targetWord) {
        const escapedWord = sub.targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedWord, 'g');

        if (!seenWords.has(sub.targetWord)) {
          seenWords.add(sub.targetWord);
          
          let displayWord = sub.targetWord;
          if (sub.direction === '書き') {
            displayWord = hiraganaToKatakana(sub.reading || sub.targetWord);
          }
          const badge = hasMultiple ? `(${idx + 1})` : '';
          
          let matchCount = 0;
          formattedPassage = formattedPassage.replace(regex, (match) => {
            matchCount++;
            if (matchCount === 1) {
              return `<span class="kanji-target-underline"><b>${badge}${displayWord}</b></span>`;
            }
            return match;
          });
        }
      }
    });
  }
  document.getElementById('kanji-ex-passage').innerHTML = formattedPassage;

  const ansArea = document.getElementById('kanji-ex-answer-area');
  ansArea.innerHTML = `<div class="text-xs font-bold text-emerald-700 mb-2">💡 解答と個別正誤判定：</div>`;
  
  passageItem.subItems.forEach((sub, idx) => {
    const subId = sub.id;
    let ansText = sub.direction === '読み' ? sub.reading : sub.targetWord;
    if (sub.direction === '書き') {
      ansText = hiraganaToKatakana(sub.reading || sub.targetWord);
    }

    const ansTypeStr = sub.direction === '読み' ? 'ひらがな' : 'カタカナ';
    const numberPrefix = hasMultiple ? `(${idx + 1}) ` : '';

    const itemDiv = document.createElement('div');
    itemDiv.className = "p-3 bg-white border rounded-lg space-y-2";
    itemDiv.innerHTML = `
      <div class="flex justify-between items-center text-xs">
        <span class="font-bold text-slate-800">${numberPrefix}傍線部「${sub.targetWord}」 [${sub.direction}]</span>
        <span class="text-emerald-700 font-semibold">答え (${ansTypeStr}): <b>${ansText}</b></span>
      </div>
      <div class="flex gap-2">
        <button type="button" class="flex-1 py-1.5 rounded text-xs font-bold transition kanji-sub-correct bg-slate-100 hover:bg-green-600 hover:text-white text-slate-700 border" data-sub-id="${subId}">⭕ 正解</button>
        <button type="button" class="flex-1 py-1.5 rounded text-xs font-bold transition kanji-sub-incorrect bg-slate-100 hover:bg-red-600 hover:text-white text-slate-700 border" data-sub-id="${subId}">❌ 誤答</button>
      </div>
    `;

    itemDiv.querySelector('.kanji-sub-correct').addEventListener('click', (e) => {
      localStorage.setItem(`kanji_hist_${activeKanjiData.id}_${subId}`, 'correct');
      e.target.className = "flex-1 py-1.5 rounded text-xs font-bold bg-green-600 text-white border border-green-600";
      e.target.nextElementSibling.className = "flex-1 py-1.5 rounded text-xs font-bold bg-slate-100 text-slate-700 border";
    });

    itemDiv.querySelector('.kanji-sub-incorrect').addEventListener('click', (e) => {
      localStorage.setItem(`kanji_hist_${activeKanjiData.id}_${subId}`, 'incorrect');
      e.target.className = "flex-1 py-1.5 rounded text-xs font-bold bg-red-600 text-white border border-red-600";
      e.target.previousElementSibling.className = "flex-1 py-1.5 rounded text-xs font-bold bg-slate-100 text-slate-700 border";
      if (!kanjiRetryQueue.includes(passageItem)) kanjiRetryQueue.push(passageItem);
    });

    ansArea.appendChild(itemDiv);
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
