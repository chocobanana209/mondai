
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
