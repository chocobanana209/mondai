import { db, currentUser } from "./script.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let activeExamData = null;

// --- 試験一覧の描画（サイドバー） ---
export function renderExamList(exams, allData) {
  const container = document.getElementById('sidebar-list'); if (!container) return;
  const activeExams = exams.filter(e => !e.isDeleted);
  container.innerHTML = activeExams.length === 0 ? '<p class="text-gray-400 text-xs italic p-2">試験・デッキがありません。</p>' : '';
  
  activeExams.forEach(ex => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border bg-indigo-50 hover:bg-indigo-100 border-indigo-300 cursor-pointer text-xs transition space-y-2';
    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-indigo-900 truncate">${ex.title}</span>
        <div class="flex gap-1">
          <button class="edit-exam text-blue-600 font-bold">編集</button>
          <button class="del-exam text-red-500 font-bold">削除</button>
        </div>
      </div>
      <div class="text-[10px] text-indigo-700">教科: ${ex.subject || '未設定'} | 登録教材数: ${ex.components ? ex.components.length : 0}件</div>
      <button class="open-exam-btn w-full bg-indigo-600 hover:bg-indigo-700 text-white py-1.5 rounded font-bold">試験モードを開く 📑</button>
    `;
    item.querySelector('.open-exam-btn').addEventListener('click', (e) => { e.stopPropagation(); openExamPlayer(ex); });
    item.querySelector('.edit-exam').addEventListener('click', (e) => { e.stopPropagation(); openExamRegisterForm(ex, allData); });
    item.querySelector('.del-exam').addEventListener('click', async (e) => { 
      e.stopPropagation(); 
      if (confirm(`試験「${ex.title}」をゴミ箱に移動しますか？`)) {
        await setDoc(doc(db, "users", currentUser.uid, "exams", ex.id), { isDeleted: true }, { merge: true });
      }
    });
    container.appendChild(item);
  });
}

// --- 試験登録・編集フォームを開く ---
export function openExamRegisterForm(examData = null, allData = {}) {
  ['view-mode-container', 'collection-player-container', 'table-player-container', 'kanji-player-container', 'refresh-mode-container', 'table-register-form-container', 'kanji-register-form-container', 'timeline-register-form-container', 'exam-register-container', 'exam-player-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  let container = document.getElementById('exam-register-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'exam-register-container';
    container.className = 'absolute inset-0 bg-white z-20 flex flex-col overflow-hidden';
    document.querySelector('main').appendChild(container);
  }

  container.classList.remove('hidden');
  const examId = examData ? examData.id : `exam_${Date.now()}`;
  const title = examData ? examData.title : '';
  const subject = examData ? examData.subject : '';
  const desc = examData ? examData.description : '';
  const references = examData ? (examData.references || []).join('\n') : '';
  const pdfData = examData ? (examData.pdfData || '') : '';
  const selectedComponents = examData ? (examData.components || []) : [];

  // 教材候補リストを作成
  let componentOptionsHtml = '';
  const addCompOptions = (arr, typeName, typeKey) => {
    if (!arr) return;
    arr.forEach(item => {
      if (item.isDeleted) return;
      const isChecked = selectedComponents.some(c => c.type === typeKey && c.id === item.id);
      componentOptionsHtml += `
        <label class="flex items-center gap-2 p-1.5 bg-white border rounded hover:bg-slate-50 cursor-pointer">
          <input type="checkbox" value="${typeKey}:${item.id}" ${isChecked ? 'checked' : ''} class="exam-comp-chk rounded"/>
          <span class="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-bold">${typeName}</span>
          <span class="font-bold text-slate-800 truncate">${item.title || item.name}</span>
        </label>
      `;
    });
  };

  addCompOptions(allData.questionTables, '一問一答', 'questionTable');
  addCompOptions(allData.kanjiTables, '漢字', 'kanjiTable');
  addCompOptions(allData.timelineTables, '年表', 'timelineTable');
  addCompOptions(allData.collections, '問題集', 'collection');
  addCompOptions(allData.documents, '短問', 'document');

  container.innerHTML = `
    <div class="p-3 border-b bg-slate-50 flex justify-between items-center shrink-0">
      <div class="flex items-center gap-3">
        <h2 class="font-bold text-sm text-indigo-800">試験・デッキ エディタ</h2>
        <input type="text" id="exam-name-input" placeholder="試験タイトル (例: 1学期期末テスト対策)" value="${title}" class="border rounded px-2 py-1 text-xs w-60 font-bold"/>
        <input type="text" id="exam-subject-input" placeholder="教科" value="${subject}" class="border rounded px-2 py-1 text-xs w-28"/>
        <input type="text" id="exam-desc-input" placeholder="説明・備考" value="${desc}" class="border rounded px-2 py-1 text-xs w-48"/>
      </div>
      <div class="flex gap-2">
        <button id="save-exam-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded text-xs font-bold transition shadow-xs">保存する</button>
        <button id="cancel-exam-btn" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-1.5 rounded text-xs font-bold transition">閉じる</button>
      </div>
    </div>
    <div class="flex-1 overflow-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="space-y-4">
        <div>
          <label class="font-bold text-xs text-slate-700 block mb-1">🔗 参考文献・関連リンク (1行に1つ)</label>
          <textarea id="exam-ref-input" rows="4" class="w-full border rounded p-2 text-xs" placeholder="https://example.com/reference">${references}</textarea>
        </div>
        <div>
          <label class="font-bold text-xs text-slate-700 block mb-1">📄 資料PDFのアップロード</label>
          <input type="file" id="exam-pdf-input" accept="application/pdf" class="w-full text-xs file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"/>
          <div id="exam-pdf-preview" class="mt-2 text-xs text-slate-600">${pdfData ? '✅ PDFファイルが登録されています' : 'PDF未選択'}</div>
          <input type="hidden" id="exam-pdf-base64" value="${pdfData}"/>
        </div>
      </div>
      <div class="flex flex-col h-full">
        <label class="font-bold text-xs text-slate-700 block mb-1">📚 この試験に含める教材を選択</label>
        <div class="flex-1 overflow-y-auto border rounded p-3 space-y-2 bg-slate-50 max-h-96">
          ${componentOptionsHtml || '<p class="text-gray-400 text-xs italic">選択可能な教材がありません。</p>'}
        </div>
      </div>
    </div>
  `;

  // PDFファイル読み込み処理
  document.getElementById('exam-pdf-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      document.getElementById('exam-pdf-base64').value = uploadEvent.target.result;
      document.getElementById('exam-pdf-preview').innerText = `✅ 選択中: ${file.name}`;
    };
    reader.readAsDataURL(file);
  });

  // キャンセルボタン
  document.getElementById('cancel-exam-btn').addEventListener('click', () => {
    container.classList.add('hidden');
    document.getElementById('view-mode-container').classList.remove('hidden');
  });

  // 保存ボタン
  document.getElementById('save-exam-btn').addEventListener('click', async () => {
    const titleVal = document.getElementById('exam-name-input').value.trim();
    if (!titleVal) { alert("試験タイトルを入力してください。"); return; }
    const subjectVal = document.getElementById('exam-subject-input').value.trim() || "未設定";
    const descVal = document.getElementById('exam-desc-input').value.trim();
    const refsVal = document.getElementById('exam-ref-input').value.split('\n').map(s => s.trim()).filter(Boolean);
    const pdfBase64 = document.getElementById('exam-pdf-base64').value;

    const checkedComps = document.querySelectorAll('.exam-comp-chk:checked');
    const components = Array.from(checkedComps).map(chk => {
      const [type, id] = chk.value.split(':');
      return { type, id };
    });

    await setDoc(doc(db, "users", currentUser.uid, "exams", examId), {
      title: titleVal,
      subject: subjectVal,
      description: descVal,
      references: refsVal,
      pdfData: pdfBase64,
      components,
      updatedAt: Date.now(),
      isDeleted: false
    }, { merge: true });

    alert("試験情報を保存しました！");
    container.classList.add('hidden');
    document.getElementById('view-mode-container').classList.remove('hidden');
  });
}

// --- 試験プレイヤー画面 ---
function openExamPlayer(examData) {
  ['view-mode-container', 'collection-player-container', 'table-player-container', 'kanji-player-container', 'refresh-mode-container', 'exam-register-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  let player = document.getElementById('exam-player-container');
  if (!player) {
    player = document.createElement('div');
    player.id = 'exam-player-container';
    player.className = 'absolute inset-0 bg-slate-50 z-20 flex flex-col overflow-hidden p-6';
    document.querySelector('main').appendChild(player);
  }
  player.classList.remove('hidden');

  const refsHtml = (examData.references || []).map(r => `<a href="${r}" target="_blank" class="text-blue-600 underline hover:text-blue-800 block truncate">🔗 ${r}</a>`).join('');
  const pdfHtml = examData.pdfData ? `<a href="${examData.pdfData}" download="${examData.title}_資料.pdf" class="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded font-bold text-xs inline-flex items-center gap-1">📥 添付PDF資料をダウンロード</a>` : '<span class="text-gray-400 text-xs">添付PDFなし</span>';

  player.innerHTML = `
    <div class="bg-white rounded-xl border shadow-xs flex-1 flex flex-col overflow-hidden max-w-4xl mx-auto w-full">
      <div class="p-4 border-b flex justify-between items-center bg-indigo-50">
        <div>
          <h3 class="font-bold text-sm text-indigo-900">📑 試験・デッキ: ${examData.title}</h3>
          <p class="text-[10px] text-indigo-700">${examData.description || ''}</p>
        </div>
        <button id="exit-exam-player-btn" class="text-slate-400 hover:text-slate-600 font-bold text-xs">✕ 終了</button>
      </div>
      <div class="flex-1 p-6 overflow-y-auto space-y-6">
        <div class="bg-white p-4 rounded-lg border shadow-2xs space-y-3">
          <h4 class="font-bold text-xs text-slate-700 border-b pb-1">📌 参考資料・リンク</h4>
          <div class="space-y-1 text-xs">${refsHtml || '<span class="text-gray-400">参考文献なし</span>'}</div>
          <div class="pt-2">${pdfHtml}</div>
        </div>
        <div class="space-y-3">
          <h4 class="font-bold text-xs text-slate-700">🎯 含まれる教材一覧 (クリックして演習や確認へ)</h4>
          <div id="exam-components-list" class="space-y-2"></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('exit-exam-player-btn').addEventListener('click', () => {
    player.classList.add('hidden');
    document.getElementById('view-mode-container').classList.remove('hidden');
  });

  const compList = document.getElementById('exam-components-list');
  compList.innerHTML = '';
  
  if (!examData.components || examData.components.length === 0) {
    compList.innerHTML = '<p class="text-gray-400 text-xs italic">教材が登録されていません。</p>';
    return;
  }

  // 各コンポーネントのタイトルや実データを取得してリスト表示
  examData.components.forEach(comp => {
    const div = document.createElement('div');
    div.className = "p-3 bg-white border rounded-lg flex justify-between items-center text-xs hover:bg-slate-50 transition";
    div.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-[10px]">${comp.type}</span>
        <span class="font-bold text-slate-800">ID: ${comp.id}</span>
      </div>
      <span class="text-indigo-600 font-bold">開く ➔</span>
    `;
    compList.appendChild(div);
  });
}
