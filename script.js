
/* ==========================================
   MONDAI ver5.0
========================================== */

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  getDocFromServer,
  getDocsFromServer,
  addDoc,
  setDoc,
  updateDoc,
  runTransaction,
  writeBatch,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";


/* ==========================================
   Firebase設定
========================================== */

const firebaseConfig = {
  apiKey: "AIzaSyDG3RdZvL2I9zpLz6Mv39y-gzJCwdLdQNg",
  authDomain: "mondai-13fe9.firebaseapp.com",
  projectId: "mondai-13fe9",
  storageBucket: "mondai-13fe9.firebasestorage.app",
  messagingSenderId: "918393240956",
  appId: "1:918393240956:web:f4ea7d359067ea4de338f9",
  measurementId: "G-QL2WPX2WWT"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const VERSION = "5.0";

const CONFIG = {
  MAX_IMPORT: 1000,
  MAX_CSV_BYTES: 5 * 1024 * 1024,

  PACK_SIZE: 50,
  PACK_BYTES: 450000,

  EDIT_BATCH: 8,

  STATS_BLOCK: 50,
  STATS_TTL: 300000,

  SYNC_THRESHOLD: 50,
  SYNC_PARALLEL: 5,
  SYNC_TIMEOUT: 15000
};

const FIELDS = [
  ["question", "問題"],
  ["answer", "解答"],
  ["explanation", "解説"],
  ["unit", "単元"],
  ["importance", "重要度"]
];

const CORE_FIELDS = [
  "question",
  "answer",
  "explanation"
];

const VISIBILITY = {
  private: "非公開",
  limited: "限定公開",
  public: "公開"
};

const $ = id => document.getElementById(id);

const main = $("main");
const footer = $("quiz-footer");
const quizButtons = $("quiz-buttons");

let user = null;
let profile = null;
let session = null;
let busy = false;

let noticeTimer;
let syncJob = null;
let syncError = "";
let pendingCount = 0;

let authGeneration = 0;

const questionMemory = new Map();
const statsMemory = new Map();

function uid() {
  if (!user) {
    throw new Error("ログインしてください。");
  }
  return user.uid;
}

function newId() {
  return crypto.randomUUID();
}

function online() {
  return navigator.onLine;
}


/* ==========================================
   通信統計
========================================== */

const debug = {
  readRequests: 0,
  readDocuments: 0,
  writeRequests: 0,
  writeDocuments: 0,
  cacheHits: 0
};

async function readDoc(ref, label = "") {

  debug.readRequests++;

  const snap = await getDocFromServer(ref);

  debug.readDocuments++;

  console.log(
    `[MONDAI ${VERSION}][READ] ${label}`,
    1
  );

  return snap;
}

async function readDocs(ref, label = "") {

  debug.readRequests++;

  const snap = await getDocsFromServer(ref);

  debug.readDocuments += Math.max(1, snap.size);

  console.log(
    `[MONDAI ${VERSION}][READ] ${label}`,
    snap.size
  );

  return snap;
}

function wrote(label, count) {

  debug.writeRequests++;
  debug.writeDocuments += count;

  console.log(
    `[MONDAI ${VERSION}][WRITE] ${label}`,
    count
  );
}

window.MONDAI_DEBUG = {
  stats() {
    console.table(debug);
    return { ...debug };
  },

  reset() {
    Object.keys(debug).forEach(key => {
      debug[key] = 0;
    });
  },

  pending() {
    return pendingCount;
  },

  sync() {
    return syncPending();
  }
};


/* ==========================================
   IndexedDB

   v0.4と同一のデータベース名を使用
   既存の未同期記録を維持
========================================== */

const localDB = new Promise((resolve, reject) => {

  const req = indexedDB.open(
    "MONDAI_LOCAL",
    1
  );

  req.onupgradeneeded = () => {

    if (!req.result.objectStoreNames.contains("kv")) {

      req.result.createObjectStore("kv", {
        keyPath: "key"
      });

    }
  };

  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function localGet(key) {

  const database = await localDB;

  return new Promise((resolve, reject) => {

    const tx = database.transaction("kv", "readonly");

    const req = tx.objectStore("kv").get(key);

    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);

  });
}

async function localWrite(entries, remove = []) {

  const database = await localDB;

  return new Promise((resolve, reject) => {

    const tx = database.transaction("kv", "readwrite");
    const store = tx.objectStore("kv");

    for (const [key, value] of entries) {
      store.put({ key, value });
    }

    for (const key of remove) {
      store.delete(key);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(
      tx.error || new Error("端末内保存に失敗しました。")
    );

  });
}

function localPut(key, value) {
  return localWrite([[key, value]]);
}

function localDelete(key) {
  return localWrite([], [key]);
}

async function localPrefix(prefix) {

  const database = await localDB;

  return new Promise((resolve, reject) => {

    const tx = database.transaction("kv", "readonly");

    const range = IDBKeyRange.bound(
      prefix,
      prefix + "\uffff"
    );

    const req = tx.objectStore("kv").getAll(range);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);

  });
}

function deckKey(id) {
  return `deck:${uid()}:${id}`;
}

function questionsKey(id) {
  return `questions:${uid()}:${id}`;
}

function statisticsKey(deckId, questionId) {
  return `stats:${uid()}:${deckId}:${questionId}`;
}

function sessionKey() {
  return `session:${uid()}`;
}

function outboxKey(event) {
  return `out:${event.uid}:${event.id}`;
}


/* ==========================================
   UI共通処理
========================================== */

function el(tag, className = "", text = "") {

  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  node.textContent = String(text);

  return node;
}

function notify(message, error = false) {

  const node = $("notice");

  node.hidden = false;
  node.textContent = message;
  node.className = error ? "error" : "";

  clearTimeout(noticeTimer);

  noticeTimer = setTimeout(() => {
    node.hidden = true;
  }, 6000);
}

function showError(error) {

  console.error(error);

  const messages = {
    "permission-denied": "アクセス権限がありません。",
    "unavailable": "サーバーに接続できません。",
    "auth/invalid-credential":
      "メールアドレスまたはパスワードが違います。",
    "auth/email-already-in-use":
      "登録済みのメールアドレスです。",
    "auth/weak-password":
      "パスワードは6文字以上にしてください。"
  };

  notify(
    messages[error.code] ||
    error.message ||
    "エラーが発生しました。",
    true
  );
}

async function act(action) {

  if (busy) return;

  busy = true;

  try {
    await action();
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
  }
}

function button(text, action, className = "") {

  const node = el("button", className, text);

  node.type = "button";

  node.onclick = () => act(async () => {

    node.disabled = true;

    try {
      await action();
    } finally {
      node.disabled = false;
    }

  });

  return node;
}

function input(value = "", placeholder = "") {

  const node = el("input");

  node.value = value;
  node.placeholder = placeholder;

  return node;
}

function textarea(value = "") {

  const node = el("textarea");

  node.value = value;

  return node;
}

function select(options, value) {

  const node = el("select");

  for (const [key, label] of options) {

    const option = el("option", "", label);

    option.value = key;

    node.append(option);
  }

  node.value = value;

  return node;
}

function field(title, control) {

  const node = el("label", "", title);

  node.append(control);

  return node;
}

function checkItem(text, value, checked = true) {

  const label = el("label", "check-item");

  const check = el("input");

  check.type = "checkbox";
  check.value = value;
  check.checked = checked;

  label.append(
    check,
    el("span", "", text)
  );

  return label;
}

function selectedValues(container) {

  return new Set(

    [...container.querySelectorAll("input:checked")]
      .map(node => node.value)

  );
}

function showScreen(screen) {

  for (const id of [
    "auth-screen",
    "profile-screen",
    "app-screen"
  ]) {
    $(id).hidden = id !== screen;
  }

  document.body.classList.toggle(
    "app-mode",
    screen === "app-screen"
  );
}

function page(title, ...actions) {

  footer.hidden = true;
  quizButtons.replaceChildren();

  main.replaceChildren();
  main.scrollTop = 0;

  const content = el("div", "content");
  const heading = el("div", "page-heading");
  const group = el("div", "actions");

  group.append(...actions);

  heading.append(
    el("h1", "", title),
    group
  );

  content.append(heading);

  main.append(content);

  return content;
}


/* ==========================================
   Firestore参照
========================================== */

function deckRef(id) {
  return doc(db, "decks", id);
}

function questionsRef(id) {
  return collection(db, "decks", id, "questions");
}

function questionRef(deckId, questionId) {

  return doc(
    db,
    "decks",
    deckId,
    "questions",
    questionId
  );
}

function packRef(deckId, packId) {

  return doc(
    db,
    "decks",
    deckId,
    "packs",
    packId
  );
}

function personalRef(deckId, questionId, userId = uid()) {

  return doc(
    db,
    "decks",
    deckId,
    "questions",
    questionId,
    "personalStats",
    userId
  );
}

function totalRef(deckId, questionId) {

  return doc(
    db,
    "decks",
    deckId,
    "questions",
    questionId,
    "totals",
    "all"
  );
}

function receiptRef(event) {

  return doc(

    personalRef(
      event.deckId,
      event.questionId,
      event.uid
    ),

    "receipts",
    event.id

  );
}

function isOwner(deck) {
  return deck.ownerId === uid();
}

function canEdit(deck) {

  return !deck.deleted && (

    isOwner(deck) ||
    (deck.editorIds || []).includes(uid())

  );
}

function canOffline(deck) {

  return !deck.deleted &&
    isOwner(deck) &&
    deck.visibility === "private";
}


/* ==========================================
   認証
========================================== */

$("auth-form").onsubmit = event => {

  event.preventDefault();

  act(() => signInWithEmailAndPassword(

    auth,
    $("email").value.trim(),
    $("password").value

  ));
};

$("register").onclick = () => act(async () => {

  if (!$("auth-form").reportValidity()) return;

  await createUserWithEmailAndPassword(

    auth,
    $("email").value.trim(),
    $("password").value

  );
});

$("reset-password").onclick = () => act(async () => {

  const email = $("email").value.trim();

  if (!email) {
    throw new Error("メールアドレスを入力してください。");
  }

  await sendPasswordResetEmail(auth, email);

  notify("再設定メールの送信を受け付けました。");
});

$("profile-logout").onclick =
  () => act(() => signOut(auth));

function validateNickname(value) {

  const name = value.trim();

  if (
    name.length < 2 ||
    name.length > 24 ||
    name === "." ||
    name === ".." ||
    /[/,、\r\n]/.test(name) ||
    /^__.*__$/.test(name)
  ) {
    throw new Error("使用できないニックネームです。");
  }

  return name;
}

$("profile-form").onsubmit = event => {

  event.preventDefault();

  act(async () => {

    const name = validateNickname(
      $("nickname").value
    );

    const userId = uid();

    const pRef = doc(db, "profiles", userId);
    const nRef = doc(db, "nicknames", name);

    await runTransaction(db, async tx => {

      const p = await tx.get(pRef);
      const n = await tx.get(nRef);

      if (p.exists()) {
        throw new Error("登録済みです。");
      }

      if (n.exists()) {
        throw new Error("この名前は使用されています。");
      }

      tx.set(pRef, { nickname: name });
      tx.set(nRef, { uid: userId });

    });

    profile = { nickname: name };

    await localPut(
      `profile:${userId}`,
      profile
    );

    enterApp();
  });
};

onAuthStateChanged(auth, async current => {

  const generation = ++authGeneration;

  user = current;
  profile = null;
  session = null;

  pendingCount = 0;
  syncError = "";

  questionMemory.clear();
  statsMemory.clear();

  main.replaceChildren();
  footer.hidden = true;

  if (!current) {
    showScreen("auth-screen");
    return;
  }

  const userId = current.uid;

  try {

    let loadedProfile;

    if (online()) {

      const snap = await readDoc(

        doc(db, "profiles", userId),
        "プロフィール"

      );

      if (generation !== authGeneration) return;

      if (!snap.exists()) {

        showScreen("profile-screen");

        return;
      }

      loadedProfile = snap.data();

      await localPut(
        `profile:${userId}`,
        loadedProfile
      );

    } else {

      loadedProfile = await localGet(
        `profile:${userId}`
      );

      if (!loadedProfile) {
        throw new Error("初回ログインには通信が必要です。");
      }
    }

    if (generation !== authGeneration) return;

    profile = loadedProfile;

    enterApp();

  } catch (error) {

    if (generation === authGeneration) {
      showError(error);
    }
  }
});

function enterApp() {

  showScreen("app-screen");

  $("account").replaceChildren(

    el("span", "", profile.nickname),

    button("ログアウト", logout, "secondary")

  );

  renderHome().catch(showError);
  refreshPending().catch(showError);

  if (online()) {
    syncPending().catch(showError);
  }
}

async function logout() {

  if (session && !confirm(
    "演習を中断してログアウトしますか？"
  )) return;

  if (online()) {
    await syncPending();
  }

  await refreshPending();

  if (pendingCount && !confirm(

    `未同期の記録が${pendingCount}件あります。` +
    "端末内に記録を保持してログアウトしますか？"

  )) return;

  session = null;

  await signOut(auth);
}


/* ==========================================
   ナビゲーション
========================================== */

$("navigation").onclick = event => {

  const node = event.target.closest("[data-page]");

  if (node) {
    act(() => navigate(node.dataset.page));
  }
};

async function navigate(name) {

  if (session) {

    if (!confirm(
      "演習を中断しますか？途中から再開できます。"
    )) return;

    session = null;

    if (online()) {
      syncPending().catch(showError);
    }
  }

  document.querySelectorAll("[data-page]")

    .forEach(node => {

      node.classList.toggle(
        "active",
        node.dataset.page === name
      );

    });

  if (name === "home") return renderHome();

  if (name === "settings") return renderSettings();

  return renderDeckList(name);
}


/* ==========================================
   デッキ取得
========================================== */

async function loadDeck(id) {

  const key = deckKey(id);

  if (!online()) {

    const saved = await localGet(key);

    if (!saved || !canOffline(saved)) {

      throw new Error(
        "オフラインでは保存済みの非公開デッキのみ利用できます。"
      );
    }

    debug.cacheHits++;

    return saved;
  }

  let snap;

  try {

    snap = await readDoc(
      deckRef(id),
      "デッキ情報"
    );

  } catch (error) {

    if (error.code === "permission-denied") {

      questionMemory.delete(`${uid()}:${id}`);

      await localWrite(
        [],
        [key, questionsKey(id)]
      );
    }

    throw error;
  }

  if (!snap.exists() || snap.data().deleted) {

    questionMemory.delete(`${uid()}:${id}`);

    await localWrite(
      [],
      [key, questionsKey(id)]
    );

    throw new Error("デッキを利用できません。");
  }

  const deck = {
    ...snap.data(),
    id: snap.id
  };

  if (canOffline(deck)) {

    await localPut(key, deck);

  } else {

    await localWrite(
      [],
      [key, questionsKey(id)]
    );
  }

  return deck;
}

function sortQuestions(items) {

  return [...items].sort((a, b) =>

    a.position - b.position ||
    a.id.localeCompare(b.id)

  );
}


/* ==========================================
   問題取得・集約
========================================== */

async function loadQuestions(deck, force = false) {

  const id = deck.id;

  const memoryKey = `${uid()}:${id}`;

  const revision = deck.contentVersion || "";

  let stored = questionMemory.get(memoryKey);

  if (!stored && canOffline(deck)) {

    stored = await localGet(
      questionsKey(id)
    );
  }

  if (
    !force &&
    stored &&
    stored.revision === revision
  ) {

    debug.cacheHits++;

    questionMemory.set(memoryKey, stored);

    return sortQuestions(stored.items);
  }

  if (!online()) {
    throw new Error("問題が端末に保存されていません。");
  }

  let items = null;

  if (
    !force &&
    deck.packGeneration &&
    deck.packCount > 0
  ) {

    try {

      items = [];

      for (
        let i = 0;
        i < deck.packCount;
        i += 8
      ) {

        const refs = [];

        for (
          let j = i;
          j < Math.min(i + 8, deck.packCount);
          j++
        ) {

          refs.push(

            packRef(
              id,
              `${deck.packGeneration}_${j}`
            )

          );
        }

        const snaps = await Promise.all(

          refs.map(ref =>
            readDoc(ref, "集約問題データ")
          )

        );

        for (const snap of snaps) {

          if (
            !snap.exists() ||
            !Array.isArray(snap.data().items)
          ) {
            throw new Error("集約データが不完全です。");
          }

          items.push(...snap.data().items);
        }
      }

      const ids = new Set(
        items.map(item => item.id)
      );

      if (ids.size !== items.length) {
        throw new Error("集約データに重複IDがあります。");
      }

    } catch (error) {

      console.warn(error);

      items = null;
    }
  }

  if (items === null) {

    const snap = await readDocs(

      questionsRef(id),
      "問題データ"

    );

    items = snap.docs.map(item => ({
      ...item.data(),
      id: item.id
    }));
  }

  items = sortQuestions(
    items.filter(q => !q.deleted)
  );

  const entry = {
    revision,
    items
  };

  questionMemory.set(memoryKey, entry);

  if (canOffline(deck)) {
    await localPut(
      questionsKey(id),
      entry
    );
  }

  return items;
}

function questionData(q) {

  return Object.fromEntries(

    FIELDS.map(([key]) => [
      key,
      String(q[key] ?? "")
    ])

  );
}

function makePacks(items) {

  const packs = [];

  let current = [];
  let bytes = 0;

  const encoder = new TextEncoder();

  for (const q of sortQuestions(items)) {

    const item = {
      ...questionData(q),
      id: q.id,
      position: q.position
    };

    const size = encoder.encode(
      JSON.stringify(item)
    ).length + 100;

    if (
      current.length >= CONFIG.PACK_SIZE ||
      bytes + size > CONFIG.PACK_BYTES
    ) {

      if (current.length) {
        packs.push(current);
      }

      current = [];
      bytes = 0;
    }

    current.push(item);
    bytes += size;
  }

  if (current.length) {
    packs.push(current);
  }

  return packs;
}

async function publishPacks(deck, items) {

  if (!online() || !canEdit(deck)) {
    throw new Error("集約する権限がありません。");
  }

  const generation = newId();

  const packs = makePacks(items);

  for (let i = 0; i < packs.length; i++) {

    await setDoc(

      packRef(
        deck.id,
        `${generation}_${i}`
      ),

      {
        generation,
        index: i,
        items: packs[i]
      }

    );

    wrote("集約データ作成", 1);
  }

  await runTransaction(db, async tx => {

    const snap = await tx.get(
      deckRef(deck.id)
    );

    debug.readRequests++;
    debug.readDocuments++;

    if (
      !snap.exists() ||
      snap.data().deleted ||
      (snap.data().contentVersion || "") !==
      (deck.contentVersion || "")
    ) {
      throw new Error(
        "集約中に問題が変更されました。"
      );
    }

    tx.update(

      deckRef(deck.id),

      {
        packGeneration: generation,
        packCount: packs.length
      }

    );
  });

  wrote("集約データ公開", 1);

  deck.packGeneration = generation;
  deck.packCount = packs.length;

  if (canOffline(deck)) {
    await localPut(
      deckKey(deck.id),
      deck
    );
  }

  return packs.length;
}


/* ==========================================
   ホーム画面
========================================== */

async function renderHome() {

  const content = page("ホーム");

  content.append(

    el(
      "p",
      "muted",
      `${profile.nickname} さんの学習スペース`
    )

  );

  const saved = await localGet(sessionKey());

  if (saved) {

    const panel = el("section", "panel");

    panel.append(

      el("h2", "", "前回の演習"),

      el(
        "p",
        "",
        `${saved.index}/${saved.questionIds.length}問完了`
      ),

      button("途中から再開", resumeSession),

      button("進捗を破棄", async () => {

        if (!confirm(
          "前回の演習進捗を破棄しますか？"
        )) return;

        await localDelete(sessionKey());

        await renderHome();

      }, "secondary")

    );

    content.append(panel);
  }

  const grid = el("div", "deck-grid");

  for (const [title, description, name] of [

    ["マイデッキ", "自分の問題集", "mine"],
    ["公開デッキ", "公開された問題集", "public"],
    ["共有デッキ", "共有された問題集", "shared"]

  ]) {

    const card = el("div", "deck-card");

    card.append(

      el("h2", "", title),
      el("p", "muted", description),
      button("開く", () => navigate(name))

    );

    grid.append(card);
  }

  content.append(grid);
}


/* ==========================================
   デッキ一覧
========================================== */

async function fetchDecks(type) {

  if (!online()) {

    if (type !== "mine") return [];

    const records = await localPrefix(
      `deck:${uid()}:`
    );

    return records
      .map(record => record.value)
      .filter(canOffline);
  }

  const col = collection(db, "decks");

  let queries;

  if (type === "mine") {

    queries = [
      query(col, where("ownerId", "==", uid()))
    ];

  } else if (type === "public") {

    queries = [
      query(col, where("visibility", "==", "public"))
    ];

  } else {

    queries = [

      query(
        col,
        where("editorIds", "array-contains", uid())
      ),

      query(
        col,
        where("viewerIds", "array-contains", uid())
      )

    ];
  }

  const snaps = await Promise.all(

    queries.map(q => readDocs(q, "デッキ一覧"))

  );

  const unique = new Map();

  for (const snap of snaps) {

    for (const item of snap.docs) {

      if (!item.data().deleted) {

        unique.set(item.id, {
          ...item.data(),
          id: item.id
        });

      }
    }
  }

  return [...unique.values()].sort((a, b) =>

    (b.updatedAt?.seconds || 0) -
    (a.updatedAt?.seconds || 0)

  );
}

async function renderDeckList(type) {

  const names = {
    mine: "マイデッキ",
    public: "公開デッキ",
    shared: "共有デッキ"
  };

  const actions = [

    button(
      "更新",
      () => renderDeckList(type),
      "secondary"
    )

  ];

  if (type === "mine" && online()) {

    actions.unshift(
      button(
        "＋ 新規作成",
        () => renderDeckSettings()
      )
    );
  }

  const content = page(names[type], ...actions);

  const search = input(
    "",
    "デッキ名・公開者を検索"
  );

  const grid = el("div", "deck-grid");

  content.append(search, grid);

  grid.textContent = "読み込み中…";

  const decks = await fetchDecks(type);

  function draw() {

    grid.replaceChildren();

    const keyword = search.value.toLowerCase();

    const matched = decks.filter(deck =>

      `${deck.name} ${deck.ownerName}`
        .toLowerCase()
        .includes(keyword)

    );

    if (!matched.length) {

      grid.append(
        el("p", "muted", "デッキがありません。")
      );
    }

    for (const deck of matched) {

      const card = el("div", "deck-card");

      card.append(

        el(
          "span",
          `tag ${deck.visibility}`,
          VISIBILITY[deck.visibility]
        ),

        el("h2", "", deck.name),

        el("p", "muted", `公開者：${deck.ownerName}`)

      );

      const group = el("div", "actions");

      group.append(

        button(
          "演習",
          () => renderPracticeSetup(deck.id)
        ),

        button(
          "成績",
          () => renderStatistics(deck.id),
          "secondary"
        ),

        button(
          "CSV",
          () => exportDeck(deck.id),
          "secondary"
        )

      );

      if (online() && canEdit(deck)) {

        group.append(

          button(
            "編集",
            () => renderEditor(deck.id),
            "secondary"
          )

        );
      }

      if (online() && isOwner(deck)) {

        group.append(

          button(
            "設定",
            () => renderDeckSettings(deck.id),
            "secondary"
          )

        );
      }

      card.append(group);

      grid.append(card);
    }
  }

  search.oninput = draw;

  draw();
}


/* ==========================================
   共有・デッキ設定
========================================== */

async function resolveNicknames(text) {

  const names = [...new Set(

    text.split(/[,、\n]/)
      .map(s => s.trim())
      .filter(Boolean)

  )];

  if (names.length > 30) {
    throw new Error("共有相手は各区分30人までです。");
  }

  const result = [];

  for (const name of names) {

    validateNickname(name);

    const snap = await readDoc(

      doc(db, "nicknames", name),
      "ニックネーム検索"

    );

    if (!snap.exists()) {
      throw new Error(`「${name}」は登録されていません。`);
    }

    if (snap.data().uid !== uid()) {

      result.push({
        name,
        uid: snap.data().uid
      });

    }
  }

  return result;
}

async function renderDeckSettings(id = null) {

  const deck = id ? await loadDeck(id) : null;

  if (deck && !isOwner(deck)) {
    throw new Error("所有者のみ変更できます。");
  }

  const content = page(

    deck ? "デッキ設定" : "デッキ作成",

    button(
      "戻る",
      () => renderDeckList("mine"),
      "secondary"
    )

  );

  const panel = el("section", "panel");

  const name = input(deck?.name || "");

  const visibility = select([

    ["private", "非公開：自分のみ"],
    ["limited", "限定公開：指定ユーザー"],
    ["public", "公開：ログインユーザー全員"]

  ], deck?.visibility || "private");

  const editors = textarea(
    (deck?.editorNames || []).join("\n")
  );

  const viewers = textarea(
    (deck?.viewerNames || []).join("\n")
  );

  const editorField = field(
    "共同編集者（1行に1人）",
    editors
  );

  const viewerField = field(
    "閲覧許可者（1行に1人）",
    viewers
  );

  function updateVisibility() {

    editorField.hidden =
      visibility.value === "private";

    viewerField.hidden =
      visibility.value !== "limited";
  }

  visibility.onchange = updateVisibility;

  updateVisibility();

  const form = el("div", "form-grid");

  form.append(

    field("デッキ名", name),
    field("公開範囲", visibility),
    editorField,
    viewerField

  );

  panel.append(

    form,

    button("保存", async () => {

      const title = name.value.trim();

      if (!title || title.length > 100) {
        throw new Error("デッキ名は1〜100文字です。");
      }

      if (
        visibility.value === "public" &&
        !confirm("全登録ユーザーに公開しますか？")
      ) return;

      const e = visibility.value === "private"

        ? []

        : await resolveNicknames(editors.value);

      const v = visibility.value === "limited"

        ? await resolveNicknames(viewers.value)

        : [];

      const values = {

        name: title,
        visibility: visibility.value,

        editorIds: e.map(x => x.uid),
        editorNames: e.map(x => x.name),

        viewerIds: v.map(x => x.uid),
        viewerNames: v.map(x => x.name),

        updatedAt: serverTimestamp()
      };

      let savedId = id;

      if (deck) {

        await updateDoc(
          deckRef(id),
          values
        );

      } else {

        const ref = await addDoc(

          collection(db, "decks"),

          {
            ...values,

            ownerId: uid(),
            ownerName: profile.nickname,

            createdAt: serverTimestamp(),

            contentVersion: newId(),

            packGeneration: "",
            packCount: 0,

            deleted: false
          }

        );

        savedId = ref.id;
      }

      wrote("デッキ保存", 1);

      if (values.visibility !== "private") {

        await localWrite(
          [],
          [
            deckKey(savedId),
            questionsKey(savedId)
          ]
        );
      }

      notify("保存しました。");

      await renderEditor(savedId);
    })

  );

  content.append(panel);

  if (deck) {

    const danger = el("section", "panel");

    danger.append(

      el("h3", "", "デッキの削除"),

      button("デッキを削除", async () => {

        if (!confirm(
          `「${deck.name}」を削除しますか？`
        )) return;

        await protectPending(
          deck.id,
          null
        );

        await updateDoc(

          deckRef(deck.id),

          {
            deleted: true,

            visibility: "private",

            editorIds: [],
            editorNames: [],

            viewerIds: [],
            viewerNames: [],

            packGeneration: "",
            packCount: 0,

            updatedAt: serverTimestamp()
          }

        );

        questionMemory.delete(
          `${uid()}:${deck.id}`
        );

        await localWrite(
          [],
          [
            deckKey(deck.id),
            questionsKey(deck.id)
          ]
        );

        notify("デッキを削除しました。");

        await renderDeckList("mine");

      }, "danger")

    );

    content.append(danger);
  }
}


/* ==========================================
   問題の検証
========================================== */

function validateQuestion(values) {

  const data = {};

  for (const [key] of FIELDS) {
    data[key] = String(values[key] ?? "").trim();
  }

  if (!data.question || !data.answer) {
    throw new Error("問題・解答は必須です。");
  }

  if (
    data.question.length > 10000 ||
    data.answer.length > 10000 ||
    data.explanation.length > 20000 ||
    data.unit.length > 100 ||
    data.importance.length > 50
  ) {
    throw new Error("入力文字数が上限を超えています。");
  }

  data.unit ||= "未分類";
  data.importance ||= "未設定";

  return data;
}

function questionControls(q = {}) {

  return {
    question: textarea(q.question || ""),
    answer: textarea(q.answer || ""),
    explanation: textarea(q.explanation || ""),
    unit: input(q.unit || ""),
    importance: input(q.importance || "")
  };
}

function controlValues(controls) {

  return Object.fromEntries(

    Object.entries(controls)
      .map(([key, node]) => [key, node.value])

  );
}


/* ==========================================
   未同期記録の保護
========================================== */

async function protectPending(deckId, ids) {

  function matches(event) {

    return event.deckId === deckId &&
      (ids === null || ids.has(event.questionId));
  }

  let pending = (
    await pendingEvents()
  ).filter(matches);

  if (!pending.length) return;

  if (online()) {
    await syncPending();
  }

  pending = (
    await pendingEvents()
  ).filter(matches);

  if (pending.length) {

    throw new Error(

      `削除対象に未同期成績が${pending.length}件あります。` +
      "先に成績を同期してください。"

    );
  }
}


/* ==========================================
   問題の変更保存

   問題IDを維持
   変更されたフィールドだけを書き込む
========================================== */

async function applyChanges(deck, original, changes) {

  if (!online() || !canEdit(deck)) {
    throw new Error("編集権限がありません。");
  }

  if (!changes.length) {

    notify("変更はありません。");

    return;
  }

  const deletedIds = new Set(

    changes
      .filter(change => change.values.deleted)
      .map(change => change.id)

  );

  if (deletedIds.size) {

    await protectPending(
      deck.id,
      deletedIds
    );
  }

  let expected = deck.contentVersion || "";

  let saved = 0;

  const map = new Map(
    original.map(q => [q.id, q])
  );

  try {

    for (
      let i = 0;
      i < changes.length;
      i += CONFIG.EDIT_BATCH
    ) {

      const chunk = changes.slice(
        i,
        i + CONFIG.EDIT_BATCH
      );

      const revision = newId();

      await runTransaction(db, async tx => {

        const snap = await tx.get(
          deckRef(deck.id)
        );

        debug.readRequests++;
        debug.readDocuments++;

        if (
          !snap.exists() ||
          snap.data().deleted ||
          (snap.data().contentVersion || "") !== expected
        ) {

          throw new Error(

            "他の端末で問題が変更されました。" +
            "編集画面を更新してください。"

          );
        }

        for (const change of chunk) {

          const ref = questionRef(
            deck.id,
            change.id
          );

          if (change.type === "create") {

            tx.set(ref, change.values);

          } else {

            tx.update(ref, change.values);

          }
        }

        tx.update(

          deckRef(deck.id),

          {
            contentVersion: revision,
            packGeneration: "",
            packCount: 0,

            updatedAt: serverTimestamp()
          }

        );

      });

      wrote("問題変更", chunk.length + 1);

      expected = revision;
      saved += chunk.length;

      for (const change of chunk) {

        if (change.values.deleted) {

          map.delete(change.id);

        } else {

          map.set(change.id, {

            ...map.get(change.id),
            ...change.values,
            id: change.id

          });
        }
      }
    }

  } catch (error) {

    questionMemory.delete(`${uid()}:${deck.id}`);

    await localDelete(
      questionsKey(deck.id)
    );

    throw new Error(

      `${saved}/${changes.length}件の保存を確認しました。` +
      "最新の問題一覧を確認してください。" +
      error.message

    );
  }

  const items = sortQuestions(
    [...map.values()]
  );

  deck.contentVersion = expected;
  deck.packGeneration = "";
  deck.packCount = 0;

  const entry = {
    revision: expected,
    items
  };

  questionMemory.set(
    `${uid()}:${deck.id}`,
    entry
  );

  if (canOffline(deck)) {

    await localWrite([

      [deckKey(deck.id), deck],
      [questionsKey(deck.id), entry]

    ]);
  }

  try {

    await publishPacks(deck, items);

    notify("変更を保存しました。");

  } catch (error) {

    console.warn(error);

    notify(

      "問題は保存済みです。" +
      "集約は編集画面から再実行してください。",

      true

    );
  }
}


/* ==========================================
   CSVパーサー
========================================== */

function parseCSV(text) {

  text = text.replace(/^\uFEFF/, "");

  const rows = [];

  let row = [];
  let value = "";

  let quoted = false;
  let closed = false;

  function cell() {

    row.push(value);

    value = "";
    closed = false;
  }

  function line() {

    cell();

    rows.push(row);

    row = [];
  }

  for (let i = 0; i < text.length; i++) {

    const c = text[i];

    if (quoted) {

      if (c === '"' && text[i + 1] === '"') {

        value += '"';
        i++;

      } else if (c === '"') {

        quoted = false;
        closed = true;

      } else {

        value += c;
      }

      continue;
    }

    if (c === '"' && value === "" && !closed) {

      quoted = true;

    } else if (c === ",") {

      cell();

    } else if (c === "\r" || c === "\n") {

      if (c === "\r" && text[i + 1] === "\n") {
        i++;
      }

      line();

    } else {

      if (closed || c === '"') {
        throw new Error("CSVの引用符が不正です。");
      }

      value += c;
    }
  }

  if (quoted) {
    throw new Error("CSVの引用符が閉じていません。");
  }

  if (value || row.length || closed) {
    line();
  }

  return rows.filter(
    row => row.some(value => value.trim())
  );
}

function readCSV(text) {

  const rows = parseCSV(text);

  if (!rows.length) {
    throw new Error("CSVが空です。");
  }

  const aliases = [

    ["問題", "question"],
    ["解答", "回答", "answer"],
    ["解説", "explanation"],
    ["単元", "unit"],
    ["重要度", "importance"]

  ];

  const header = rows[0].map(
    s => s.trim().toLowerCase()
  );

  const indexes = aliases.map(

    names => header.findIndex(
      value => names.includes(value)
    )

  );

  const hasHeader =
    indexes[0] >= 0 && indexes[1] >= 0;

  const data = hasHeader
    ? rows.slice(1)
    : rows;

  if (
    !data.length ||
    data.length > CONFIG.MAX_IMPORT
  ) {

    throw new Error(
      "1回のインポートは1〜1,000問です。"
    );
  }

  return data.map((row, i) => {

    try {

      return validateQuestion(

        Object.fromEntries(

          FIELDS.map(([key], j) => [

            key,

            row[
              hasHeader ? indexes[j] : j
            ] ?? ""

          ])

        )

      );

    } catch (error) {

      throw new Error(

        `CSV ${i + (hasHeader ? 2 : 1)}行目：` +
        error.message

      );
    }
  });
}


/* ==========================================
   CSV差分検知 ver5.0
========================================== */

function normalize(value) {

  return String(value ?? "")

    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
}

function coreKey(q) {

  return JSON.stringify(

    CORE_FIELDS.map(
      key => normalize(q[key])
    )

  );
}

function fullKey(q) {

  return JSON.stringify(

    FIELDS.map(
      ([key]) => normalize(q[key])
    )

  );
}

function equalCore(a, b) {
  return coreKey(a) === coreKey(b);
}

function sameFields(a, b) {

  return FIELDS.every(
    ([key]) => a[key] === b[key]
  );
}

function changedFields(a, b) {

  return FIELDS.filter(
    ([key]) => a[key] !== b[key]
  ).map(([, label]) => label);
}

/*
  空欄同士の一致は、
  同一問題と判断する根拠に含めない。
*/

function matchScore(a, b) {

  let score = 0;

  for (const key of CORE_FIELDS) {

    const x = normalize(a[key]);
    const y = normalize(b[key]);

    if (x && x === y) {
      score++;
    }
  }

  return score;
}

/*
  全体から完全一致を先に確保する。

  例：
  既存 A B C D
  CSV  A X B D

  Bを先に確保するので、
  XがBのIDを奪うことがない。
*/

function matchCSV(existing, incoming) {

  const old = sortQuestions(existing);

  const assignments = new Map();

  const used = new Set();

  const conflicts = [];

  const duplicates = [];

  const byCore = new Map();

  const seen = new Set();

  const activeRows = [];

  for (const q of old) {

    const key = coreKey(q);

    if (!byCore.has(key)) {
      byCore.set(key, []);
    }

    byCore.get(key).push(q);
  }

  /*
    CSV内の完全重複を除外する。
    単元・重要度が異なる場合は残す。
  */

  incoming.forEach((q, index) => {

    const key = fullKey(q);

    if (seen.has(key)) {

      duplicates.push({
        index,
        question: q
      });

      return;
    }

    seen.add(key);

    activeRows.push({
      index,
      question: q
    });
  });

  /*
    第1段階：
    5項目完全一致を全体から確保
  */

  for (const row of activeRows) {

    const candidates = (

      byCore.get(coreKey(row.question)) || []

    ).filter(q => !used.has(q.id));

    const match = candidates.find(

      q => fullKey(q) === fullKey(row.question)

    );

    if (match) {

      assignments.set(row.index, match.id);

      used.add(match.id);
    }
  }

  /*
    第2段階：
    問題・解答・解説が一致するものを確保

    複数候補がある場合は自動決定しない。
  */

  for (const row of activeRows) {

    if (assignments.has(row.index)) continue;

    const candidates = (

      byCore.get(coreKey(row.question)) || []

    ).filter(q => !used.has(q.id));

    if (candidates.length === 1) {

      assignments.set(
        row.index,
        candidates[0].id
      );

      used.add(candidates[0].id);
    }
  }

  /*
    第3段階：
    残りの行の部分一致候補を作る。
  */

  const remaining = old.filter(
    q => !used.has(q.id)
  );

  const proposals = new Map();

  for (const row of activeRows) {

    if (assignments.has(row.index)) continue;

    const candidates = remaining

      .map(q => ({
        question: q,
        score: matchScore(q, row.question),
        exact: equalCore(q, row.question)
      }))

      .filter(item =>
        item.exact || item.score >= 1
      )

      .sort((a, b) =>

        Number(b.exact) - Number(a.exact) ||
        b.score - a.score

      );

    proposals.set(row.index, candidates);
  }

  /*
    2項目以上一致し、
    既存側・CSV側の両方で候補が一意の場合
    同一問題として自動照合する。
  */

  const claims = new Map();

  for (const candidates of proposals.values()) {

    for (const candidate of candidates) {

      if (candidate.score >= 2 || candidate.exact) {

        const id = candidate.question.id;

        claims.set(
          id,
          (claims.get(id) || 0) + 1
        );
      }
    }
  }

  for (const row of activeRows) {

    if (assignments.has(row.index)) continue;

    const candidates =
      proposals.get(row.index) || [];

    const strong = candidates.filter(

      c => c.score >= 2 || c.exact

    );

    if (
      strong.length === 1 &&
      claims.get(strong[0].question.id) === 1 &&
      !used.has(strong[0].question.id)
    ) {

      const id = strong[0].question.id;

      assignments.set(row.index, id);

      used.add(id);
    }
  }

  /*
    第4段階：
    曖昧な候補を確認対象にする。

    3項目とも変更された問題は、
    候補がなければ新規として登録する。
  */

  for (const row of activeRows) {

    if (assignments.has(row.index)) continue;

    const candidates = (

      proposals.get(row.index) || []

    ).filter(

      item => !used.has(item.question.id)

    );

    if (!candidates.length) {

      assignments.set(row.index, null);

    } else {

      conflicts.push({

        index: row.index,

        incoming: row.question,

        candidates

      });
    }
  }

  return {

    old,
    activeRows,

    assignments,
    used,

    conflicts,
    duplicates
  };
}


/* ==========================================
   CSV差分計画の確定
========================================== */

function buildImportPlan(
  existing,
  incoming,
  mode,
  matching = null,
  decisions = new Map(),
  keepAnswerHistory = false
) {

  const old = sortQuestions(existing);

  const oldMap = new Map(
    old.map(q => [q.id, q])
  );

  const final = [];

  const changes = [];
  const details = [];

  const used = new Set();

  let added = 0;
  let removed = 0;
  let updated = 0;
  let moved = 0;
  let skipped = 0;
  let unchanged = 0;

  function addNew(q) {

    const item = {

      ...questionData(q),

      id: newId(),
      deleted: false
    };

    final.push(item);

    added++;

    details.push({
      type: "add",
      question: item.question,
      id: item.id,
      detail: "新規問題"
    });

    return item;
  }

  if (mode === "append" || mode === "skip") {

    final.push(...old);

    const seen = new Set(
      old.map(fullKey)
    );

    for (const q of incoming) {

      const key = fullKey(q);

      if (mode === "skip" && seen.has(key)) {

        skipped++;

        continue;
      }

      addNew(q);

      seen.add(key);
    }

  } else {

    if (!matching) {
      matching = matchCSV(old, incoming);
    }

    skipped += matching.duplicates.length;

    const matchedRows = new Map(
      matching.assignments
    );

    for (const conflict of matching.conflicts) {

      if (!decisions.has(conflict.index)) {

        throw new Error(
          "未確認の一致候補があります。"
        );
      }

      const chosen = decisions.get(conflict.index);

      if (chosen !== null && !conflict.candidates.some(

        c => c.question.id === chosen

      )) {

        throw new Error("一致候補が無効です。");
      }

      matchedRows.set(
        conflict.index,
        chosen
      );
    }

    const resolved = [];

    for (const row of matching.activeRows) {

      const oldId = matchedRows.get(row.index);

      if (!oldId) {

        resolved.push({
          oldId: null,
          data: row.question
        });

        continue;
      }

      if (used.has(oldId)) {

        throw new Error(
          "同じ既存問題が複数行に割り当てられています。"
        );
      }

      const previous = oldMap.get(oldId);

      if (!previous) {
        throw new Error("一致した問題が存在しません。");
      }

      if (
        !equalCore(previous, row.question) &&
        matchScore(previous, row.question) === 0
      ) {

        throw new Error(
          "3項目すべて変更された問題は新規登録してください。"
        );
      }

      used.add(oldId);

      const answerChanged =

        normalize(previous.answer) !==
        normalize(row.question.answer);

      if (answerChanged && !keepAnswerHistory) {

        resolved.push({

          oldId,
          data: row.question,
          replaceId: true

        });

      } else {

        resolved.push({

          oldId,
          data: row.question

        });
      }
    }

    if (mode === "sync") {

      /*
        CSVの並び順をそのまま反映。
        CSVにない問題は論理削除。
      */

      for (const row of resolved) {

        if (!row.oldId || row.replaceId) {

          addNew(row.data);

        } else {

          final.push({

            ...oldMap.get(row.oldId),
            ...questionData(row.data)

          });
        }
      }

    } else {

      /*
        追加・更新：
        既存の並び順を維持。
        新規問題だけ末尾に追加。
      */

      final.push(...old);

      for (const row of resolved) {

        if (!row.oldId) {

          addNew(row.data);

          continue;
        }

        const index = final.findIndex(
          q => q.id === row.oldId
        );

        if (row.replaceId) {

          final[index] = {

            ...questionData(row.data),

            id: newId(),
            deleted: false
          };

          added++;

          details.push({
            type: "add",
            question: row.data.question,
            id: final[index].id,
            detail: "解答変更・成績リセット"
          });

        } else {

          final[index] = {

            ...final[index],
            ...questionData(row.data)

          };
        }
      }
    }
  }

  /*
    新しい順序の確定。

    既存IDはそのまま維持し、
    変更されたフィールドとpositionのみ保存。
  */

  const finalIds = new Set();

  final.forEach((q, index) => {

    if (finalIds.has(q.id)) {
      throw new Error("問題IDが重複しています。");
    }

    finalIds.add(q.id);

    const position = index + 1;

    const previous = oldMap.get(q.id);

    if (!previous) {

      changes.push({

        type: "create",
        id: q.id,

        values: {
          ...questionData(q),
          position,
          deleted: false
        }

      });

      return;
    }

    const values = {};

    for (const [key] of FIELDS) {

      if (previous[key] !== q[key]) {
        values[key] = q[key];
      }
    }

    const contentChanged =
      Object.keys(values).length > 0;

    if (contentChanged) {

      updated++;

      details.push({

        type: "update",
        question: q.question,

        detail: changedFields(previous, q).join("・")

      });
    }

    if (previous.position !== position) {

      values.position = position;

      moved++;

      details.push({

        type: "move",
        question: q.question,

        detail: `${previous.position} → ${position}`

      });
    }

    if (Object.keys(values).length) {

      changes.push({

        type: "update",
        id: q.id,
        values

      });

    } else {

      unchanged++;
    }
  });

  for (const q of old) {

    if (!finalIds.has(q.id)) {

      removed++;

      changes.push({

        type: "update",
        id: q.id,

        values: {
          deleted: true
        }

      });

      details.push({

        type: "remove",
        question: q.question,

        detail: "問題を除外・過去の成績は保持"

      });
    }
  }

  return {

    changes,
    details,

    added,
    removed,
    updated,
    moved,
    skipped,
    unchanged,

    total: final.length
  };
}


/* ==========================================
   CSV出力
========================================== */

function csvEscape(value) {

  let text = String(value ?? "");

  /*
    表計算ソフトによる意図しない
    数式実行を防ぐ。
  */

  if (/^\s*[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return '"' +
    text.replaceAll('"', '""') +
    '"';
}

function downloadCSV(filename, rows) {

  const text = "\uFEFF" +

    rows.map(

      row => row.map(csvEscape).join(",")

    ).join("\r\n");

  const blob = new Blob(

    [text],

    { type: "text/csv;charset=utf-8;" }

  );

  const url = URL.createObjectURL(blob);

  const link = el("a");

  link.href = url;
  link.download = filename;

  document.body.append(link);

  link.click();
  link.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    3000
  );
}

async function exportDeck(id) {

  const deck = await loadDeck(id);

  const questions = await loadQuestions(deck);

  downloadCSV(

    `${deck.name.replace(/[\\/:*?"<>|]/g, "_")}.csv`,

    [
      FIELDS.map(x => x[1]),

      ...questions.map(
        q => FIELDS.map(([key]) => q[key])
      )
    ]

  );
}


/* ==========================================
   CSV差分確認画面
========================================== */

function renderDiffPreview(
  target,
  plan,
  existingCount,
  incomingCount,
  onSave
) {

  target.hidden = false;

  target.replaceChildren(

    el("h2", "", "CSV差分確認"),

    el(
      "p",
      "muted",
      `現在：${existingCount}問／CSV：${incomingCount}問`
    )

  );

  const summary = el("div", "diff-summary");

  for (const [name, value, color] of [

    ["追加", plan.added, "green"],
    ["削除", plan.removed, "red"],
    ["内容更新", plan.updated, "orange"],
    ["順序変更", plan.moved, ""],
    ["重複除外", plan.skipped, ""],
    ["変更なし", plan.unchanged, ""]

  ]) {

    const box = el("div", "diff-stat");

    box.append(

      el("span", "muted", name),

      el("strong", color, value)

    );

    summary.append(box);
  }

  target.append(summary);

  target.append(

    el(
      "p",
      "",
      `変更後：${plan.total}問`
    ),

    el(

      "p",
      "muted",

      "内容更新と順序変更は重複して計上される場合があります。"

    ),

    el(

      "p",
      "muted",

      `書き込み対象：${plan.changes.length}問`

    )

  );

  const filter = select([

    ["all", "すべて"],
    ["add", "追加"],
    ["remove", "削除"],
    ["update", "内容更新"],
    ["move", "順序変更"]

  ], "all");

  const list = el("div", "diff-list");

  const labels = {

    add: "追加",
    remove: "削除",
    update: "更新",
    move: "移動"

  };

  function draw() {

    list.replaceChildren();

    const entries = plan.details.filter(

      item =>
        filter.value === "all" ||
        item.type === filter.value

    );

    for (const item of entries) {

      const row = el("div", "diff-item");

      const content = el("div");

      content.append(

        el("strong", "", item.question),

        el("div", "diff-detail", item.detail)

      );

      row.append(

        el(
          "span",
          `diff-type ${item.type}`,
          labels[item.type]
        ),

        content

      );

      list.append(row);
    }

    if (!entries.length) {

      list.append(
        el("p", "muted", "該当する変更はありません。")
      );
    }
  }

  filter.onchange = draw;

  target.append(filter, list);

  draw();

  const save = button("インポートを確定", async () => {

    if (
      plan.removed &&
      !confirm(

        `${plan.removed}問をデッキから除外します。` +
        "続行しますか？"

      )
    ) return;

    await onSave();

  });

  target.append(save);
}


/* ==========================================
   曖昧な一致候補の確認
========================================== */

function renderConflictReview(
  target,
  matching,
  onComplete
) {

  target.hidden = false;

  target.replaceChildren(

    el("h2", "", "一致候補の確認"),

    el(

      "p",
      "muted",

      `${matching.conflicts.length}件の問題について` +
      "同一問題か新規問題かを確認してください。"

    )

  );

  const decisions = new Map();

  const controls = new Map();

  for (const conflict of matching.conflicts) {

    const panel = el("div", "conflict-card");

    panel.append(

      el(
        "h3",
        "",
        `CSV ${conflict.index + 1}問目`
      ),

      el(
        "p",
        "",
        conflict.incoming.question
      ),

      el(
        "p",
        "muted",
        `解答：${conflict.incoming.answer}`
      ),

      el(
        "p",
        "muted",
        `解説：${conflict.incoming.explanation || "なし"}`
      )

    );

    const options = [

      ["", "選択してください"],

      ["__new__", "新規問題として登録"]

    ];

    for (const item of conflict.candidates) {

      const q = item.question;

      options.push([

        q.id,

        `${q.position}番：${q.question} ／ ${q.answer}`

      ]);
    }

    const control = select(options, "");

    const detail = el("div", "diff-detail");

    controls.set(
      conflict.index,
      control
    );

    control.onchange = () => {

      detail.replaceChildren();

      if (control.value === "") {

        decisions.delete(conflict.index);

        return;
      }

      if (control.value === "__new__") {

        decisions.set(
          conflict.index,
          null
        );

        detail.textContent =
          "新しい問題IDを発行します。";

        return;
      }

      const selected = conflict.candidates.find(

        c => c.question.id === control.value

      )?.question;

      if (!selected) return;

      for (const [index, chosen] of decisions) {

        if (
          index !== conflict.index &&
          chosen === selected.id
        ) {

          control.value = "";

          decisions.delete(conflict.index);

          notify(
            "その既存問題は別のCSV行で選択済みです。",
            true
          );

          return;
        }
      }

      decisions.set(
        conflict.index,
        selected.id
      );

      detail.append(

        el(
          "p",
          "",
          `旧問題：${selected.question}`
        ),

        el(
          "p",
          "",
          `旧解答：${selected.answer}`
        ),

        el(
          "p",
          "",
          `旧解説：${selected.explanation || "なし"}`
        ),

        el(

          "p",
          "muted",

          `変更項目：${
            changedFields(
              selected,
              conflict.incoming
            ).join("・") || "なし"
          }`

        )

      );
    };

    panel.append(
      control,
      detail
    );

    target.append(panel);
  }

  target.append(

    button("未選択をすべて新規にする", () => {

      for (const [index, control] of controls) {

        if (!decisions.has(index)) {

          control.value = "__new__";

          control.onchange();
        }
      }

    }, "secondary"),

    button("差分確認へ進む", async () => {

      if (
        decisions.size !== matching.conflicts.length
      ) {

        throw new Error(
          "すべての候補を確認してください。"
        );
      }

      await onComplete(decisions);

    })

  );
}


/* ==========================================
   CSVインポートパネル
========================================== */

function createImportPanel(deck) {

  const panel = el("section", "panel");

  panel.append(

    el("h2", "", "CSVインポート"),

    el(

      "p",
      "muted",

      "問題・解答・解説・単元・重要度。最大1,000問。"

    )

  );

  const file = el("input");

  file.type = "file";
  file.accept = ".csv,text/csv";

  const options = [

    ["skip", "追加（完全重複を除外）"],

    ["append", "追加（重複を許可）"],

    ["merge", "追加・更新"]

  ];

  if (isOwner(deck)) {

    options.push([
      "sync",
      "差分同期（CSVを最新版とする）"
    ]);
  }

  const mode = select(options, "skip");

  const history = checkItem(

    "解答を変更した問題の成績も引き継ぐ",

    "keep",

    false

  );

  const explanation = el("p", "muted");

  const preview = el("div", "panel");

  preview.hidden = true;

  function updateMode() {

    const descriptions = {

      skip:
        "5項目が完全一致する問題を除き、末尾に追加します。",

      append:
        "すべての問題を末尾に追加します。",

      merge:
        "既存問題を更新し、新規問題を末尾に追加します。",

      sync:
        "CSVの順序を反映し、CSVにない既存問題を除外します。"

    };

    explanation.textContent =
      descriptions[mode.value];

    history.hidden =
      !["merge", "sync"].includes(mode.value);

    preview.hidden = true;
  }

  mode.onchange = updateMode;

  file.onchange = () => {
    preview.hidden = true;
  };

  history.onchange = () => {
    preview.hidden = true;
  };

  updateMode();

  const form = el("div", "form-grid");

  form.append(

    field("CSVファイル", file),

    field("インポート方式", mode)

  );

  panel.append(

    form,
    explanation,
    history

  );

  const actions = el("div", "actions");

  actions.append(

    button("変更内容を確認", async () => {

      const source = file.files[0];

      if (!source) {
        throw new Error("CSVを選択してください。");
      }

      if (source.size > CONFIG.MAX_CSV_BYTES) {
        throw new Error("CSVは5MB以下です。");
      }

      const incoming = readCSV(
        await source.text()
      );

      const latest = await loadDeck(deck.id);

      /*
        差分判定では最新の正規データを使う。
        古い集約キャッシュによる誤判定を防ぐ。
      */

      const existing = await loadQuestions(
        latest,
        true
      );

      const chosenMode = mode.value;

      const keep = history
        .querySelector("input")
        .checked;

      if (
        chosenMode === "sync" &&
        !isOwner(latest)
      ) {

        throw new Error(
          "差分同期は所有者のみ実行できます。"
        );
      }

      const matching =

        ["merge", "sync"].includes(chosenMode)

        ? matchCSV(existing, incoming)

        : null;

      async function complete(decisions = new Map()) {

        const plan = buildImportPlan(

          existing,
          incoming,
          chosenMode,
          matching,
          decisions,
          keep

        );

        renderDiffPreview(

          preview,

          plan,

          existing.length,

          incoming.length,

          async () => {

            if (mode.value !== chosenMode) {
              throw new Error(
                "方式が変更されています。再確認してください。"
              );
            }

            await applyChanges(

              latest,
              existing,
              plan.changes

            );

            await renderEditor(deck.id);
          }

        );
      }

      if (matching?.conflicts.length) {

        renderConflictReview(
          preview,
          matching,
          complete
        );

      } else {

        await complete();
      }
    }),

    button(
      "CSV出力",
      () => exportDeck(deck.id),
      "secondary"
    ),

    button(

      "テンプレート",

      () => downloadCSV(

        "MONDAI_template.csv",

        [FIELDS.map(x => x[1])]

      ),

      "secondary"

    )

  );

  panel.append(
    actions,
    preview
  );

  return panel;
}


/* ==========================================
   ドラッグによる並び替え
========================================== */

async function renderReorder(id) {

  const deck = await loadDeck(id);

  if (!online() || !canEdit(deck)) {
    throw new Error("編集権限がありません。");
  }

  const original = await loadQuestions(
    deck,
    true
  );

  let items = [...original];

  let dirty = false;

  const content = page("問題の並び替え");

  const toolbar = el("div", "reorder-toolbar");

  const actions = el("div", "actions");

  const status = el("p", "muted");

  const list = el("div", "reorder-list");

  content.append(
    toolbar,
    list
  );

  function updateStatus() {

    dirty = items.some(

      (q, index) => q.id !== original[index]?.id

    );

    status.textContent =

      `${items.length}問 ／ ` +

      (dirty ? "未保存の変更あり" : "変更なし");
  }

  function refreshNumbers() {

    [...list.children].forEach((row, index) => {

      row.querySelector(
        ".reorder-number"
      ).textContent = index + 1;

    });

    items = [...list.children].map(

      row => items.find(
        q => q.id === row.dataset.id
      )

    );

    updateStatus();
  }

  function moveTo(questionId, destination) {

    const from = items.findIndex(
      q => q.id === questionId
    );

    if (from < 0) return;

    const to = Math.max(

      0,

      Math.min(
        items.length - 1,
        destination
      )

    );

    if (from === to) return;

    const [q] = items.splice(from, 1);

    items.splice(to, 0, q);

    draw();

    const row = [...list.children].find(
      node => node.dataset.id === questionId
    );

    row?.scrollIntoView({

      block: "nearest"

    });
  }

  function draw() {

    list.replaceChildren();

    items.forEach((q, index) => {

      const row = el("div", "reorder-item");

      row.dataset.id = q.id;

      const handle = el(
        "button",
        "reorder-handle",
        "⠿"
      );

      handle.type = "button";

      handle.setAttribute(
        "aria-label",
        "ドラッグして移動"
      );

      const number = el(

        "span",
        "reorder-number",
        index + 1

      );

      const body = el("div");

      body.append(

        el(
          "div",
          "reorder-question",
          q.question
        ),

        el(
          "div",
          "reorder-answer",
          q.answer
        )

      );

      const move = button("移動", () => {

        const from = items.findIndex(
          item => item.id === q.id
        );

        const value = prompt(

          `移動先の番号（1〜${items.length}）`,

          String(from + 1)

        );

        if (value === null) return;

        const destination = Number(value);

        if (
          !Number.isInteger(destination) ||
          destination < 1 ||
          destination > items.length
        ) {

          throw new Error(
            "正しい移動先番号を入力してください。"
          );
        }

        moveTo(
          q.id,
          destination - 1
        );

      }, "secondary small");

      /*
        キーボード操作にも対応。
      */

      handle.onkeydown = event => {

        const from = items.findIndex(
          item => item.id === q.id
        );

        if (event.key === "ArrowUp") {

          event.preventDefault();

          moveTo(q.id, from - 1);

        } else if (event.key === "ArrowDown") {

          event.preventDefault();

          moveTo(q.id, from + 1);

        }
      };

      row.append(
        handle,
        number,
        body,
        move
      );

      list.append(row);
    });

    updateStatus();
  }

  /*
    Pointer Eventsを使用するため、
    マウス・タッチ・トラックパッドに対応。
  */

  let drag = null;

  let frame = 0;

  function moveDraggedRow() {

    if (!drag) return;

    const bounds = main.getBoundingClientRect();

    const x = Math.min(

      window.innerWidth - 5,

      Math.max(5, drag.x)

    );

    const y = Math.min(

      bounds.bottom - 5,

      Math.max(
        bounds.top + 5,
        drag.y
      )

    );

    const target = document

      .elementFromPoint(x, y)

      ?.closest(".reorder-item");

    if (
      target &&
      target.parentElement === list &&
      target !== drag.row
    ) {

      const rect =
        target.getBoundingClientRect();

      const after =
        y > rect.top + rect.height / 2;

      const before = after

        ? target.nextSibling

        : target;

      if (before !== drag.row) {

        list.insertBefore(
          drag.row,
          before
        );

        refreshNumbers();
      }
    }
  }

  function animateDrag() {

    if (!drag) return;

    if (!list.isConnected) {

      finishDrag(true);

      return;
    }

    const bounds =
      main.getBoundingClientRect();

    const edge = 85;

    let speed = 0;

    if (drag.y < bounds.top + edge) {

      speed = -Math.min(

        24,

        (bounds.top + edge - drag.y) / 3

      );

    } else if (
      drag.y > bounds.bottom - edge
    ) {

      speed = Math.min(

        24,

        (drag.y - bounds.bottom + edge) / 3

      );
    }

    if (speed) {

      main.scrollTop += speed;

      moveDraggedRow();
    }

    frame = requestAnimationFrame(
      animateDrag
    );
  }

  function finishDrag(cancelled = false) {

    if (!drag) return;

    const previous = drag;

    drag = null;

    cancelAnimationFrame(frame);

    previous.ghost.remove();

    previous.row.classList.remove(
      "drag-source"
    );

    if (
      list.hasPointerCapture(
        previous.pointerId
      )
    ) {

      list.releasePointerCapture(
        previous.pointerId
      );
    }

    if (cancelled) {

      items = previous.before;

      draw();

    } else {

      refreshNumbers();
    }
  }

  list.addEventListener("pointerdown", event => {

    const handle = event.target.closest(
      ".reorder-handle"
    );

    if (!handle || drag || busy) return;

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) return;

    event.preventDefault();

    const row = handle.closest(
      ".reorder-item"
    );

    const q = items.find(

      item => item.id === row.dataset.id

    );

    const rect =
      row.getBoundingClientRect();

    const ghost = el(

      "div",
      "drag-ghost",
      q.question

    );

    ghost.style.width =

      `${Math.min(rect.width, 500)}px`;

    ghost.style.left =

      `${Math.max(8, rect.left)}px`;

    ghost.style.top =

      `${event.clientY - 25}px`;

    document.body.append(ghost);

    drag = {

      row,
      ghost,

      pointerId: event.pointerId,

      x: event.clientX,
      y: event.clientY,

      before: [...items]
    };

    row.classList.add("drag-source");

    /*
      移動される行ではなくリスト本体に
      ポインターを捕捉させる。
    */

    list.setPointerCapture(
      event.pointerId
    );

    frame = requestAnimationFrame(
      animateDrag
    );

  });

  list.addEventListener("pointermove", event => {

    if (
      !drag ||
      event.pointerId !== drag.pointerId
    ) return;

    event.preventDefault();

    drag.x = event.clientX;
    drag.y = event.clientY;

    drag.ghost.style.top =

      `${event.clientY - 25}px`;

    moveDraggedRow();

  }, { passive: false });

  list.addEventListener("pointerup", event => {

    if (
      drag &&
      drag.pointerId === event.pointerId
    ) {

      finishDrag(false);
    }

  });

  list.addEventListener("pointercancel", () => {

    finishDrag(true);

  });

  list.addEventListener("lostpointercapture", () => {

    if (drag) {
      finishDrag(true);
    }

  });

  actions.append(

    button("保存", async () => {

      if (drag) return;

      if (!dirty) {

        notify("変更はありません。");

        return;
      }

      const changes = [];

      items.forEach((q, index) => {

        const position = index + 1;

        if (q.position !== position) {

          changes.push({

            type: "update",

            id: q.id,

            values: {
              position
            }

          });
        }
      });

      await applyChanges(

        deck,
        original,
        changes

      );

      await renderEditor(id);

    }),

    button("元に戻す", () => {

      if (drag) {
        finishDrag(true);
      }

      items = [...original];

      draw();

    }, "secondary"),

    button("戻る", async () => {

      if (
        dirty &&
        !confirm("未保存の並び替えを破棄しますか？")
      ) return;

      await renderEditor(id);

    }, "secondary")

  );

  toolbar.append(

    actions,
    status,

    el(

      "p",
      "muted",

      "左のハンドルをドラッグして移動します。" +
      "長距離の移動には「移動」ボタンを使用できます。"

    )

  );

  draw();
}


/* ==========================================
   問題編集画面
========================================== */

async function renderEditor(id, force = false) {

  const deck = await loadDeck(id);

  if (!online() || !canEdit(deck)) {
    throw new Error("編集権限がありません。");
  }

  const questions = await loadQuestions(
    deck,
    force
  );

  const content = page(

    deck.name,

    button(
      "演習",
      () => renderPracticeSetup(id)
    ),

    button(
      "並び替え",
      () => renderReorder(id),
      "secondary"
    ),

    button(
      "更新",
      () => renderEditor(id, true),
      "secondary"
    ),

    button(

      "戻る",

      () => renderDeckList(
        isOwner(deck) ? "mine" : "shared"
      ),

      "secondary"

    )

  );

  /* 集約 */

  const packPanel = el("section", "panel");

  packPanel.append(

    el("h2", "", "問題データの最適化"),

    el(

      "p",
      "muted",

      deck.packGeneration

        ? `集約済み：${deck.packCount}ドキュメント`

        : "未集約：通常形式を使用しています。"

    ),

    button("集約データを作成", async () => {

      if (!confirm(

        "問題を最大50問単位で集約します。" +
        "既存の問題IDと成績は維持されます。"

      )) return;

      const latest = await loadDeck(id);

      const items = await loadQuestions(
        latest,
        true
      );

      const count = await publishPacks(
        latest,
        items
      );

      notify(
        `${items.length}問を${count}個に集約しました。`
      );

      await renderEditor(id);

    }, "secondary")

  );

  content.append(packPanel);

  /* CSV */

  content.append(
    createImportPanel(deck)
  );

  /* 手動追加 */

  const addPanel = el("section", "panel");

  const controls = questionControls();

  const fields = el("div", "form-grid");

  for (const [key, title] of FIELDS) {

    fields.append(
      field(title, controls[key])
    );
  }

  addPanel.append(

    el("h2", "", "問題を追加"),

    fields,

    button("追加", async () => {

      const data = validateQuestion(
        controlValues(controls)
      );

      const position = questions.reduce(

        (max, q) => Math.max(
          max,
          q.position
        ),

        0

      ) + 1;

      await applyChanges(

        deck,
        questions,

        [{

          type: "create",

          id: newId(),

          values: {

            ...data,

            position,

            deleted: false
          }

        }]

      );

      await renderEditor(id);

    })

  );

  content.append(addPanel);

  /* 問題一覧 */

  const list = el("section", "panel");

  const search = input(

    "",

    "問題・解答・単元を検索"

  );

  const wrap = el("div", "table-wrap");

  const paging = el("div", "actions");

  const label = el("span", "muted");

  let current = 0;

  const pageSize = 50;

  function draw() {

    wrap.replaceChildren();

    const keyword =
      search.value.toLowerCase();

    const filtered = questions.filter(q =>

      `${q.question} ${q.answer} ${q.unit}`

        .toLowerCase()

        .includes(keyword)

    );

    const pages = Math.max(

      1,

      Math.ceil(
        filtered.length / pageSize
      )

    );

    current = Math.min(
      current,
      pages - 1
    );

    label.textContent =

      `${current + 1}/${pages}`;

    const table = el("table");

    const thead = el("thead");

    const head = el("tr");

    for (const title of [

      "No.",

      ...FIELDS.map(x => x[1]),

      "操作"

    ]) {

      head.append(
        el("th", "", title)
      );
    }

    thead.append(head);

    table.append(thead);

    const tbody = el("tbody");

    const shown = filtered.slice(

      current * pageSize,

      (current + 1) * pageSize

    );

    for (const q of shown) {

      const row = el("tr");

      const edit = questionControls(q);

      row.append(

        el(
          "td",
          "",
          q.position
        )

      );

      for (const [key] of FIELDS) {

        const cell = el("td");

        cell.append(edit[key]);

        row.append(cell);
      }

      const operations = el("td");

      operations.append(

        button("保存", async () => {

          const data = validateQuestion(
            controlValues(edit)
          );

          const values = {};

          for (const [key] of FIELDS) {

            if (data[key] !== q[key]) {

              values[key] = data[key];
            }
          }

          if (!Object.keys(values).length) {

            notify("変更はありません。");

            return;
          }

          if (
            CORE_FIELDS.every(

              key => normalize(data[key]) !==
                normalize(q[key])

            )
          ) {

            if (!confirm(

              "問題・解答・解説がすべて変更されています。" +
              "別問題として登録しますか？"

            )) return;

            await applyChanges(

              deck,
              questions,

              [

                {

                  type: "create",

                  id: newId(),

                  values: {

                    ...data,

                    position: q.position,

                    deleted: false
                  }

                },

                {

                  type: "update",

                  id: q.id,

                  values: {

                    deleted: true
                  }

                }

              ]

            );

          } else {

            await applyChanges(

              deck,
              questions,

              [{

                type: "update",

                id: q.id,

                values

              }]

            );
          }

          await renderEditor(id);

        }, "secondary small"),

        button("削除", async () => {

          if (!confirm(
            "この問題を削除しますか？"
          )) return;

          await applyChanges(

            deck,
            questions,

            [{

              type: "update",

              id: q.id,

              values: {
                deleted: true
              }

            }]

          );

          await renderEditor(id);

        }, "danger small")

      );

      row.append(operations);

      tbody.append(row);
    }

    table.append(tbody);

    wrap.append(table);
  }

  search.oninput = () => {

    current = 0;

    draw();
  };

  paging.append(

    button("前へ", () => {

      current = Math.max(
        0,
        current - 1
      );

      draw();

    }, "secondary"),

    label,

    button("次へ", () => {

      current++;

      draw();

    }, "secondary")

  );

  list.append(

    el(
      "h2",
      "",
      `登録問題：${questions.length}問`
    ),

    search,
    paging,
    wrap

  );

  content.append(list);

  draw();
}


/* ==========================================
   未同期成績キュー
========================================== */

async function pendingEvents(userId = uid()) {

  const rows = await localPrefix(

    `out:${userId}:`

  );

  return rows

    .map(row => row.value)

    .sort((a, b) => a.time - b.time);
}

async function refreshPending() {

  if (!user) return;

  const userId = uid();

  const entries = await pendingEvents(
    userId
  );

  if (user?.uid !== userId) return;

  pendingCount = entries.length;

  updateSyncStatus();
}

function updateSyncStatus() {

  const node = $("sync-status");

  node.className = "";

  if (!online()) {

    node.textContent =

      `オフライン・未同期 ${pendingCount}件`;

    node.className = "pending";

  } else if (syncJob) {

    node.textContent =

      `同期中・残り ${pendingCount}件`;

    node.className = "pending";

  } else if (syncError) {

    node.textContent =

      `同期失敗・未同期 ${pendingCount}件`;

    node.className = "error";

  } else if (pendingCount) {

    node.textContent =

      `未同期：${pendingCount}件`;

    node.className = "pending";

  } else {

    node.textContent = "同期済み";

    node.className = "synced";
  }
}

function timeout(promise, ms) {

  let timer;

  return Promise.race([

    promise,

    new Promise((_, reject) => {

      timer = setTimeout(

        () => reject(

          new Error(
            "通信がタイムアウトしました。"
          )

        ),

        ms

      );

    })

  ]).finally(() => clearTimeout(timer));
}


/* ==========================================
   正誤記録の送信

   同期IDを使用して二重加算を防止する。
========================================== */

async function sendEvent(event) {

  if (auth.currentUser?.uid !== event.uid) {
    throw new Error("アカウントが変更されました。");
  }

  const personal = personalRef(

    event.deckId,
    event.questionId,
    event.uid

  );

  const total = totalRef(

    event.deckId,
    event.questionId

  );

  const receipt = receiptRef(event);

  const correct =
    event.correct ? 1 : 0;

  const incorrect =
    event.correct ? 0 : 1;

  const batch = writeBatch(db);

  batch.set(

    personal,

    {

      correct: increment(correct),

      incorrect: increment(incorrect),

      lastEvent: event.id

    },

    { merge: true }

  );

  batch.set(

    total,

    {

      correct: increment(correct),

      incorrect: increment(incorrect),

      lastUid: event.uid,

      lastEvent: event.id

    },

    { merge: true }

  );

  batch.set(

    receipt,

    {

      correct: event.correct,

      createdAt: serverTimestamp()

    }

  );

  try {

    await timeout(

      batch.commit(),

      CONFIG.SYNC_TIMEOUT

    );

    wrote(
      "正誤記録・同期ID",
      3
    );

  } catch (error) {

    /*
      タイムアウト等で実際の保存結果が
      不明な場合は同期IDを確認する。
    */

    let snap;

    try {

      snap = await timeout(

        readDoc(
          receipt,
          "同期ID確認"
        ),

        CONFIG.SYNC_TIMEOUT

      );

    } catch {

      throw error;
    }

    if (
      !snap.exists() ||
      snap.data().correct !== event.correct
    ) {

      throw error;
    }
  }

  await localDelete(
    outboxKey(event)
  );
}


/* ==========================================
   一括同期
========================================== */

async function syncPending() {

  if (!user || !online()) return false;

  if (syncJob) {
    return syncJob;
  }

  const userId = uid();

  syncError = "";

  syncJob = (async () => {

    let failed = 0;

    const events = await pendingEvents(
      userId
    );

    /*
      一度に5記録ずつ処理。

      同一問題が同じ処理グループに
      重複しないようにする。
    */

    const remaining = [...events];

    while (remaining.length) {

      if (
        !online() ||
        auth.currentUser?.uid !== userId
      ) {

        throw new Error("同期を中断しました。");
      }

      const group = [];

      const keys = new Set();

      for (
        let i = 0;
        i < remaining.length &&
        group.length < CONFIG.SYNC_PARALLEL;
      ) {

        const event = remaining[i];

        const key =

          `${event.deckId}:${event.questionId}`;

        if (keys.has(key)) {

          i++;

          continue;
        }

        keys.add(key);

        group.push(event);

        remaining.splice(i, 1);
      }

      const results = await Promise.allSettled(

        group.map(sendEvent)

      );

      for (const result of results) {

        if (result.status === "rejected") {

          failed++;

          console.warn(
            "同期失敗",
            result.reason
          );
        }
      }

      await refreshPending();
    }

    if (failed) {

      syncError =

        `${failed}件を同期できませんでした。`;

      return false;
    }

    return true;

  })();

  updateSyncStatus();

  try {

    return await syncJob;

  } catch (error) {

    console.error(error);

    syncError = error.message;

    return false;

  } finally {

    syncJob = null;

    await refreshPending();

    updateSyncStatus();
  }
}

$("sync-now").onclick = () => act(async () => {

  const result = await syncPending();

  notify(

    result

      ? "同期しました。"

      : "未同期記録は端末に保持されています。",

    !result

  );
});

window.addEventListener("online", () => {

  updateSyncStatus();

  syncPending().catch(showError);

});

window.addEventListener(

  "offline",

  updateSyncStatus

);


/* ==========================================
   成績取得
========================================== */

function counts(snap) {

  const data = snap.exists()
    ? snap.data()
    : {};

  return {

    correct: data.correct || 0,

    incorrect: data.incorrect || 0

  };
}

async function getStatistics(
  deck,
  questionId,
  pendingSet,
  force = false
) {

  const key = statisticsKey(
    deck.id,
    questionId
  );

  let cached = statsMemory.get(key);

  if (!cached && canOffline(deck)) {

    cached = await localGet(key);
  }

  if (

    !online() ||

    pendingSet.has(questionId) ||

    (

      !force &&
      cached &&
      Date.now() - cached.time <
        CONFIG.STATS_TTL

    )

  ) {

    if (cached) {

      debug.cacheHits++;

      statsMemory.set(key, cached);

      return cached.value;
    }

    return null;
  }

  const [personal, total] = await Promise.all([

    readDoc(

      personalRef(deck.id, questionId),

      "個人成績"

    ),

    readDoc(

      totalRef(deck.id, questionId),

      "全体成績"

    )

  ]);

  const entry = {

    time: Date.now(),

    value: {

      personal: counts(personal),

      total: counts(total)

    }
  };

  statsMemory.set(key, entry);

  if (canOffline(deck)) {

    await localPut(
      key,
      entry
    );
  }

  return entry.value;
}

async function preloadStatistics(
  deck,
  questions,
  force = false
) {

  const pending = await pendingEvents();

  const pendingSet = new Set(

    pending

      .filter(
        event => event.deckId === deck.id
      )

      .map(
        event => event.questionId
      )

  );

  for (
    let i = 0;
    i < questions.length;
    i += 8
  ) {

    const chunk = questions.slice(
      i,
      i + 8
    );

    await Promise.all(

      chunk.map(q =>

        getStatistics(

          deck,
          q.id,
          pendingSet,
          force

        ).catch(error => {

          console.warn(

            "成績取得失敗",

            q.id,

            error

          );
        })

      )

    );
  }
}


/* ==========================================
   演習条件
========================================== */

function shuffle(items) {

  const result = [...items];

  for (
    let i = result.length - 1;
    i > 0;
    i--
  ) {

    const j = Math.floor(

      Math.random() * (i + 1)

    );

    [result[i], result[j]] = [

      result[j],
      result[i]

    ];
  }

  return result;
}

async function renderPracticeSetup(id) {

  const deck = await loadDeck(id);

  const questions = await loadQuestions(deck);

  const content = page(

    deck.name,

    button(

      "ホーム",

      () => navigate("home"),

      "secondary"

    )

  );

  if (!questions.length) {

    content.append(

      el("p", "", "問題がありません。")

    );

    return;
  }

  const panel = el("section", "panel");

  const mode = select([

    ["normal", "通常モード"],

    ["custom", "カスタムモード"]

  ], "normal");

  const order = select([

    ["ordered", "順番（すべて）"],

    ["random", "ランダム（すべて）"],

    ["random20", "ランダム（20問）"]

  ], "ordered");

  const allStats = checkItem(

    "全対象問題の成績を先に取得する",

    "all",

    false

  );

  const unitGroup = el(
    "div",
    "check-group"
  );

  const importanceGroup = el(
    "div",
    "check-group"
  );

  const customGroup = el(
    "div",
    "custom-list"
  );

  const units = [...new Set(

    questions.map(q => q.unit)

  )];

  const importance = [...new Set(

    questions.map(q => q.importance)

  )].sort((a, b) =>

    a.localeCompare(
      b,
      "ja",
      { numeric: true }
    )

  );

  for (const unit of units) {

    unitGroup.append(

      checkItem(
        unit,
        unit
      )

    );
  }

  for (const value of importance) {

    importanceGroup.append(

      checkItem(
        value,
        value
      )

    );
  }

  for (const q of questions) {

    customGroup.append(

      checkItem(

        `${q.position}. ${q.question}`,

        q.id,

        false

      )

    );
  }

  const normalArea = el("div");

  const customArea = el("div");

  const count = el("p", "muted");

  function selected() {

    if (mode.value === "custom") {

      const ids = selectedValues(
        customGroup
      );

      return questions.filter(

        q => ids.has(q.id)

      );
    }

    const selectedUnits =
      selectedValues(unitGroup);

    const selectedImportance =
      selectedValues(importanceGroup);

    return questions.filter(q =>

      selectedUnits.has(q.unit) &&

      selectedImportance.has(q.importance)

    );
  }

  function drawCount() {

    normalArea.hidden =
      mode.value !== "normal";

    customArea.hidden =
      mode.value !== "custom";

    const amount = selected().length;

    count.textContent =

      `対象：${amount}問 ／ 出題：` +

      (

        order.value === "random20"

          ? Math.min(20, amount)

          : amount

      ) +

      "問";
  }

  function checkActions(container) {

    const actions = el("div", "actions");

    actions.append(

      button("全選択", () => {

        container

          .querySelectorAll("input")

          .forEach(node => {
            node.checked = true;
          });

        drawCount();

      }, "secondary small"),

      button("全解除", () => {

        container

          .querySelectorAll("input")

          .forEach(node => {
            node.checked = false;
          });

        drawCount();

      }, "secondary small")

    );

    return actions;
  }

  normalArea.append(

    el("h3", "", "単元"),

    checkActions(unitGroup),

    unitGroup,

    el("h3", "", "重要度"),

    checkActions(importanceGroup),

    importanceGroup

  );

  customArea.append(

    checkActions(customGroup),

    customGroup

  );

  const modeField = field(
    "演習モード",
    mode
  );

  modeField.classList.add(
    "setup-control"
  );

  const orderField = field(
    "出題順序",
    order
  );

  orderField.classList.add(
    "setup-control"
  );

  panel.append(

    modeField,

    normalArea,

    customArea,

    orderField,

    allStats,

    el(

      "p",
      "muted",

      "標準では成績を50問ずつ先読みします。"

    ),

    count,

    button("演習を開始", async () => {

      let items = selected();

      if (!items.length) {

        throw new Error(
          "問題を選択してください。"
        );
      }

      if (order.value !== "ordered") {

        items = shuffle(items);
      }

      if (order.value === "random20") {

        items = items.slice(0, 20);
      }

      if (online()) {

        const latest = await loadDeck(id);

        if (

          (latest.contentVersion || "") !==

          (deck.contentVersion || "")

        ) {

          throw new Error(

            "問題が変更されています。" +
            "演習条件を開き直してください。"

          );
        }
      }

      await startSession(

        deck,

        items,

        allStats.querySelector("input").checked

      );

    })

  );

  panel.onchange = drawCount;

  content.append(panel);

  drawCount();
}


/* ==========================================
   演習進捗
========================================== */

function serializeSession(s) {

  return {

    deckId: s.deck.id,

    revision:
      s.deck.contentVersion || "",

    questionIds:
      s.questions.map(q => q.id),

    index: s.index,

    correct: s.correct,

    wrongIds:
      s.wrong.map(q => q.id),

    revealed: s.revealed,

    allStats: s.allStats

  };
}

async function startSession(
  deck,
  questions,
  allStats = false
) {

  if (!questions.length) return;

  const old = await localGet(
    sessionKey()
  );

  if (

    old &&

    old.index < old.questionIds.length &&

    !confirm(
      "前回の演習進捗を置き換えますか？"
    )

  ) return;

  session = {

    deck,

    questions: [...questions],

    index: 0,

    correct: 0,

    wrong: [],

    revealed: false,

    allStats,

    loadedBlocks: new Set()

  };

  await localPut(

    sessionKey(),

    serializeSession(session)

  );

  await prepareBlock();

  await renderQuiz();
}

async function resumeSession() {

  const saved = await localGet(
    sessionKey()
  );

  if (!saved) return;

  const deck = await loadDeck(
    saved.deckId
  );

  const all = await loadQuestions(
    deck
  );

  const map = new Map(

    all.map(q => [q.id, q])

  );

  const questions = saved.questionIds.map(

    id => map.get(id)

  );

  if (questions.some(q => !q)) {

    throw new Error(

      "演習対象の問題が削除されています。" +

      "新しい演習を開始してください。"

    );
  }

  if (

    saved.revision !== undefined &&

    saved.revision !==
      (deck.contentVersion || "") &&

    !confirm(

      "演習中に問題集が改訂されています。" +

      "現在の問題内容で再開しますか？"

    )

  ) return;

  session = {

    deck,

    questions,

    index: saved.index,

    correct: saved.correct,

    wrong: saved.wrongIds

      .map(id => map.get(id))

      .filter(Boolean),

    revealed: saved.revealed,

    allStats: saved.allStats,

    loadedBlocks: new Set()

  };

  await prepareBlock();

  await renderQuiz();
}

async function prepareBlock() {

  const s = session;

  if (
    !s ||
    s.index >= s.questions.length
  ) return;

  const block = s.allStats

    ? 0

    : Math.floor(
        s.index / CONFIG.STATS_BLOCK
      );

  if (s.loadedBlocks.has(block)) return;

  const start =
    block * CONFIG.STATS_BLOCK;

  const items = s.allStats

    ? s.questions

    : s.questions.slice(

        start,

        start + CONFIG.STATS_BLOCK

      );

  if (online()) {

    notify(
      `成績を先読みしています：${items.length}問`
    );
  }

  await preloadStatistics(
    s.deck,
    items
  );

  s.loadedBlocks.add(block);
}


/* ==========================================
   成績表示
========================================== */

function accuracy(data) {

  const sum =
    data.correct + data.incorrect;

  if (!sum) return "—";

  return Math.round(

    data.correct / sum * 100

  ) + "%";
}

function statsPanel(stats) {

  const panel = el(
    "div",
    "quiz-stats"
  );

  if (!stats) {

    panel.append(

      el(

        "span",

        "muted",

        "過去の成績：未取得"

      )

    );

    return panel;
  }

  const personal = el("span");

  personal.append(

    el(
      "span",
      "muted",
      "自分："
    ),

    el(

      "strong",

      "quiz-correct",

      stats.personal.correct

    ),

    document.createTextNode("/"),

    el(

      "strong",

      "quiz-incorrect",

      stats.personal.incorrect

    ),

    document.createTextNode(

      ` (${accuracy(stats.personal)})`

    )

  );

  panel.append(

    personal,

    el(

      "span",

      "quiz-stats-total",

      `全体：${accuracy(stats.total)}`

    )

  );

  return panel;
}


/* ==========================================
   演習画面
========================================== */

async function renderQuiz(
  preserveScroll = false
) {

  if (!session) return;

  if (
    session.index >=
    session.questions.length
  ) {

    await renderResult();

    return;
  }

  const s = session;

  const q = s.questions[s.index];

  const oldScroll = main.scrollTop;

  main.replaceChildren();

  footer.hidden = false;

  const wrap = el("div", "quiz");

  const heading = el(
    "div",
    "toolbar"
  );

  heading.append(

    el("strong", "", s.deck.name),

    el(

      "span",

      "quiz-progress",

      `${s.index + 1} / ${s.questions.length}`

    ),

    button("演習終了", async () => {

      if (!confirm(

        "演習を中断しますか？途中から再開できます。"

      )) return;

      session = null;

      if (online()) {

        syncPending().catch(showError);
      }

      await renderPracticeSetup(
        s.deck.id
      );

    }, "secondary")

  );

  const track = el(
    "div",
    "progress-track"
  );

  const bar = el(
    "div",
    "progress-bar"
  );

  bar.style.width =

    `${s.index / s.questions.length * 100}%`;

  track.append(bar);

  const card = el(
    "section",
    "quiz-card"
  );

  const tags = el(
    "div",
    "quiz-tags"
  );

  tags.append(

    el(
      "span",
      "tag",
      `単元：${q.unit}`
    ),

    el(
      "span",
      "tag",
      `重要度：${q.importance}`
    )

  );

  const stats = statsMemory.get(

    statisticsKey(
      s.deck.id,
      q.id
    )

  )?.value;

  card.append(

    tags,

    statsPanel(stats),

    el(

      "div",

      "quiz-question",

      q.question

    )

  );

  quizButtons.replaceChildren();

  if (!s.revealed) {

    quizButtons.append(

      button("解答を表示", async () => {

        const next = {

          ...s,

          revealed: true

        };

        await localPut(

          sessionKey(),

          serializeSession(next)

        );

        session = next;

        await renderQuiz(true);

      })

    );

  } else {

    const answer = el(
      "div",
      "quiz-answer"
    );

    answer.append(

      el("div", "muted", "解答"),

      el(

        "div",

        "answer-text",

        q.answer

      )

    );

    if (q.explanation) {

      answer.append(

        el("h3", "", "解説"),

        el(

          "p",

          "explanation",

          q.explanation

        )

      );
    }

    card.append(answer);

    quizButtons.append(

      button(

        "× 不正解",

        () => grade(false),

        "danger"

      ),

      button(

        "○ 正解",

        () => grade(true),

        "success"

      )

    );
  }

  wrap.append(

    heading,

    track,

    card

  );

  main.append(wrap);

  main.scrollTop = preserveScroll

    ? oldScroll

    : 0;

  updateSyncStatus();
}


/* ==========================================
   自己採点

   成績と進捗をIndexedDBへ一括保存
========================================== */

async function grade(correct) {

  if (!session || !session.revealed) return;

  const s = session;

  const q = s.questions[s.index];

  const event = {

    id: newId(),

    uid: uid(),

    deckId: s.deck.id,

    questionId: q.id,

    correct,

    time: Date.now()

  };

  const next = {

    ...s,

    index: s.index + 1,

    correct:
      s.correct + (correct ? 1 : 0),

    wrong: correct

      ? [...s.wrong]

      : [...s.wrong, q],

    revealed: false

  };

  const entries = [

    [outboxKey(event), event],

    [sessionKey(), serializeSession(next)]

  ];

  const key = statisticsKey(

    s.deck.id,

    q.id

  );

  const cached = statsMemory.get(key);

  let updated = null;

  if (cached) {

    updated = {

      time: cached.time,

      value: {

        personal: {

          ...cached.value.personal

        },

        total: {

          ...cached.value.total

        }

      }

    };

    const countKey = correct

      ? "correct"

      : "incorrect";

    updated.value.personal[countKey]++;

    updated.value.total[countKey]++;

    if (canOffline(s.deck)) {

      entries.push([
        key,
        updated
      ]);
    }
  }

  await localWrite(entries);

  if (updated) {

    statsMemory.set(
      key,
      updated
    );
  }

  session = next;

  pendingCount++;

  updateSyncStatus();

  if (

    pendingCount >= CONFIG.SYNC_THRESHOLD &&

    online()

  ) {

    syncPending().catch(showError);
  }

  await prepareBlock();

  await renderQuiz();
}


/* ==========================================
   演習結果
========================================== */

async function renderResult() {

  if (!session) return;

  const finished = session;

  await localDelete(
    sessionKey()
  );

  session = null;

  if (online()) {

    syncPending().catch(showError);
  }

  const content = page("演習結果");

  const panel = el("section", "panel");

  const total = finished.questions.length;

  const percent = total

    ? Math.round(
        finished.correct / total * 100
      )

    : 0;

  panel.append(

    el(

      "p",

      "muted",

      finished.deck.name

    ),

    el(

      "div",

      "result-number",

      `${percent}%`

    )

  );

  const grid = el(
    "div",
    "stats-grid"
  );

  for (const [name, value] of [

    ["正解", finished.correct],

    ["不正解", finished.wrong.length]

  ]) {

    const box = el(
      "div",
      "stat-box"
    );

    box.append(

      el("span", "muted", name),

      el(

        "div",

        "stat-number",

        value

      )

    );

    grid.append(box);
  }

  panel.append(grid);

  const actions = el(
    "div",
    "actions"
  );

  if (finished.wrong.length) {

    actions.append(

      button(

        `間違えた${finished.wrong.length}問を再演習`,

        async () => {

          const latest = await loadDeck(

            finished.deck.id

          );

          const current = await loadQuestions(

            latest

          );

          const ids = new Set(

            finished.wrong.map(q => q.id)

          );

          const items = current.filter(

            q => ids.has(q.id)

          );

          if (!items.length) {

            throw new Error(
              "再演習できる問題がありません。"
            );
          }

          await startSession(

            latest,

            items

          );
        }

      )

    );
  }

  actions.append(

    button(

      "演習条件に戻る",

      () => renderPracticeSetup(
        finished.deck.id
      ),

      "secondary"

    ),

    button(

      "ホーム",

      () => navigate("home"),

      "secondary"

    )

  );

  panel.append(

    el(

      "p",

      "muted",

      "学習成績は端末内に保存され、順次同期されます。"

    ),

    actions

  );

  content.append(panel);

  for (const q of finished.wrong) {

    const item = el(
      "section",
      "panel"
    );

    item.append(

      el(

        "strong",

        "",

        q.question

      ),

      el(

        "p",

        "",

        `解答：${q.answer}`

      )

    );

    content.append(item);
  }
}


/* ==========================================
   問題別成績一覧
========================================== */

async function renderStatistics(id) {

  const deck = await loadDeck(id);

  const questions = await loadQuestions(deck);

  const content = page(

    "問題別成績",

    button(

      "演習",

      () => renderPracticeSetup(id)

    )

  );

  const panel = el("section", "panel");

  const actions = el("div", "actions");

  const wrap = el("div", "table-wrap");

  const indicator = el("span", "muted");

  const pageSize = 50;

  let current = 0;

  const pages = Math.max(

    1,

    Math.ceil(
      questions.length / pageSize
    )

  );

  async function draw(force = false) {

    wrap.textContent = "読み込み中…";

    const group = questions.slice(

      current * pageSize,

      (current + 1) * pageSize

    );

    await preloadStatistics(

      deck,

      group,

      force

    );

    const table = el("table");

    const head = el("tr");

    for (const title of [

      "問題",

      "単元",

      "重要度",

      "自分",

      "全体"

    ]) {

      head.append(
        el("th", "", title)
      );
    }

    const thead = el("thead");

    thead.append(head);

    table.append(thead);

    const tbody = el("tbody");

    for (const q of group) {

      const row = el("tr");

      const stats = statsMemory.get(

        statisticsKey(id, q.id)

      )?.value;

      const personal = stats

        ? `${stats.personal.correct}/` +

          `${stats.personal.incorrect} ` +

          `(${accuracy(stats.personal)})`

        : "未取得";

      const total = stats

        ? accuracy(stats.total)

        : "未取得";

      for (const value of [

        q.question,

        q.unit,

        q.importance,

        personal,

        total

      ]) {

        row.append(
          el("td", "", value)
        );
      }

      tbody.append(row);
    }

    table.append(tbody);

    wrap.replaceChildren(table);

    indicator.textContent =

      `${current + 1}/${pages}`;
  }

  actions.append(

    button("前へ", async () => {

      current = Math.max(
        0,
        current - 1
      );

      await draw();

    }, "secondary"),

    indicator,

    button("次へ", async () => {

      current = Math.min(
        pages - 1,
        current + 1
      );

      await draw();

    }, "secondary"),

    button(

      "成績を更新",

      () => draw(true),

      "secondary"

    )

  );

  panel.append(

    el("h2", "", deck.name),

    actions,

    wrap

  );

  content.append(panel);

  await draw();
}


/* ==========================================
   設定
========================================== */

async function renderSettings() {

  const content = page("設定");

  const account = el(
    "section",
    "panel"
  );

  account.append(

    el("h2", "", "アカウント"),

    el(

      "p",

      "",

      `ニックネーム：${profile.nickname}`

    ),

    el(

      "p",

      "",

      `メールアドレス：${user.email}`

    ),

    button("パスワードを再設定", async () => {

      await sendPasswordResetEmail(

        auth,

        user.email

      );

      notify(
        "再設定メールの送信を受け付けました。"
      );

    }, "secondary")

  );

  content.append(account);

  await refreshPending();

  const syncPanel = el(
    "section",
    "panel"
  );

  syncPanel.append(

    el("h2", "", "データ同期"),

    el(

      "p",

      "",

      `未同期記録：${pendingCount}件`

    ),

    el(

      "p",

      "muted",

      online()

        ? "オンライン"

        : "オフライン"

    ),

    button("今すぐ同期", async () => {

      await syncPending();

      await renderSettings();

    })

  );

  if (syncError) {

    syncPanel.append(

      el(

        "p",

        "red",

        syncError

      )

    );
  }

  content.append(syncPanel);

  const stats = el(
    "section",
    "panel"
  );

  stats.append(

    el("h2", "", "通信統計"),

    el(

      "p",

      "muted",

      "アプリ側の計測値です。" +

      "Firestoreの実際の課金件数とは異なります。"

    )

  );

  const grid = el(
    "div",
    "stats-grid"
  );

  for (const [name, value] of [

    ["読み取り要求", debug.readRequests],

    ["読み取り件数", debug.readDocuments],

    ["書き込み件数", debug.writeDocuments],

    ["キャッシュ利用", debug.cacheHits]

  ]) {

    const box = el(
      "div",
      "stat-box"
    );

    box.append(

      el("span", "muted", name),

      el(
        "div",
        "stat-number",
        value
      )

    );

    grid.append(box);
  }

  const actions = el(
    "div",
    "actions"
  );

  actions.append(

    button(

      "表示を更新",

      renderSettings,

      "secondary"

    ),

    button("計測リセット", async () => {

      window.MONDAI_DEBUG.reset();

      await renderSettings();

    }, "secondary")

  );

  stats.append(
    grid,
    actions
  );

  content.append(stats);

  const storage = el(
    "section",
    "panel"
  );

  storage.append(

    el("h2", "", "端末内データ"),

    el(

      "p",

      "muted",

      "未同期記録を除き、問題・成績キャッシュを消去します。"

    ),

    button("キャッシュを消去", async () => {

      if (!confirm(

        "端末内のキャッシュを消去しますか？"

      )) return;

      const keys = [];

      for (const prefix of [

        `deck:${uid()}:`,

        `questions:${uid()}:`,

        `stats:${uid()}:`

      ]) {

        const records = await localPrefix(
          prefix
        );

        keys.push(

          ...records.map(record => record.key)

        );
      }

      await localWrite([], keys);

      questionMemory.clear();

      statsMemory.clear();

      notify("キャッシュを消去しました。");

    }, "secondary")

  );

  content.append(storage);

  content.append(

    el(

      "p",

      "muted",

      `MONDAI Version ${VERSION}`

    )

  );
}


/* ==========================================
   差分検知デバッグ機能
========================================== */

window.MONDAI_DEBUG.testDiff = function(
  existing,
  incoming
) {

  const matching = matchCSV(

    existing,
    incoming

  );

  const decisions = new Map(

    matching.conflicts.map(

      item => [item.index, null]

    )

  );

  const plan = buildImportPlan(

    existing,

    incoming,

    "sync",

    matching,

    decisions,

    true

  );

  console.table(plan.details);

  console.log(
    "一致確認候補",
    matching.conflicts
  );

  return plan;
};


/* ==========================================
   Service Worker
========================================== */

if ("serviceWorker" in navigator) {

  navigator.serviceWorker

    .register("./sw.js?v=5.0")

    .catch(error => {

      console.warn(

        "Service Worker登録失敗",

        error

      );
    });
}

console.log(
  `MONDAI ver${VERSION}`
);

console.log(
  "通信統計：MONDAI_DEBUG.stats()"
);

console.log(
  "計測リセット：MONDAI_DEBUG.reset()"
);

/* ==========================================
   END
========================================== */
