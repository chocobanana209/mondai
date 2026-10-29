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
  serverTimestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase設定
const firebaseConfig = {
  apiKey: "AIzaSyAat1qoigRFAQtIwCHweMeO6P0qTmR10_8",
  authDomain: "mondai-choco.firebaseapp.com",
  projectId: "mondai-choco",
  appId: "1:41081435290:web:f5237845a870e11e719b23"
};

let app, auth, db;
let currentUser = null;
let selectedDocId = null;
let activeTab = 'question'; // 'question' | 'answer'
let currentDocData = null;
let allDocuments = [];
let allCollections = [];
let currentMainView = 'documents'; // 'documents' | 'collections'

// リアルタイムリスナーのアンサブスクライブ関数保管用
let unsubscribeDocs = null;
let unsubscribeCollections = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  setPersistence(auth, browserLocalPersistence).catch(console.error);
} catch (e) {
  console.error("Firebase init failed:", e);
}

// 認証状態の監視
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  updateAuthUI(user);
  
  if (user) {
    setupRealtimeListeners();
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

  if (user) {
    authStatus.innerText = "ログイン中";
    authStatus.className = "px-2 py-0.5 bg-green-100 text-green-800 rounded text-[10px] font-semibold";
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    userInfo.classList.remove('hidden');
    userPhoto.src = user.photoURL || 'https://via.placeholder.com/40';
    userName.innerText = user.displayName || user.email;
    mainContent.classList.remove('opacity-50', 'pointer-events-none');
  } else {
    authStatus.innerText = "未ログイン";
    authStatus.className = "px-2 py-0.5 bg-gray-100 text-gray-800 rounded text-[10px] font-semibold";
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    userInfo.classList.add('hidden');
    mainContent.classList.add('opacity-50', 'pointer-events-none');
  }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); } catch (e) { alert(e.message); }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// サイドバー折りたたみ
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

// 自動同期（リアルタイムリスナー）
function setupRealtimeListeners() {
  detachRealtimeListeners();

  const qDocs = query(collection(db, "users", currentUser.uid, "documents"), orderBy("updatedAt", "desc"));
  unsubscribeDocs = onSnapshot(qDocs, (snapshot) => {
    allDocuments = [];
    snapshot.forEach(d => allDocuments.push({ id: d.id, ...d.data() }));
    renderCurrentView();
    if (selectedDocId) {
      const updated = allDocuments.find(d => d.id === selectedDocId);
      if (updated) {
        currentDocData = updated;
        updateSidebarStats();
      }
    }
  });

  const qColls = query(collection(db, "users", currentUser.uid, "collections"), orderBy("updatedAt", "desc"));
  unsubscribeCollections = onSnapshot(qColls, (snapshot) => {
    allCollections = [];
    snapshot.forEach(d => allCollections.push({ id: d.id, ...d.data() }));
    if (currentMainView === 'collections') renderCurrentView();
  });
}

function detachRealtimeListeners() {
  if (unsubscribeDocs) unsubscribeDocs();
  if (unsubscribeCollections) unsubscribeCollections();
}

// ビュー切り替え
document.getElementById('nav-docs').addEventListener('click', () => {
  currentMainView = 'documents';
  document.getElementById('nav-docs').className = "flex-1 py-1.5 text-xs font-bold text-blue-600 bg-white rounded shadow-sm";
  document.getElementById('nav-collections').className = "flex-1 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700";
  renderCurrentView();
});

document.getElementById('nav-collections').addEventListener('click', () => {
  currentMainView = 'collections';
  document.getElementById('nav-collections').className = "flex-1 py-1.5 text-xs font-bold text-blue-600 bg-white rounded shadow-sm";
  document.getElementById('nav-docs').className = "flex-1 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700";
  renderCurrentView();
});

function renderCurrentView() {
  if (currentMainView === 'documents') renderDocumentList(allDocuments);
  else renderCollectionList(allCollections);
}

function renderDocumentList(docs) {
  const container = document.getElementById('sidebar-list');
  container.innerHTML = docs.length === 0 ? '<p class="text-gray-400 text-xs italic">問題がありません。</p>' : '';

  docs.forEach(data => {
    const item = document.createElement('div');
    const isSelected = data.id === selectedDocId;
    item.className = `p-2.5 rounded-lg border cursor-pointer text-xs transition ${isSelected ? 'bg-blue-50 border-blue-400 font-semibold' : 'bg-white hover:bg-slate-50 border-slate-200'}`;
    
    item.innerHTML = `
      <div class="flex justify-between items-center mb-1">
        <span class="truncate text-slate-800">${data.title}</span>
        <div class="flex gap-1">
          <button class="edit-btn text-blue-500 hover:text-blue-700 px-1">編集</button>
          <button class="del-btn text-red-400 hover:text-red-600 px-1">削除</button>
        </div>
      </div>
      <div class="flex justify-between text-[10px] text-gray-500">
        <span>○: ${data.stats?.correct || 0} / ×: ${data.stats?.incorrect || 0}</span>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('del-btn') || e.target.classList.contains('edit-btn')) return;
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

function renderCollectionList(colls) {
  const container = document.getElementById('sidebar-list');
  container.innerHTML = colls.length === 0 ? '<p class="text-gray-400 text-xs italic">問題集がありません。</p>' : '';

  colls.forEach(c => {
    const item = document.createElement('div');
    item.className = 'p-2.5 rounded-lg border bg-white hover:bg-slate-50 border-slate-200 cursor-pointer text-xs transition';
    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-slate-800">${c.name}</span>
        <button class="del-coll text-red-400 hover:text-red-600 px-1">削除</button>
      </div>
    `;

    item.querySelector('.del-coll').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`問題集「${c.name}」を削除しますか？`)) {
        await deleteDoc(doc(db, "users", currentUser.uid, "collections", c.id));
      }
    });

    container.appendChild(item);
  });
}

// 新規問題集作成
document.getElementById('create-collection-btn').addEventListener('click', async () => {
  const name = prompt("問題集の名前を入力してください:");
  if (!name || !currentUser) return;
  const collId = `coll_${Date.now()}`;
  await setDoc(doc(db, "users", currentUser.uid, "collections", collId), {
    name: name,
    updatedAt: serverTimestamp()
  });
});

// ファイル変換・保存処理
async function processFiles(fileList) {
  const materials = [];
  for (let file of fileList) {
    const buffer = await file.arrayBuffer();
    const base64 = await arrayBufferToBase64(buffer);
    const compressed = LZString.compressToUTF16(base64);

    let type = 'raw';
    if (file.name.match(/\.docx$/i)) type = 'docx';
    else if (file.name.match(/\.pdf$/i)) type = 'pdf';
    else if (file.type.startsWith('image/')) type = 'image';

    materials.push({
      fileName: file.name,
      type: type,
      data: compressed
    });
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
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// 登録・編集フォーム処理
document.getElementById('btn-nav-register').addEventListener('click', () => openRegisterForm());
document.getElementById('cancel-register-btn').addEventListener('click', closeRegisterForm);

function openRegisterForm(docData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.remove('hidden');

  if (docData) {
    document.getElementById('form-header-title').innerText = "問題データの編集";
    document.getElementById('editing-doc-id').value = docData.id;
    document.getElementById('problem-name-input').value = docData.title || '';
    document.getElementById('tags-input').value = (docData.tags || []).join(' ');
    document.getElementById('q-text-input').value = docData.questionText || '';
    document.getElementById('a-text-input').value = docData.answerText || '';
  } else {
    document.getElementById('form-header-title').innerText = "新しい問題データの登録";
    document.getElementById('editing-doc-id').value = '';
    document.getElementById('problem-name-input').value = '';
    document.getElementById('tags-input').value = '';
    document.getElementById('q-text-input').value = '';
    document.getElementById('a-text-input').value = '';
  }
}

function closeRegisterForm() {
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
}

document.getElementById('save-doc-btn').addEventListener('click', async () => {
  if (!currentUser) return;

  const title = document.getElementById('problem-name-input').value.trim();
  if (!title) return alert("タイトルを入力してください。");

  const editingId = document.getElementById('editing-doc-id').value;
  const docId = editingId || `doc_${Date.now()}`;

  const qFiles = document.getElementById('q-file-input').files;
  const aFiles = document.getElementById('a-file-input').files;

  const qMaterials = await processFiles(qFiles);
  const aMaterials = await processFiles(aFiles);

  const tags = document.getElementById('tags-input').value.split(/[, \s]+/)
    .map(t => t.replace(/^#/, '').trim()).filter(t => t.length > 0);

  const payload = {
    title: title,
    tags: tags,
    questionText: document.getElementById('q-text-input').value,
    answerText: document.getElementById('a-text-input').value,
    updatedAt: serverTimestamp()
  };

  // 編集時、新しい添付がない場合は以前のデータを維持
  if (qMaterials.length > 0 || !editingId) payload.questionMaterials = qMaterials;
  if (aMaterials.length > 0 || !editingId) payload.answerMaterials = aMaterials;

  await setDoc(doc(db, "users", currentUser.uid, "documents", docId), payload, { merge: true });

  alert("保存しました！");
  closeRegisterForm();
});

// 問題の選択と表示処理
function selectDocument(docData) {
  selectedDocId = docData.id;
  currentDocData = docData;

  document.getElementById('doc-title').innerText = docData.title;
  document.getElementById('edit-current-btn').classList.remove('hidden');
  
  if (docData.answerText || (docData.answerMaterials && docData.answerMaterials.length > 0)) {
    document.getElementById('tab-answer').classList.remove('hidden');
  } else {
    document.getElementById('tab-answer').classList.add('hidden');
    activeTab = 'question';
  }

  updateSidebarStats();
  renderContent();
  renderCurrentView();
}

document.getElementById('edit-current-btn').addEventListener('click', () => {
  if (currentDocData) openRegisterForm(currentDocData);
});

function updateSidebarStats() {
  if (!currentDocData) return;
  document.getElementById('sidebar-stats-card').classList.remove('hidden');
  document.getElementById('sidebar-target-title').innerText = currentDocData.title;
  document.getElementById('stat-correct').innerText = currentDocData.stats?.correct || 0;
  document.getElementById('stat-incorrect').innerText = currentDocData.stats?.incorrect || 0;
}

// サイドバーからの正誤記録
document.getElementById('btn-record-correct').addEventListener('click', () => recordResult('correct'));
document.getElementById('btn-record-incorrect').addEventListener('click', () => recordResult('incorrect'));

async function recordResult(type) {
  if (!currentDocData || !currentUser) return;
  const stats = currentDocData.stats || { correct: 0, incorrect: 0 };
  if (type === 'correct') stats.correct++;
  else stats.incorrect++;

  currentDocData.stats = stats;
  updateSidebarStats();

  await setDoc(doc(db, "users", currentUser.uid, "documents", currentDocData.id), { stats: stats }, { merge: true });
}

// タブ切り替え
document.getElementById('tab-question').addEventListener('click', () => {
  activeTab = 'question';
  updateTabStyle();
  renderContent();
});

document.getElementById('tab-answer').addEventListener('click', () => {
  activeTab = 'answer';
  updateTabStyle();
  renderContent();
});

function updateTabStyle() {
  const qTab = document.getElementById('tab-question');
  const aTab = document.getElementById('tab-answer');
  if (activeTab === 'question') {
    qTab.className = "px-3 py-1 font-bold text-blue-600 border-b-2 border-blue-600 text-xs focus:outline-none";
    aTab.className = "px-3 py-1 font-medium text-gray-500 hover:text-gray-700 text-xs focus:outline-none";
  } else {
    aTab.className = "px-3 py-1 font-bold text-blue-600 border-b-2 border-blue-600 text-xs focus:outline-none";
    qTab.className = "px-3 py-1 font-medium text-gray-500 hover:text-gray-700 text-xs focus:outline-none";
  }
}

// 素材レンダリング
async function renderContent() {
  if (!currentDocData) return;
  const displayArea = document.getElementById('content-display-area');
  displayArea.innerHTML = '';

  const textVal = activeTab === 'question' ? currentDocData.questionText : currentDocData.answerText;
  const materials = activeTab === 'question' ? currentDocData.questionMaterials : currentDocData.answerMaterials;

  // 1. テキスト表示
  if (textVal) {
    const textDiv = document.createElement('div');
    textDiv.className = "p-3 bg-slate-50 border rounded-lg text-sm whitespace-pre-wrap font-sans";
    textDiv.innerText = textVal;
    displayArea.appendChild(textDiv);
  }

  // 2. 添付素材表示 (Word, PDF, 画像)
  if (materials && materials.length > 0) {
    for (let item of materials) {
      const container = document.createElement('div');
      container.className = "custom-content-viewer border rounded-lg p-2";

      const buffer = base64ToArrayBuffer(LZString.decompressFromUTF16(item.data));

      if (item.type === 'docx') {
        await docx.renderAsync(buffer, container);
      } else if (item.type === 'image') {
        const blob = new Blob([buffer]);
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = url;
        img.className = "content-image";
        container.appendChild(img);
      } else if (item.type === 'pdf') {
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.className = "pdf-page-canvas";
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          container.appendChild(canvas);
        }
      }

      displayArea.appendChild(container);
    }
  }
}

function clearDocumentView() {
  selectedDocId = null;
  currentDocData = null;
  document.getElementById('doc-title').innerText = '左のリストから問題を選択してください';
  document.getElementById('sidebar-stats-card').classList.add('hidden');
  document.getElementById('edit-current-btn').classList.add('hidden');
  document.getElementById('content-display-area').innerHTML = '<div class="text-center text-gray-400 py-20"><p>データを選択してください。</p></div>';
}
