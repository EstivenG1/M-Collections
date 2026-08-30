import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot,
  serverTimestamp, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ---------------------------------------------------------------- */
/*  WhatsApp de M Collections                                        */
/* ---------------------------------------------------------------- */
const WHATSAPP_NUMBER = "573146292543";

/* ---------------------------------------------------------------- */
/*  Firebase                                                         */
/* ---------------------------------------------------------------- */
let db, auth, firebaseReady = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  firebaseReady = true;
} catch (e) {
  console.error("Firebase no se pudo inicializar:", e);
}

/* ---------------------------------------------------------------- */
/*  Utilidades                                                       */
/* ---------------------------------------------------------------- */
const money = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n) || 0);

const formatDate = (d) =>
  d ? d.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "";

const isNew = (d) => d && (Date.now() - d.getTime() < 1000 * 60 * 60 * 24 * 7);

const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Firestore limita cada documento a ~1 MiB. Como guardamos la foto dentro
// del mismo documento del producto (sin usar Storage, para no requerir
// tarjeta de crédito), comprimimos en pasos hasta quedar muy por debajo
// de ese límite (tope objetivo: 500 KB en base64).
const IMAGE_BYTE_TARGET = 500 * 1024;

function drawToDataURL(img, maxDim, quality) {
  let { width, height } = img;
  if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
  else if (height >= width && height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.round((base64.length * 3) / 4);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const img = await loadImage(file);
  const steps = [
    [1000, 0.75], [800, 0.7], [650, 0.6], [500, 0.5], [400, 0.4], [320, 0.35],
  ];
  let result = drawToDataURL(img, steps[0][0], steps[0][1]);
  for (const [maxDim, quality] of steps) {
    result = drawToDataURL(img, maxDim, quality);
    if (dataUrlBytes(result) <= IMAGE_BYTE_TARGET) break;
  }
  return result;
}

/* ---------------------------------------------------------------- */
/*  Estado                                                            */
/* ---------------------------------------------------------------- */
const state = {
  sections: [],
  products: [],
  loading: true,
  loadError: "",
  activeSection: "todo",
  query: "",
  isAdmin: false,
};

/* ---------------------------------------------------------------- */
/*  Referencias DOM                                                   */
/* ---------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
document.getElementById("year").textContent = new Date().getFullYear();

const el = {
  storeView: $("#store-view"),
  adminView: $("#admin-view"),
  adminGate: $("#admin-login-gate"),
  adminPanel: $("#admin-panel"),
  btnAdminToggle: $("#btn-admin-toggle"),
  sectionPills: $("#section-pills"),
  featuredShelf: $("#featured-shelf"),
  featuredGrid: $("#featured-grid"),
  productsStatus: $("#products-status"),
  productsGrid: $("#products-grid"),
  searchInput: $("#search-input"),
  productModal: $("#product-modal"),
  loginModalRoot: $("#login-modal-root"),
  productFormRoot: $("#product-form-root"),
  confirmRoot: $("#confirm-root"),
  sectionsList: $("#sections-list"),
  adminProductsList: $("#admin-products-list"),
};

/* ---------------------------------------------------------------- */
/*  Navegación store <-> admin                                       */
/* ---------------------------------------------------------------- */
function showStore() {
  el.storeView.classList.remove("hidden");
  el.adminView.classList.add("hidden");
}
function showAdmin() {
  el.storeView.classList.add("hidden");
  el.adminView.classList.remove("hidden");
  if (state.isAdmin) {
    el.adminGate.classList.add("hidden");
    el.adminPanel.classList.remove("hidden");
    renderAdminSections();
    renderAdminProducts();
  } else {
    el.adminGate.classList.remove("hidden");
    el.adminPanel.classList.add("hidden");
  }
}

el.btnAdminToggle.addEventListener("click", showAdmin);
$("#btn-back-store-1").addEventListener("click", showStore);
$("#btn-back-store-2").addEventListener("click", showStore);
$("#btn-logout").addEventListener("click", async () => { await signOut(auth); });

/* ---------------------------------------------------------------- */
/*  Autenticación                                                     */
/* ---------------------------------------------------------------- */
if (firebaseReady) {
  onAuthStateChanged(auth, (user) => {
    state.isAdmin = !!user;
    if (!el.adminView.classList.contains("hidden")) showAdmin();
  });
}

$("#btn-login").addEventListener("click", async () => {
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const errEl = $("#login-error");
  errEl.classList.add("hidden");
  if (!email || !password) return;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    errEl.textContent = "Correo o contraseña incorrectos.";
    errEl.classList.remove("hidden");
  }
});

/* ---------------------------------------------------------------- */
/*  Carga en tiempo real desde Firestore                             */
/* ---------------------------------------------------------------- */
function startListeners() {
  if (!firebaseReady) {
    state.loading = false;
    state.loadError = "El sitio aún no está conectado a Firebase. Sigue la guía en README-DESPLIEGUE.md.";
    renderProducts();
    return;
  }
  try {
    const sectionsQuery = query(collection(db, "sections"), orderBy("name"));
    onSnapshot(sectionsQuery, (snap) => {
      state.sections = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderSectionPills();
      renderProducts();
      if (!el.adminView.classList.contains("hidden") && state.isAdmin) renderAdminSections();
    }, (e) => { state.loadError = "No se pudieron cargar las secciones."; renderProducts(); });

    const productsQuery = query(collection(db, "products"), orderBy("createdAt", "desc"));
    onSnapshot(productsQuery, (snap) => {
      state.loading = false;
      state.products = snap.docs.map((d) => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: data.createdAt ? data.createdAt.toDate() : new Date() };
      });
      renderProducts();
      if (!el.adminView.classList.contains("hidden") && state.isAdmin) renderAdminProducts();
    }, (e) => {
      state.loading = false;
      state.loadError = "No se pudieron cargar los productos. Revisa tu conexión.";
      renderProducts();
    });
  } catch (e) {
    state.loading = false;
    state.loadError = "No se pudo conectar con la base de datos.";
    renderProducts();
  }
}

/* ---------------------------------------------------------------- */
/*  Render: pills de sección                                         */
/* ---------------------------------------------------------------- */
function renderSectionPills() {
  const pills = [{ id: "todo", name: "Todo" }, ...state.sections];
  el.sectionPills.innerHTML = pills.map((s) => `
    <button class="section-pill pill rounded-full px-4 py-2 text-sm shrink-0" data-id="${s.id}" data-active="${state.activeSection === s.id}">
      ${esc(s.name)}
    </button>`).join("");
  el.sectionPills.querySelectorAll(".section-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeSection = btn.dataset.id;
      renderSectionPills();
      renderProducts();
    });
  });
}

/* ---------------------------------------------------------------- */
/*  Render: tarjeta de producto                                      */
/* ---------------------------------------------------------------- */
function sectionName(id) {
  return state.sections.find((s) => s.id === id)?.name || "Sin sección";
}

function productCardHTML(p, compact = false) {
  const img = p.imageUrl
    ? `<img src="${p.imageUrl}" alt="${esc(p.name)}" class="w-full h-full object-cover" loading="lazy" />`
    : `<div class="w-full h-full flex items-center justify-center" style="color:var(--coffee-soft)"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/></svg></div>`;
  const newBadge = isNew(p.createdAt) ? `<span class="absolute bottom-2 left-2 badge-new text-[11px] font-semibold px-2 py-1 rounded-full">Nuevo</span>` : "";
  return `
    <button class="product-card fade-in rounded-2xl overflow-hidden text-left relative flex flex-col ${compact ? "w-40 sm:w-48 shrink-0" : ""}" data-product-id="${p.id}">
      <div class="relative aspect-square" style="background:var(--ivory-deep)">
        ${img}
        <span class="price-tag">${money(p.price)}</span>
        ${newBadge}
      </div>
      <div class="p-3.5 flex flex-col gap-1">
        <p class="serif text-[16px] leading-tight truncate">${esc(p.name)}</p>
        <div class="flex items-center justify-between text-xs" style="color:var(--coffee-soft)">
          <span class="truncate">${esc(sectionName(p.sectionId))}</span>
          <span class="shrink-0 ml-2">${formatDate(p.createdAt)}</span>
        </div>
      </div>
    </button>`;
}

function emptyStateHTML(title, subtitle, iconSvg) {
  return `
    <div class="flex flex-col items-center justify-center text-center gap-3 py-16 px-6">
      <div class="w-14 h-14 rounded-full flex items-center justify-center field">${iconSvg}</div>
      <p class="serif text-xl">${title}</p>
      <p class="text-sm max-w-sm" style="color:var(--coffee)">${subtitle}</p>
    </div>`;
}

const ICON_BAG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold-deep)" stroke-width="1.6"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/></svg>`;
const ICON_WARN = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;

/* ---------------------------------------------------------------- */
/*  Render: cuadrícula pública                                       */
/* ---------------------------------------------------------------- */
function renderProducts() {
  if (state.loading) {
    el.productsStatus.innerHTML = `<div class="flex flex-col items-center justify-center gap-3 py-8"><svg class="spin" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"/></svg><p class="text-sm" style="color:var(--coffee)">Cargando productos...</p></div>`;
    el.productsStatus.classList.remove("hidden");
    el.productsGrid.classList.add("hidden");
    el.featuredShelf.classList.add("hidden");
    return;
  }
  if (state.loadError) {
    el.productsStatus.innerHTML = emptyStateHTML("Algo salió mal", state.loadError, ICON_WARN);
    el.productsStatus.classList.remove("hidden");
    el.productsGrid.classList.add("hidden");
    el.featuredShelf.classList.add("hidden");
    return;
  }

  const q = state.query.trim().toLowerCase();
  const visible = state.products
    .filter((p) => state.activeSection === "todo" || p.sectionId === state.activeSection)
    .filter((p) => p.name.toLowerCase().includes(q));

  const featured = state.products.filter((p) => p.featured);
  if (featured.length && state.activeSection === "todo" && !q) {
    el.featuredShelf.classList.remove("hidden");
    el.featuredGrid.innerHTML = featured.map((p) => productCardHTML(p, true)).join("");
  } else {
    el.featuredShelf.classList.add("hidden");
  }

  if (visible.length === 0) {
    el.productsStatus.classList.remove("hidden");
    el.productsGrid.classList.add("hidden");
    const noProductsAtAll = state.products.length === 0;
    el.productsStatus.innerHTML = emptyStateHTML(
      noProductsAtAll ? "Aún no hay productos publicados" : "No encontramos productos",
      noProductsAtAll ? "Muy pronto encontrarás aquí toda la colección." : "Prueba con otra búsqueda o sección.",
      ICON_BAG
    );
  } else {
    el.productsStatus.classList.add("hidden");
    el.productsGrid.classList.remove("hidden");
    el.productsGrid.innerHTML = visible.map((p) => productCardHTML(p)).join("");
  }

  document.querySelectorAll("[data-product-id]").forEach((btn) => {
    btn.addEventListener("click", () => openProductModal(btn.dataset.productId));
  });
}

el.searchInput.addEventListener("input", (e) => { state.query = e.target.value; renderProducts(); });

/* ---------------------------------------------------------------- */
/*  Modal de producto (vista pública)                                */
/* ---------------------------------------------------------------- */
function openProductModal(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const message = `Hola M Collections! 👋 Quiero más información sobre este producto:\n\n🛍️ ${p.name}\n💰 ${money(p.price)}\n\n¿Me podrías contar más detalles?`;
  const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  el.productModal.innerHTML = `
    <div class="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto scrollbar-thin fade-in" style="background:var(--card)">
      <div class="grid sm:grid-cols-2">
        <div class="relative aspect-square sm:aspect-auto" style="background:var(--ivory-deep)">
          ${p.imageUrl ? `<img src="${p.imageUrl}" alt="${esc(p.name)}" class="w-full h-full object-cover" />` : `<div class="w-full h-full flex items-center justify-center">${ICON_BAG}</div>`}
          <button id="modal-close" class="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white" aria-label="Cerrar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="p-6 flex flex-col gap-4">
          <div>
            <p class="text-xs uppercase tracking-wider" style="color:var(--gold-deep)">${esc(sectionName(p.sectionId))}</p>
            <h2 class="serif text-3xl mt-1 leading-tight">${esc(p.name)}</h2>
            <p class="serif text-2xl mt-2" style="color:var(--gold-deep)">${money(p.price)}</p>
          </div>
          <div class="h-px hairline border-t"></div>
          <p class="text-[15px] leading-relaxed whitespace-pre-line" style="color:var(--coffee)">${esc(p.description || "Sin descripción disponible.")}</p>
          <p class="text-xs" style="color:var(--coffee-soft)">Publicado el ${formatDate(p.createdAt)}</p>
          <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp mt-2 rounded-xl px-5 py-3.5 flex items-center justify-center gap-2 text-[15px]">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.87 9.87 0 0 0 4.75 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Z"/></svg>
            Preguntar por WhatsApp
          </a>
          <p class="text-[11px] text-center -mt-2" style="color:var(--coffee-soft)">Se abrirá WhatsApp con un mensaje ya escrito para ti</p>
        </div>
      </div>
    </div>`;
  el.productModal.classList.remove("hidden");
  el.productModal.classList.add("flex");
  el.productModal.addEventListener("click", (e) => { if (e.target === el.productModal) closeProductModal(); }, { once: true });
  $("#modal-close").addEventListener("click", closeProductModal);
}
function closeProductModal() {
  el.productModal.classList.add("hidden");
  el.productModal.classList.remove("flex");
  el.productModal.innerHTML = "";
}

/* ---------------------------------------------------------------- */
/*  Admin: pestañas                                                   */
/* ---------------------------------------------------------------- */
document.querySelectorAll(".admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((b) => b.dataset.active = "false");
    btn.dataset.active = "true";
    const tab = btn.dataset.tab;
    $("#tab-productos").classList.toggle("hidden", tab !== "productos");
    $("#tab-secciones").classList.toggle("hidden", tab !== "secciones");
  });
});

/* ---------------------------------------------------------------- */
/*  Admin: secciones                                                  */
/* ---------------------------------------------------------------- */
$("#btn-add-section").addEventListener("click", async () => {
  const input = $("#new-section-input");
  const name = input.value.trim();
  if (!name) return;
  await setDoc(doc(collection(db, "sections")), { name, createdAt: serverTimestamp() });
  input.value = "";
});

function renderAdminSections() {
  if (state.sections.length === 0) {
    el.sectionsList.innerHTML = `<p class="text-sm" style="color:var(--coffee)">Todavía no has creado secciones.</p>`;
    return;
  }
  el.sectionsList.innerHTML = state.sections.map((s) => `
    <div class="flex items-center justify-between rounded-lg px-3.5 py-2.5" style="background:var(--ivory-deep)">
      <span class="text-sm">${esc(s.name)}</span>
      <button class="delete-section" data-id="${s.id}" data-name="${esc(s.name)}" style="color:var(--coffee-soft)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
      </button>
    </div>`).join("");
  el.sectionsList.querySelectorAll(".delete-section").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hasProducts = state.products.some((p) => p.sectionId === btn.dataset.id);
      showConfirm(
        hasProducts
          ? `"${btn.dataset.name}" tiene productos asociados. Si la eliminas, esos productos quedarán sin sección. ¿Continuar?`
          : `¿Eliminar la sección "${btn.dataset.name}"?`,
        async () => { await deleteDoc(doc(db, "sections", btn.dataset.id)); }
      );
    });
  });
}

/* ---------------------------------------------------------------- */
/*  Admin: productos                                                  */
/* ---------------------------------------------------------------- */
function renderAdminProducts() {
  if (state.products.length === 0) {
    el.adminProductsList.innerHTML = emptyStateHTML("Sin productos todavía", "Agrega el primer producto con el botón de arriba.", ICON_BAG);
    return;
  }
  el.adminProductsList.innerHTML = state.products.map((p) => `
    <div class="product-card rounded-xl p-3 flex items-center gap-3" style="cursor:default">
      <div class="w-14 h-14 rounded-lg overflow-hidden shrink-0" style="background:var(--ivory-deep)">
        ${p.imageUrl ? `<img src="${p.imageUrl}" class="w-full h-full object-cover" alt="" />` : `<div class="w-full h-full flex items-center justify-center">${ICON_BAG}</div>`}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium truncate flex items-center gap-1.5">
          ${esc(p.name)}
          ${p.featured ? `<span class="badge-featured text-[10px] px-1.5 py-0.5 rounded-full shrink-0">Destacado</span>` : ""}
        </p>
        <p class="text-xs truncate" style="color:var(--coffee-soft)">${esc(sectionName(p.sectionId))} · ${formatDate(p.createdAt)}</p>
      </div>
      <p class="text-sm font-semibold shrink-0 hidden sm:block" style="color:var(--gold-deep)">${money(p.price)}</p>
      <div class="flex items-center gap-1 shrink-0">
        <button class="edit-product btn-ghost w-9 h-9 rounded-lg flex items-center justify-center" data-id="${p.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button class="delete-product btn-ghost w-9 h-9 rounded-lg flex items-center justify-center" data-id="${p.id}" data-name="${esc(p.name)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
        </button>
      </div>
    </div>`).join("");

  el.adminProductsList.querySelectorAll(".edit-product").forEach((btn) => {
    btn.addEventListener("click", () => openProductForm(state.products.find((p) => p.id === btn.dataset.id)));
  });
  el.adminProductsList.querySelectorAll(".delete-product").forEach((btn) => {
    btn.addEventListener("click", () => {
      showConfirm(`¿Eliminar "${btn.dataset.name}"? Esta acción no se puede deshacer.`, async () => {
        await deleteDoc(doc(db, "products", btn.dataset.id));
      });
    });
  });
}

$("#btn-new-product").addEventListener("click", () => openProductForm(null));

function openProductForm(product) {
  const isEdit = !!product;
  const options = state.sections.map((s) => `<option value="${s.id}" ${product?.sectionId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");

  el.productFormRoot.innerHTML = `
    <div class="overlay flex items-end sm:items-center justify-center p-0 sm:p-6" id="pf-overlay">
      <div class="rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto scrollbar-thin fade-in" style="background:var(--card)">
        <div class="flex items-center justify-between p-5 border-b hairline sticky top-0" style="background:var(--card)">
          <h3 class="serif text-xl">${isEdit ? "Editar producto" : "Nuevo producto"}</h3>
          <button id="pf-close" aria-label="Cerrar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--coffee-soft)" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>
        <div class="p-5 flex flex-col gap-4">
          <div>
            <label class="text-xs block mb-1.5" style="color:var(--coffee-soft)">Foto del producto</label>
            <input id="pf-file" type="file" accept="image/*" class="hidden" />
            <div id="pf-drop" class="field rounded-xl aspect-video flex items-center justify-center cursor-pointer overflow-hidden relative">
              ${product?.imageUrl ? `<img id="pf-preview" src="${product.imageUrl}" class="w-full h-full object-cover" />` : `<div id="pf-placeholder" class="flex flex-col items-center gap-1.5 text-xs" style="color:var(--coffee-soft)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>Subir foto</div>`}
            </div>
          </div>
          <div>
            <label class="text-xs block mb-1.5" style="color:var(--coffee-soft)">Nombre</label>
            <input id="pf-name" value="${product ? esc(product.name) : ""}" class="field rounded-lg px-3 py-2.5 w-full text-sm" placeholder="Ej. Vela aromática lavanda" />
          </div>
          <div>
            <label class="text-xs block mb-1.5" style="color:var(--coffee-soft)">Precio (COP)</label>
            <input id="pf-price" type="number" min="0" value="${product ? product.price : ""}" class="field rounded-lg px-3 py-2.5 w-full text-sm" placeholder="Ej. 45000" />
          </div>
          <div>
            <label class="text-xs block mb-1.5" style="color:var(--coffee-soft)">Sección</label>
            ${state.sections.length === 0
              ? `<p class="text-xs" style="color:var(--danger)">Crea una sección primero, en la pestaña "Secciones".</p>`
              : `<select id="pf-section" class="field rounded-lg px-3 py-2.5 w-full text-sm">${options}</select>`}
          </div>
          <div>
            <label class="text-xs block mb-1.5" style="color:var(--coffee-soft)">Descripción</label>
            <textarea id="pf-desc" rows="4" class="field rounded-lg px-3 py-2.5 w-full text-sm resize-none" placeholder="Detalles, tamaño, aroma, material, etc.">${product ? esc(product.description || "") : ""}</textarea>
          </div>
          <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input id="pf-featured" type="checkbox" ${product?.featured ? "checked" : ""} class="w-4 h-4" />
            Mostrar en "Destacados"
          </label>
          <p id="pf-error" class="text-xs hidden" style="color:var(--danger)"></p>
          <button id="pf-submit" class="btn-gold rounded-lg w-full py-3 text-sm" ${state.sections.length === 0 ? "disabled" : ""}>
            ${isEdit ? "Guardar cambios" : "Publicar producto"}
          </button>
        </div>
      </div>
    </div>`;

  let pendingImage = product?.imageUrl || null;
  let imageChanged = false;

  const closeForm = () => { el.productFormRoot.innerHTML = ""; };
  $("#pf-close").addEventListener("click", closeForm);
  $("#pf-overlay").addEventListener("click", (e) => { if (e.target.id === "pf-overlay") closeForm(); });

  $("#pf-drop").addEventListener("click", () => $("#pf-file").click());
  $("#pf-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const drop = $("#pf-drop");
    drop.innerHTML = `<svg class="spin" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"/></svg>`;
    try {
      pendingImage = await compressImage(file);
      imageChanged = true;
      drop.innerHTML = `<img src="${pendingImage}" class="w-full h-full object-cover" />`;
    } catch {
      drop.innerHTML = `<p class="text-xs" style="color:var(--danger)">No se pudo procesar la imagen</p>`;
    }
  });

  $("#pf-submit").addEventListener("click", async () => {
    const name = $("#pf-name").value.trim();
    const price = Number($("#pf-price").value);
    const sectionId = $("#pf-section")?.value;
    const description = $("#pf-desc").value.trim();
    const featured = $("#pf-featured").checked;
    const errEl = $("#pf-error");

    if (!name) return showFormError(errEl, "Ponle un nombre al producto.");
    if (!price || price <= 0) return showFormError(errEl, "El precio debe ser mayor a cero.");
    if (!sectionId) return showFormError(errEl, "Elige o crea una sección primero.");

    const submitBtn = $("#pf-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Guardando...";

    try {
      const id = product?.id || crypto.randomUUID();
      const imageUrl = imageChanged ? pendingImage : (product?.imageUrl || null);

      await setDoc(doc(db, "products", id), {
        name, price, description, sectionId, featured,
        imageUrl: imageUrl || null,
        createdAt: product?.createdAtRaw || serverTimestamp(),
      }, { merge: true });

      closeForm();
    } catch (e) {
      showFormError(errEl, "No se pudo guardar. Intenta de nuevo.");
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? "Guardar cambios" : "Publicar producto";
    }
  });
}

function showFormError(errEl, msg) {
  errEl.textContent = msg;
  errEl.classList.remove("hidden");
}

/* ---------------------------------------------------------------- */
/*  Confirmación genérica                                             */
/* ---------------------------------------------------------------- */
function showConfirm(text, onConfirm) {
  el.confirmRoot.innerHTML = `
    <div class="overlay flex items-center justify-center p-6" id="cf-overlay">
      <div class="rounded-2xl w-full max-w-sm p-6 fade-in" style="background:var(--card)">
        <p class="text-sm mb-5">${text}</p>
        <div class="flex gap-3">
          <button id="cf-cancel" class="btn-ghost rounded-lg flex-1 py-2.5 text-sm">Cancelar</button>
          <button id="cf-confirm" class="btn-danger rounded-lg flex-1 py-2.5 text-sm">Eliminar</button>
        </div>
      </div>
    </div>`;
  const close = () => { el.confirmRoot.innerHTML = ""; };
  $("#cf-overlay").addEventListener("click", (e) => { if (e.target.id === "cf-overlay") close(); });
  $("#cf-cancel").addEventListener("click", close);
  $("#cf-confirm").addEventListener("click", async () => {
    $("#cf-confirm").textContent = "Eliminando...";
    $("#cf-confirm").disabled = true;
    await onConfirm();
    close();
  });
}

/* ---------------------------------------------------------------- */
/*  Arranque                                                          */
/* ---------------------------------------------------------------- */
renderSectionPills();
renderProducts();
startListeners();
