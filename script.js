import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, query, orderBy, onSnapshot, deleteDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = { apiKey: "AIzaSyAat1qoigRFAQtIwCHweMeO6P0qTmR10_8", authDomain: "mondai-choco.firebaseapp.com", projectId: "mondai-choco", appId: "1:41081435290:web:f5237845a870e11e719b23" };
let app, auth, db, currentUser = null, selectedDocId = null, currentDocData = null, allDocuments = [], allCollections = [], allTables = [], allKanjiTables = [], currentMainView = 'documents';
let collectionPlayList = [], collectionPlayIndex = 0, isPlayingCollection = false, isContinuousAnswerOn = false;
let activeTableData = null, exerciseQueue = [], retryQueue = [], currentExerciseIndex = 0, exerciseTotalCount = 0, isRetryLoop = false;
let activeModalRowId = null, activeModalType = 'question';

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

// --- 画像アップロードモーダル共通処理 ---
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


// --- 一問一答表 ＆ 演習プレイヤー ---
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

function openTableConfigModal(tableData) {
  activeTableData = tableData;
  document.getElementById('table-config-modal').classList.remove('hidden');
}

document.getElementById('close-table-config-modal').addEventListener('click', () => {
  document.getElementById('table-config-modal').classList.add('hidden');
});

// 💡 一問一答演習の開始ロジックを完全復活・実装
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

  // 選択肢形式の処理
  const choicesArea = document.getElementById('t-ex-choices-area');
  if (item.isChoiceMode && item.wrongChoices) {
    choicesArea.classList.remove('hidden');
    choicesArea.innerHTML = `<div class="text-xs font-bold text-slate-500 mb-1">選択肢：</div>`;
    
    const wrongList = item.wrongChoices.split(',').map(s => s.trim()).filter(Boolean);
    let allChoices = [{ text: item.answer, isCorrect: true, img: item.choiceImage || "" }];
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
        // 選択された時のフィードバック
        grid.querySelectorAll('button').forEach(b => b.disabled = true);
        if (ch.isCorrect) {
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


// --- 一問一答エディタ画面 ---
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
      <td class="p-2 text-center text-gray-400 cursor-grab font-bold drag-handle" title="ドラッグして移動" draggable="true">≡</td>
      <td class="p-2 text-center font-bold text-gray-500 row-index">${index + 1}</td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題...">${item.question || ''}</textarea></td>
      <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasImg ? '画像付(変)' : '画像追加'}</button></td>
      <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答...">${item.answer || ''}</textarea></td>
      <td class="p-2 text-center"><input type="checkbox" class="row-choice-chk w-4 h-4 rounded cursor-pointer" ${item.isChoiceMode ? 'checked' : ''} title="選択肢形式にする"/></td>
      <td class="p-2"><input type="text" class="w-full border rounded p-1 row-wrong" placeholder="誤答をカンマ区切り" value="${item.wrongChoices || ''}"/></td>
      <td class="p-2 text-center"><button type="button" class="row-choice-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasChoiceImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasChoiceImg ? '画像付(変)' : '画像追加'}</button></td>
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

const addRowBtn = document.getElementById('add-qa-row-btn');
if (addRowBtn) addRowBtn.addEventListener('click', () => addRowToTable(null));

function addRowToTable(initialData = null) {
  const tbody = document.getElementById('qa-table-tbody'); if (!tbody) return;
  const importancesInput = document.getElementById('table-importances-input');
  const importances = importancesInput ? importancesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ["高", "中", "低"];
  let defaultExp = "";
  if (!initialData && tbody.children.length > 0) defaultExp = tbody.lastElementChild.querySelector('.row-exp').value;

  const newItemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wrapper = document.createElement('tr'); 
  wrapper.className = "border-b"; 
  wrapper.dataset.itemId = newItemId; 
  wrapper.dataset.imgData = initialData ? initialData.questionImage : "";
  wrapper.dataset.choiceImgData = initialData ? initialData.choiceImage : "";
  
  const hasImg = (initialData ? initialData.questionImage : "").length > 0;
  const hasChoiceImg = (initialData ? initialData.choiceImage : "").length > 0;

  wrapper.innerHTML = `
    <td class="p-2 text-center text-gray-400 cursor-grab font-bold drag-handle" title="ドラッグして移動" draggable="true">≡</td>
    <td class="p-2 text-center font-bold text-gray-500 row-index">${tbody.children.length + 1}</td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題...">${initialData ? initialData.question : ''}</textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasImg ? '画像付(変)' : '画像追加'}</button></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答...">${initialData ? initialData.answer : ''}</textarea></td>
    <td class="p-2 text-center"><input type="checkbox" class="row-choice-chk w-4 h-4 rounded cursor-pointer" ${initialData && initialData.isChoiceMode ? 'checked' : ''} title="選択肢形式にする"/></td>
    <td class="p-2"><input type="text" class="w-full border rounded p-1 row-wrong" placeholder="誤答をカンマ区切り" value="${initialData ? initialData.wrongChoices : ''}"/></td>
    <td class="p-2 text-center"><button type="button" class="row-choice-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasChoiceImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">${hasChoiceImg ? '画像付(変)' : '画像追加'}</button></td>
    <td class="p-2 text-center"><select class="w-full border rounded p-1 row-imp bg-white">${importances.map(i => `<option value="${i}" ${initialData && initialData.importance === i ? 'selected' : ''}>${i}</option>`).join('')}</select></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-exp" placeholder="解説...">${initialData ? initialData.explanation : defaultExp}</textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-del-btn text-red-500 hover:text-red-700 font-bold px-2 py-1 text-xs bg-red-50 rounded">削除</button></td>
  `;

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
