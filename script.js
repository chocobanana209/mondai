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
let allDocuments = [];
let allCollections = [];
let currentMainView = 'documents'; 

let unsubscribeDocs = null;
let unsubscribeCollections = null;

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

// 右上の ≡ ボタン (正誤記録メニュー)
document.getElementById('header-menu-btn').addEventListener('click', () => {
  if (!currentDocData) {
    alert("まず左のリストから問題を選択してください。");
    return;
  }
  document.getElementById('stats-modal').classList.remove('hidden');
  updateModalStats();
});

document.getElementById('close-stats-modal').addEventListener('click', () => {
  document.getElementById('stats-modal').classList.add('hidden');
});

// 解答解説ペインのトグル
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

function setupRealtimeListeners() {
  detachRealtimeListeners();
  if (!currentUser) return;

  const qDocs = query(collection(db, "users", currentUser.uid, "documents"), orderBy("updatedAt", "desc"));
  unsubscribeDocs = onSnapshot(qDocs, (snapshot) => {
    allDocuments = [];
    snapshot.forEach(d => allDocuments.push({ id: d.id, ...d.data() }));
    renderCurrentView();
    updateSubjectAndUnitDatalists(); // 登録用サジェストの更新
    
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

// 登録済みの中から教科名・単元名を抽出して使い回せるようにサジェストを更新
function updateSubjectAndUnitDatalists() {
  const subjects = [...new Set(allDocuments.map(d => d.subject).filter(Boolean))];
  const units = [...new Set(allDocuments.map(d => d.unit).filter(Boolean))];

  const subList = document.getElementById('subject-list');
  const unitList = document.getElementById('unit-list');
  
  if (subList) {
    subList.innerHTML = subjects.map(s => `<option value="${s}">`).join('');
  }
  if (unitList) {
    unitList.innerHTML = units.map(u => `<option value="${u}">`).join('');
  }
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
    
    const subUnitBadge = (data.subject || data.unit) ? `
      <div class="text-[10px] text-blue-600 font-medium mb-1 truncate">
        ${data.subject ? `[${data.subject}]` : ''} ${data.unit || ''}
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

function renderCollectionList(colls) {
  const container = document.getElementById('sidebar-list');
  container.innerHTML = colls.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">問題集がありません。</p>' : '';

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
        try {
          await deleteDoc(doc(db, "users", currentUser.uid, "collections", c.id));
        } catch (err) {
          alert("削除に失敗しました: " + err.message);
        }
      }
    });

    container.appendChild(item);
  });
}

document.getElementById('create-collection-btn').addEventListener('click', async () => {
  const name = prompt("問題集の名前を入力してください:");
  if (!name || !currentUser) return;
  try {
    const collId = `coll_${Date.now()}`;
    await setDoc(doc(db, "users", currentUser.uid, "collections", collId), {
      name: name,
      updatedAt: Date.now()
    });
  } catch (err) {
    alert("問題集の作成に失敗しました: " + err.message);
  }
});

// ファイル処理
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
        const convertedBlob = await heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.8
        });
        targetFile = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        fileName = fileName.replace(/\.[^/.]+$/, '') + '.jpg';
      } catch (e) {
        console.warn("HEIC変換スキップ:", e);
        throw new Error(`ファイル「${file.name}」のHEIC形式解析に失敗しました。`);
      }
    }

    try {
      const buffer = await targetFile.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        throw new Error(`ファイル「${fileName}」のデータが空（0バイト）です。`);
      }

      const base64 = await arrayBufferToBase64(buffer);
      if (!base64) {
        throw new Error(`ファイル「${fileName}」のBase64エンコードに失敗しました。`);
      }

      const compressed = LZString.compressToUTF16(base64);

      if (fileName.match(/\.docx$/i)) {
        type = 'docx';
      } else if (fileName.match(/\.pdf$/i)) {
        type = 'pdf';
      } else if (targetFile.type.startsWith('image/') || fileName.match(/\.(jpg|jpeg|png|webp)$/i)) {
        type = 'image';
        if (!fileName.match(/\.jpe?g$/i)) {
          fileName = fileName.replace(/\.[^/.]+$/, '') + '.jpg';
        }
      } else {
        throw new Error(`ファイル「${fileName}」はサポートされていない形式です。`);
      }

      materials.push({
        fileName: String(fileName),
        type: String(type),
        data: String(compressed)
      });
    } catch (err) {
      console.error("ファイル処理エラー詳細:", err);
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
  document.getElementById('register-form-container').classList.remove('hidden');

  if (docData) {
    document.getElementById('form-header-title').innerText = "問題データの編集";
    document.getElementById('editing-doc-id').value = docData.id;
    document.getElementById('problem-name-input').value = docData.title || '';
    document.getElementById('subject-input').value = docData.subject || '';
    document.getElementById('unit-input').value = docData.unit || '';
    document.getElementById('tags-input').value = (docData.tags || []).join(' ');
    document.getElementById('q-text-input').value = docData.questionText || '';
    document.getElementById('a-text-input').value = docData.answerText || '';
  } else {
    document.getElementById('form-header-title').innerText = "新しい問題データの登録";
    document.getElementById('editing-doc-id').value = '';
    document.getElementById('problem-name-input').value = '';
    document.getElementById('subject-input').value = '';
    document.getElementById('unit-input').value = '';
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
  if (!currentUser) {
    alert("ログインしていません。");
    return;
  }

  const title = document.getElementById('problem-name-input').value.trim();
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

  document.getElementById('doc-title').innerText = docData.title;
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
  document.getElementById('modal-target-title').innerText = currentDocData.title;
  document.getElementById('stat-correct').innerText = currentDocData.stats?.correct || 0;
  document.getElementById('stat-incorrect').innerText = currentDocData.stats?.incorrect || 0;
}

document.getElementById('btn-record-correct').addEventListener('click', () => recordResult('correct'));
document.getElementById('btn-record-incorrect').addEventListener('click', () => recordResult('incorrect'));

async function recordResult(type) {
  if (!currentDocData || !currentUser) return;
  const stats = currentDocData.stats || { correct: 0, incorrect: 0 };
  if (type === 'correct') stats.correct++;
  else stats.incorrect++;

  currentDocData.stats = stats;
  updateModalStats();

  try {
    await setDoc(doc(db, "users", currentUser.uid, "documents", currentDocData.id), { stats: stats }, { merge: true });
  } catch (e) {
    console.error("正誤の保存に失敗:", e);
  }
}

// レンダリング処理
async function renderContent() {
  if (!currentDocData) return;
  
  await renderPaneContent('question-display-area', currentDocData.questionText, currentDocData.questionMaterials);
  await renderPaneContent('answer-display-area', currentDocData.answerText, currentDocData.answerMaterials, "解答解説は登録されていません。");
}

async function renderPaneContent(containerId, textVal, materials, emptyMsg = "データはありません。") {
  const displayArea = document.getElementById(containerId);
  displayArea.innerHTML = '';

  if (!textVal && (!materials || materials.length === 0)) {
    displayArea.innerHTML = `<div class="text-center text-gray-400 py-10"><p class="text-xs">${emptyMsg}</p></div>`;
    return;
  }

  if (textVal) {
    const textDiv = document.createElement('div');
    textDiv.className = "p-3 bg-slate-50 border rounded-lg text-sm whitespace-pre-wrap font-sans";
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
          }, 50);

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
