import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  deleteDoc,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAat1qoigRFAQtIwCHweMeO6P0qTmR10_8",
  authDomain: "mondai-choco.firebaseapp.com",
  projectId: "mondai-choco",
  appId: "1:41081435290:web:f5237845a870e11e719b23"
};

let app, auth, db;
let currentUser = null;
let selectedDocId = null;
let currentDocData = null;
let currentCollectionData = null;
let allDocuments = [];
let allCollections = [];
let allTables = []; // 一問一答テーブルリスト
let currentMainView = 'documents'; 

let collectionPlayList = [];
let collectionPlayIndex = 0;
let isPlayingCollection = false;
let isContinuousAnswerOn = false;

// 一問一答の演習用ステート
let activeTableData = null;
let exerciseQueue = [];
let retryQueue = [];
let currentExerciseIndex = 0;
let exerciseTotalCount = 0;
let isRetryLoop = false;

let unsubscribeDocs = null;
let unsubscribeCollections = null;
let unsubscribeTables = null;

let pendingSubResults = {};
let currentFormQMaterials = [];
let currentFormAMaterials = [];
let editingCollectionOrder = [];
let draggedIndex = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  enableIndexedDbPersistence(db).catch((err) => {
    console.warn("オフラインキャッシュの競合:", err.code);
  });

  setPersistence(auth, browserLocalPersistence).catch(err => {
    console.error("セッション永続化エラー:", err);
  });
} catch (e) {
  console.error("Firebase初期化失敗:", e);
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  updateAuthUI(user);
  
  if (user) {
    try {
      await user.getIdToken(true);
      setupRealtimeListeners();
    } catch (error) {
      console.error("トークン更新エラー:", error);
    }
  } else {
    detachRealtimeListeners();
    clearDocumentView();
  }
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
    authStatus.innerText = "ログイン中";
    authStatus.className = "px-2 py-0.5 bg-green-100 text-green-800 rounded text-[10px] font-semibold";
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    userInfo.classList.remove('hidden');
    headerMenuBtn.classList.remove('hidden');
    userPhoto.src = user.photoURL || 'https://via.placeholder.com/40';
    userName.innerText = user.displayName || user.email;
    mainContent.classList.remove('opacity-50', 'pointer-events-none');
  } else {
    authStatus.innerText = "未ログイン";
    authStatus.className = "px-2 py-0.5 bg-gray-100 text-gray-800 rounded text-[10px] font-semibold";
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    userInfo.classList.add('hidden');
    headerMenuBtn.classList.add('hidden');
    mainContent.classList.add('opacity-50', 'pointer-events-none');
  }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    alert(`ログインに失敗しました: ${e.message}`);
  }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

document.getElementById('header-menu-btn').addEventListener('click', () => {
  if (!currentDocData && currentMainView !== 'collections' && currentMainView !== 'tables') {
    alert("まず問題を選択するか、問題集・一問一答を開いてください。");
    return;
  }
  document.getElementById('stats-modal').classList.remove('hidden');
  updateModalStats();
});

document.getElementById('close-stats-modal').addEventListener('click', () => {
  document.getElementById('stats-modal').classList.add('hidden');
});

const answerPane = document.getElementById('answer-pane');
const toggleAnswerBtn = document.getElementById('toggle-answer-pane-btn');
const closeAnswerBtn = document.getElementById('close-answer-pane-btn');

toggleAnswerBtn.addEventListener('click', () => {
  answerPane.classList.toggle('hidden');
  toggleAnswerBtn.innerText = answerPane.classList.contains('hidden') ? "💡 解答解説を表示" : "💡 解答解説を隠す";
});

closeAnswerBtn.addEventListener('click', () => {
  answerPane.classList.add('hidden');
  toggleAnswerBtn.innerText = "💡 解答解説を表示";
});

const collAnswerPane = document.getElementById('coll-answer-pane');
const toggleCollAnswerBtn = document.getElementById('toggle-coll-answer-btn');
const closeCollAnswerBtn = document.getElementById('close-coll-answer-pane-btn');

toggleCollAnswerBtn.addEventListener('click', () => {
  collAnswerPane.classList.toggle('hidden');
  toggleCollAnswerBtn.innerText = collAnswerPane.classList.contains('hidden') ? "💡 解答解説を表示" : "💡 解答解説を隠す";
});

closeCollAnswerBtn.addEventListener('click', () => {
  collAnswerPane.classList.add('hidden');
  toggleCollAnswerBtn.innerText = "💡 解答解説を表示";
});

const toggleContinuousBtn = document.getElementById('toggle-continuous-answer-btn');
const continuousStatusText = document.getElementById('continuous-status-text');

toggleContinuousBtn.addEventListener('click', () => {
  isContinuousAnswerOn = !isContinuousAnswerOn;
  if (isContinuousAnswerOn) {
    continuousStatusText.innerText = "ON";
    continuousStatusText.className = "text-emerald-600 font-bold";
    toggleContinuousBtn.classList.add('border-emerald-500', 'bg-emerald-50');
  } else {
    continuousStatusText.innerText = "OFF";
    continuousStatusText.className = "text-gray-500 font-semibold";
    toggleContinuousBtn.classList.remove('border-emerald-500', 'bg-emerald-50');
  }
});

function setupRealtimeListeners() {
  detachRealtimeListeners();
  if (!currentUser) return;

  // 通常問題リスナー
  const qDocs = query(collection(db, "users", currentUser.uid, "documents"), orderBy("updatedAt", "desc"));
  unsubscribeDocs = onSnapshot(qDocs, (snapshot) => {
    allDocuments = [];
    snapshot.forEach(d => allDocuments.push({ id: d.id, ...d.data() }));
    if (currentMainView === 'documents') renderCurrentView();
    updateSubjectAndUnitDatalists();
  });

  // 問題集リスナー
  const qColls = query(collection(db, "users", currentUser.uid, "collections"), orderBy("updatedAt", "desc"));
  unsubscribeCollections = onSnapshot(qColls, (snapshot) => {
    allCollections = [];
    snapshot.forEach(d => allCollections.push({ id: d.id, ...d.data() }));
    if (currentMainView === 'collections') renderCurrentView();
  });

  // 一問一答テーブルリスナー
  const qTables = query(collection(db, "users", currentUser.uid, "questionTables"), orderBy("updatedAt", "desc"));
  unsubscribeTables = onSnapshot(qTables, (snapshot) => {
    allTables = [];
    snapshot.forEach(d => allTables.push({ id: d.id, ...d.data() }));
    if (currentMainView === 'tables') renderCurrentView();
  });
}

function detachRealtimeListeners() {
  if (unsubscribeDocs) unsubscribeDocs();
  if (unsubscribeCollections) unsubscribeCollections();
  if (unsubscribeTables) unsubscribeTables();
}

function updateSubjectAndUnitDatalists() {
  const subjects = [...new Set(allDocuments.map(d => d.subject).filter(Boolean))];
  const units = [...new Set(allDocuments.map(d => d.unit).filter(Boolean))];
  const subList = document.getElementById('subject-list');
  const unitList = document.getElementById('unit-list');
  if (subList) subList.innerHTML = subjects.map(s => `<option value="${s}">`).join('');
  if (unitList) unitList.innerHTML = units.map(u => `<option value="${u}">`).join('');
}

// ナビゲーション切り替え
document.getElementById('nav-docs').addEventListener('click', () => {
  currentMainView = 'documents';
  setActiveNavTab('nav-docs');
  renderCurrentView();
});

document.getElementById('nav-collections').addEventListener('click', () => {
  currentMainView = 'collections';
  setActiveNavTab('nav-collections');
  renderCurrentView();
});

document.getElementById('nav-tables').addEventListener('click', () => {
  currentMainView = 'tables';
  setActiveNavTab('nav-tables');
  renderCurrentView();
});

function setActiveNavTab(tabId) {
  ['nav-docs', 'nav-collections', 'nav-tables'].forEach(id => {
    const btn = document.getElementById(id);
    if (id === tabId) {
      btn.className = "flex-1 py-1.5 font-bold text-blue-600 bg-white rounded shadow-sm text-xs";
    } else {
      btn.className = "flex-1 py-1.5 font-medium text-gray-500 hover:text-gray-700 text-xs";
    }
  });
}

function renderCurrentView() {
  if (currentMainView === 'documents') renderDocumentList(allDocuments);
  else if (currentMainView === 'collections') renderCollectionList(allCollections);
  else if (currentMainView === 'tables') renderTableList(allTables);
}

// --- 通常問題リスト描画 ---
function renderDocumentList(docs) {
  const container = document.getElementById('sidebar-list');
  container.innerHTML = docs.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題が登録されていません。</p>' : '';

  docs.forEach(data => {
    const item = document.createElement('div');
    const isSelected = data.id === selectedDocId;
    item.className = `p-2.5 rounded-lg border cursor-pointer text-xs transition ${isSelected ? 'bg-blue-50 border-blue-400 font-semibold' : 'bg-white hover:bg-slate-50 border-slate-200'}`;
    
    item.innerHTML = `
      <div class="flex justify-between items-center mb-1">
        <span class="truncate text-slate-800 font-bold flex-1 mr-1" title="${data.title}">${data.title}</span>
        <div class="flex gap-1">
          <button class="edit-btn text-blue-500 hover:text-blue-700 px-1">編集</button>
          <button class="del-btn text-red-400 hover:text-red-600 px-1">削除</button>
        </div>
      </div>
      <div class="flex justify-between text-[10px] text-gray-500">
        <span>正解: ${data.stats?.correct || 0} / 誤答: ${data.stats?.incorrect || 0}</span>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('del-btn') || e.target.classList.contains('edit-btn')) return;
      if (isPlayingCollection) {
        const indexInPlay = collectionPlayList.findIndex(d => d.id === data.id);
        if (indexInPlay !== -1) {
          collectionPlayIndex = indexInPlay;
          renderCollectionPlayerCurrent();
        }
        return;
      }
      selectDocument(data);
    });

    item.querySelector('.del-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`「${data.title}」を削除しますか？`)) {
        await deleteDoc(doc(db, "users", currentUser.uid, "documents", data.id));
        if (selectedDocId === data.id) clearDocumentView();
      }
    });

    item.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openRegisterForm(data);
    });

    container.appendChild(item);
  });
}

// --- 一問一答テーブルリスト描画 ---
function renderTableList(tables) {
  const container = document.getElementById('sidebar-list');
  container.innerHTML = tables.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">一問一答表がありません。</p>' : '';

  tables.forEach(t => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border bg-emerald-50 hover:bg-emerald-100 border-emerald-300 cursor-pointer text-xs transition space-y-2 shadow-xs';
    
    const itemCount = t.items ? t.items.length : 0;

    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-emerald-900 text-sm truncate" title="${t.title}">${t.title}</span>
        <div class="flex gap-1">
          <button class="edit-table text-blue-600 hover:text-blue-800 px-1 font-bold">編集</button>
          <button class="del-table text-red-500 hover:text-red-700 px-1 font-bold">削除</button>
        </div>
      </div>
      <div class="text-[10px] text-emerald-700">収録問題数: ${itemCount} 問</div>
      <button class="start-exercise-btn w-full bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded font-bold transition">
        演習を始める 🎯
      </button>
    `;

    item.querySelector('.start-exercise-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openTableConfigModal(t);
    });

    item.querySelector('.edit-table').addEventListener('click', (e) => {
      e.stopPropagation();
      openTableRegisterForm(t);
    });

    item.querySelector('.del-table').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`一問一答「${t.title}」を削除しますか？`)) {
        await deleteDoc(doc(db, "users", currentUser.uid, "questionTables", t.id));
      }
    });

    container.appendChild(item);
  });
}

// --- 一問一答 表形式エディタのロジック ---
document.getElementById('btn-nav-table-register').addEventListener('click', () => openTableRegisterForm(null));
document.getElementById('cancel-table-register-btn').addEventListener('click', closeTableRegisterForm);

function openTableRegisterForm(tableData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.remove('hidden');

  const titleInput = document.getElementById('table-name-input');
  const idInput = document.getElementById('editing-table-id');
  const importancesInput = document.getElementById('table-importances-input');
  
  if (tableData) {
    document.getElementById('table-form-header-title').innerText = "一問一答表の編集";
    idInput.value = tableData.id;
    titleInput.value = tableData.title || '';
    importancesInput.value = tableData.importances ? tableData.importances.join(', ') : "高, 中, 低";
    renderTableRows(tableData.items || []);
  } else {
    document.getElementById('table-form-header-title').innerText = "新しい一問一答表の作成";
    idInput.value = '';
    titleInput.value = '';
    importancesInput.value = "高, 中, 低";
    renderTableRows([createEmptyRowItem()]);
  }
}

function closeTableRegisterForm() {
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
}

function createEmptyRowItem() {
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    question: "",
    questionImage: "",
    answer: "",
    importance: "中",
    explanation: ""
  };
}

function renderTableRows(items) {
  const tbody = document.getElementById('qa-table-tbody');
  tbody.innerHTML = '';

  const importances = document.getElementById('table-importances-input').value.split(',').map(s => s.trim()).filter(Boolean);

  items.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.className = "border-b hover:bg-slate-100";
    tr.dataset.itemId = item.id;

    const hasImg = item.questionImage && item.questionImage.length > 0;

    tr.innerHTML = `
      <td class="p-2 text-center font-bold text-gray-500 row-index">${index + 1}</td>
      <td class="p-2">
        <textarea rows="2" class="w-full border rounded p-1 row-q focus:outline-none focus:border-blue-500" placeholder="問題...">${item.question || ''}</textarea>
      </td>
      <td class="p-2 text-center">
        <button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold ${hasImg ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}">
          ${hasImg ? '画像付(変)' : '画像追加'}
        </button>
      </td>
      <td class="p-2">
        <textarea rows="2" class="w-full border rounded p-1 row-a focus:outline-none focus:border-blue-500" placeholder="解答...">${item.answer || ''}</textarea>
      </td>
      <td class="p-2 text-center">
        <select class="w-full border rounded p-1 row-imp bg-white">
          ${importances.map(imp => `<option value="${imp}" ${item.importance === imp ? 'selected' : ''}>${imp}</option>`).join('')}
        </select>
      </td>
      <td class="p-2">
        <textarea rows="2" class="w-full border rounded p-1 row-exp focus:outline-none focus:border-blue-500" placeholder="解説...">${item.explanation || ''}</textarea>
      </td>
      <td class="p-2 text-center">
        <button type="button" class="row-del-btn text-red-500 hover:text-red-700 font-bold px-1">✕</button>
      </td>
    `;

    // 画像モーダルを開くボタン
    tr.querySelector('.row-img-btn').addEventListener('click', () => {
      openQaImageModal(item.id, item.questionImage);
    });

    // 行削除
    tr.querySelector('.row-del-btn').addEventListener('click', () => {
      tr.remove();
      reindexTableRows();
    });

    tbody.appendChild(tr);
  });
}

function reindexTableRows() {
  const rows = document.querySelectorAll('#qa-table-tbody tr');
  rows.forEach((r, idx) => {
    r.querySelector('.row-index').innerText = idx + 1;
  });
}

document.getElementById('add-qa-row-btn').addEventListener('click', () => {
  const tbody = document.getElementById('qa-table-tbody');
  const importances = document.getElementById('table-importances-input').value.split(',').map(s => s.trim()).filter(Boolean);
  
  const newItem = createEmptyRowItem();
  const tr = document.createElement('tr');
  tr.className = "border-b hover:bg-slate-100";
  tr.dataset.itemId = newItem.id;

  tr.innerHTML = `
    <td class="p-2 text-center font-bold text-gray-500 row-index">${tbody.children.length + 1}</td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-q" placeholder="問題..."></textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-img-btn px-2 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700">画像追加</button></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-a" placeholder="解答..."></textarea></td>
    <td class="p-2 text-center"><select class="w-full border rounded p-1 row-imp bg-white">${importances.map(i => `<option value="${i}">${i}</option>`).join('')}</select></td>
    <td class="p-2"><textarea rows="2" class="w-full border rounded p-1 row-exp" placeholder="解説..."></textarea></td>
    <td class="p-2 text-center"><button type="button" class="row-del-btn text-red-500 font-bold px-1">✕</button></td>
  `;

  tr.querySelector('.row-img-btn').addEventListener('click', () => openQaImageModal(newItem.id, ""));
  tr.querySelector('.row-del-btn').addEventListener('click', () => { tr.remove(); reindexTableRows(); });

  tbody.appendChild(tr);
});

// 画像モーダル関連
let modalTargetItemId = null;
let modalSelectedImageBase64 = "";

function openQaImageModal(itemId, currentBase64) {
  modalTargetItemId = itemId;
  modalSelectedImageBase64 = currentBase64 || "";
  document.getElementById('qa-image-modal').classList.remove('hidden');
  document.getElementById('qa-modal-file-input').value = '';
  
  const preview = document.getElementById('qa-modal-img-preview');
  if (modalSelectedImageBase64) {
    preview.innerHTML = `<img src="${modalSelectedImageBase64}" class="max-h-32 mx-auto rounded"/>`;
  } else {
    preview.innerHTML = `<span class="text-gray-400 text-xs">画像未選択</span>`;
  }
}

document.getElementById('close-qa-img-modal').addEventListener('click', () => {
  document.getElementById('qa-image-modal').classList.add('hidden');
});

document.getElementById('qa-modal-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const base64 = await arrayBufferToBase64(buffer);
    modalSelectedImageBase64 = `data:${file.type};base64,${base64}`;
    document.getElementById('qa-modal-img-preview').innerHTML = `<img src="${modalSelectedImageBase64}" class="max-h-32 mx-auto rounded"/>`;
  } catch (err) {
    alert("画像の読み込みに失敗しました。");
  }
});

document.getElementById('qa-img-remove-btn').addEventListener('click', () => {
  modalSelectedImageBase64 = "";
  document.getElementById('qa-modal-img-preview').innerHTML = `<span class="text-gray-400 text-xs">画像未選択</span>`;
});

document.getElementById('qa-img-save-btn').addEventListener('click', () => {
  if (!modalTargetItemId) return;
  const rowTr = document.querySelector(`tr[data-item-id="${modalTargetItemId}"]`);
  if (rowTr) {
    const btn = rowTr.querySelector('.row-img-btn');
    if (modalSelectedImageBase64) {
      btn.className = "row-img-btn px-2 py-1 rounded text-[10px] font-bold bg-blue-600 text-white";
      btn.innerText = "画像付(変)";
      rowTr.dataset.imgData = modalSelectedImageBase64;
    } else {
      btn.className = "row-img-btn px-2 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700";
      btn.innerText = "画像追加";
      rowTr.dataset.imgData = "";
    }
  }
  document.getElementById('qa-image-modal').classList.add('hidden');
});

// 一問一答表の保存
document.getElementById('save-table-doc-btn').addEventListener('click', async () => {
  if (!currentUser) return;

  const title = document.getElementById('table-name-input').value.trim();
  const importancesStr = document.getElementById('table-importances-input').value.trim();
  if (!title) {
    alert("一問一答集のタイトルを入力してください。");
    return;
  }

  const importances = importancesStr.split(',').map(s => s.trim()).filter(Boolean);
  const rows = document.querySelectorAll('#qa-table-tbody tr');
  const items = [];

  rows.forEach(tr => {
    const id = tr.dataset.itemId;
    const question = tr.querySelector('.row-q').value.trim();
    const answer = tr.querySelector('.row-a').value.trim();
    const importance = tr.querySelector('.row-imp').value;
    const explanation = tr.querySelector('.row-exp').value.trim();
    const questionImage = tr.dataset.imgData || "";

    if (question || answer) {
      items.push({ id, question, questionImage, answer, importance, explanation });
    }
  });

  if (items.length === 0) {
    alert("少なくとも1問以上の問題と解答を入力してください。");
    return;
  }

  const editingId = document.getElementById('editing-table-id').value;
  const tableId = editingId ? editingId : `table_${Date.now()}`;

  try {
    await setDoc(doc(db, "users", currentUser.uid, "questionTables", tableId), {
      title: String(title),
      importances: importances,
      items: items,
      updatedAt: Date.now()
    }, { merge: true });

    alert("一問一答表を保存しました！");
    closeTableRegisterForm();
  } catch (err) {
    alert("保存に失敗しました: " + err.message);
  }
});

// --- 一問一答 演習設定モーダル＆プレイヤー ---
function openTableConfigModal(tableData) {
  activeTableData = tableData;
  document.getElementById('config-target-table-id').value = tableData.id;
  document.getElementById('config-limit-input').value = Math.min(10, tableData.items.length);
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

  // 過去に間違えた問題のみの絞り込み
  if (scope === 'mistaken') {
    items = items.filter(item => {
      const historyKey = `qa_hist_${activeTableData.id}_${item.id}`;
      const lastState = localStorage.getItem(historyKey);
      return lastState === 'incorrect';
    });
    if (items.length === 0) {
      alert("「過去に間違えた問題」として記録されている問題がありません。");
      return;
    }
  }

  // 順番・ランダム
  if (order === 'random') {
    items.sort(() => Math.random() - 0.5);
  }

  // 問題数制限
  exerciseQueue = items.slice(0, limit);
  retryQueue = [];
  currentExerciseIndex = 0;
  exerciseTotalCount = exerciseQueue.length;
  isRetryLoop = false;

  document.getElementById('table-config-modal').classList.add('hidden');
  
  // 画面切り替え
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.remove('hidden');

  document.getElementById('table-player-title').innerText = `${activeTableData.title} (演習中)`;
  document.getElementById('table-exercise-content').classList.remove('hidden');
  document.getElementById('table-exercise-result').classList.add('hidden');

  renderExerciseCurrentItem();
});

function renderExerciseCurrentItem() {
  if (currentExerciseIndex >= exerciseQueue.length) {
    // 現在の周回が終了
    if (retryQueue.length > 0) {
      // 間違えた問題があればリトライ周回へ移行
      exerciseQueue = [...retryQueue];
      retryQueue = [];
      currentExerciseIndex = 0;
      isRetryLoop = true;
      alert("一周目が終了しました！間違えた問題のリトライ周回を開始します。");
      renderExerciseCurrentItem();
      return;
    } else {
      // 完全クリア
      document.getElementById('table-exercise-content').classList.add('hidden');
      document.getElementById('table-exercise-result').classList.remove('hidden');
      document.getElementById('table-result-summary').innerText = `全 ${exerciseTotalCount} 問の演習と復習を完了しました！お疲れ様でした！`;
      return;
    }
  }

  const currentItem = exerciseQueue[currentExerciseIndex];

  document.getElementById('table-progress-count').innerText = `問題 ${currentExerciseIndex + 1} / ${exerciseQueue.length}`;
  document.getElementById('table-loop-badge').innerText = isRetryLoop ? "🔥 リトライ周回" : "通常周回";
  document.getElementById('table-loop-badge').className = isRetryLoop ? "px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold" : "px-2 py-0.5 bg-blue-100 text-blue-800 rounded";

  document.getElementById('t-ex-question').innerText = currentItem.question;
  
  const imgArea = document.getElementById('t-ex-q-image-area');
  imgArea.innerHTML = currentItem.questionImage ? `<img src="${currentItem.questionImage}" class="max-h-40 rounded mx-auto mt-2"/>` : '';

  // 解答エリア非表示＆ボタン初期化
  document.getElementById('t-ex-answer-area').classList.add('hidden');
  document.getElementById('t-ex-show-ans-btn').classList.remove('hidden');
  document.getElementById('t-ex-grade-buttons').classList.add('hidden');

  document.getElementById('t-ex-answer').innerText = currentItem.answer;
  document.getElementById('t-ex-explanation').innerText = currentItem.explanation || "解説なし";
}

document.getElementById('t-ex-show-ans-btn').addEventListener('click', () => {
  document.getElementById('t-ex-answer-area').classList.remove('hidden');
  document.getElementById('t-ex-show-ans-btn').classList.add('hidden');
  document.getElementById('t-ex-grade-buttons').classList.remove('hidden');
});

// 正解ボタン
document.getElementById('t-ex-correct-btn').addEventListener('click', () => {
  const currentItem = exerciseQueue[currentExerciseIndex];
  const historyKey = `qa_hist_${activeTableData.id}_${currentItem.id}`;
  localStorage.setItem(historyKey, 'correct'); // 正解を記録

  currentExerciseIndex++;
  renderExerciseCurrentItem();
});

// 誤答ボタン (リトライ周回の最後に追加)
document.getElementById('t-ex-incorrect-btn').addEventListener('click', () => {
  const currentItem = exerciseQueue[currentExerciseIndex];
  const historyKey = `qa_hist_${activeTableData.id}_${currentItem.id}`;
  localStorage.setItem(historyKey, 'incorrect'); // 誤答を記録

  // 周回の最後にもう一度出題するためリトライキューへ蓄積
  retryQueue.push(currentItem);

  currentExerciseIndex++;
  renderExerciseCurrentItem();
});

document.getElementById('restart-table-ex-btn').addEventListener('click', () => {
  openTableConfigModal(activeTableData);
});

document.getElementById('exit-table-player-btn').addEventListener('click', () => {
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
  clearDocumentView();
});

// --- 通常問題登録・編集の関連補助関数 ---
document.getElementById('btn-nav-register').addEventListener('click', () => openRegisterForm(null));
document.getElementById('cancel-register-btn').addEventListener('click', closeRegisterForm);

function openRegisterForm(docData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('table-player-container').classList.add('hidden');
  document.getElementById('table-register-form-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.remove('hidden');

  if (docData) {
    document.getElementById('form-header-title').innerText = "問題データの編集";
    document.getElementById('editing-doc-id').value = docData.id;
    document.getElementById('problem-name-input').value = docData.title || '';
    document.getElementById('subquestion-input').value = docData.subQuestion || '';
    document.getElementById('subject-input').value = docData.subject || '';
    document.getElementById('unit-input').value = docData.unit || '';
    document.getElementById('tags-input').value = (docData.tags || []).join(' ');
    document.getElementById('q-text-input').value = docData.questionText || '';
    document.getElementById('a-text-input').value = docData.answerText || '';
    currentFormQMaterials = docData.questionMaterials ? [...docData.questionMaterials] : [];
    currentFormAMaterials = docData.answerMaterials ? [...docData.answerMaterials] : [];
  } else {
    document.getElementById('form-header-title').innerText = "新しい問題データの登録";
    document.getElementById('editing-doc-id').value = '';
    document.getElementById('problem-name-input').value = '';
    document.getElementById('subquestion-input').value = '';
    document.getElementById('subject-input').value = '';
    document.getElementById('unit-input').value = '';
    document.getElementById('tags-input').value = '';
    document.getElementById('q-text-input').value = '';
    document.getElementById('a-text-input').value = '';
    currentFormQMaterials = [];
    currentFormAMaterials = [];
  }
  document.getElementById('q-file-input').value = '';
  document.getElementById('a-file-input').value = '';
  updateLivePreviews();
}

function closeRegisterForm() {
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
}

// ファイル処理・プレビュー等の基本共通関数
async function processFiles(fileList) {
  const materials = [];
  if (!fileList || fileList.length === 0) return materials;
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    let targetFile = file;
    let fileName = String(file.name || "attachment");
    let type = 'image';
    const buffer = await targetFile.arrayBuffer();
    const base64 = await arrayBufferToBase64(buffer);
    const compressed = LZString.compressToUTF16(base64);
    materials.push({ fileName, type, data: compressed });
  }
  return materials;
}

function arrayBufferToBase64(buffer) {
  return new Promise((resolve) => {
    const blob = new Blob([buffer]);
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}

document.getElementById('q-file-input').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (files && files.length > 0) {
    const newMats = await processFiles(files);
    currentFormQMaterials.push(...newMats);
    document.getElementById('q-file-input').value = '';
    updateLivePreviews();
  }
});

document.getElementById('a-file-input').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (files && files.length > 0) {
    const newMats = await processFiles(files);
    currentFormAMaterials.push(...newMats);
    document.getElementById('a-file-input').value = '';
    updateLivePreviews();
  }
});

document.getElementById('q-text-input').addEventListener('input', updateLivePreviews);
document.getElementById('a-text-input').addEventListener('input', updateLivePreviews);

async function updateLivePreviews() {
  const qText = document.getElementById('q-text-input').value;
  const aText = document.getElementById('a-text-input').value;
  await renderPreviewPane('q-preview-area', qText, currentFormQMaterials, 'q');
  await renderPreviewPane('a-preview-area', aText, currentFormAMaterials, 'a');
}

async function renderPreviewPane(previewId, textVal, materials, typePrefix) {
  const area = document.getElementById(previewId);
  area.innerHTML = '';
  if (!textVal && (!materials || materials.length === 0)) {
    area.innerHTML = '<span class="text-gray-400">プレビューなし</span>';
    return;
  }
  if (textVal) {
    const div = document.createElement('div');
    div.className = "content-text-box mb-2";
    div.innerText = textVal;
    area.appendChild(div);
  }
  if (materials && materials.length > 0) {
    for (let idx = 0; idx < materials.length; idx++) {
      const item = materials[idx];
      const wrapper = document.createElement('div');
      wrapper.className = "relative border rounded p-1 bg-white mb-2";
      const delBtn = document.createElement('button');
      delBtn.type = "button";
      delBtn.className = "absolute top-2 right-2 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow z-10";
      delBtn.innerText = "✕";
      delBtn.addEventListener('click', async () => {
        if (typePrefix === 'q') currentFormQMaterials.splice(idx, 1);
        else currentFormAMaterials.splice(idx, 1);
        updateLivePreviews();
      });
      wrapper.appendChild(delBtn);

      const container = document.createElement('div');
      container.className = "custom-content-viewer pr-6";
      const buffer = base64ToArrayBuffer(LZString.decompressFromUTF16(item.data));
      const blob = new Blob([buffer]);
      const url = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = url;
      img.className = "content-image";
      container.appendChild(img);
      wrapper.appendChild(container);
      area.appendChild(wrapper);
    }
  }
}

document.getElementById('save-doc-btn').addEventListener('click', async () => {
  if (!currentUser) return;
  const title = document.getElementById('problem-name-input').value.trim();
  const subQuestion = document.getElementById('subquestion-input').value.trim();
  const subject = document.getElementById('subject-input').value.trim();
  const unit = document.getElementById('unit-input').value.trim();
  const qText = document.getElementById('q-text-input').value.trim();
  const aText = document.getElementById('a-text-input').value.trim();

  if (!title && !qText && currentFormQMaterials.length === 0) {
    alert("タイトル、または問題文を入力してください。");
    return;
  }

  const editingId = document.getElementById('editing-doc-id').value;
  const docId = editingId ? editingId : `doc_${Date.now()}`;

  const existingDoc = allDocuments.find(d => d.id === docId);
  const rawPayload = {
    title: String(title || "無題の問題"),
    subQuestion: String(subQuestion || ""),
    subject: String(subject || ""),
    unit: String(unit || ""),
    questionText: String(qText),
    answerText: String(aText),
    updatedAt: Date.now(),
    questionMaterials: currentFormQMaterials || [],
    answerMaterials: currentFormAMaterials || [],
    stats: existingDoc ? (existingDoc.stats || { correct: 0, incorrect: 0 }) : { correct: 0, incorrect: 0 },
    subStats: existingDoc ? (existingDoc.subStats || {}) : {},
    history: existingDoc ? (existingDoc.history || []) : []
  };

  await setDoc(doc(db, "users", currentUser.uid, "documents", docId), rawPayload, { merge: true });
  alert("正常に保存されました！");
  closeRegisterForm();
});

function selectDocument(docData) {
  selectedDocId = docData.id;
  currentDocData = docData;
  document.getElementById('doc-title').innerText = `${docData.title} ${docData.subQuestion ? '('+docData.subQuestion+')' : ''}`;
  document.getElementById('edit-current-btn').classList.remove('hidden');
  
  const hasAnswer = docData.answerText || (docData.answerMaterials && docData.answerMaterials.length > 0);
  if (hasAnswer) toggleAnswerBtn.classList.remove('hidden');
  else toggleAnswerBtn.classList.add('hidden');
  answerPane.classList.add('hidden');
  toggleAnswerBtn.innerText = "💡 解答解説を表示";

  renderContent();
  renderCurrentView();
}

document.getElementById('edit-current-btn').addEventListener('click', () => {
  if (currentDocData) openRegisterForm(currentDocData);
});

async function renderContent() {
  if (!currentDocData) return;
  await renderPaneContent('question-display-area', currentDocData.questionText, currentDocData.questionMaterials);
  await renderPaneContent('answer-display-area', currentDocData.answerText, currentDocData.answerMaterials, "解答解説は登録されていません。");
}

async function renderPaneContentForContainer(displayArea, textVal, materials, emptyMsg = "データはありません。") {
  displayArea.innerHTML = '';
  if (!textVal && (!materials || materials.length === 0)) {
    displayArea.innerHTML = `<div class="text-center text-gray-400 py-10"><p class="text-xs">${emptyMsg}</p></div>`;
    return;
  }
  if (textVal) {
    const textDiv = document.createElement('div');
    textDiv.className = "content-text-box";
    textDiv.innerText = textVal;
    displayArea.appendChild(textDiv);
  }
  if (materials && materials.length > 0) {
    for (let item of materials) {
      const container = document.createElement('div');
      container.className = "custom-content-viewer border rounded-lg p-2 bg-white";
      const buffer = base64ToArrayBuffer(LZString.decompressFromUTF16(item.data));
      const blob = new Blob([buffer]);
      const url = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = url;
      img.className = "content-image";
      container.appendChild(img);
      displayArea.appendChild(container);
    }
  }
}

async function renderPaneContent(containerId, textVal, materials, emptyMsg = "データはありません。") {
  const displayArea = document.getElementById(containerId);
  await renderPaneContentForContainer(displayArea, textVal, materials, emptyMsg);
}

function clearDocumentView() {
  selectedDocId = null;
  currentDocData = null;
  document.getElementById('doc-title').innerText = '左のリストから問題を選択してください';
  document.getElementById('edit-current-btn').classList.add('hidden');
  toggleAnswerBtn.classList.add('hidden');
  answerPane.classList.add('hidden');
  document.getElementById('question-display-area').innerHTML = '<div class="text-center text-gray-400 py-20"><p>問題データが選択されていません。</p></div>';
  document.getElementById('answer-display-area').innerHTML = '<div class="text-center text-gray-400 py-20"><p>解答解説はここに表示されます。</p></div>';
}
