
/* ==========================================
   MONDAI v0.4
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


/* ==========================================
   アプリ設定
========================================== */

const VERSION = "0.4";

const CONFIG = {
  MAX_IMPORT: 1000,
  MAX_CSV_BYTES: 5 * 1024 * 1024,

  PACK_SIZE: 50,
  PACK_BYTES: 450000,

  EDIT_BATCH: 8,

  STATS_BLOCK: 50,
  STATS_TTL: 5 * 60 * 1000,

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
let noticeTimer = null;

let syncJob = null;
let syncError = "";

let pendingCount = 0;

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
   デバッグ機能
========================================== */

const debug = {
  readRequests: 0,
  readDocuments: 0,

  writeRequests: 0,
  writeDocuments: 0,

  cacheHits: 0
};

function log(type, name, count = 0) {

  console.log(
    `[MONDAI ${VERSION}][${type}] ${name}`,
    count
  );
}

async function readDoc(ref, name) {

  debug.readRequests++;

  const snap = await getDocFromServer(ref);

  debug.readDocuments++;

  log("READ", name, 1);

  return snap;
}

async function readDocs(ref, name) {

  debug.readRequests++;

  const snap = await getDocsFromServer(ref);

  debug.readDocuments += Math.max(1, snap.size);

  log("READ", name, snap.size);

  return snap;
}

function wrote(name, count) {

  debug.writeRequests++;
  debug.writeDocuments += count;

  log("WRITE", name, count);
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
========================================== */

const localDB = new Promise((resolve, reject) => {

  const request = indexedDB.open(
    "MONDAI_LOCAL",
    1
  );

  request.onupgradeneeded = () => {

    const database = request.result;

    if (!database.objectStoreNames.contains("kv")) {

      database.createObjectStore("kv", {
        keyPath: "key"
      });

    }

  };

  request.onsuccess = () => resolve(request.result);

  request.onerror = () => reject(request.error);

});


async function localGet(key) {

  const database = await localDB;

  return new Promise((resolve, reject) => {

    const tx = database.transaction(
      "kv",
      "readonly"
    );

    const request = tx
      .objectStore("kv")
      .get(key);

    request.onsuccess = () => {
      resolve(request.result?.value);
    };

    request.onerror = () => reject(request.error);

  });

}


async function localWrite(entries, remove = []) {

  const database = await localDB;

  return new Promise((resolve, reject) => {

    const tx = database.transaction(
      "kv",
      "readwrite"
    );

    const store = tx.objectStore("kv");

    for (const [key, value] of entries) {

      store.put({
        key,
        value
      });

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


async function localPut(key, value) {
  return localWrite([[key, value]]);
}


async function localDelete(key) {
  return localWrite([], [key]);
}


async function localPrefix(prefix) {

  const database = await localDB;

  return new Promise((resolve, reject) => {

    const tx = database.transaction(
      "kv",
      "readonly"
    );

    const range = IDBKeyRange.bound(
      prefix,
      prefix + "\uffff"
    );

    const request = tx
      .objectStore("kv")
      .getAll(range);

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);

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
   共通UI
========================================== */

function el(tag, className = "", text = "") {

  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  node.textContent = text;

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

    "permission-denied":
      "アクセス権限がありません。",

    "unavailable":
      "通信できません。",

    "auth/email-already-in-use":
      "このメールアドレスは登録済みです。",

    "auth/invalid-credential":
      "メールアドレスまたはパスワードが違います。",

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

  const node = el(
    "button",
    className,
    text
  );

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

  for (const [key, name] of options) {

    const option = el("option", "", name);

    option.value = key;

    node.append(option);

  }

  node.value = value;

  return node;
}


function field(text, control) {

  const label = el("label", "", text);

  label.append(control);

  return label;
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

  return (

    !deck.deleted &&

    isOwner(deck) &&

    deck.visibility === "private"

  );

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

    throw new Error(
      "メールアドレスを入力してください。"
    );

  }

  await sendPasswordResetEmail(auth, email);

  notify("再設定メールの送信を受け付けました。");

});


$("profile-logout").onclick = () => act(() => signOut(auth));


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

    throw new Error(
      "使用できないニックネームです。"
    );

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

        throw new Error(
          "この名前はすでに使用されています。"
        );

      }

      tx.set(pRef, {
        nickname: name
      });

      tx.set(nRef, {
        uid: userId
      });

    });

    profile = {
      nickname: name
    };

    await localPut(
      `profile:${userId}`,
      profile
    );

    enterApp();

  });

};


let authGeneration = 0;

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

  if (!user) {

    showScreen("auth-screen");

    return;

  }

  const userId = user.uid;

  try {

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

      profile = snap.data();

      await localPut(
        `profile:${userId}`,
        profile
      );

    } else {

      profile = await localGet(
        `profile:${userId}`
      );

      if (!profile) {

        throw new Error(
          "初回ログインには通信が必要です。"
        );

      }

    }

    if (generation !== authGeneration) return;

    enterApp();

  } catch (error) {

    if (generation === authGeneration) {
      showError(error);
    }

  }

});


function enterApp() {

  showScreen("app-screen");

  const account = $("account");

  account.replaceChildren(

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

    "記録を端末内に保持してログアウトしますか？"

  )) return;

  session = null;

  await signOut(auth);

}


/* ==========================================
   ナビゲーション
========================================== */

$("navigation").onclick = event => {

  const node = event.target.closest(
    "[data-page]"
  );

  if (!node) return;

  act(() => navigate(node.dataset.page));

};


async function leaveSession() {

  if (!session) return true;

  if (!confirm(
    "演習を中断しますか？途中から再開できます。"
  )) return false;

  session = null;

  if (online()) {
    syncPending().catch(showError);
  }

  return true;

}


async function navigate(name) {

  if (!await leaveSession()) return;

  document
    .querySelectorAll("[data-page]")
    .forEach(node => {

      node.classList.toggle(
        "active",
        node.dataset.page === name
      );

    });

  if (name === "home") {
    return renderHome();
  }

  if (name === "settings") {
    return renderSettings();
  }

  return renderDeckList(name);

}


/* ==========================================
   デッキ取得
========================================== */

async function loadDeck(id) {

  const key = deckKey(id);

  if (!online()) {

    const stored = await localGet(key);

    if (!stored || !canOffline(stored)) {

      throw new Error(
        "オフラインでは保存済みの非公開デッキのみ利用できます。"
      );

    }

    debug.cacheHits++;

    return stored;

  }

  const snap = await readDoc(
    deckRef(id),
    "デッキ情報"
  );

  if (!snap.exists() || snap.data().deleted) {

    await localDelete(key);

    await localDelete(questionsKey(id));

    throw new Error(
      "デッキを利用できません。"
    );

  }

  const deck = {
    ...snap.data(),
    id: snap.id
  };

  if (canOffline(deck)) {

    await localPut(key, deck);

  } else {

    await localDelete(key);

    await localDelete(questionsKey(id));

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
   問題の集約取得
========================================== */

async function loadQuestions(deck, force = false) {

  const id = deck.id;

  const revision = deck.contentVersion || "";

  const memoryKey = `${uid()}:${id}`;

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

    log(
      "CACHE",
      "問題データ再利用",
      stored.items.length
    );

    return sortQuestions(stored.items);

  }

  if (!online()) {

    throw new Error(
      "この問題データは端末に保存されていません。"
    );

  }

  let items = [];

  if (deck.packGeneration && deck.packCount > 0) {

    try {

      for (let i = 0; i < deck.packCount; i += 8) {

        const ids = [];

        for (

          let j = i;

          j < Math.min(i + 8, deck.packCount);

          j++

        ) {

          ids.push(j);

        }

        const snaps = await Promise.all(

          ids.map(index => readDoc(

            packRef(
              id,
              `${deck.packGeneration}_${index}`
            ),

            "集約問題データ"

          ))

        );

        for (const snap of snaps) {

          if (!snap.exists()) {

            throw new Error(
              "集約データが不足しています。"
            );

          }

          items.push(
            ...snap.data().items
          );

        }

      }

    } catch (error) {

      console.warn(
        "集約データ取得失敗：旧形式を使用",
        error
      );

      items = null;

    }

  } else {

    items = null;

  }

  /* 既存の1問1ドキュメント形式との互換性 */

  if (items === null) {

    const snap = await readDocs(

      questionsRef(id),

      "旧形式の問題データ"

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


/* ==========================================
   集約問題データの作成

   最大50問、または容量制限で分割
   元の問題ID・成績は変更しない
========================================== */

function makePacks(items) {

  const packs = [];

  let current = [];

  let bytes = 0;

  const encoder = new TextEncoder();

  for (const q of sortQuestions(items)) {

    const item = {

      id: q.id,

      position: q.position,

      ...Object.fromEntries(

        FIELDS.map(([key]) => [
          key,
          String(q[key] ?? "")
        ])

      )

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

    throw new Error(
      "問題データを集約する権限がありません。"
    );

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

  /*
    集約中に共同編集者が変更した場合は、
    古い集約データを公開しない。
  */

  await runTransaction(db, async tx => {

    const snap = await tx.get(
      deckRef(deck.id)
    );

    debug.readRequests++;
    debug.readDocuments++;

    if (!snap.exists() || snap.data().deleted) {

      throw new Error(
        "デッキが存在しません。"
      );

    }

    if (

      (snap.data().contentVersion || "") !==

      (deck.contentVersion || "")

    ) {

      throw new Error(
        "集約中に問題が変更されました。更新してください。"
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
   ホーム
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

  const saved = await localGet(
    sessionKey()
  );

  if (saved) {

    const resume = el("section", "panel");

    resume.append(

      el("h2", "", "前回の演習"),

      el(
        "p",
        "",
        `${saved.index}/${saved.questionIds.length}問完了`
      ),

      button("途中から再開", resumeSession)

    );

    content.append(resume);

  }

  const grid = el("div", "deck-grid");

  const menus = [

    ["マイデッキ", "自分の問題集", "mine"],

    ["公開デッキ", "公開されている問題集", "public"],

    ["共有デッキ", "共有された問題集", "shared"]

  ];

  for (const [title, description, name] of menus) {

    const card = el("div", "deck-card");

    card.append(

      el("h2", "", title),

      el("p", "muted", description),

      button("開く", () => navigate(name))

    );

    grid.append(card);

  }

  content.append(grid);

  if (!online()) {

    content.append(

      el(
        "p",
        "muted",
        "オフライン：保存済みの非公開デッキを利用できます。"
      )

    );

  }

}


/* ==========================================
   デッキ一覧
========================================== */

async function fetchDecks(type) {

  if (!online()) {

    if (type !== "mine") return [];

    const stored = await localPrefix(
      `deck:${uid()}:`
    );

    return stored
      .map(item => item.value)
      .filter(canOffline);

  }

  const col = collection(db, "decks");

  let queries = [];

  if (type === "mine") {

    queries = [

      query(
        col,
        where("ownerId", "==", uid())
      )

    ];

  }

  if (type === "public") {

    queries = [

      query(
        col,
        where("visibility", "==", "public")
      )

    ];

  }

  if (type === "shared") {

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

  const results = await Promise.all(

    queries.map(q => readDocs(q, "デッキ一覧"))

  );

  const unique = new Map();

  for (const snap of results) {

    for (const item of snap.docs) {

      const deck = {

        ...item.data(),

        id: item.id

      };

      if (!deck.deleted) {

        unique.set(item.id, deck);

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

  const content = page(
    names[type],
    ...actions
  );

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

    const word = search.value.toLowerCase();

    const matched = decks.filter(deck =>

      `${deck.name} ${deck.ownerName}`
        .toLowerCase()
        .includes(word)

    );

    if (!matched.length) {

      grid.append(

        el(
          "p",
          "muted",
          "デッキがありません。"
        )

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

        el(
          "p",
          "muted",
          `公開者：${deck.ownerName}`
        )

      );

      const actions = el("div", "actions");

      actions.append(

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

        actions.append(

          button(
            "編集",
            () => renderEditor(deck.id),
            "secondary"
          )

        );

      }

      if (online() && isOwner(deck)) {

        actions.append(

          button(
            "設定",
            () => renderDeckSettings(deck.id),
            "secondary"
          )

        );

      }

      card.append(actions);

      grid.append(card);

    }

  }

  search.oninput = draw;

  draw();

}


/* ==========================================
   デッキ設定
========================================== */

async function resolveNicknames(text) {

  const names = [...new Set(

    text.split(/[,、\n]/)
      .map(s => s.trim())
      .filter(Boolean)

  )];

  if (names.length > 30) {

    throw new Error(
      "共有相手は各区分30人までです。"
    );

  }

  const result = [];

  for (const name of names) {

    validateNickname(name);

    const snap = await readDoc(

      doc(db, "nicknames", name),

      "ニックネーム検索"

    );

    if (!snap.exists()) {

      throw new Error(
        `「${name}」は登録されていません。`
      );

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

    throw new Error(
      "所有者のみ変更できます。"
    );

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

  const name = input(
    deck?.name || "",
    "デッキ名"
  );

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

  panel.append(form);

  panel.append(

    button("保存", async () => {

      const deckName = name.value.trim();

      if (!deckName || deckName.length > 100) {

        throw new Error(
          "デッキ名は1〜100文字です。"
        );

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

        name: deckName,

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

      if (values.visibility !== "private") {

        await localDelete(deckKey(savedId));

        await localDelete(questionsKey(savedId));

      }

      wrote("デッキ設定保存", 1);

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

        await updateDoc(

          deckRef(id),

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

        questionMemory.delete(`${uid()}:${id}`);

        await localDelete(deckKey(id));

        await localDelete(questionsKey(id));

        notify("デッキを削除しました。");

        await renderDeckList("mine");

      }, "danger")

    );

    content.append(danger);

  }

}


/* ==========================================
   問題データ検証
========================================== */

function validateQuestion(values) {

  const data = {};

  for (const [key] of FIELDS) {

    data[key] = String(
      values[key] ?? ""
    ).trim();

  }

  if (!data.question || !data.answer) {

    throw new Error(
      "問題・解答は必須です。"
    );

  }

  if (

    data.question.length > 10000 ||

    data.answer.length > 10000 ||

    data.explanation.length > 20000 ||

    data.unit.length > 100 ||

    data.importance.length > 50

  ) {

    throw new Error(
      "入力文字数が上限を超えています。"
    );

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

      .map(([key, node]) => [
        key,
        node.value
      ])

  );

}


/* ==========================================
   問題変更の保存

   共同編集との競合を検査し、
   集約データを同時に無効化する
========================================== */

async function applyChanges(deck, original, changes) {

  if (!canEdit(deck)) {

    throw new Error(
      "編集権限がありません。"
    );

  }

  if (!changes.length) return;

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
            "他の編集が反映されています。更新してください。"
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

      wrote(
        "問題変更",
        chunk.length + 1
      );

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

    questionMemory.delete(
      `${uid()}:${deck.id}`
    );

    await localDelete(
      questionsKey(deck.id)
    );

    throw new Error(

      `${saved}/${changes.length}件の変更を確認しました。` +

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

  /*
    問題変更後に集約データを再構築。
    失敗しても元の問題は保存済み。
  */

  try {

    await publishPacks(deck, items);

    notify("問題保存・データ集約が完了しました。");

  } catch (error) {

    console.warn(error);

    notify(

      "問題は保存済みです。集約は編集画面から再実行してください。",

      true

    );

  }

}


/* ==========================================
   CSV解析
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

        throw new Error(
          "CSVの引用符が不正です。"
        );

      }

      value += c;

    }

  }

  if (quoted) {

    throw new Error(
      "CSVの引用符が閉じられていません。"
    );

  }

  if (value || row.length || closed) {

    line();

  }

  return rows.filter(
    r => r.some(v => v.trim())
  );

}


function readCSV(text) {

  const rows = parseCSV(text);

  if (!rows.length) {

    throw new Error(
      "CSVが空です。"
    );

  }

  const aliases = [

    ["問題", "question"],

    ["解答", "回答", "answer"],

    ["解説", "explanation"],

    ["単元", "unit"],

    ["重要度", "importance"]

  ];

  const header = rows[0].map(
    value => value.trim().toLowerCase()
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

  if (!data.length || data.length > CONFIG.MAX_IMPORT) {

    throw new Error(
      "1回のCSVインポートは1〜1,000問です。"
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
        `${i + 1}行目：${error.message}`
      );

    }

  });

}


/* ==========================================
   CSV重複判定
========================================== */

function normalize(value) {

  return String(value ?? "")

    .normalize("NFC")

    .replace(/\s+/gu, " ")

    .trim();

}

function questionKey(q) {

  return normalize(q.question);

}

function pairKey(q) {

  return JSON.stringify([

    normalize(q.question),

    normalize(q.answer)

  ]);

}


function sameFields(a, b) {

  return FIELDS.every(

    ([key]) => a[key] === b[key]

  );

}


/* ==========================================
   CSVインポート計画
========================================== */

function planImport(
  existing,
  incoming,
  mode,
  keepAnswerHistory
) {

  const changes = [];

  const map = new Map(
    existing.map(q => [q.id, q])
  );

  const used = new Set();

  const seen = new Set();

  const csvQuestionKeys = new Set();

  let added = 0;

  let updated = 0;

  let skipped = 0;

  let removed = 0;

  let position = existing.reduce(

    (max, q) => Math.max(max, q.position),

    0

  );

  function add(q, pos) {

    const id = newId();

    const values = {

      ...q,

      position: pos,

      deleted: false

    };

    changes.push({

      type: "create",

      id,

      values

    });

    map.set(id, {
      ...values,
      id
    });

    used.add(id);

    added++;

  }

  function remove(q) {

    changes.push({

      type: "update",

      id: q.id,

      values: {
        deleted: true
      }

    });

    map.delete(q.id);

    removed++;

  }

  for (const incomingQuestion of incoming) {

    const pair = pairKey(incomingQuestion);

    if (mode !== "append" && seen.has(pair)) {

      skipped++;

      continue;

    }

    seen.add(pair);

    if (mode === "append") {

      add(
        incomingQuestion,
        ++position
      );

      continue;

    }

    const active = [...map.values()];

    const exact = active.filter(

      q => pairKey(q) === pair

    );

    if (mode === "skip") {

      if (exact.length) {

        skipped++;

      } else {

        add(
          incomingQuestion,
          ++position
        );

      }

      continue;

    }

    if (mode === "merge") {

      const qKey = questionKey(incomingQuestion);

      if (csvQuestionKeys.has(qKey)) {

        throw new Error(

          "同一問題文に異なる解答が含まれています。" +

          "追加方式を使用するか、CSVを修正してください。"

        );

      }

      csvQuestionKeys.add(qKey);

      const candidates = active.filter(

        q => questionKey(q) === qKey

      );

      if (candidates.length > 1) {

        throw new Error(

          `既存の同一問題文が複数あります：${incomingQuestion.question}`

        );

      }

      const match = candidates[0];

      if (!match) {

        add(
          incomingQuestion,
          ++position
        );

      } else if (sameFields(
        match,
        incomingQuestion
      )) {

        skipped++;

      } else if (

        normalize(match.answer) !==

        normalize(incomingQuestion.answer) &&

        !keepAnswerHistory

      ) {

        remove(match);

        add(
          incomingQuestion,
          match.position
        );

      } else {

        changes.push({

          type: "update",

          id: match.id,

          values: incomingQuestion

        });

        map.set(match.id, {

          ...match,

          ...incomingQuestion

        });

        updated++;

      }

      continue;

    }

    if (mode === "replace") {

      const match = exact.find(

        q => !used.has(q.id)

      );

      const newPosition = used.size + 1;

      if (match) {

        used.add(match.id);

        const values = {

          ...incomingQuestion,

          position: newPosition

        };

        if (

          !sameFields(match, incomingQuestion) ||

          match.position !== newPosition

        ) {

          changes.push({

            type: "update",

            id: match.id,

            values

          });

          map.set(match.id, {

            ...match,

            ...values

          });

          updated++;

        } else {

          skipped++;

        }

      } else {

        add(
          incomingQuestion,
          newPosition
        );

      }

    }

  }

  if (mode === "replace") {

    for (const q of existing) {

      if (!used.has(q.id)) {

        remove(q);

      }

    }

  }

  return {

    changes,

    added,

    updated,

    skipped,

    removed,

    total: map.size

  };

}


/* ==========================================
   CSV出力
========================================== */

function csvEscape(value) {

  let text = String(value ?? "");

  // 表計算ソフトで数式として実行されることを防止

  if (/^\s*[=+\-@]/.test(text)) {

    text = "'" + text;

  }

  return '"' +

    text.replaceAll('"', '""') +

    '"';

}


function downloadCSV(filename, rows) {

  const content = "\uFEFF" +

    rows.map(

      row => row.map(csvEscape).join(",")

    ).join("\r\n");

  const blob = new Blob(

    [content],

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

  const rows = [

    FIELDS.map(x => x[1]),

    ...questions.map(

      q => FIELDS.map(([key]) => q[key])

    )

  ];

  downloadCSV(

    `${deck.name.replace(/[\\/:*?"<>|]/g, "_")}.csv`,

    rows

  );

}


/* ==========================================
   問題編集画面
========================================== */

async function renderEditor(id, force = false) {

  const deck = await loadDeck(id);

  if (!online() || !canEdit(deck)) {

    throw new Error(
      "編集には通信と編集権限が必要です。"
    );

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

  /* データ集約 */

  const packPanel = el("section", "panel");

  packPanel.append(

    el("h2", "", "問題データの最適化"),

    el(

      "p",

      "muted",

      deck.packGeneration

        ? `集約済み：${deck.packCount}ドキュメント`

        : "未集約：旧形式の問題データを使用しています。"

    ),

    button("集約データを作成", async () => {

      if (!confirm(

        "既存の問題を最大50問単位にまとめます。" +

        "元の問題と学習成績は削除されません。"

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

  /* CSVインポート */

  const csvPanel = el("section", "panel");

  csvPanel.append(

    el("h2", "", "CSVインポート"),

    el(

      "p",

      "muted",

      "問題・解答・解説・単元・重要度。最大1,000問／回。"

    )

  );

  const file = el("input");

  file.type = "file";

  file.accept = ".csv,text/csv";

  const modes = [

    ["skip", "追加（重複を除外）"],

    ["append", "追加（重複を許可）"],

    ["merge", "追加・更新"]

  ];

  if (isOwner(deck)) {

    modes.push([
      "replace",
      "全体置き換え"
    ]);

  }

  const mode = select(modes, "skip");

  const history = checkItem(

    "解答変更時にも従来の成績を維持する",

    "keep",

    false

  );

  const preview = el("div", "panel");

  preview.hidden = true;

  mode.onchange = () => {
    preview.hidden = true;
  };

  file.onchange = () => {
    preview.hidden = true;
  };

  history.onchange = () => {
    preview.hidden = true;
  };

  const form = el("div", "form-grid");

  form.append(

    field("CSVファイル", file),

    field("インポート方式", mode),

    history

  );

  csvPanel.append(form);

  const csvActions = el("div", "actions");

  csvActions.append(

    button("変更内容を確認", async () => {

      const source = file.files[0];

      if (!source) {

        throw new Error(
          "CSVファイルを選択してください。"
        );

      }

      if (source.size > CONFIG.MAX_CSV_BYTES) {

        throw new Error(
          "CSVファイルは5MB以下です。"
        );

      }

      const incoming = readCSV(
        await source.text()
      );

      const latest = await loadDeck(id);

      const existing = await loadQuestions(latest);

      const plan = planImport(

        existing,

        incoming,

        mode.value,

        history.querySelector("input").checked

      );

      preview.hidden = false;

      preview.replaceChildren(

        el("h3", "", "インポート確認"),

        el("p", "", `現在：${existing.length}問`),

        el("p", "", `CSV：${incoming.length}問`),

        el("p", "", `追加：${plan.added}問`),

        el("p", "", `更新：${plan.updated}問`),

        el("p", "", `スキップ：${plan.skipped}問`),

        el("p", "", `除外：${plan.removed}問`),

        el(
          "strong",
          "",
          `変更後：${plan.total}問`
        )

      );

      preview.append(

        button("インポートを確定", async () => {

          if (plan.removed && !confirm(

            `${plan.removed}問をデッキから除外します。` +

            "続行しますか？"

          )) return;

          await applyChanges(

            latest,

            existing,

            plan.changes

          );

          await renderEditor(id);

        })

      );

    }),

    button(
      "CSV出力",
      () => exportDeck(id),
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

  csvPanel.append(
    csvActions,
    preview
  );

  content.append(csvPanel);

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

        (max, q) => Math.max(max, q.position),

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

  const pageSize = 50;

  let pageIndex = 0;

  function draw() {

    wrap.replaceChildren();

    const keyword = search.value.toLowerCase();

    const filtered = questions.filter(q =>

      `${q.question} ${q.answer} ${q.unit}`

        .toLowerCase()

        .includes(keyword)

    );

    const pages = Math.max(

      1,

      Math.ceil(filtered.length / pageSize)

    );

    pageIndex = Math.min(
      pageIndex,
      pages - 1
    );

    label.textContent =
      `${pageIndex + 1}/${pages}`;

    const table = el("table");

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

    const thead = el("thead");

    thead.append(head);

    table.append(thead);

    const tbody = el("tbody");

    const shown = filtered.slice(

      pageIndex * pageSize,

      (pageIndex + 1) * pageSize

    );

    shown.forEach((q, index) => {

      const row = el("tr");

      const edit = questionControls(q);

      row.append(

        el(

          "td",

          "",

          String(
            pageIndex * pageSize + index + 1
          )

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

          const values = validateQuestion(

            controlValues(edit)

          );

          await applyChanges(

            deck,

            questions,

            [{

              type: "update",

              id: q.id,

              values

            }]

          );

          await renderEditor(id);

        }, "secondary"),

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

        }, "danger")

      );

      row.append(operations);

      tbody.append(row);

    });

    table.append(tbody);

    wrap.append(table);

  }

  search.oninput = () => {

    pageIndex = 0;

    draw();

  };

  paging.append(

    button("前へ", () => {

      pageIndex = Math.max(0, pageIndex - 1);

      draw();

    }, "secondary"),

    label,

    button("次へ", () => {

      pageIndex++;

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
   正誤記録・未同期キュー
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

  const entries = await pendingEvents(userId);

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
          new Error("通信がタイムアウトしました。")
        ),

        ms

      );

    })

  ]).finally(() => clearTimeout(timer));

}


/* ==========================================
   1件の演習記録を原子的に保存

   個人成績
   全体成績
   同期済み記録ID

   3ドキュメントを同時更新
========================================== */

async function sendEvent(event) {

  if (auth.currentUser?.uid !== event.uid) {

    throw new Error(
      "アカウントが変更されました。"
    );

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

  const correct = event.correct ? 1 : 0;

  const incorrect = event.correct ? 0 : 1;

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

    wrote("正誤記録＋同期ID", 3);

  } catch (error) {

    /*
      通信切断等で保存結果が不明な場合、
      同期IDが存在するか確認する。

      同じIDによる二重加算は禁止されている。
    */

    let snap;

    try {

      snap = await timeout(

        readDoc(receipt, "同期ID確認"),

        CONFIG.SYNC_TIMEOUT

      );

    } catch {

      throw error;

    }

    if (!snap.exists()) {

      throw error;

    }

  }

  await localDelete(
    outboxKey(event)
  );

}


/* ==========================================
   未同期成績の一括処理
========================================== */

async function syncPending() {

  if (!user || !online()) return false;

  const userId = uid();

  if (syncJob) {

    return syncJob;

  }

  syncError = "";

  syncJob = (async () => {

    try {

      const events = await pendingEvents(userId);

      for (

        let i = 0;

        i < events.length;

        i += CONFIG.SYNC_PARALLEL

      ) {

        if (

          !online() ||

          auth.currentUser?.uid !== userId

        ) {

          throw new Error("同期を中断しました。");

        }

        const chunk = events.slice(

          i,

          i + CONFIG.SYNC_PARALLEL

        );

        const results = await Promise.allSettled(

          chunk.map(sendEvent)

        );

        await refreshPending();

        const failure = results.find(

          result => result.status === "rejected"

        );

        if (failure) {

          throw failure.reason;

        }

      }

      return true;

    } catch (error) {

      console.error("同期失敗", error);

      syncError = error.message;

      return false;

    }

  })();

  updateSyncStatus();

  try {

    return await syncJob;

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

      : "未同期の記録は端末内に保持されています。",

    !result

  );

});


window.addEventListener("online", () => {

  updateSyncStatus();

  syncPending().catch(showError);

});


window.addEventListener("offline", updateSyncStatus);


/* ==========================================
   正誤成績の取得・端末内キャッシュ
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

  const pending = pendingSet.has(questionId);

  if (

    !online() ||

    pending ||

    (

      !force &&

      cached &&

      Date.now() - cached.time < CONFIG.STATS_TTL

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

  const value = {

    personal: counts(personal),

    total: counts(total)

  };

  const entry = {

    time: Date.now(),

    value

  };

  statsMemory.set(key, entry);

  if (canOffline(deck)) {

    await localPut(key, entry);

  }

  return value;

}


/* ==========================================
   成績の先読み
========================================== */

async function preloadStatistics(

  deck,

  questions,

  force = false

) {

  const pending = await pendingEvents();

  const pendingSet = new Set(

    pending

      .filter(event => event.deckId === deck.id)

      .map(event => event.questionId)

  );

  for (

    let i = 0;

    i < questions.length;

    i += 8

  ) {

    const chunk = questions.slice(i, i + 8);

    await Promise.all(

      chunk.map(q =>

        getStatistics(
          deck,
          q.id,
          pendingSet,
          force
        ).catch(error => {

          console.warn(
            "成績先読み失敗",
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

  for (let i = result.length - 1; i > 0; i--) {

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

  const unitGroup = el("div", "check-group");

  const importanceGroup = el("div", "check-group");

  const customGroup = el("div", "custom-list");

  const units = [...new Set(

    questions.map(q => q.unit)

  )];

  const importance = [...new Set(

    questions.map(q => q.importance)

  )].sort((a, b) =>

    a.localeCompare(b, "ja", {
      numeric: true
    })

  );

  for (const unit of units) {

    unitGroup.append(
      checkItem(unit, unit)
    );

  }

  for (const value of importance) {

    importanceGroup.append(
      checkItem(value, value)
    );

  }

  questions.forEach((q, i) => {

    customGroup.append(

      checkItem(
        `${i + 1}. ${q.question}`,
        q.id,
        false
      )

    );

  });

  const normalArea = el("div");

  normalArea.append(

    el("h3", "", "単元"),

    unitGroup,

    el("h3", "", "重要度"),

    importanceGroup

  );

  const customArea = el("div");

  const customActions = el("div", "actions");

  const count = el("p", "muted");

  function selected() {

    if (mode.value === "custom") {

      const ids = selectedValues(customGroup);

      return questions.filter(
        q => ids.has(q.id)
      );

    }

    const units = selectedValues(unitGroup);

    const priorities = selectedValues(
      importanceGroup
    );

    return questions.filter(q =>

      units.has(q.unit) &&

      priorities.has(q.importance)

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

  customActions.append(

    button("全選択", () => {

      customGroup.querySelectorAll("input")

        .forEach(node => {
          node.checked = true;
        });

      drawCount();

    }, "secondary"),

    button("全解除", () => {

      customGroup.querySelectorAll("input")

        .forEach(node => {
          node.checked = false;
        });

      drawCount();

    }, "secondary")

  );

  customArea.append(

    customActions,

    customGroup

  );

  panel.append(

    field("演習モード", mode),

    normalArea,

    customArea,

    field("出題順序", order),

    allStats,

    el(

      "p",

      "muted",

      "標準では成績を50問ずつ先読みします。" +

      "全件先読みを選ぶと初回通信量が増えます。"

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
   演習の途中保存
========================================== */

function serializeSession(s) {

  return {

    deckId: s.deck.id,

    questionIds: s.questions.map(q => q.id),

    index: s.index,

    correct: s.correct,

    wrongIds: s.wrong.map(q => q.id),

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

    !confirm("前回の演習進捗を置き換えますか？")

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

  renderQuiz();

}


async function resumeSession() {

  const saved = await localGet(
    sessionKey()
  );

  if (!saved) return;

  const deck = await loadDeck(saved.deckId);

  const all = await loadQuestions(deck);

  const map = new Map(
    all.map(q => [q.id, q])
  );

  const questions = saved.questionIds.map(
    id => map.get(id)
  );

  if (questions.some(q => !q)) {

    throw new Error(

      "演習中の問題が削除されています。" +

      "演習条件画面から新しく開始してください。"

    );

  }

  session = {

    deck,

    questions,

    index: saved.index,

    correct: saved.correct,

    wrong: saved.wrongIds.map(id => map.get(id)),

    revealed: saved.revealed,

    allStats: saved.allStats,

    loadedBlocks: new Set()

  };

  await prepareBlock();

  renderQuiz();

}


async function prepareBlock() {

  const s = session;

  if (!s || s.index >= s.questions.length) return;

  const block = s.allStats

    ? 0

    : Math.floor(
      s.index / CONFIG.STATS_BLOCK
    );

  if (s.loadedBlocks.has(block)) return;

  const start = block * CONFIG.STATS_BLOCK;

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

  const panel = el("div", "quiz-stats");

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

    el("span", "muted", "自分："),

    el(
      "strong",
      "quiz-correct",
      String(stats.personal.correct)
    ),

    document.createTextNode("/"),

    el(
      "strong",
      "quiz-incorrect",
      String(stats.personal.incorrect)
    ),

    document.createTextNode(

      ` (${accuracy(stats.personal)})`

    )

  );

  const total = el(

    "span",

    "quiz-stats-total",

    `全体：${accuracy(stats.total)}`

  );

  panel.append(
    personal,
    total
  );

  return panel;

}


/* ==========================================
   演習画面

   中央mainのみスクロール
   操作ボタンはfooterに配置
========================================== */

function renderQuiz(preserveScroll = false) {

  if (!session) return;

  if (session.index >= session.questions.length) {

    renderResult().catch(showError);

    return;

  }

  const s = session;

  const q = s.questions[s.index];

  const oldScroll = main.scrollTop;

  main.replaceChildren();

  footer.hidden = false;

  const wrap = el("div", "quiz");

  const heading = el("div", "toolbar");

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

      const id = s.deck.id;

      session = null;

      if (online()) {

        syncPending().catch(showError);

      }

      await renderPracticeSetup(id);

    }, "secondary")

  );

  const track = el("div", "progress-track");

  const bar = el("div", "progress-bar");

  bar.style.width =

    `${s.index / s.questions.length * 100}%`;

  track.append(bar);

  const card = el("section", "quiz-card");

  const tags = el("div", "quiz-tags");

  tags.append(

    el("span", "tag", `単元：${q.unit}`),

    el("span", "tag", `重要度：${q.importance}`)

  );

  const stats = statsMemory.get(

    statisticsKey(s.deck.id, q.id)

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

        s.revealed = true;

        await localPut(

          sessionKey(),

          serializeSession(s)

        );

        renderQuiz(true);

      })

    );

  } else {

    const answer = el("div", "quiz-answer");

    answer.append(

      el("div", "muted", "解答"),

      el("div", "answer-text", q.answer)

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

   サーバー通信を待たず、
   IndexedDBへの保存完了後に次の問題へ
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

    correct: s.correct + (correct ? 1 : 0),

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

  /*
    成績と演習進捗を1回の
    IndexedDBトランザクションで保存する。
  */

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

  /*
    次の50問ブロックに入った時だけ
    必要な成績を先読みする。
  */

  await prepareBlock();

  renderQuiz();

}


/* ==========================================
   演習結果
========================================== */

async function renderResult() {

  if (!session) return;

  const finished = session;

  session = null;

  await localDelete(
    sessionKey()
  );

  if (online()) {

    syncPending().catch(showError);

  }

  const content = page("演習結果");

  const panel = el("section", "panel");

  const total = finished.questions.length;

  const percent = Math.round(

    finished.correct / total * 100

  );

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

  const grid = el("div", "stats-grid");

  for (const [name, value] of [

    ["正解", finished.correct],

    ["不正解", finished.wrong.length]

  ]) {

    const box = el("div", "stat-box");

    box.append(

      el("span", "muted", name),

      el("div", "stat-number", String(value))

    );

    grid.append(box);

  }

  panel.append(grid);

  const actions = el("div", "actions");

  if (finished.wrong.length) {

    actions.append(

      button(

        `間違えた${finished.wrong.length}問を再演習`,

        () => startSession(

          finished.deck,

          finished.wrong

        )

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

    el("p", "muted", "成績は端末に保存され、順次同期されます。"),

    actions

  );

  content.append(panel);

  for (const q of finished.wrong) {

    const item = el("section", "panel");

    item.append(

      el("strong", "", q.question),

      el("p", "", `解答：${q.answer}`)

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

    Math.ceil(questions.length / pageSize)

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

    const body = el("tbody");

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

      body.append(row);

    }

    table.append(body);

    wrap.replaceChildren(table);

    indicator.textContent =
      `${current + 1}/${pages}`;

  }

  actions.append(

    button("前へ", async () => {

      current = Math.max(0, current - 1);

      await draw();

    }, "secondary"),

    indicator,

    button("次へ", async () => {

      current = Math.min(pages - 1, current + 1);

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
   設定・通信統計
========================================== */

async function renderSettings() {

  const content = page("設定");

  const account = el("section", "panel");

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

      notify("再設定メールを送信しました。");

    }, "secondary")

  );

  content.append(account);

  const syncPanel = el("section", "panel");

  await refreshPending();

  const status = el(

    "p",

    "",

    `未同期記録：${pendingCount}件`

  );

  syncPanel.append(

    el("h2", "", "データ同期"),

    status,

    el(
      "p",
      "muted",
      online() ? "オンライン" : "オフライン"
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
        "muted",
        `同期エラー：${syncError}`
      )

    );

  }

  content.append(syncPanel);

  const stats = el("section", "panel");

  stats.append(

    el("h2", "", "通信統計"),

    el(

      "p",

      "muted",

      "アプリ側の計測値です。" +

      "Firebaseの実際の課金件数とは異なります。"

    )

  );

  const grid = el("div", "stats-grid");

  for (const [name, value] of [

    ["読み取り要求", debug.readRequests],

    ["読み取り件数", debug.readDocuments],

    ["書き込み件数", debug.writeDocuments],

    ["キャッシュ利用", debug.cacheHits]

  ]) {

    const box = el("div", "stat-box");

    box.append(

      el("span", "muted", name),

      el(
        "div",
        "stat-number",
        String(value)
      )

    );

    grid.append(box);

  }

  const actions = el("div", "actions");

  actions.append(

    button(

      "表示を更新",

      renderSettings,

      "secondary"

    ),

    button("カウンターをリセット", async () => {

      window.MONDAI_DEBUG.reset();

      await renderSettings();

    }, "secondary")

  );

  stats.append(
    grid,
    actions
  );

  content.append(stats);

  const storage = el("section", "panel");

  storage.append(

    el("h2", "", "端末内データ"),

    el(

      "p",

      "muted",

      "未同期の成績を除き、保存済み問題・成績キャッシュを消去します。"

    ),

    button("キャッシュを消去", async () => {

      if (!confirm(

        "端末内の問題・成績キャッシュを消去しますか？"

      )) return;

      const keys = [];

      for (const prefix of [

        `deck:${uid()}:`,

        `questions:${uid()}:`,

        `stats:${uid()}:`

      ]) {

        const records = await localPrefix(prefix);

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
   Service Worker登録
========================================== */

if ("serviceWorker" in navigator) {

  navigator.serviceWorker

    .register("./sw.js")

    .catch(error => {

      console.warn(

        "Service Workerの登録に失敗",

        error

      );

    });

}

console.log(
  `MONDAI v${VERSION}`
);

/* END */
