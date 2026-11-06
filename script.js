import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, query, orderBy, onSnapshot, deleteDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { renderTableList } from "./keywords.js";
import { renderKanjiTableList } from "./kanji.js";
import { renderTimelineList } from "./timeline.js";
import { openRefreshModeModal } from "./refresh.js";

const firebaseConfig = { apiKey: "AIzaSyAat1qoigRFAQtIwCHweMeO6P0qTmR10_8", authDomain: "mondai-choco.firebaseapp.com", projectId: "mondai-choco", appId: "1:41081435290:web:f5237845a870e11e719b23" };
let app, auth;
export let db;
export let currentUser = null;

let selectedDocId = null, currentDocData = null, allDocuments = [], allCollections = [], allTables = [], allKanjiTables = [], allTimelines = [], currentMainView = 'documents';
let collectionPlayList = [], collectionPlayIndex = 0, isPlayingCollection = false, isContinuousAnswerOn = false;

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
document.getElementById('nav-timeline').addEventListener('click', () => { currentMainView = 'timeline'; isPlayingCollection = false; setActiveNavTab('nav-timeline'); renderCurrentView(); });

// 💡 誤答リフレッシュモード起動ボタンのイベント
document.getElementById('nav-refresh').addEventListener('click', () => {
  isPlayingCollection = false;
  openRefreshModeModal(allDocuments, allTables, allKanjiTables);
});

function setActiveNavTab(tabId) {
  ['nav-docs', 'nav-collections', 'nav-tables', 'nav-kanji', 'nav-timeline'].forEach(id => {
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
  onSnapshot(query(collection(db, "users", currentUser.uid, "timelineTables"), orderBy("updatedAt", "desc")), snap => {
    allTimelines = []; snap.forEach(d => allTimelines.push({ id: d.id, ...d.data() })); if (currentMainView === 'timeline') renderCurrentView();
  });
}

function detachRealtimeListeners() {}
function renderCurrentView() {
  if (currentMainView === 'documents') renderDocumentList(allDocuments);
  else if (currentMainView === 'collections') renderCollectionList(allCollections);
  else if (currentMainView === 'tables') renderTableList(allTables);
  else if (currentMainView === 'kanji') renderKanjiTableList(allKanjiTables);
  else if (currentMainView === 'timeline') renderTimelineList(allTimelines);
}

function renderDocumentList(docs) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  container.innerHTML = docs.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題がありません。</p>' : '';
  docs.forEach(data => {
    const item = document.createElement('div');
    item.className = `p-2.5 rounded-lg border cursor-pointer text-xs transition ${data.id === selectedDocId && !isPlayingCollection ? 'bg-blue-50 border-blue-400 font-semibold' : 'bg-white hover:bg-slate-50'}`;
    item.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="truncate font-bold">${data.title}</span><div class="flex gap-1"><button class="edit-btn text-blue-500">編集</button><button class="del-btn text-red-400">削除</button></div></div><div class="text-[10px] text-gray-500">教科: ${data.subject || '未設定'} | 正解: ${data.stats?.correct || 0} / 誤答: ${data.stats?.incorrect || 0}</div>`;
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
  document.getElementById('refresh-mode-container').classList.add('hidden');
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
  if (i > 0) {
    localStorage.setItem(`doc_mistake_time_${currentDocData.id}`, Date.now());
  } else {
    localStorage.removeItem(`doc_mistake_time_${currentDocData.id}`);
  }
  await setDoc(doc(db, "users", currentUser.uid, "documents", currentDocData.id), { stats: currentDocData.stats }, { merge: true });
  alert("正誤記録を保存しました！");
  document.getElementById('stats-modal').classList.add('hidden');
});

function selectDocument(docData) {
  selectedDocId = docData.id;
  currentDocData = docData;
  document.getElementById('doc-title').innerText = docData.title;
  document.getElementById('edit-current-btn').classList.remove('hidden');
  renderPaneContentForContainer(document.getElementById('question-display-area'), docData.questionText, docData.questionMaterials);
  answerPane.classList.add('hidden');
  toggleAnswerBtn.classList.remove('hidden');
  toggleAnswerBtn.innerText = "💡 解答解説を表示";
}

function clearDocumentView() {
  selectedDocId = null;
  currentDocData = null;
  document.getElementById('doc-title').innerText = "左のリストから問題を選択してください";
  document.getElementById('edit-current-btn').classList.add('hidden');
  document.getElementById('question-display-area').innerHTML = '<div class="text-center text-gray-400 py-20"><p>問題データが選択されていません。</p></div>';
  answerPane.classList.add('hidden');
  toggleAnswerBtn.classList.add('hidden');
}

function renderPaneContentForContainer(container, text, materials, fallbackText = "問題文なし") {
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
