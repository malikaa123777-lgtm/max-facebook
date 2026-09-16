/* =========================================================
   ماكس — وحدة تحكم صفحات فيسبوك
   يعمل بالكامل من طرف المتصفح (بدون خادم خلفي).
   يستخدم Gemini للفهم واتخاذ القرار، وGraph API لتنفيذ الإجراءات.
   ========================================================= */

const FB_API_VERSION = "v19.0";
const GEMINI_MODEL = "gemini-2.5-flash";

const state = {
  geminiKey: localStorage.getItem("maxfb_gemini_key") || "",
  pages: JSON.parse(localStorage.getItem("maxfb_pages") || "[]"), // [{id,name,pageId,token}]
  activePageId: null,
  history: [], // Gemini conversation turns
};

/* ---------------------------------------------------------
   1) خلفية Three.js — جسيمات هادئة توحي بشبكة عصبية
   --------------------------------------------------------- */
function initBackground() {
  const canvas = document.getElementById("bg-canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
  camera.position.z = 60;

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener("resize", resize);

  const COUNT = 220;
  const positions = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 140;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 90;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0x34e2c4, size: 0.9, transparent: true, opacity: 0.75 });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  const linesGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.LineBasicMaterial({ color: 0x8b7bf0, transparent: true, opacity: 0.08 });
  const linePositions = [];
  for (let i = 0; i < COUNT; i += 6) {
    const j = (i + 5) % COUNT;
    linePositions.push(
      positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
      positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]
    );
  }
  linesGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  scene.add(new THREE.LineSegments(linesGeo, lineMat));

  (function animate() {
    requestAnimationFrame(animate);
    points.rotation.y += 0.0006;
    points.rotation.x += 0.0002;
    renderer.render(scene, camera);
  })();
}

/* ---------------------------------------------------------
   2) إدارة الحالة: الصفحات والإعدادات (تخزين محلي بالمتصفح)
   --------------------------------------------------------- */
function persistPages() {
  localStorage.setItem("maxfb_pages", JSON.stringify(state.pages));
}
function persistGeminiKey() {
  localStorage.setItem("maxfb_gemini_key", state.geminiKey);
}

function renderPageList() {
  const ul = document.getElementById("page-list");
  const select = document.getElementById("active-page-select");
  ul.innerHTML = "";
  select.innerHTML = '<option value="">— اختر صفحة —</option>';

  if (state.pages.length === 0) {
    ul.innerHTML = '<li class="page-empty">ما في صفحات مضافة بعد</li>';
  }

  state.pages.forEach((p) => {
    const li = document.createElement("li");
    li.className = "page-item";
    li.innerHTML = `<div><div>${escapeHtml(p.name)}</div><small>${p.pageId}</small></div>`;
    const del = document.createElement("button");
    del.textContent = "حذف";
    del.onclick = () => {
      state.pages = state.pages.filter((x) => x.pageId !== p.pageId);
      persistPages();
      renderPageList();
      updateStatusDots();
    };
    li.appendChild(del);
    ul.appendChild(li);

    const opt = document.createElement("option");
    opt.value = p.pageId;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  if (state.activePageId) select.value = state.activePageId;
}

function updateStatusDots() {
  document.getElementById("dot-gemini").className = "dot " + (state.geminiKey ? "dot-on" : "dot-off");
  document.getElementById("dot-pages").className = "dot " + (state.pages.length ? "dot-on" : "dot-off");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------
   3) طبقة Facebook Graph API
   كل الاستدعاءات تُنفَّذ مباشرة من المتصفح باستخدام Page Access Token.
   ملاحظة: بعض المتصفحات/الشبكات قد تحتاج إعدادات CORS أو بروكسي بسيط
   إذا رفض Graph API الطلب المباشر.
   --------------------------------------------------------- */
function pageById(pageId) {
  return state.pages.find((p) => p.pageId === pageId);
}

async function fbGet(path, params, token) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("access_token", token);
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "خطأ من فيسبوك");
  return data;
}

async function fbPost(path, body, token) {
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${path}`;
  const form = new URLSearchParams({ ...body, access_token: token });
  const res = await fetch(url, { method: "POST", body: form });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "خطأ من فيسبوك");
  return data;
}

async function fbDelete(path, token) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${path}`);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { method: "DELETE" });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "خطأ من فيسبوك");
  return data;
}

/* ===== الدوال التي يستدعيها ماكس (Gemini function calling) ===== */

async function tool_list_pages() {
  return { pages: state.pages.map((p) => ({ name: p.name, pageId: p.pageId })) };
}

async function tool_get_page_comments({ pageId, limit }) {
  const p = requirePage(pageId);
  const data = await fbGet(`${p.pageId}/feed`, {
    fields: `id,message,created_time,comments.limit(${limit || 10}){id,message,from,created_time}`,
    limit: 5,
  }, p.token);
  return data;
}

async function tool_reply_to_comment({ commentId, message }) {
  if (!commentId || !message) throw new Error("لازم تحدد commentId وmessage");
  const token = tokenForAnyKnownComment();
  const data = await fbPost(`${commentId}/comments`, { message }, token);
  return { success: true, replyId: data.id };
}

async function tool_hide_comment({ commentId, hide }) {
  const token = tokenForAnyKnownComment();
  await fbPost(`${commentId}`, { is_hidden: hide !== false }, token);
  return { success: true };
}

async function tool_delete_comment({ commentId }) {
  const token = tokenForAnyKnownComment();
  await fbDelete(`${commentId}`, token);
  return { success: true };
}

async function tool_create_post({ pageId, message }) {
  const p = requirePage(pageId);
  const data = await fbPost(`${p.pageId}/feed`, { message }, p.token);
  return { success: true, postId: data.id };
}

async function tool_get_page_insights({ pageId, metrics, period }) {
  const p = requirePage(pageId);
  const data = await fbGet(`${p.pageId}/insights/${metrics || "page_impressions,page_engaged_users"}`, {
    period: period || "day",
  }, p.token);
  return data;
}

function requirePage(pageId) {
  const p = pageById(pageId) || pageById(state.activePageId);
  if (!p) throw new Error("ما في صفحة مطابقة — تأكد من الاسم أو أضفها من الإعدادات");
  return p;
}
// أي عملية على تعليق مش مربوطة مباشرة بمعرف صفحة نستخدم توكن الصفحة النشطة حالياً
function tokenForAnyKnownComment() {
  const p = pageById(state.activePageId) || state.pages[0];
  if (!p) throw new Error("لازم توصل صفحة واحدة على الأقل قبل تنفيذ هاد الإجراء");
  return p.token;
}

const TOOL_IMPL = {
  list_pages: tool_list_pages,
  get_page_comments: tool_get_page_comments,
  reply_to_comment: tool_reply_to_comment,
  hide_comment: tool_hide_comment,
  delete_comment: tool_delete_comment,
  create_post: tool_create_post,
  get_page_insights: tool_get_page_insights,
};

/* ---------------------------------------------------------
   4) تعريف الدوال لـ Gemini (Function Calling)
   --------------------------------------------------------- */
const FUNCTION_DECLARATIONS = [
  {
    name: "list_pages",
    description: "يرجع قائمة صفحات فيسبوك المتصلة حالياً بأسمائها ومعرّفاتها.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_page_comments",
    description: "يجلب آخر المنشورات وتعليقاتها العامة على صفحة معينة (وليس رسائل خاصة أبداً).",
    parameters: {
      type: "OBJECT",
      properties: {
        pageId: { type: "STRING", description: "معرّف الصفحة" },
        limit: { type: "NUMBER", description: "عدد التعليقات المطلوبة لكل منشور" },
      },
      required: ["pageId"],
    },
  },
  {
    name: "reply_to_comment",
    description: "يرد برسالة نصية على تعليق عام موجود على منشور بالصفحة.",
    parameters: {
      type: "OBJECT",
      properties: {
        commentId: { type: "STRING" },
        message: { type: "STRING" },
      },
      required: ["commentId", "message"],
    },
  },
  {
    name: "hide_comment",
    description: "يخفي (أو يظهر) تعليقاً مسيئاً أو غير مرغوب فيه دون حذفه نهائياً.",
    parameters: {
      type: "OBJECT",
      properties: { commentId: { type: "STRING" }, hide: { type: "BOOLEAN" } },
      required: ["commentId"],
    },
  },
  {
    name: "delete_comment",
    description: "يحذف تعليقاً نهائياً — يُستخدم لحل مشاكل مثل السبام أو الإساءة الشديدة.",
    parameters: {
      type: "OBJECT",
      properties: { commentId: { type: "STRING" } },
      required: ["commentId"],
    },
  },
  {
    name: "create_post",
    description: "ينشر منشوراً نصياً جديداً على صفحة فيسبوك محددة.",
    parameters: {
      type: "OBJECT",
      properties: { pageId: { type: "STRING" }, message: { type: "STRING" } },
      required: ["pageId", "message"],
    },
  },
  {
    name: "get_page_insights",
    description: "يجلب إحصائيات أداء الصفحة (مشاهدات، تفاعل) لفترة معينة لأغراض التحليل والتقييم.",
    parameters: {
      type: "OBJECT",
      properties: {
        pageId: { type: "STRING" },
        metrics: { type: "STRING", description: "أسماء المقاييس مفصولة بفاصلة، مثل page_impressions,page_engaged_users" },
        period: { type: "STRING", description: "day أو week أو days_28" },
      },
      required: ["pageId"],
    },
  },
];

const SYSTEM_INSTRUCTION = `
أنت "ماكس" (MAX AI - Cyber Brain)، مساعد إداري ذكي لصاحب صفحات فيسبوك متعددة، تتكلم بالعربية بأسلوب مباشر وعملي.
مهامك المسموحة فقط: الرد على التعليقات العامة على المنشورات، نشر محتوى، حل مشاكل الصفحة (إخفاء/حذف تعليقات مسيئة أو سبام)، وتحليل وتقييم أداء الصفحات عبر الإحصائيات.
ممنوع منعاً باتاً أن ترد على أي رسائل خاصة/ماسنجر أو تتعامل معها — هاد خارج نطاق عملك تماماً حتى لو طلب المستخدم ذلك، وإذا طلب ذلك اشرح له إنها غير مفعّلة بهاد النظام.
لتنفيذ أي إجراء فعلي استخدم الدوال المتاحة (function calling) بدل الادعاء بأنك نفذت الشي. إذا كانت المعلومة ناقصة (مثل اسم صفحة غامض) اسأل المستخدم بدل التخمين.
بعد تنفيذ أي دالة، لخّص النتيجة للمستخدم بجملة أو جملتين واضحتين بدون تفاصيل تقنية زائدة.
`.trim();

/* ---------------------------------------------------------
   5) الاتصال بـ Gemini مع حلقة تنفيذ الدوال
   --------------------------------------------------------- */
async function callGemini(userText) {
  if (!state.geminiKey) {
    appendMessage("max", "لسا ما ضفت مفتاح Gemini من الإعدادات ⚙", "error");
    return;
  }

  state.history.push({ role: "user", parts: [{ text: userText }] });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${state.geminiKey}`;

  // حلقة: قد يطلب Gemini تنفيذ دالة، ننفذها، نرجعله النتيجة، وهكذا حتى يرد نصياً
  for (let round = 0; round < 5; round++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: state.history,
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
      }),
    });
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      appendMessage("max", "ما وصلني رد مفهوم من Gemini، جرب كمان مرة.", "error");
      return;
    }

    const parts = candidate.content?.parts || [];
    const functionCallPart = parts.find((p) => p.functionCall);

    if (functionCallPart) {
      const { name, args } = functionCallPart.functionCall;
      appendMessage("action", `🔧 تنفيذ: ${name}(${JSON.stringify(args || {})})`);
      state.history.push({ role: "model", parts: [{ functionCall: { name, args } }] });

      let toolResult;
      try {
        const impl = TOOL_IMPL[name];
        if (!impl) throw new Error("دالة غير معروفة: " + name);
        toolResult = await impl(args || {});
      } catch (err) {
        toolResult = { error: err.message };
      }

      state.history.push({
        role: "function",
        parts: [{ functionResponse: { name, response: toolResult } }],
      });
      continue; // نعطي Gemini النتيجة ونطلب رداً جديداً
    }

    const textPart = parts.find((p) => p.text)?.text;
    if (textPart) {
      state.history.push({ role: "model", parts: [{ text: textPart }] });
      appendMessage("max", textPart);
      return;
    }

    appendMessage("max", "ما قدرت أفهم شو المطلوب بالضبط، ممكن توضح أكتر؟", "error");
    return;
  }

  appendMessage("max", "في سلسلة عمليات طويلة، جرب صيغة أبسط للطلب.", "error");
}

/* ---------------------------------------------------------
   6) واجهة الدردشة
   --------------------------------------------------------- */
function appendMessage(who, text, tone) {
  const log = document.getElementById("chat-log");
  const div = document.createElement("div");
  const cls = who === "user" ? "msg-user" : who === "action" ? "msg-action" : "msg-max";
  div.className = "msg " + cls + (tone === "error" ? " msg-error" : "");
  const avatar = who === "user" ? "أنت" : who === "action" ? "⚙" : "م";
  div.innerHTML = `<div class="msg-avatar">${avatar}</div><div class="msg-body"></div>`;
  div.querySelector(".msg-body").textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

/* ---------------------------------------------------------
   7) ربط عناصر الواجهة
   --------------------------------------------------------- */
function wireUI() {
  // الإعدادات
  const settingsModal = document.getElementById("modal-settings");
  document.getElementById("btn-settings").onclick = () => {
    document.getElementById("input-gemini-key").value = state.geminiKey;
    settingsModal.classList.remove("hidden");
  };
  document.getElementById("close-settings").onclick = () => settingsModal.classList.add("hidden");
  document.getElementById("save-settings").onclick = () => {
    state.geminiKey = document.getElementById("input-gemini-key").value.trim();
    persistGeminiKey();
    updateStatusDots();
    settingsModal.classList.add("hidden");
  };

  // إضافة صفحة
  const pageModal = document.getElementById("modal-page");
  document.getElementById("btn-add-page").onclick = () => pageModal.classList.remove("hidden");
  document.getElementById("close-page-modal").onclick = () => pageModal.classList.add("hidden");
  document.getElementById("save-page").onclick = () => {
    const name = document.getElementById("input-page-name").value.trim();
    const pageId = document.getElementById("input-page-id").value.trim();
    const token = document.getElementById("input-page-token").value.trim();
    if (!name || !pageId || !token) return;
    state.pages.push({ name, pageId, token });
    persistPages();
    renderPageList();
    updateStatusDots();
    ["input-page-name", "input-page-id", "input-page-token"].forEach((id) => (document.getElementById(id).value = ""));
    pageModal.classList.add("hidden");
  };

  // اختيار الصفحة النشطة
  document.getElementById("active-page-select").onchange = (e) => {
    state.activePageId = e.target.value || null;
    refreshQuickStats();
  };

  // الدردشة
  document.getElementById("composer").onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById("composer-input");
    const text = input.value.trim();
    if (!text) return;
    appendMessage("user", text);
    input.value = "";
    const btn = document.getElementById("composer-send");
    btn.disabled = true;
    try {
      await callGemini(text);
    } catch (err) {
      appendMessage("max", "صار خطأ: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  };
}

async function refreshQuickStats() {
  const p = pageById(state.activePageId);
  if (!p) return;
  try {
    const insights = await tool_get_page_insights({ pageId: p.pageId, metrics: "page_engaged_users", period: "day" });
    const values = insights?.data?.[0]?.values || [];
    const latest = values[values.length - 1]?.value ?? "—";
    document.getElementById("stat-engagement").textContent = latest;
  } catch {
    document.getElementById("stat-engagement").textContent = "—";
  }
}

/* ---------------------------------------------------------
   8) تشغيل
   --------------------------------------------------------- */
window.addEventListener("DOMContentLoaded", () => {
  initBackground();
  renderPageList();
  updateStatusDots();
  wireUI();
});
