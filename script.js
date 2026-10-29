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
let currentMainView = 'documents'; 

let collectionPlayList = [];
let collectionPlayIndex = 0;

let unsubscribeDocs = null;
let unsubscribeCollections = null;

let pendingSubResults = {};

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
  if (!currentDocData && currentMainView !== 'collections') {
    alert("まず問題を選択するか、問題集を開いてください。");
    return;
  }
  document.getElementById('stats-modal').classList.remove('hidden');
  updateModalStats();
});

document.getElementById('close-stats-modal').addEventListener('click', () => {
  document.getElementById('stats-modal').classList.add('hidden');
});

// 単体問題用解答解説ペインのトグル
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

// 問題集プレイ用解答解説ペインのトグル
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

function setupRealtimeListeners() {
  detachRealtimeListeners();
  if (!currentUser) return;

  const qDocs = query(collection(db, "users", currentUser.uid, "documents"), orderBy("updatedAt", "desc"));
  unsubscribeDocs = onSnapshot(qDocs, (snapshot) => {
    allDocuments = [];
    snapshot.forEach(d => allDocuments.push({ id: d.id, ...d.data() }));
    renderCurrentView();
    updateSubjectAndUnitDatalists();
    
    if (selectedDocId) {
      const updated = allDocuments.find(d => d.id === selectedDocId);
      if (updated) {
        currentDocData = updated;
        updateModalStats();
      }
    }
  }, (error) => {
    console.error("ドキュメントリスナーエラー:", error);
  });

  const qColls = query(collection(db, "users", currentUser.uid, "collections"), orderBy("updatedAt", "desc"));
  unsubscribeCollections = onSnapshot(qColls, (snapshot) => {
    allCollections = [];
    snapshot.forEach(d => allCollections.push({ id: d.id, ...d.data() }));
    if (currentMainView === 'collections') renderCurrentView();
  }, (error) => {
    console.error("問題集リスナーエラー:", error);
  });
}

function detachRealtimeListeners() {
  if (unsubscribeDocs) unsubscribeDocs();
  if (unsubscribeCollections) unsubscribeCollections();
}

function updateSubjectAndUnitDatalists() {
  const subjects = [...new Set(allDocuments.map(d => d.subject).filter(Boolean))];
  const units = [...new Set(allDocuments.map(d => d.unit).filter(Boolean))];

  const subList = document.getElementById('subject-list');
  const unitList = document.getElementById('unit-list');
  
  if (subList) subList.innerHTML = subjects.map(s => `<option value="${s}">`).join('');
  if (unitList) unitList.innerHTML = units.map(u => `<option value="${u}">`).join('');
}

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
  container.innerHTML = docs.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題が登録されていません。</p>' : '';

  docs.forEach(data => {
    const item = document.createElement('div');
    const isSelected = data.id === selectedDocId;
    item.className = `p-2.5 rounded-lg border cursor-pointer text-xs transition ${isSelected ? 'bg-blue-50 border-blue-400 font-semibold' : 'bg-white hover:bg-slate-50 border-slate-200'}`;
    
    const subUnitBadge = (data.subject || data.unit || data.subQuestion) ? `
      <div class="text-[10px] text-blue-600 font-medium mb-1 truncate">
        ${data.subject ? `[${data.subject}]` : ''} ${data.unit || ''} ${data.subQuestion ? `(${data.subQuestion})` : ''}
      </div>` : '';

    item.innerHTML = `
      <div class="flex justify-between items-center mb-1">
        <span class="truncate text-slate-800 font-bold flex-1 mr-1" title="${data.title}">${data.title}</span>
        <div class="flex gap-1">
          <button class="edit-btn text-blue-500 hover:text-blue-700 px-1">編集</button>
          <button class="del-btn text-red-400 hover:text-red-600 px-1">削除</button>
        </div>
      </div>
      ${subUnitBadge}
      <div class="flex justify-between text-[10px] text-gray-500">
        <span>正解: ${data.stats?.correct || 0} / 誤答: ${data.stats?.incorrect || 0}</span>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('del-btn') || e.target.classList.contains('edit-btn')) return;
      selectDocument(data);
    });

    item.querySelector('.del-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`「${data.title}」を削除しますか？`)) {
        try {
          await deleteDoc(doc(db, "users", currentUser.uid, "documents", data.id));
          if (selectedDocId === data.id) clearDocumentView();
        } catch (err) {
          alert("削除に失敗しました: " + err.message);
        }
      }
    });

    item.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openRegisterForm(data);
    });

    container.appendChild(item);
  });
}

// 誤答整理ロジックに基づく問題リスト生成ヘルパー
function getMistakeReviewList() {
  // 1. 各問題の「最後の履歴」または「過去の誤答有無」を分析
  let incorrectLast = []; // 最終解答が誤答のもの
  let onceIncorrectNowCorrect = []; // 最終解答は正答だが過去に間違えたもの

  allDocuments.forEach(doc => {
    const history = doc.history || [];
    if (history.length === 0) return;

    // 最新の履歴を取得
    const lastEntry = history[history.length - 1];
    const hasIncorrect = history.some(h => h.type === 'incorrect');

    if (lastEntry.type === 'incorrect') {
      // 最終解答が誤答
      // 最後の誤答の日時(timestamp)を取得 (古い順に並べるための値)
      const lastIncorrectTime = new Date(lastEntry.timestamp || 0).getTime();
      incorrectLast.push({ doc, time: lastIncorrectTime });
    } else if (lastEntry.type === 'correct' && hasIncorrect) {
      // 最終解答は正答だが過去に間違いがある
      // 最後の正解の日時 (新しい順に並べるための値)
      const lastCorrectTime = new Date(lastEntry.timestamp || 0).getTime();
      onceIncorrectNowCorrect.push({ doc, time: lastCorrectTime });
    }
  });

  // ルール適用
  // ① 最終解答が誤答のものを古い順 (昇順)
  incorrectLast.sort((a, b) => a.time - b.time);

  // ② 最終解答は正答でも過去間違えた問題を最終解答が新しい順 (降順)
  onceIncorrectNowCorrect.sort((a, b) => b.time - a.time);

  return [...incorrectLast.map(item => item.doc), ...onceIncorrectNowCorrect.map(item => item.doc)];
}

function renderCollectionList(colls) {
  const container = document.getElementById('sidebar-list');
  container.innerHTML = '';

  // 1. 【誤答整理】を常に一番上に固定表示
  const mistakeList = getMistakeReviewList();
  const mistakeCard = document.createElement('div');
  mistakeCard.className = 'p-3 rounded-lg border bg-amber-50 hover:bg-amber-100 border-amber-300 cursor-pointer text-xs transition space-y-2 shadow-xs';
  mistakeCard.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="font-bold text-amber-900 text-sm flex items-center gap-1">
        <span>🔥 誤答整理</span>
      </span>
      <span class="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold">自動生成</span>
    </div>
    <div class="text-[10px] text-amber-700">復習対象問題: ${mistakeList.length} 問</div>
    <div class="flex gap-1 pt-1">
      <button class="play-mistake-seq flex-1 bg-amber-600 hover:bg-amber-700 text-white py-1 rounded font-bold">順番に出題</button>
      <button class="play-mistake-rnd flex-1 bg-orange-600 hover:bg-orange-700 text-white py-1 rounded font-bold">ランダム出題</button>
    </div>
  `;

  mistakeCard.querySelector('.play-mistake-seq').addEventListener('click', (e) => {
    e.stopPropagation();
    startCustomCollectionPlay({ name: "誤答整理", documentIds: mistakeList.map(d => d.id) }, 'sequential');
  });

  mistakeCard.querySelector('.play-mistake-rnd').addEventListener('click', (e) => {
    e.stopPropagation();
    startCustomCollectionPlay({ name: "誤答整理", documentIds: mistakeList.map(d => d.id) }, 'random');
  });

  container.appendChild(mistakeCard);

  // 2. 通常の問題集リスト
  colls.forEach(c => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border bg-white hover:bg-slate-50 border-slate-200 cursor-pointer text-xs transition space-y-2';
    
    const docCount = c.documentIds ? c.documentIds.length : 0;

    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-slate-800 text-sm">${c.name}</span>
        <div class="flex gap-1">
          <button class="edit-coll text-blue-500 hover:text-blue-700 px-1">編集</button>
          <button class="del-coll text-red-400 hover:text-red-600 px-1">削除</button>
        </div>
      </div>
      <div class="text-[10px] text-gray-500">登録問題数: ${docCount} 問</div>
      <div class="flex gap-1 pt-1">
        <button class="play-seq flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1 rounded font-bold">順番に出題</button>
        <button class="play-rnd flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1 rounded font-bold">ランダム出題</button>
      </div>
    `;

    item.querySelector('.play-seq').addEventListener('click', (e) => {
      e.stopPropagation();
      startCollectionPlay(c, 'sequential');
    });

    item.querySelector('.play-rnd').addEventListener('click', (e) => {
      e.stopPropagation();
      startCollectionPlay(c, 'random');
    });

    item.querySelector('.del-coll').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`問題集「${c.name}」を削除しますか？`)) {
        try {
          await deleteDoc(doc(db, "users", currentUser.uid, "collections", c.id));
        } catch (err) {
          alert("削除に失敗しました: " + err.message);
        }
      }
    });

    item.querySelector('.edit-coll').addEventListener('click', (e) => {
      e.stopPropagation();
      openCollectionEditorModal(c);
    });

    container.appendChild(item);
  });
}

function openCollectionEditorModal(collData = null) {
  const modal = document.getElementById('collection-edit-modal');
  const titleEl = document.getElementById('coll-modal-title');
  const idEl = document.getElementById('editing-coll-id');
  const nameEl = document.getElementById('coll-name-input');
  const checkboxListEl = document.getElementById('coll-problems-checkbox-list');

  modal.classList.remove('hidden');
  checkboxListEl.innerHTML = '';

  if (collData) {
    titleEl.innerText = "問題集の編集";
    idEl.value = collData.id;
    nameEl.value = collData.name;
  } else {
    titleEl.innerText = "新しい問題集の作成";
    idEl.value = '';
    nameEl.value = '';
  }

  const currentIds = collData && collData.documentIds ? collData.documentIds : [];

  if (allDocuments.length === 0) {
    checkboxListEl.innerHTML = '<p class="text-gray-400 text-xs">登録されている問題がありません。</p>';
    return;
  }

  allDocuments.forEach(doc => {
    const isChecked = currentIds.includes(doc.id) ? 'checked' : '';
    const div = document.createElement('label');
    div.className = "flex items-center gap-2 p-1 hover:bg-slate-100 rounded cursor-pointer text-xs";
    div.innerHTML = `
      <input type="checkbox" value="${doc.id}" ${isChecked} class="coll-prob-checkbox rounded text-blue-600 focus:ring-0">
      <span class="truncate flex-1">${doc.title} ${doc.subQuestion ? '('+doc.subQuestion+')' : ''}</span>
      <span class="text-[10px] text-gray-400">${doc.subject || ''}</span>
    `;
    checkboxListEl.appendChild(div);
  });
}

document.getElementById('close-coll-modal').addEventListener('click', () => {
  document.getElementById('collection-edit-modal').classList.add('hidden');
});

document.getElementById('create-collection-btn').addEventListener('click', () => {
  if (!currentUser) return;
  openCollectionEditorModal(null);
});

document.getElementById('save-coll-modal-btn').addEventListener('click', async () => {
  const collId = document.getElementById('editing-coll-id').value || `coll_${Date.now()}`;
  const collName = document.getElementById('coll-name-input').value.trim();

  if (!collName) {
    alert("問題集の名前を入力してください。");
    return;
  }

  const checkboxes = document.querySelectorAll('.coll-prob-checkbox:checked');
  const selectedIds = Array.from(checkboxes).map(cb => cb.value);

  try {
    await setDoc(doc(db, "users", currentUser.uid, "collections", collId), {
      name: collName,
      documentIds: selectedIds,
      updatedAt: Date.now()
    }, { merge: true });

    alert("問題集を保存しました！");
    document.getElementById('collection-edit-modal').classList.add('hidden');
  } catch (err) {
    alert("保存に失敗しました: " + err.message);
  }
});

function startCollectionPlay(collection, mode) {
  if (!collection.documentIds || collection.documentIds.length === 0) {
    alert("この問題集には問題が登録されていません。");
    return;
  }

  let list = collection.documentIds.map(id => allDocuments.find(d => d.id === id)).filter(Boolean);
  startCustomCollectionPlay({ name: collection.name, documentIds: list.map(d => d.id) }, mode);
}

function startCustomCollectionPlay(collection, mode) {
  let list = collection.documentIds.map(id => allDocuments.find(d => d.id === id)).filter(Boolean);
  if (list.length === 0) {
    alert("対象となる問題がありません。");
    return;
  }

  if (mode === 'random') {
    list.sort(() => Math.random() - 0.5);
  }

  collectionPlayList = list;
  collectionPlayIndex = 0;
  currentCollectionData = collection;

  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.remove('hidden');

  document.getElementById('collection-player-title').innerText = `${collection.name} (${mode === 'random' ? 'ランダム出題' : '順番に出題'})`;
  renderCollectionPlayerCurrent();
}

async function renderCollectionPlayerCurrent() {
  const qContainer = document.getElementById('coll-q-display-area');
  const aContainer = document.getElementById('coll-a-display-area');
  qContainer.innerHTML = '';
  aContainer.innerHTML = '';

  if (collectionPlayIndex >= collectionPlayList.length) {
    document.getElementById('collection-player-content').innerHTML = `
      <div class="text-center py-20 space-y-4">
        <h3 class="text-lg font-bold text-slate-800">🎉 問題集をすべてクリアしました！</h3>
        <button id="restart-coll-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-xs font-bold">最初からやり直す</button>
      </div>
    `;
    document.getElementById('restart-coll-btn').addEventListener('click', () => {
      collectionPlayIndex = 0;
      renderCollectionPlayerCurrent();
    });
    return;
  }

  const docData = collectionPlayList[collectionPlayIndex];
  selectedDocId = docData.id;
  currentDocData = docData;

  document.getElementById('coll-progress-badge').innerText = `${collectionPlayIndex + 1} / ${collectionPlayList.length}`;

  // 解答解説の有無チェック
  const hasAnswer = docData.answerText || (docData.answerMaterials && docData.answerMaterials.length > 0);
  if (hasAnswer) {
    toggleCollAnswerBtn.classList.remove('hidden');
  } else {
    toggleCollAnswerBtn.classList.add('hidden');
    collAnswerPane.classList.add('hidden');
  }
  collAnswerPane.classList.add('hidden');
  toggleCollAnswerBtn.innerText = "💡 解答解説を表示";

  await renderPaneContentForContainer(qContainer, docData.questionText, docData.questionMaterials);
  await renderPaneContentForContainer(aContainer, docData.answerText, docData.answerMaterials, "解答解説はありません。");
}

document.getElementById('coll-next-btn').addEventListener('click', () => {
  collectionPlayIndex++;
  renderCollectionPlayerCurrent();
});

document.getElementById('exit-collection-btn').addEventListener('click', () => {
  document.getElementById('collection-player-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
  clearDocumentView();
});

async function processFiles(fileList) {
  const materials = [];
  if (!fileList || fileList.length === 0) return materials;

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (!file) continue;

    let targetFile = file;
    let fileName = String(file.name || "attachment");
    let type = 'raw';

    const isHeic = fileName.match(/\.heic$/i) || file.type === 'image/heic' || file.type === 'image/heif';
    
    if (isHeic && typeof heic2any !== 'undefined') {
      try {
        const convertedBlob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
        targetFile = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        fileName = fileName.replace(/\.[^/.]+$/, '') + '.jpg';
      } catch (e) {
        throw new Error(`ファイル「${file.name}」のHEIC形式解析に失敗しました。`);
      }
    }

    try {
      const buffer = await targetFile.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) throw new Error(`ファイル「${fileName}」のデータが空です。`);

      const base64 = await arrayBufferToBase64(buffer);
      const compressed = LZString.compressToUTF16(base64);

      if (fileName.match(/\.docx$/i)) type = 'docx';
      else if (fileName.match(/\.pdf$/i)) type = 'pdf';
      else if (targetFile.type.startsWith('image/') || fileName.match(/\.(jpg|jpeg|png|webp)$/i)) {
        type = 'image';
        if (!fileName.match(/\.jpe?g$/i)) fileName = fileName.replace(/\.[^/.]+$/, '') + '.jpg';
      } else {
        throw new Error(`ファイル「${fileName}」はサポートされていない形式です。`);
      }

      materials.push({ fileName: String(fileName), type: String(type), data: String(compressed) });
    } catch (err) {
      throw new Error(`[読み込み失敗] ${err.message}`);
    }
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

document.getElementById('btn-nav-register').addEventListener('click', () => openRegisterForm());
document.getElementById('cancel-register-btn').addEventListener('click', closeRegisterForm);

function openRegisterForm(docData = null) {
  document.getElementById('view-mode-container').classList.add('hidden');
  document.getElementById('collection-player-container').classList.add('hidden');
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
  }
  updateLivePreviews();
}

function closeRegisterForm() {
  document.getElementById('register-form-container').classList.add('hidden');
  document.getElementById('view-mode-container').classList.remove('hidden');
}

async function updateLivePreviews() {
  const qText = document.getElementById('q-text-input').value;
  const aText = document.getElementById('a-text-input').value;
  const qFiles = document.getElementById('q-file-input').files;
  const aFiles = document.getElementById('a-file-input').files;

  await renderPreviewPane('q-preview-area', qText, qFiles);
  await renderPreviewPane('a-preview-area', aText, aFiles);
}

document.getElementById('q-text-input').addEventListener('input', updateLivePreviews);
document.getElementById('a-text-input').addEventListener('input', updateLivePreviews);
document.getElementById('q-file-input').addEventListener('change', updateLivePreviews);
document.getElementById('a-file-input').addEventListener('change', updateLivePreviews);

async function renderPreviewPane(previewId, textVal, files) {
  const area = document.getElementById(previewId);
  area.innerHTML = '';

  if (!textVal && (!files || files.length === 0)) {
    area.innerHTML = '<span class="text-gray-400">プレビューなし</span>';
    return;
  }

  if (textVal) {
    const div = document.createElement('div');
    div.className = "content-text-box mb-2";
    div.innerText = textVal;
    area.appendChild(div);
  }

  if (files && files.length > 0) {
    try {
      const tempMaterials = await processFiles(files);
      for (let item of tempMaterials) {
        const container = document.createElement('div');
        container.className = "custom-content-viewer border rounded p-1 bg-white mb-2";
        const buffer = base64ToArrayBuffer(LZString.decompressFromUTF16(item.data));

        if (item.type === 'docx') {
          await docx.renderAsync(buffer, container, null, {
            inWrapper: true,
            ignoreWidth: true,
            ignoreHeight: true,
            renderChanges: false,
            defaultFont: "MS Mincho"
          });
          fixWordListNumbers(container);
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
            const viewport = page.getViewport({ scale: 1.0 });
            const canvas = document.createElement('canvas');
            canvas.className = "pdf-page-canvas";
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            container.appendChild(canvas);
          }
        }
        area.appendChild(container);
      }
    } catch (e) {
      area.innerHTML += `<p class="text-red-500 text-[10px]">プレビュー生成エラー: ${e.message}</p>`;
    }
  }
}

function fixWordListNumbers(container) {
  setTimeout(() => {
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeValue.trim().match(/^[(（]1[)）]|^1\./)) {
        textNodes.push(node);
      }
    }
    textNodes.forEach((node, index) => {
      const num = index + 1;
      node.nodeValue = node.nodeValue.replace(/^[(（]1[)）]/, `(${num})`).replace(/^1\./, `${num}.`);
    });
  }, 30);
}

document.getElementById('save-doc-btn').addEventListener('click', async () => {
  if (!currentUser) {
    alert("ログインしていません。");
    return;
  }

  const title = document.getElementById('problem-name-input').value.trim();
  const subQuestion = document.getElementById('subquestion-input').value.trim();
  const subject = document.getElementById('subject-input').value.trim();
  const unit = document.getElementById('unit-input').value.trim();
  const qText = document.getElementById('q-text-input').value.trim();
  const aText = document.getElementById('a-text-input').value.trim();
  
  const qFiles = document.getElementById('q-file-input').files;
  const aFiles = document.getElementById('a-file-input').files;

  if (!title && !qText && (!qFiles || qFiles.length === 0)) {
    alert("タイトル、または問題文・添付ファイルのいずれかを入力・選択してください。");
    return;
  }

  const editingId = document.getElementById('editing-doc-id').value;
  const docId = editingId || `doc_${Date.now()}`;

  try {
    const qMaterials = await processFiles(qFiles);
    const aMaterials = await processFiles(aFiles);

    const tags = document.getElementById('tags-input').value.split(/[, \s]+/)
      .map(t => t.replace(/^#/, '').trim())
      .filter(t => t.length > 0);

    const rawPayload = {
      title: String(title || "無題の問題"),
      subQuestion: String(subQuestion || ""),
      subject: String(subject || ""),
      unit: String(unit || ""),
      tags: tags,
      questionText: String(qText),
      answerText: String(aText),
      updatedAt: Date.now(),
      questionMaterials: qMaterials || [],
      answerMaterials: aMaterials || []
    };

    const cleanPayload = JSON.parse(JSON.stringify(rawPayload));
    await setDoc(doc(db, "users", currentUser.uid, "documents", docId), cleanPayload, { merge: true });

    alert("正常に保存されました！");
    closeRegisterForm();
  } catch (error) {
    console.error("保存失敗:", error);
    alert(`保存に失敗しました: ${error.message}`);
  }
});

function selectDocument(docData) {
  selectedDocId = docData.id;
  currentDocData = docData;

  document.getElementById('doc-title').innerText = `${docData.title} ${docData.subQuestion ? '('+docData.subQuestion+')' : ''}`;
  document.getElementById('edit-current-btn').classList.remove('hidden');

  const hasAnswer = docData.answerText || (docData.answerMaterials && docData.answerMaterials.length > 0);
  if (hasAnswer) {
    toggleAnswerBtn.classList.remove('hidden');
  } else {
    toggleAnswerBtn.classList.add('hidden');
    answerPane.classList.add('hidden');
  }

  answerPane.classList.add('hidden');
  toggleAnswerBtn.innerText = "💡 解答解説を表示";

  updateModalStats();
  renderContent();
  renderCurrentView();
}

document.getElementById('edit-current-btn').addEventListener('click', () => {
  if (currentDocData) openRegisterForm(currentDocData);
});

function updateModalStats() {
  if (!currentDocData) return;
  
  document.getElementById('modal-target-title').innerText = `${currentDocData.title} ${currentDocData.subQuestion ? '('+currentDocData.subQuestion+')' : ''}`;
  
  const container = document.getElementById('subquestion-stats-container');
  container.innerHTML = '';
  pendingSubResults = {};

  const subList = currentDocData.subQuestion 
    ? currentDocData.subQuestion.split(/[,、]/).map(s => s.trim()).filter(Boolean)
    : ["全体"];

  const subStatsMap = currentDocData.subStats || {};

  subList.forEach(subKey => {
    pendingSubResults[subKey] = null;

    const currentSubStat = subStatsMap[subKey] || { correct: 0, incorrect: 0 };

    const itemDiv = document.createElement('div');
    itemDiv.className = "bg-slate-50 border rounded-lg p-3 space-y-2";

    itemDiv.innerHTML = `
      <div class="flex justify-between items-center text-xs">
        <span class="font-bold text-slate-800">${subKey}</span>
        <span class="text-[10px] text-gray-500">正解: <strong class="text-green-600">${currentSubStat.correct}</strong> / 誤答: <strong class="text-red-600">${currentSubStat.incorrect}</strong></span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button data-key="${subKey}" data-type="correct" class="sub-btn-correct border-2 border-green-600 text-green-700 hover:bg-green-50 py-1.5 rounded text-xs font-bold transition">○ 正解</button>
        <button data-key="${subKey}" data-type="incorrect" class="sub-btn-incorrect border-2 border-red-600 text-red-700 hover:bg-red-50 py-1.5 rounded text-xs font-bold transition">× 誤答</button>
      </div>
    `;

    itemDiv.querySelector('.sub-btn-correct').addEventListener('click', () => {
      pendingSubResults[subKey] = pendingSubResults[subKey] === 'correct' ? null : 'correct';
      updateSubButtonsUI(itemDiv, subKey);
    });

    itemDiv.querySelector('.sub-btn-incorrect').addEventListener('click', () => {
      pendingSubResults[subKey] = pendingSubResults[subKey] === 'incorrect' ? null : 'incorrect';
      updateSubButtonsUI(itemDiv, subKey);
    });

    container.appendChild(itemDiv);
  });
}

function updateSubButtonsUI(parentDiv, subKey) {
  const btnCorrect = parentDiv.querySelector('.sub-btn-correct');
  const btnIncorrect = parentDiv.querySelector('.sub-btn-incorrect');
  const state = pendingSubResults[subKey];

  btnCorrect.className = "sub-btn-correct border-2 py-1.5 rounded text-xs font-bold transition " + 
    (state === 'correct' ? "bg-green-600 text-white border-green-600 ring-2 ring-green-300" : "border-green-600 text-green-700 hover:bg-green-50");

  btnIncorrect.className = "sub-btn-incorrect border-2 py-1.5 rounded text-xs font-bold transition " + 
    (state === 'incorrect' ? "bg-red-600 text-white border-red-600 ring-2 ring-red-300" : "border-red-600 text-red-700 hover:bg-red-50");
}

document.getElementById('btn-record-commit').addEventListener('click', async () => {
  if (!currentDocData || !currentUser) return;

  const stats = currentDocData.stats || { correct: 0, incorrect: 0 };
  const subStatsMap = currentDocData.subStats || {};
  const history = currentDocData.history || [];
  const timestamp = new Date().toISOString(); // 正確な時系列比較用

  let updated = false;

  Object.keys(pendingSubResults).forEach(subKey => {
    const type = pendingSubResults[subKey];
    if (!type) return;

    updated = true;

    if (!subStatsMap[subKey]) subStatsMap[subKey] = { correct: 0, incorrect: 0 };

    if (type === 'correct') {
      stats.correct++;
      subStatsMap[subKey].correct++;
      history.push({ subQuestion: subKey, type: 'correct', timestamp: timestamp });
    } else if (type === 'incorrect') {
      stats.incorrect++;
      subStatsMap[subKey].incorrect++;
      history.push({ subQuestion: subKey, type: 'incorrect', timestamp: timestamp });
    }
  });

  if (!updated) {
    alert("「○」または「×」を選択してください。");
    return;
  }

  currentDocData.stats = stats;
  currentDocData.subStats = subStatsMap;
  currentDocData.history = history;

  try {
    await setDoc(doc(db, "users", currentUser.uid, "documents", currentDocData.id), { 
      stats: stats,
      subStats: subStatsMap,
      history: history 
    }, { merge: true });

    document.getElementById('stats-modal').classList.add('hidden');
    alert("正誤記録を更新しました！");
  } catch (e) {
    console.error("正誤の保存に失敗:", e);
    alert("保存に失敗しました。");
  }
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

      try {
        const buffer = base64ToArrayBuffer(LZString.decompressFromUTF16(item.data));

        if (item.type === 'docx') {
          await docx.renderAsync(buffer, container, null, {
            inWrapper: true,
            ignoreWidth: true,
            ignoreHeight: true,
            renderChanges: false,
            defaultFont: "MS Mincho"
          });
          fixWordListNumbers(container);
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
      } catch (err) {
        console.error("ファイル描画エラー:", err);
        container.innerHTML = `<p class="text-red-500 text-xs">ファイルの表示に失敗しました (${item.fileName})</p>`;
      }

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
