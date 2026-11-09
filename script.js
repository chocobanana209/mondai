import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, query, orderBy, onSnapshot, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { renderTableList } from "./keywords.js";
import { renderKanjiTableList } from "./kanji.js";
import { renderTimelineList } from "./timeline.js";
import { renderExamList, openExamRegisterForm } from "./exam.js";
import { openRefreshModeModal } from "./refresh.js";

const firebaseConfig = { apiKey: "AIzaSyAat1qoigRFAQtIwCHweMeO6P0qTmR10_8", authDomain: "mondai-choco.firebaseapp.com", projectId: "mondai-choco", appId: "1:41081435290:web:f5237845a870e11e719b23" };
let app, auth;
export let db;
export let currentUser = null;

let selectedDocId = null, currentDocData = null, allDocuments = [], allCollections = [], allTables = [], allKanjiTables = [], allTimelines = [], allExams = [], currentMainView = 'documents';
let collectionPlayList = [], collectionPlayIndex = 0, isPlayingCollection = false, isContinuousAnswerOn = false;
let hiddenUnits = new Set();

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

function safeListen(id, event, callback) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, callback);
}

safeListen('login-btn', 'click', () => signInWithPopup(auth, new GoogleAuthProvider()));
safeListen('logout-btn', 'click', () => signOut(auth));

const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const sidebar = document.getElementById('sidebar');
if (toggleSidebarBtn && sidebar) {
  toggleSidebarBtn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
}

function closeAllEditorsAndSync() {
  const saveBtn = document.getElementById('save-table-doc-btn');
  if (saveBtn && document.getElementById('table-register-form-container') && !document.getElementById('table-register-form-container').classList.contains('hidden')) {
    saveBtn.click();
  }
  const kanjiSaveBtn = document.getElementById('save-kanji-doc-btn');
  if (kanjiSaveBtn && document.getElementById('kanji-register-form-container') && !document.getElementById('kanji-register-form-container').classList.contains('hidden')) {
    kanjiSaveBtn.click();
  }
  const timelineSaveBtn = document.getElementById('save-timeline-doc-btn');
  if (timelineSaveBtn && document.getElementById('timeline-register-form-container') && !document.getElementById('timeline-register-form-container').classList.contains('hidden')) {
    timelineSaveBtn.click();
  }

  ['table-register-form-container', 'kanji-register-form-container', 'timeline-register-form-container', 'exam-register-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

safeListen('nav-docs', 'click', () => {
  closeAllEditorsAndSync();
  currentMainView = 'documents'; isPlayingCollection = false; setActiveNavTab('nav-docs'); renderCurrentView(); clearDocumentView(); 
});

safeListen('nav-collections', 'click', () => {
  closeAllEditorsAndSync();
  currentMainView = 'collections'; isPlayingCollection = false; setActiveNavTab('nav-collections'); renderCurrentView(); 
});

safeListen('nav-tables', 'click', () => {
  closeAllEditorsAndSync();
  currentMainView = 'tables'; isPlayingCollection = false; setActiveNavTab('nav-tables'); renderCurrentView(); 
});

safeListen('nav-kanji', 'click', () => {
  closeAllEditorsAndSync();
  currentMainView = 'kanji'; isPlayingCollection = false; setActiveNavTab('nav-kanji'); renderCurrentView(); 
});

safeListen('nav-timeline', 'click', () => {
  closeAllEditorsAndSync();
  currentMainView = 'timeline'; isPlayingCollection = false; setActiveNavTab('nav-timeline'); renderCurrentView(); 
});

safeListen('nav-exams', 'click', () => {
  closeAllEditorsAndSync();
  currentMainView = 'exams'; isPlayingCollection = false; setActiveNavTab('nav-exams'); renderCurrentView(); 
});

safeListen('nav-refresh', 'click', () => {
  closeAllEditorsAndSync();
  isPlayingCollection = false;
  openRefreshModeModal({
    documents: allDocuments,
    collections: allCollections,
    questionTables: allTables,
    kanjiTables: allKanjiTables,
    timelineTables: allTimelines,
    exams: allExams
  });
});

safeListen('nav-quick-doc-add', 'click', () => {
  ['qd-title', 'qd-subject', 'qd-unit', 'qd-desc', 'qd-question', 'qd-answer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const modal = document.getElementById('quick-doc-modal');
  if (modal) modal.classList.remove('hidden');
});

safeListen('btn-nav-exam-register', 'click', () => {
  closeAllEditorsAndSync();
  openExamRegisterForm(null, {
    documents: allDocuments,
    collections: allCollections,
    questionTables: allTables,
    kanjiTables: allKanjiTables,
    timelineTables: allTimelines
  });
});

safeListen('close-quick-doc-modal', 'click', () => {
  const modal = document.getElementById('quick-doc-modal');
  if (modal) modal.classList.add('hidden');
});

safeListen('save-quick-doc-btn', 'click', async () => {
  if (!currentUser) return;
  const title = document.getElementById('qd-title')?.value.trim() || "";
  const subject = document.getElementById('qd-subject')?.value.trim() || "未設定";
  const unit = document.getElementById('qd-unit')?.value.trim() || "";
  const description = document.getElementById('qd-desc')?.value.trim() || "";
  const questionText = document.getElementById('qd-question')?.value.trim() || "";
  const answerText = document.getElementById('qd-answer')?.value.trim() || "";

  if (!title || !questionText) { alert("タイトルと問題文を入力してください。"); return; }

  const docId = `doc_${Date.now()}`;
  await setDoc(doc(db, "users", currentUser.uid, "documents", docId), {
    title,
    subject,
    unit,
    description,
    questionText,
    answerText,
    questionMaterials: [],
    answerMaterials: [],
    stats: { correct: 0, incorrect: 0 },
    updatedAt: Date.now(),
    isDeleted: false
  });

  alert("短問を追加しました！");
  const modal = document.getElementById('quick-doc-modal');
  if (modal) modal.classList.add('hidden');
});

safeListen('open-trash-modal-btn', 'click', () => {
  renderTrashModalItems();
  const modal = document.getElementById('trash-modal');
  if (modal) modal.classList.remove('hidden');
});

safeListen('close-trash-modal', 'click', () => {
  const modal = document.getElementById('trash-modal');
  if (modal) modal.classList.add('hidden');
});

function renderTrashModalItems() {
  const container = document.getElementById('trash-items-list');
  if (!container) return;
  container.innerHTML = '';
  
  const allTrashed = [];
  allDocuments.forEach(d => { if (d.isDeleted) allTrashed.push({ ...d, typeName: '問題', col: 'documents' }); });
  allCollections.forEach(c => { if (c.isDeleted) allTrashed.push({ ...c, title: c.name, typeName: '問題集', col: 'collections' }); });
  allTables.forEach(t => { if (t.isDeleted) allTrashed.push({ ...t, typeName: '一問一答', col: 'questionTables' }); });
  allKanjiTables.forEach(k => { if (k.isDeleted) allTrashed.push({ ...k, typeName: '漢字', col: 'kanjiTables' }); });
  allTimelines.forEach(l => { if (l.isDeleted) allTrashed.push({ ...l, typeName: '年表', col: 'timelineTables' }); });
  allExams.forEach(e => { if (e.isDeleted) allTrashed.push({ ...e, typeName: '試験', col: 'exams' }); });

  if (allTrashed.length === 0) {
    container.innerHTML = '<p class="text-gray-400 text-xs italic text-center py-8">ゴミ箱は空です。</p>';
    return;
  }

  allTrashed.forEach(item => {
    const row = document.createElement('div');
    row.className = "flex justify-between items-center p-3 bg-slate-50 border rounded-lg text-xs";
    row.innerHTML = `
      <div>
        <span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-bold text-[10px] mr-2">${item.typeName}</span>
        <span class="font-bold text-slate-800">${item.title}</span>
      </div>
      <button class="restore-btn bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1 rounded transition">復元する</button>
    `;
    row.querySelector('.restore-btn').addEventListener('click', async () => {
      await setDoc(doc(db, "users", currentUser.uid, item.col, item.id), { isDeleted: false }, { merge: true });
      row.remove();
      if (container.children.length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-xs italic text-center py-8">ゴミ箱は空です。</p>';
      }
    });
    container.appendChild(row);
  });
}

function setActiveNavTab(tabId) {
  ['nav-docs', 'nav-collections', 'nav-tables', 'nav-kanji', 'nav-timeline', 'nav-exams'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.className = id === tabId ? "flex-1 py-1 font-bold text-blue-600 bg-white rounded shadow-sm text-[11px]" : "flex-1 py-1 font-medium text-gray-500 hover:text-gray-700 text-[11px]";
  });
}

function setupRealtimeListeners() {
  detachRealtimeListeners();
  if (!currentUser) return;
  
  onSnapshot(query(collection(db, "users", currentUser.uid, "documents"), orderBy("updatedAt", "desc")), snap => {
    allDocuments = []; 
    snap.forEach(d => allDocuments.push({ id: d.id, ...d.data() })); 
    if (currentMainView === 'documents') renderCurrentView();
  });

  onSnapshot(query(collection(db, "users", currentUser.uid, "collections"), orderBy("updatedAt", "desc")), snap => {
    allCollections = []; 
    snap.forEach(d => allCollections.push({ id: d.id, ...d.data() })); 
    if (currentMainView === 'collections') renderCurrentView();
  });

  onSnapshot(query(collection(db, "users", currentUser.uid, "questionTables"), orderBy("updatedAt", "desc")), snap => {
    allTables = []; 
    snap.forEach(d => allTables.push({ id: d.id, ...d.data() })); 
    if (currentMainView === 'tables') renderCurrentView();
  });

  onSnapshot(query(collection(db, "users", currentUser.uid, "kanjiTables"), orderBy("updatedAt", "desc")), snap => {
    allKanjiTables = []; 
    snap.forEach(d => allKanjiTables.push({ id: d.id, ...d.data() })); 
    if (currentMainView === 'kanji') renderCurrentView();
  });

  onSnapshot(query(collection(db, "users", currentUser.uid, "timelineTables"), orderBy("updatedAt", "desc")), snap => {
    allTimelines = []; 
    snap.forEach(d => allTimelines.push({ id: d.id, ...d.data() })); 
    if (currentMainView === 'timeline') renderCurrentView();
  });

  onSnapshot(query(collection(db, "users", currentUser.uid, "exams"), orderBy("updatedAt", "desc")), snap => {
    allExams = []; 
    snap.forEach(d => allExams.push({ id: d.id, ...d.data() })); 
    if (currentMainView === 'exams') renderCurrentView();
  });
}

function detachRealtimeListeners() {}
function renderCurrentView() {
  if (currentMainView === 'documents') renderDocumentList(allDocuments);
  else if (currentMainView === 'collections') renderCollectionList(allCollections);
  else if (currentMainView === 'tables') renderTableList(allTables, hiddenUnits);
  else if (currentMainView === 'kanji') renderKanjiTableList(allKanjiTables, hiddenUnits);
  else if (currentMainView === 'timeline') renderTimelineList(allTimelines);
  else if (currentMainView === 'exams') renderExamList(allExams, {
    documents: allDocuments,
    collections: allCollections,
    questionTables: allTables,
    kanjiTables: allKanjiTables,
    timelineTables: allTimelines
  });
}

function renderDocumentList(docs) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  const activeDocs = docs.filter(d => !d.isDeleted);
  container.innerHTML = activeDocs.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題がありません。</p>' : '';
  
  updateUnitFilterUI(activeDocs);

  activeDocs.forEach(data => {
    if (data.unit && hiddenUnits.has(data.unit)) return;

    const item = document.createElement('div');
    item.className = `p-2.5 rounded-lg border cursor-pointer text-xs transition ${data.id === selectedDocId && !isPlayingCollection ? 'bg-blue-50 border-blue-400 font-semibold' : 'bg-white hover:bg-slate-50'}`;
    item.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="truncate font-bold">${data.title}</span><div class="flex gap-1"><button class="edit-btn text-blue-500">編集</button><button class="del-btn text-red-400">削除</button></div></div><div class="text-[10px] text-gray-500">教科: ${data.subject || '未設定'} ${data.unit ? `| 単元: ${data.unit}` : ''}</div>`;
    
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('del-btn') || e.target.classList.contains('edit-btn')) return;
      closeAllEditorsAndSync();
      if (isPlayingCollection) {
        const idx = collectionPlayList.findIndex(d => d.id === data.id);
        if (idx !== -1) { collectionPlayIndex = idx; renderCollectionPlayerCurrent(); }
        return;
      }
      selectDocument(data);
    });

    item.querySelector('.del-btn').addEventListener('click', async (e) => { 
      e.stopPropagation(); 
      if (confirm(`「${data.title}」をゴミ箱に移動しますか？`)) {
        await setDoc(doc(db, "users", currentUser.uid, "documents", data.id), { isDeleted: true }, { merge: true });
        if (selectedDocId === data.id) clearDocumentView();
      }
    });

    item.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openRegisterForm(data); });
    container.appendChild(item);
  });
}

function updateUnitFilterUI(docs) {
  const units = [...new Set(docs.map(d => d.unit).filter(Boolean))];
  const container = document.getElementById('unit-filter-container');
  const checkboxesArea = document.getElementById('unit-checkboxes');
  if (!container || !checkboxesArea) return;
  if (units.length === 0) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  checkboxesArea.innerHTML = '';
  units.forEach(u => {
    const lbl = document.createElement('label');
    lbl.className = "flex items-center gap-1 cursor-pointer";
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = hiddenUnits.has(u);
    chk.onchange = () => {
      if (chk.checked) hiddenUnits.add(u);
      else hiddenUnits.delete(u);
      renderCurrentView();
    };
    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode(u));
    checkboxesArea.appendChild(lbl);
  });
}

safeListen('create-collection-btn', 'click', () => {
  closeAllEditorsAndSync();
  openCollectionEditModal(null);
});

function renderCollectionList(collections) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  const activeCollections = collections.filter(c => !c.isDeleted);
  container.innerHTML = activeCollections.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題集がありません。</p>' : '';
  activeCollections.forEach(c => {
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
      <div class="text-[10px] text-gray-500">登録問題数: ${count}問 ${c.description ? `| ${c.description}` : ''}</div>
      <button class="play-coll-btn w-full bg-blue-600 text-white py-1.5 rounded font-bold">問題集をプレイ 🚀</button>
    `;
    item.querySelector('.play-coll-btn').addEventListener('click', (e) => { 
      e.stopPropagation(); 
      closeAllEditorsAndSync();
      startCollectionPlay(c); 
    });
    item.querySelector('.edit-coll').addEventListener('click', (e) => { 
      e.stopPropagation(); 
      closeAllEditorsAndSync();
      openCollectionEditModal(c); 
    });
    
    item.querySelector('.del-coll').addEventListener('click', async (e) => { 
      e.stopPropagation(); 
      if (confirm(`問題集「${c.name}」をゴミ箱に移動しますか？`)) {
        await setDoc(doc(db, "users", currentUser.uid, "collections", c.id), { isDeleted: true }, { merge: true });
      }
    });
    container.appendChild(item);
  });
}

function openCollectionEditModal(collData) {
  const editingCollId = document.getElementById('editing-coll-id');
  const collNameInput = document.getElementById('coll-name-input');
  const collDescInput = document.getElementById('coll-desc-input');
  const collModalTitle = document.getElementById('coll-modal-title');
  if (editingCollId) editingCollId.value = collData ? collData.id : '';
  if (collNameInput) collNameInput.value = collData ? collData.name : '';
  if (collDescInput) collDescInput.value = collData ? (collData.description || '') : '';
  if (collModalTitle) collModalTitle.innerText = collData ? "問題集の編集" : "新しい問題集の作成";
  
  const listEl = document.getElementById('coll-problems-checkbox-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const selectedIds = collData && collData.documentIds ? collData.documentIds : [];

  allDocuments.forEach(doc => {
    if (doc.isDeleted) return;
    const label = document.createElement('label');
    label.className = "flex items-center gap-2 p-1 hover:bg-white rounded cursor-pointer";
    const isChecked = selectedIds.includes(doc.id);
    label.innerHTML = `<input type="checkbox" value="${doc.id}" ${isChecked ? 'checked' : ''} class="rounded"/><span class="truncate">${doc.title}</span>`;
    listEl.appendChild(label);
  });
  const modal = document.getElementById('collection-edit-modal');
  if (modal) modal.classList.remove('hidden');
}

safeListen('close-coll-modal', 'click', () => {
  const modal = document.getElementById('collection-edit-modal');
  if (modal) modal.classList.add('hidden');
});

safeListen('save-coll-modal-btn', 'click', async () => {
  if (!currentUser) return;
  const name = document.getElementById('coll-name-input')?.value.trim() || "";
  const description = document.getElementById('coll-desc-input')?.value.trim() || "";
  if (!name) { alert("問題集名を入力してください。"); return; }
  const checkedBoxes = document.querySelectorAll('#coll-problems-checkbox-list input[type="checkbox"]:checked');
  const documentIds = Array.from(checkedBoxes).map(b => b.value);
  const editingId = document.getElementById('editing-coll-id')?.value || "";
  const collId = editingId ? editingId : `coll_${Date.now()}`;

  await setDoc(doc(db, "users", currentUser.uid, "collections", collId), { name, description, documentIds, updatedAt: Date.now(), isDeleted: false }, { merge: true });
  const modal = document.getElementById('collection-edit-modal');
  if (modal) modal.classList.add('hidden');
});

function startCollectionPlay(collData) {
  const docs = collData.documentIds.map(id => allDocuments.find(d => d.id === id && !d.isDeleted)).filter(Boolean);
  if (docs.length === 0) { alert("問題集に有効な問題が含まれていません。"); return; }
  collectionPlayList = docs;
  collectionPlayIndex = 0;
  isPlayingCollection = true;

  ['view-mode-container', 'table-player-container', 'kanji-player-container', 'refresh-mode-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const collPlayer = document.getElementById('collection-player-container');
  if (collPlayer) collPlayer.classList.remove('hidden');
  
  const titleEl = document.getElementById('collection-player-title');
  if (titleEl) titleEl.innerText = collData.name;
  const descEl = document.getElementById('collection-player-desc');
  if (descEl) descEl.innerText = collData.description || '';
  renderCollectionPlayerCurrent();
}

function renderCollectionPlayerCurrent() {
  const docData = collectionPlayList[collectionPlayIndex];
  currentDocData = docData;
  const prog = document.getElementById('coll-progress-badge');
  if (prog) prog.innerText = `${collectionPlayIndex + 1} / ${collectionPlayList.length}`;
  const qArea = document.getElementById('coll-q-display-area');
  if (qArea) renderPaneContentForContainer(qArea, docData.questionText, docData.questionMaterials);
  
  const collAnsPane = document.getElementById('coll-answer-pane');
  const toggleCollAnswerBtn = document.getElementById('toggle-coll-answer-btn');
  if (isContinuousAnswerOn) {
    if (collAnsPane) collAnsPane.classList.remove('hidden');
    const aArea = document.getElementById('coll-a-display-area');
    if (aArea) renderPaneContentForContainer(aArea, docData.answerText, docData.answerMaterials, "解答解説なし");
    if (toggleCollAnswerBtn) toggleCollAnswerBtn.innerText = "💡 解答解説を隠す";
  } else {
    if (collAnsPane) collAnsPane.classList.add('hidden');
    if (toggleCollAnswerBtn) toggleCollAnswerBtn.innerText = "💡 解答解説を表示";
  }
}

safeListen('coll-next-btn', 'click', () => {
  if (collectionPlayIndex < collectionPlayList.length - 1) { collectionPlayIndex++; renderCollectionPlayerCurrent(); }
  else { alert("問題集の最後の問題です！"); }
});

safeListen('coll-prev-btn', 'click', () => {
  if (collectionPlayIndex > 0) { collectionPlayIndex--; renderCollectionPlayerCurrent(); }
});

safeListen('exit-collection-btn', 'click', () => {
  isPlayingCollection = false;
  const collPlayer = document.getElementById('collection-player-container');
  if (collPlayer) collPlayer.classList.add('hidden');
  const viewMode = document.getElementById('view-mode-container');
  if (viewMode) viewMode.classList.remove('hidden');
  clearDocumentView();
});

const answerPane = document.getElementById('answer-pane');
const toggleAnswerBtn = document.getElementById('toggle-answer-pane-btn');
safeListen('toggle-answer-pane-btn', 'click', () => {
  if (answerPane) answerPane.classList.toggle('hidden');
  if (toggleAnswerBtn && answerPane) {
    toggleAnswerBtn.innerText = answerPane.classList.contains('hidden') ? "💡 解答解説を表示" : "💡 解答解説を隠す";
  }
});
safeListen('close-answer-pane-btn', 'click', () => {
  if (answerPane) answerPane.classList.add('hidden');
  if (toggleAnswerBtn) toggleAnswerBtn.innerText = "💡 解答解説を表示";
});

const collAnswerPane = document.getElementById('coll-answer-pane');
const toggleCollAnswerBtn = document.getElementById('toggle-coll-answer-btn');
safeListen('toggle-coll-answer-btn', 'click', () => {
  if (collAnswerPane) collAnswerPane.classList.toggle('hidden');
  if (toggleCollAnswerBtn && collAnswerPane) {
    toggleCollAnswerBtn.innerText = collAnswerPane.classList.contains('hidden') ? "💡 解答解説を表示" : "💡 解答解説を隠す";
  }
  if (collAnswerPane && !collAnswerPane.classList.contains('hidden') && currentDocData) {
    const aArea = document.getElementById('coll-a-display-area');
    if (aArea) renderPaneContentForContainer(aArea, currentDocData.answerText, currentDocData.answerMaterials, "解答解説なし");
  }
});
safeListen('close-coll-answer-pane-btn', 'click', () => {
  if (collAnswerPane) collAnswerPane.classList.add('hidden');
  if (toggleCollAnswerBtn) toggleCollAnswerBtn.innerText = "💡 解答解説を表示";
});

safeListen('toggle-continuous-answer-btn', 'click', () => {
  isContinuousAnswerOn = !isContinuousAnswerOn;
  const statusText = document.getElementById('continuous-status-text');
  if (statusText) {
    statusText.innerText = isContinuousAnswerOn ? "ON" : "OFF";
    statusText.className = isContinuousAnswerOn ? "text-emerald-600 font-bold" : "text-gray-500 font-semibold";
  }
  if (isPlayingCollection) renderCollectionPlayerCurrent();
});

safeListen('header-menu-btn', 'click', () => {
  if (!currentDocData && !isPlayingCollection) { alert("問題を選択してください。"); return; }
  const statsModal = document.getElementById('stats-modal');
  if (statsModal) statsModal.classList.remove('hidden');
  updateModalStats();
});

safeListen('close-stats-modal', 'click', () => {
  const statsModal = document.getElementById('stats-modal');
  if (statsModal) statsModal.classList.add('hidden');
});

function updateModalStats() {
  const docData = currentDocData;
  if (!docData) return;
  const targetTitle = document.getElementById('modal-target-title');
  if (targetTitle) targetTitle.innerText = docData.title;
  const container = document.getElementById('subquestion-stats-container');
  if (!container) return;
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

safeListen('btn-record-commit', 'click', async () => {
  if (!currentUser || !currentDocData) return;
  const c = parseInt(document.getElementById('stat-correct-input')?.value) || 0;
  const i = parseInt(document.getElementById('stat-incorrect-input')?.value) || 0;
  currentDocData.stats = { correct: c, incorrect: i };
  await setDoc(doc(db, "users", currentUser.uid, "documents", currentDocData.id), { stats: currentDocData.stats }, { merge: true });
  const statsModal = document.getElementById('stats-modal');
  if (statsModal) statsModal.classList.add('hidden');
});

function selectDocument(docData) {
  selectedDocId = docData.id;
  currentDocData = docData;
  const titleEl = document.getElementById('doc-title');
  if (titleEl) titleEl.innerText = docData.title;
  const editBtn = document.getElementById('edit-current-btn');
  if (editBtn) editBtn.classList.remove('hidden');
  const qArea = document.getElementById('question-display-area');
  if (qArea) renderPaneContentForContainer(qArea, docData.questionText, docData.questionMaterials);
  if (answerPane) answerPane.classList.add('hidden');
  if (toggleAnswerBtn) {
    toggleAnswerBtn.classList.remove('hidden');
    toggleAnswerBtn.innerText = "💡 解答解説を表示";
  }
}

function clearDocumentView() {
  selectedDocId = null;
  currentDocData = null;
  const titleEl = document.getElementById('doc-title');
  if (titleEl) titleEl.innerText = "左のリストから問題を選択してください";
  const editBtn = document.getElementById('edit-current-btn');
  if (editBtn) editBtn.classList.add('hidden');
  const qArea = document.getElementById('question-display-area');
  if (qArea) qArea.innerHTML = '<div class="text-center text-gray-400 py-20"><p>問題データが選択されていません。</p></div>';
  if (answerPane) answerPane.classList.add('hidden');
  if (toggleAnswerBtn) toggleAnswerBtn.classList.add('hidden');
}

function renderPaneContentForContainer(container, text, materials, fallbackText = "問題文なし") {
  if (!container) return;
  container.innerHTML = '';
  if (text) {
    const p = document.createElement('div');
    p.className = "text-sm whitespace-pre-wrap leading-relaxed text-slate-800";
    p.innerText = text;
    container.appendChild(p);
  }
  if (materials && materials.length > 0) {
    materials.forEach(mat => {
      const img = document.createElement('img');
      img.src = mat;
      img.className = "max-w-full rounded border my-2";
      container.appendChild(img);
    });
  }
  if (!text && (!materials || materials.length === 0)) {
    container.innerHTML = `<p class="text-gray-400 text-xs italic">${fallbackText}</p>`;
  }
}
