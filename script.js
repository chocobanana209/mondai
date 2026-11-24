
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

import {
  getFirestore, collection, doc,
  getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, runTransaction, writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

/* ==========================================
   MONDAI v0.2
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

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

/* ==========================================
   共通処理
========================================== */

const $ = id => document.getElementById(id);
const main = $("main");

let user = null;
let profile = null;
let session = null;
let noticeTimer;
let busy = false;

const visibilityNames = {
  public: "公開",
  limited: "限定公開",
  private: "非公開"
};

const columns = [
  ["question", "問題"],
  ["answer", "解答"],
  ["explanation", "解説"],
  ["unit", "単元"],
  ["importance", "重要度"]
];

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function notify(message, error = false) {
  $("notice").textContent = message;
  $("notice").className = error ? "error" : "";
  clearTimeout(noticeTimer);

  noticeTimer = setTimeout(() => {
    $("notice").textContent = "";
  }, 6000);
}

function errorMessage(error) {
  console.error(error);

  const messages = {
    "auth/email-already-in-use":
      "このメールアドレスは登録済みです。",
    "auth/invalid-credential":
      "メールアドレスまたはパスワードが違います。",
    "auth/weak-password":
      "パスワードは6文字以上にしてください。",
    "auth/invalid-email":
      "メールアドレスが正しくありません。",
    "auth/too-many-requests":
      "試行回数が多すぎます。時間をおいてください。",
    "auth/network-request-failed":
      "ネットワークに接続できません。",
    "permission-denied":
      "アクセス権限がありません。",
    "unavailable":
      "通信できません。接続を確認してください。"
  };

  notify(
    messages[error.code] ||
    error.message ||
    "エラーが発生しました。",
    true
  );
}

async function safely(action) {
  if (busy) return;
  busy = true;

  try {
    await action();
  } catch (error) {
    errorMessage(error);
  } finally {
    busy = false;
  }
}

function button(text, action, className = "") {
  const b = el("button", className, text);
  b.type = "button";

  b.addEventListener("click", async () => {
    if (busy) return;

    b.disabled = true;
    await safely(action);
    b.disabled = false;
  });

  return b;
}

function field(labelText, control) {
  const label = el("label", "", labelText);
  label.append(control);
  return label;
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

function select(options, current) {
  const node = el("select");

  for (const [value, text] of options) {
    const option = el("option", "", text);
    option.value = value;
    node.append(option);
  }

  node.value = current;
  return node;
}

function showScreen(name) {
  for (const id of [
    "auth-screen",
    "profile-screen",
    "app-screen"
  ]) {
    $(id).hidden = id !== name;
  }
}

function pageHeading(title, ...actions) {
  const heading = el("div", "page-heading");

  heading.append(el("h1", "", title));

  const group = el("div", "actions");
  group.append(...actions);

  heading.append(group);
  return heading;
}

function clearMain() {
  main.replaceChildren();
}

function updateAccount() {
  $("account").replaceChildren();

  if (!user) return;

  if (profile) {
    $("account").append(
      el("span", "", profile.nickname)
    );
  }

  $("account").append(
    button("ログアウト", async () => {
      if (
        session &&
        !confirm("演習を終了してログアウトしますか？")
      ) {
        return;
      }

      session = null;
      await signOut(auth);
    }, "secondary")
  );
}

/* ==========================================
   Firestore参照
========================================== */

function deckRef(id) {
  return doc(db, "decks", id);
}

function questionCollection(id) {
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

function personalRef(deckId, questionId) {
  return doc(
    db,
    "decks",
    deckId,
    "questions",
    questionId,
    "personalStats",
    user.uid
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

function isOwner(deck) {
  return deck.ownerId === user.uid;
}

function canEdit(deck) {
  return isOwner(deck) ||
    (deck.editorIds || []).includes(user.uid);
}

async function loadDeck(id) {
  const snap = await getDoc(deckRef(id));

  if (!snap.exists()) {
    throw new Error("デッキが存在しません。");
  }

  return {
    ...snap.data(),
    id: snap.id
  };
}

async function loadQuestions(id) {
  const snap = await getDocs(questionCollection(id));

  return snap.docs
    .map(d => ({
      ...d.data(),
      id: d.id
    }))
    .sort((a, b) =>
      a.position - b.position ||
      a.id.localeCompare(b.id)
    );
}

function normalizeNickname(value) {
  const name = value.trim();

  if (
    name.length < 2 ||
    name.length > 24 ||
    name.includes("/") ||
    name === ".." ||
    /^__.*__$/.test(name) ||
    /[\r\n,、]/.test(name)
  ) {
    throw new Error(
      "ニックネームは2〜24文字で、スラッシュや読点を含まない名前にしてください。"
    );
  }

  return name;
}

/* ==========================================
   ログイン・ユーザー登録
========================================== */

$("auth-form").addEventListener("submit", event => {
  event.preventDefault();

  safely(async () => {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );
  });
});

$("register").addEventListener("click", () => {
  safely(async () => {
    if (!$("auth-form").reportValidity()) return;

    await createUserWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );

    notify("アカウントを作成しました。");
  });
});

$("reset-password").addEventListener("click", () => {
  safely(async () => {
    const email = $("email").value.trim();

    if (!email) {
      throw new Error(
        "メールアドレスを入力してください。"
      );
    }

    await sendPasswordResetEmail(auth, email);

    notify(
      "パスワード再設定メールの送信を受け付けました。"
    );
  });
});

onAuthStateChanged(auth, async currentUser => {
  user = currentUser;
  profile = null;
  session = null;

  updateAccount();

  if (!user) {
    clearMain();
    showScreen("auth-screen");
    return;
  }

  try {
    const snap = await getDoc(
      doc(db, "profiles", user.uid)
    );

    if (!snap.exists()) {
      showScreen("profile-screen");
      return;
    }

    profile = snap.data();

    showScreen("app-screen");
    updateAccount();

    await navigate("home");

  } catch (error) {
    errorMessage(error);
  }
});

$("profile-form").addEventListener("submit", event => {
  event.preventDefault();

  safely(async () => {
    const nickname = normalizeNickname(
      $("nickname").value
    );

    const nameRef = doc(db, "nicknames", nickname);
    const profileRef = doc(db, "profiles", user.uid);

    await runTransaction(db, async tx => {
      const [nameSnap, profileSnap] = await Promise.all([
        tx.get(nameRef),
        tx.get(profileRef)
      ]);

      if (nameSnap.exists()) {
        throw new Error(
          "このニックネームは使用されています。"
        );
      }

      if (profileSnap.exists()) {
        throw new Error(
          "ニックネームは登録済みです。"
        );
      }

      tx.set(nameRef, {
        uid: user.uid
      });

      tx.set(profileRef, {
        nickname
      });
    });

    profile = { nickname };

    showScreen("app-screen");
    updateAccount();

    await navigate("home");

    notify("ニックネームを登録しました。");
  });
});

/* ==========================================
   ナビゲーション
========================================== */

$("navigation").addEventListener("click", event => {
  const target = event.target.closest("[data-page]");

  if (!target) return;

  safely(() => navigate(target.dataset.page));
});

async function navigate(page) {
  if (session) {
    if (!confirm(
      "演習を中断しますか？記録済みの正誤は保存されます。"
    )) {
      return;
    }

    session = null;
  }

  document
    .querySelectorAll("[data-page]")
    .forEach(b => {
      b.classList.toggle(
        "active",
        b.dataset.page === page
      );
    });

  if (page === "home") {
    return renderHome();
  }

  if (page === "mine") {
    return renderDeckList("mine");
  }

  if (page === "public") {
    return renderDeckList("public");
  }

  if (page === "shared") {
    return renderDeckList("shared");
  }

  if (page === "settings") {
    return renderSettings();
  }
}

/* ==========================================
   ホーム
========================================== */

function renderHome() {
  clearMain();

  main.append(
    pageHeading("ホーム"),
    el(
      "p",
      "muted",
      `${profile.nickname} さんの学習スペース`
    )
  );

  const grid = el("div", "deck-grid");

  const menus = [
    [
      "マイデッキ",
      "作成したデッキで学習する",
      "mine"
    ],
    [
      "公開デッキ",
      "公開されているデッキを探す",
      "public"
    ],
    [
      "共有デッキ",
      "共有・共同編集デッキを開く",
      "shared"
    ]
  ];

  for (const [title, description, page] of menus) {
    const card = el("div", "deck-card");

    card.append(
      el("h2", "", title),
      el("p", "muted", description),
      button("開く", () => navigate(page))
    );

    grid.append(card);
  }

  main.append(grid);
}

function renderSettings() {
  clearMain();

  const panel = el("section", "panel");

  panel.append(
    el("h2", "", "アカウント"),
    el("p", "", `ニックネーム：${profile.nickname}`),
    el("p", "", `メールアドレス：${user.email}`),
    el(
      "p",
      "muted",
      "ニックネームは現在変更できません。"
    ),

    button(
      "パスワード再設定メールを送信",
      async () => {
        await sendPasswordResetEmail(
          auth,
          user.email
        );

        notify("再設定メールを送信しました。");
      },
      "secondary"
    )
  );

  main.append(
    pageHeading("設定"),
    panel
  );
}

/* ==========================================
   デッキ一覧
========================================== */

async function fetchDecks(type) {
  const col = collection(db, "decks");

  let queries = [];

  if (type === "mine") {
    queries = [
      query(
        col,
        where("ownerId", "==", user.uid)
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
        where(
          "editorIds",
          "array-contains",
          user.uid
        )
      ),

      query(
        col,
        where(
          "viewerIds",
          "array-contains",
          user.uid
        )
      )
    ];
  }

  const snapshots = await Promise.all(
    queries.map(q => getDocs(q))
  );

  const unique = new Map();

  for (const snap of snapshots) {
    for (const item of snap.docs) {
      unique.set(item.id, {
        ...item.data(),
        id: item.id
      });
    }
  }

  return [...unique.values()].sort((a, b) =>
    (b.updatedAt?.seconds || 0) -
    (a.updatedAt?.seconds || 0)
  );
}

async function renderDeckList(type) {
  clearMain();

  const titles = {
    mine: "マイデッキ",
    public: "公開デッキ",
    shared: "共有デッキ"
  };

  const actions = [];

  if (type === "mine") {
    actions.push(
      button(
        "＋ 新規作成",
        () => renderDeckSettings()
      )
    );
  }

  main.append(
    pageHeading(titles[type], ...actions)
  );

  const search = input(
    "",
    "デッキ名・公開者を検索"
  );

  const grid = el("div", "deck-grid");

  main.append(search, grid);

  grid.append(
    el("p", "muted", "読み込み中…")
  );

  const decks = await fetchDecks(type);

  function draw() {
    grid.replaceChildren();

    const keyword = search.value
      .trim()
      .toLowerCase();

    const filtered = decks.filter(d =>
      `${d.name} ${d.ownerName}`
        .toLowerCase()
        .includes(keyword)
    );

    if (!filtered.length) {
      grid.append(
        el(
          "p",
          "muted",
          "該当するデッキがありません。"
        )
      );

      return;
    }

    for (const deck of filtered) {
      const card = $("deck-template")
        .content
        .firstElementChild
        .cloneNode(true);

      card.querySelector(".deck-name")
        .textContent = deck.name;

      const visibility =
        card.querySelector(".visibility");

      visibility.textContent =
        visibilityNames[deck.visibility];

      visibility.classList.add(deck.visibility);

      card.querySelector(".deck-meta")
        .textContent =
        `公開者：${deck.ownerName}` +
        (isOwner(deck) ? "（自分）" : "");

      const group =
        card.querySelector(".deck-actions");

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

      if (canEdit(deck)) {
        group.append(
          button(
            "編集",
            () => renderEditor(deck.id),
            "secondary"
          )
        );
      }

      if (isOwner(deck)) {
        group.append(
          button(
            "設定",
            () => renderDeckSettings(deck.id),
            "secondary"
          )
        );
      }

      grid.append(card);
    }
  }

  search.addEventListener("input", draw);

  draw();
}

/* ==========================================
   デッキ作成・公開設定・共有設定
========================================== */

async function resolveNicknames(text) {
  const names = [...new Set(
    text
      .split(/[,、\n]/)
      .map(s => s.trim())
      .filter(Boolean)
  )];

  if (names.length > 30) {
    throw new Error(
      "共有相手は各区分30人まで指定できます。"
    );
  }

  const result = [];

  for (const name of names) {
    normalizeNickname(name);

    const snap = await getDoc(
      doc(db, "nicknames", name)
    );

    if (!snap.exists()) {
      throw new Error(
        `「${name}」は登録されていません。`
      );
    }

    if (snap.data().uid !== user.uid) {
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
      "公開設定を変更できるのは所有者だけです。"
    );
  }

  clearMain();

  main.append(
    pageHeading(
      deck ? "デッキ設定" : "デッキを作成",

      button(
        "戻る",
        () => renderDeckList("mine"),
        "secondary"
      )
    )
  );

  const panel = el("section", "panel");

  const name = input(
    deck?.name || "",
    "デッキ名"
  );

  const visibility = select([
    ["private", "非公開：自分のみ"],
    ["limited", "限定公開：指定ユーザーのみ"],
    ["public", "公開：ログインユーザー全員"]
  ], deck?.visibility || "private");

  const editors = textarea(
    (deck?.editorNames || []).join("\n")
  );

  const viewers = textarea(
    (deck?.viewerNames || []).join("\n")
  );

  editors.placeholder =
    "共同編集者のニックネームを1行に1人";

  viewers.placeholder =
    "公開対象者のニックネームを1行に1人";

  const editorField = field(
    "共同編集者",
    editors
  );

  const viewerField = field(
    "限定公開の対象者",
    viewers
  );

  function updateVisibility() {
    editorField.hidden =
      visibility.value === "private";

    viewerField.hidden =
      visibility.value !== "limited";
  }

  visibility.addEventListener(
    "change",
    updateVisibility
  );

  updateVisibility();

  panel.append(
    field("デッキ名", name),
    field("公開範囲", visibility),
    editorField,
    viewerField,
    el(
      "p",
      "muted",
      "ニックネームは完全一致で指定してください。共同編集者は問題の追加・修正・削除ができます。"
    )
  );

  panel.append(
    button("保存", async () => {
      const deckName = name.value.trim();

      if (!deckName || deckName.length > 100) {
        throw new Error(
          "デッキ名は1〜100文字で入力してください。"
        );
      }

      if (
        visibility.value === "public" &&
        !confirm(
          "登録ユーザー全員が閲覧・CSV保存できる状態にしますか？"
        )
      ) {
        return;
      }

      const editorList =
        visibility.value === "private"
          ? []
          : await resolveNicknames(editors.value);

      const viewerList =
        visibility.value === "limited"
          ? await resolveNicknames(viewers.value)
          : [];

      const data = {
        name: deckName,
        visibility: visibility.value,
        editorIds: editorList.map(x => x.uid),
        editorNames: editorList.map(x => x.name),
        viewerIds: viewerList.map(x => x.uid),
        viewerNames: viewerList.map(x => x.name),
        updatedAt: serverTimestamp()
      };

      let savedId = id;

      if (id) {
        await updateDoc(deckRef(id), data);
      } else {
        const ref = await addDoc(
          collection(db, "decks"),
          {
            ...data,
            ownerId: user.uid,
            ownerName: profile.nickname,
            createdAt: serverTimestamp()
          }
        );

        savedId = ref.id;
      }

      notify("デッキを保存しました。");

      await renderEditor(savedId);
    })
  );

  main.append(panel);

  if (deck) {
    const dangerPanel = el("section", "panel");

    dangerPanel.append(
      el("h3", "", "デッキの削除"),

      el(
        "p",
        "muted",
        "削除するとデッキにアクセスできなくなります。"
      ),

      button("デッキを削除", async () => {
        if (!confirm(
          `「${deck.name}」を削除しますか？`
        )) {
          return;
        }

        await deleteDoc(deckRef(deck.id));

        notify("デッキを削除しました。");

        await renderDeckList("mine");
      }, "danger")
    );

    main.append(dangerPanel);
  }
}

/* ==========================================
   問題の入力検証
========================================== */

function validateQuestion(values) {
  const data = {};

  for (const [key] of columns) {
    data[key] = String(values[key] ?? "").trim();
  }

  if (!data.question || !data.answer) {
    throw new Error("問題と解答は必須です。");
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

function questionControls(question = {}) {
  return {
    question: textarea(question.question || ""),
    answer: textarea(question.answer || ""),
    explanation: textarea(question.explanation || ""),
    unit: input(question.unit || "", "単元名"),
    importance: input(
      question.importance || "",
      "例：1、2、3、4"
    )
  };
}

function controlValues(controls) {
  return Object.fromEntries(
    Object.entries(controls).map(
      ([key, node]) => [key, node.value]
    )
  );
}

/* ==========================================
   問題編集画面
========================================== */

async function renderEditor(id) {
  const deck = await loadDeck(id);

  if (!canEdit(deck)) {
    throw new Error("編集権限がありません。");
  }

  const questions = await loadQuestions(id);

  clearMain();

  main.append(
    pageHeading(
      deck.name,

      button(
        "演習",
        () => renderPracticeSetup(id)
      ),

      button(
        "戻る",
        () => renderDeckList(
          isOwner(deck) ? "mine" : "shared"
        ),
        "secondary"
      )
    )
  );

  const tools = el("section", "panel");
  const fileInput = el("input");

  fileInput.type = "file";
  fileInput.accept = ".csv,text/csv";

  tools.append(
    el("h2", "", "CSVインポート"),

    el(
      "p",
      "muted",
      "列順：問題、解答、解説、単元、重要度。1回につき最大1,000問。既存の問題に追加します。"
    ),

    fileInput
  );

  const csvActions = el("div", "actions");

  csvActions.append(
    button("インポート", async () => {
      if (!fileInput.files.length) {
        throw new Error(
          "CSVファイルを選択してください。"
        );
      }

      const file = fileInput.files[0];

      if (file.size > 5 * 1024 * 1024) {
        throw new Error(
          "CSVファイルは5MB以下にしてください。"
        );
      }

      await importCSV(
        id,
        await file.text()
      );

      await renderEditor(id);
    }),

    button(
      "CSVダウンロード",
      () => exportDeck(id),
      "secondary"
    ),

    button(
      "テンプレート",
      () => downloadCSV(
        "MONDAI_template.csv",
        [columns.map(x => x[1])]
      ),
      "secondary"
    )
  );

  tools.append(csvActions);
  main.append(tools);

  /* 手動追加 */

  const addPanel = el("section", "panel");

  addPanel.append(
    el("h2", "", "問題の追加")
  );

  const controls = questionControls();
  const fields = el("div", "form-grid");

  for (const [key, title] of columns) {
    fields.append(
      field(title, controls[key])
    );
  }

  addPanel.append(fields);

  addPanel.append(
    button("問題を追加", async () => {
      const data = validateQuestion(
        controlValues(controls)
      );

      const current = await loadQuestions(id);

      const position = current.reduce(
        (max, q) => Math.max(max, q.position),
        0
      ) + 1;

      await addDoc(
        questionCollection(id),
        {
          ...data,
          position
        }
      );

      notify("問題を追加しました。");

      await renderEditor(id);
    })
  );

  main.append(addPanel);

  /* 登録済み問題の一覧 */

  const list = el("section", "panel");

  list.append(
    el(
      "h2",
      "",
      `登録問題（${questions.length}問）`
    )
  );

  const search = input(
    "",
    "問題・解答・単元で検索"
  );

  const wrap = el("div", "table-wrap");

  list.append(search, wrap);
  main.append(list);

  function drawTable() {
    wrap.replaceChildren();

    const keyword = search.value.toLowerCase();

    const table = el("table");
    const head = el("tr");

    for (const title of [
      "No.",
      "問題",
      "解答",
      "解説",
      "単元",
      "重要度",
      "操作"
    ]) {
      head.append(el("th", "", title));
    }

    const thead = el("thead");
    thead.append(head);
    table.append(thead);

    const tbody = el("tbody");

    questions.forEach((q, i) => {
      if (
        !`${q.question} ${q.answer} ${q.unit}`
          .toLowerCase()
          .includes(keyword)
      ) {
        return;
      }

      const row = el("tr");
      const controls = questionControls(q);

      row.append(
        el("td", "", String(i + 1))
      );

      for (const [key] of columns) {
        const cell = el("td");

        cell.append(controls[key]);
        row.append(cell);
      }

      const operations = el("td");

      operations.append(
        button("保存", async () => {
          const values = validateQuestion(
            controlValues(controls)
          );

          await updateDoc(
            questionRef(id, q.id),
            values
          );

          Object.assign(q, values);

          notify("問題を保存しました。");
        }, "secondary"),

        button("削除", async () => {
          if (!confirm(
            "この問題を削除しますか？"
          )) {
            return;
          }

          await deleteDoc(
            questionRef(id, q.id)
          );

          notify("問題を削除しました。");

          await renderEditor(id);
        }, "danger")
      );

      row.append(operations);
      tbody.append(row);
    });

    table.append(tbody);
    wrap.append(table);
  }

  search.addEventListener(
    "input",
    drawTable
  );

  drawTable();
}

/* ==========================================
   CSV解析
========================================== */

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");

  const rows = [];

  let row = [];
  let cell = "";
  let quoted = false;
  let closed = false;

  function pushCell() {
    row.push(cell);
    cell = "";
    closed = false;
  }

  function pushRow() {
    pushCell();
    rows.push(row);
    row = [];
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (
        char === '"' &&
        text[i + 1] === '"'
      ) {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else {
        cell += char;
      }

      continue;
    }

    if (
      char === '"' &&
      cell === "" &&
      !closed
    ) {
      quoted = true;

    } else if (char === ",") {
      pushCell();

    } else if (
      char === "\r" ||
      char === "\n"
    ) {
      if (
        char === "\r" &&
        text[i + 1] === "\n"
      ) {
        i++;
      }

      pushRow();

    } else {
      if (closed || char === '"') {
        throw new Error(
          "CSVの引用符の形式が正しくありません。"
        );
      }

      cell += char;
    }
  }

  if (quoted) {
    throw new Error(
      "CSVの引用符が閉じられていません。"
    );
  }

  if (
    cell !== "" ||
    row.length ||
    closed
  ) {
    pushRow();
  }

  return rows.filter(
    r => r.some(v => v.trim() !== "")
  );
}

/* ==========================================
   CSVインポート
   v0.2：最大1,000問
========================================== */

async function importCSV(id, text) {
  const deck = await loadDeck(id);

  if (!canEdit(deck)) {
    throw new Error("編集権限がありません。");
  }

  const rows = parseCSV(text);

  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const first = rows[0].map(
    s => s.trim().toLowerCase()
  );

  const aliases = [
    ["問題", "question"],
    ["解答", "回答", "answer"],
    ["解説", "explanation"],
    ["単元", "unit"],
    ["重要度", "importance"]
  ];

  const headerIndexes = aliases.map(names =>
    first.findIndex(v => names.includes(v))
  );

  const hasHeader =
    headerIndexes[0] !== -1 &&
    headerIndexes[1] !== -1;

  const indexes = hasHeader
    ? headerIndexes
    : [0, 1, 2, 3, 4];

  const dataRows = hasHeader
    ? rows.slice(1)
    : rows;

  if (!dataRows.length) {
    throw new Error(
      "インポートする問題がありません。"
    );
  }

  if (dataRows.length > 1000) {
    throw new Error(
      "1回のインポートは1,000問までです。分割してください。"
    );
  }

  /* 全問題を事前検証 */

  const data = dataRows.map((row, index) => {
    try {
      const values = {};

      columns.forEach(([key], i) => {
        values[key] = row[indexes[i]] || "";
      });

      return validateQuestion(values);

    } catch (error) {
      throw new Error(
        `データ${index + 1}行目：${error.message}`
      );
    }
  });

  if (!confirm(
    `${data.length}問を追加しますか？`
  )) {
    return;
  }

  const existing = await loadQuestions(id);

  let position = existing.reduce(
    (max, q) => Math.max(max, q.position),
    0
  );

  /*
    Firestoreへの書き込みを100問ずつ分割する。
    インポート途中で失敗した場合は、
    保存を確認できた問題数を通知する。
  */

  let saved = 0;

  for (let i = 0; i < data.length; i += 100) {
    const chunk = data.slice(i, i + 100);
    const batch = writeBatch(db);

    for (const values of chunk) {
      const ref = doc(
        questionCollection(id)
      );

      batch.set(ref, {
        ...values,
        position: ++position
      });
    }

    try {
      await batch.commit();
      saved += chunk.length;

      notify(
        `インポート中：${saved}/${data.length}問`
      );

    } catch (error) {
      console.error(error);

      throw new Error(
        `インポート中断：${saved}/${data.length}問の保存を確認しました。登録済み問題を確認し、未登録分だけ再実行してください。(${error.code || error.message})`
      );
    }
  }

  notify(
    `${data.length}問をインポートしました。`
  );
}

/* ==========================================
   CSVエクスポート
========================================== */

function csvEscape(value) {
  let text = String(value ?? "");

  /* CSVの数式インジェクション対策 */

  if (
    /^\s*[=+\-@]/.test(text) ||
    /^[\t\r\n]/.test(text)
  ) {
    text = "'" + text;
  }

  return '"' +
    text.replaceAll('"', '""') +
    '"';
}

function downloadCSV(filename, rows) {
  const content = "\uFEFF" + rows.map(
    row => row.map(csvEscape).join(",")
  ).join("\r\n");

  const blob = new Blob(
    [content],
    {
      type: "text/csv;charset=utf-8;"
    }
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
  const questions = await loadQuestions(id);

  const rows = [
    columns.map(x => x[1]),

    ...questions.map(
      q => columns.map(([key]) => q[key])
    )
  ];

  downloadCSV(
    `${deck.name.replace(/[\\/:*?"<>|]/g, "_")}.csv`,
    rows
  );

  notify("CSVを出力しました。");
}

/* ==========================================
   チェックボックス・シャッフル
========================================== */

function checkItem(text, value, checked = true) {
  const label = el("label", "check-item");
  const checkbox = el("input");

  checkbox.type = "checkbox";
  checkbox.value = value;
  checkbox.checked = checked;

  label.append(
    checkbox,
    el("span", "", text)
  );

  return label;
}

function checkedValues(container) {
  return new Set(
    [...container.querySelectorAll("input:checked")]
      .map(node => node.value)
  );
}

function shuffle(items) {
  const array = [...items];

  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [array[i], array[j]] =
      [array[j], array[i]];
  }

  return array;
}

/* ==========================================
   演習条件の設定
========================================== */

async function renderPracticeSetup(id) {
  const deck = await loadDeck(id);
  const questions = await loadQuestions(id);

  clearMain();

  main.append(
    pageHeading(
      deck.name,

      button(
        "ホーム",
        () => navigate("home"),
        "secondary"
      )
    )
  );

  if (!questions.length) {
    main.append(
      el(
        "p",
        "muted",
        "問題が登録されていません。"
      )
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

  const units = [
    ...new Set(questions.map(q => q.unit))
  ];

  const importance = [
    ...new Set(questions.map(q => q.importance))
  ].sort((a, b) =>
    a.localeCompare(
      b,
      "ja",
      { numeric: true }
    )
  );

  const unitGroup = el("div", "check-group");

  const importanceGroup =
    el("div", "check-group");

  const customGroup =
    el("div", "custom-list");

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

  function getSelected() {
    if (mode.value === "custom") {
      const selected = checkedValues(
        customGroup
      );

      return questions.filter(
        q => selected.has(q.id)
      );
    }

    const selectedUnits =
      checkedValues(unitGroup);

    const selectedImportance =
      checkedValues(importanceGroup);

    return questions.filter(q =>
      selectedUnits.has(q.unit) &&
      selectedImportance.has(q.importance)
    );
  }

  function updateCount() {
    normalArea.hidden =
      mode.value !== "normal";

    customArea.hidden =
      mode.value !== "custom";

    const available = getSelected().length;

    const amount =
      order.value === "random20"
        ? Math.min(20, available)
        : available;

    count.textContent =
      `対象：${available}問 ／ 出題：${amount}問`;
  }

  customActions.append(
    button("全選択", () => {
      customGroup
        .querySelectorAll("input")
        .forEach(node => {
          node.checked = true;
        });

      updateCount();
    }, "secondary"),

    button("全解除", () => {
      customGroup
        .querySelectorAll("input")
        .forEach(node => {
          node.checked = false;
        });

      updateCount();
    }, "secondary")
  );

  customArea.append(
    el("h3", "", "出題する問題を選択"),
    customActions,
    customGroup
  );

  panel.append(
    field("演習モード", mode),
    normalArea,
    customArea,
    field("出題順序", order),
    count
  );

  panel.append(
    button("演習を開始", async () => {
      let selected = getSelected();

      if (!selected.length) {
        throw new Error(
          "出題する問題を選択してください。"
        );
      }

      if (order.value !== "ordered") {
        selected = shuffle(selected);
      }

      if (order.value === "random20") {
        selected = selected.slice(0, 20);
      }

      await startSession(deck, selected);
    })
  );

  panel.addEventListener(
    "change",
    updateCount
  );

  main.append(panel);
  updateCount();
}

/* ==========================================
   問題別の正誤記録
========================================== */

function counters(snapshot) {
  const data = snapshot.exists()
    ? snapshot.data()
    : {};

  return {
    correct: data.correct || 0,
    incorrect: data.incorrect || 0
  };
}

async function getStatistics(deckId, questionId) {
  const [personal, total] = await Promise.all([
    getDoc(
      personalRef(deckId, questionId)
    ),

    getDoc(
      totalRef(deckId, questionId)
    )
  ]);

  return {
    personal: counters(personal),
    total: counters(total)
  };
}

async function recordAnswer(
  deckId,
  questionId,
  correct
) {
  const personal = personalRef(
    deckId,
    questionId
  );

  const total = totalRef(
    deckId,
    questionId
  );

  await runTransaction(db, async tx => {
    const [pSnap, tSnap] = await Promise.all([
      tx.get(personal),
      tx.get(total)
    ]);

    const p = counters(pSnap);
    const t = counters(tSnap);

    const key = correct
      ? "correct"
      : "incorrect";

    p[key]++;
    t[key]++;

    tx.set(personal, p);

    tx.set(total, {
      ...t,
      lastUid: user.uid
    });
  });
}

/* ==========================================
   v0.2：コンパクトな正答率表示

   自分：21/4 (84%) ｜ 全体：76%
   正解回数：緑色
   不正解回数：赤色
========================================== */

function statsPanel(stats) {
  const percent = data => {
    const count =
      data.correct + data.incorrect;

    return count
      ? Math.round(
          data.correct / count * 100
        ) + "%"
      : "—";
  };

  const row = el("div", "quiz-stats");

  const personal = el(
    "span",
    "quiz-stats-personal"
  );

  const correctNumber = el(
    "strong",
    "quiz-correct",
    String(stats.personal.correct)
  );

  const incorrectNumber = el(
    "strong",
    "quiz-incorrect",
    String(stats.personal.incorrect)
  );

  personal.append(
    el("span", "muted", "自分："),
    correctNumber,
    document.createTextNode("/"),
    incorrectNumber,

    document.createTextNode(
      ` (${percent(stats.personal)})`
    )
  );

  const total = el(
    "span",
    "quiz-stats-total"
  );

  total.append(
    el("span", "muted", "全体："),

    el(
      "strong",
      "",
      percent(stats.total)
    )
  );

  row.append(
    personal,
    total
  );

  return row;
}

/* ==========================================
   演習開始
========================================== */

async function startSession(deck, questions) {
  session = {
    deck,
    questions: [...questions],
    index: 0,
    correct: 0,
    wrong: [],
    revealed: false
  };

  await renderQuiz();
}

/* ==========================================
   演習画面
========================================== */

async function renderQuiz() {
  if (!session) return;

  if (
    session.index >=
    session.questions.length
  ) {
    return renderResult();
  }

  clearMain();

  const s = session;
  const q = s.questions[s.index];

  const wrap = el("div", "quiz");

  /* ヘッダー */

  const heading = el("div", "toolbar");

  heading.append(
    el("strong", "", s.deck.name),

    el(
      "span",
      "",
      `${s.index + 1} / ${s.questions.length}`
    ),

    button("演習終了", async () => {
      if (!confirm(
        "演習を終了しますか？"
      )) {
        return;
      }

      const id = s.deck.id;

      session = null;

      await renderPracticeSetup(id);
    }, "secondary")
  );

  /* 進捗バー */

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

  /* 問題カード */

  const card = el("div", "quiz-card");

  const statsSlot = el(
    "div",
    "quiz-stats-slot",
    "成績を読み込み中…"
  );

  card.append(
    el(
      "span",
      "tag",
      `単元：${q.unit}`
    ),

    document.createTextNode(" "),

    el(
      "span",
      "tag",
      `重要度：${q.importance}`
    ),

    statsSlot,

    el(
      "div",
      "quiz-question",
      q.question
    )
  );

  const buttons = el(
    "div",
    "quiz-buttons"
  );

  /* 解答表示前 */

  if (!s.revealed) {
    buttons.append(
      button("解答を表示", async () => {
        s.revealed = true;

        await renderQuiz();
      })
    );

  } else {

    /* 解答・解説 */

    const answerArea = el(
      "div",
      "quiz-answer"
    );

    answerArea.append(
      el("p", "muted", "解答"),

      el(
        "div",
        "answer-text",
        q.answer
      )
    );

    if (q.explanation) {
      answerArea.append(
        el("h3", "", "解説"),

        el(
          "p",
          "explanation",
          q.explanation
        )
      );
    }

    card.append(answerArea);

    /* 自己採点 */

    buttons.append(
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
    card,
    buttons
  );

  main.append(wrap);

  /*
    問題表示時点で成績を取得する。
    解答表示時には同じ成績を再利用する。
  */

  try {
    if (s.statsQuestionId !== q.id) {
      s.stats = await getStatistics(
        s.deck.id,
        q.id
      );

      s.statsQuestionId = q.id;
    }

    if (
      session === s &&
      s.questions[s.index]?.id === q.id
    ) {
      statsSlot.replaceChildren(
        statsPanel(s.stats)
      );
    }

  } catch (error) {
    statsSlot.textContent =
      "成績を取得できませんでした。";

    errorMessage(error);
  }
}

/* ==========================================
   自己採点
========================================== */

async function grade(correct) {
  if (
    !session ||
    !session.revealed
  ) {
    return;
  }

  const s = session;
  const q = s.questions[s.index];

  /*
    Firestoreへの保存が完了するまで
    次の問題に進まない。
  */

  await recordAnswer(
    s.deck.id,
    q.id,
    correct
  );

  if (correct) {
    s.correct++;
  } else {
    s.wrong.push(q);
  }

  s.index++;
  s.revealed = false;

  await renderQuiz();
}

/* ==========================================
   演習結果・再演習
========================================== */

function renderResult() {
  const finished = session;

  const total = finished.questions.length;

  const wrong = [...finished.wrong];

  const correct = finished.correct;

  const percent = Math.round(
    correct / total * 100
  );

  session = null;

  clearMain();

  const panel = el(
    "section",
    "panel quiz"
  );

  panel.append(
    el("h2", "", "演習結果"),

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

  const stats = el(
    "div",
    "stats-grid"
  );

  const correctBox = el(
    "div",
    "stat-box"
  );

  correctBox.append(
    el("p", "", "正解"),

    el(
      "div",
      "stat-number",
      String(correct)
    )
  );

  const wrongBox = el(
    "div",
    "stat-box"
  );

  wrongBox.append(
    el("p", "", "不正解"),

    el(
      "div",
      "stat-number",
      String(wrong.length)
    )
  );

  stats.append(
    correctBox,
    wrongBox
  );

  panel.append(stats);

  const actions = el(
    "div",
    "actions"
  );

  actions.style.marginTop = "20px";

  if (wrong.length) {
    const wrongList = el("div");

    wrongList.append(
      el("h3", "", "間違えた問題")
    );

    wrong.forEach((q, i) => {
      const item = el(
        "div",
        "panel"
      );

      item.append(
        el(
          "strong",
          "",
          `${i + 1}. ${q.question}`
        ),

        el(
          "p",
          "",
          `解答：${q.answer}`
        )
      );

      wrongList.append(item);
    });

    panel.append(wrongList);

    actions.append(
      button(
        `間違えた${wrong.length}問を再演習`,

        () => startSession(
          finished.deck,
          wrong
        )
      )
    );

  } else {
    panel.append(
      el("p", "", "全問正解です。")
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
      "ホームに戻る",
      () => navigate("home"),
      "secondary"
    )
  );

  panel.append(actions);

  main.append(panel);
}

/* ==========================================
   問題別成績一覧
========================================== */

async function renderStatistics(id) {
  const deck = await loadDeck(id);
  const questions = await loadQuestions(id);

  clearMain();

  main.append(
    pageHeading(
      "問題別成績",

      button(
        "演習",
        () => renderPracticeSetup(id)
      ),

      button(
        "ホーム",
        () => navigate("home"),
        "secondary"
      )
    ),

    el("p", "muted", deck.name)
  );

  const panel = el("section", "panel");
  const wrap = el("div", "table-wrap");
  const table = el("table");

  const headings = [
    "No.",
    "問題",
    "単元",
    "重要度",
    "自分・正解",
    "自分・不正解",
    "全体・正解",
    "全体・不正解"
  ];

  const head = el("tr");

  headings.forEach(title => {
    head.append(
      el("th", "", title)
    );
  });

  const thead = el("thead");

  thead.append(head);
  table.append(thead);

  const body = el("tbody");

  table.append(body);

  wrap.append(table);
  panel.append(wrap);

  main.append(panel);

  /*
    同時読み込み数を10問に制限。
    問題数が多い場合も順次表示する。
  */

  for (
    let i = 0;
    i < questions.length;
    i += 10
  ) {
    const group = questions.slice(
      i,
      i + 10
    );

    const results = await Promise.all(
      group.map(q =>
        getStatistics(id, q.id)
      )
    );

    group.forEach((q, index) => {
      const stats = results[index];

      const values = [
        i + index + 1,
        q.question,
        q.unit,
        q.importance,
        stats.personal.correct,
        stats.personal.incorrect,
        stats.total.correct,
        stats.total.incorrect
      ];

      const row = el("tr");

      values.forEach(value => {
        row.append(
          el("td", "", String(value))
        );
      });

      body.append(row);
    });
  }
}

/* ==========================================
   MONDAI v0.2
   END OF SCRIPT
========================================== */
