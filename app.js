'use strict';
/* Closet Collection — public PWA v1
   Data model: items in IndexedDB (db: closet-collection, store: items)
   Item: { id, brand, name, category（大分類）, categorySub（中分類）, categoryDetail（小分類）, size, color, price, date, place, memo, sell, photo(dataURL jpeg), createdAt, market, marketDate }
   旧データ（categoryのみ）はそのまま大分類として扱う（移行不要）。
*/

/* カテゴリ分類: 大分類 → 中分類 → 小分類 */
const TAXONOMY = {
  'トップス': {
    'Tシャツ・カットソー': ['半袖', '長袖', 'ノースリーブ'],
    'シャツ': ['半袖', '長袖'],
    'ニット・セーター': [],
    'スウェット': ['パーカー', 'トレーナー', 'ジップアップ'],
    'タンクトップ': [],
    'その他': [],
  },
  'アウター': {
    'ジャケット': ['デニムジャケット', 'レザージャケット', 'ブルゾン', 'テーラードジャケット', 'その他'],
    'コート': ['チェスターコート', 'トレンチコート', 'ステンカラーコート', 'モッズコート', 'その他'],
    'ダウン': ['ダウンジャケット', 'ダウンベスト'],
    'ベスト': [],
    'その他': [],
  },
  'ボトムス': {
    'パンツ': ['デニム', 'カーゴパンツ', 'スラックス', 'チノパン', 'スウェットパンツ', 'トラックパンツ', 'その他'],
    'ショートパンツ': [],
    'スカート': [],
    'その他': [],
  },
  'シューズ': {
    'スニーカー': ['ローカット', 'ハイカット'],
    'ブーツ': [],
    '革靴': [],
    'サンダル': [],
    'その他': [],
  },
  'バッグ': {
    'ショルダーバッグ': [],
    'トートバッグ': [],
    'リュック': [],
    'ハンドバッグ': [],
    'ウエストバッグ': [],
    'その他': [],
  },
  'アクセサリー': {
    '帽子': ['キャップ', 'ハット', 'ニット帽', 'その他'],
    'ネックレス': [],
    'ブレスレット': [],
    'リング': [],
    'ピアス': [],
    'ベルト': [],
    'サングラス・メガネ': [],
    'マフラー・ストール': [],
    '手袋': [],
    '時計': [],
    'その他': [],
  },
  'その他': { 'その他': [] },
};
const DB_NAME = 'closet-collection';
const STORE = 'items';
let db = null;
let items = [];
let editingId = null;
let detailId = null;
let pendingPhoto = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}
function tx(mode) { return db.transaction(STORE, mode).objectStore(STORE); }
function getAll() {
  return new Promise((resolve, reject) => {
    const out = [];
    const req = tx('readonly').openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { out.push(cur.value); cur.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}
function putItem(item) {
  return new Promise((resolve, reject) => {
    const req = tx('readwrite').put(item);
    req.onsuccess = resolve; req.onerror = () => reject(req.error);
  });
}
function deleteItem(id) {
  return new Promise((resolve, reject) => {
    const req = tx('readwrite').delete(id);
    req.onsuccess = resolve; req.onerror = () => reject(req.error);
  });
}

const $ = (id) => document.getElementById(id);
const yen = (n) => '¥' + Number(n || 0).toLocaleString('ja-JP');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function catPath(it) {
  return [it.category, it.categorySub, it.categoryDetail].filter(Boolean).join(' ＞ ');
}

function setOptions(sel, values, current, emptyLabel) {
  const vals = [...values];
  if (current && !vals.includes(current)) vals.push(current);
  sel.innerHTML = (emptyLabel != null ? `<option value="">${emptyLabel}</option>` : '') +
    vals.map((v) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
  sel.value = current || '';
}

/* 編集フォームのカテゴリ3段セレクトを、大→中→小の順に連動して埋める */
function fillCatForm(l, m, s) {
  const catSel = $('fCat'), subSel = $('fCatSub'), detSel = $('fCatDetail');
  setOptions(catSel, Object.keys(TAXONOMY), l || 'トップス', null);
  const subs = Object.keys(TAXONOMY[catSel.value] || {});
  setOptions(subSel, subs, m || '', '指定なし');
  const dets = (TAXONOMY[catSel.value] || {})[subSel.value] || [];
  setOptions(detSel, dets, s || '', '指定なし');
  detSel.disabled = dets.length === 0 && !s;
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function currentFilter() {
  return {
    q: $('q').value.trim().toLowerCase(),
    cat: $('fCategory').value,
    brand: $('fBrand').value,
    sellOnly: $('fSell').checked,
  };
}

function render() {
  const f = currentFilter();
  const list = items.filter((it) => {
    if (f.cat && it.category !== f.cat) return false;
    if (f.brand && it.brand !== f.brand) return false;
    if (f.sellOnly && !it.sell) return false;
    if (f.q) {
      const hay = [it.brand, it.name, it.color, it.place, it.memo, it.category, it.categorySub, it.categoryDetail].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
  list.sort((a, b) => b.createdAt - a.createdAt);

  $('statCount').textContent = items.length;
  $('statTotal').textContent = yen(items.reduce((s, it) => s + (Number(it.price) || 0), 0));
  $('statSell').textContent = items.filter((it) => it.sell).length;
  const withMarket = items.filter((it) => Number(it.market) > 0);
  $('statMarket').textContent = yen(withMarket.reduce((s, it) => s + Number(it.market), 0));
  const diff = withMarket.reduce((s, it) => s + (Number(it.market) - (Number(it.price) || 0)), 0);
  const diffEl = $('statDiff');
  diffEl.textContent = (diff >= 0 ? '+' : '−') + yen(Math.abs(diff));
  diffEl.className = diff >= 0 ? 'pos' : 'neg';

  const grid = $('grid');
  grid.innerHTML = list.map((it) => `
    <button class="card" data-id="${it.id}">
      ${it.photo ? `<img src="${it.photo}" alt="">` : `<img alt="">`}
      <span class="meta" style="display:block">
        <span class="brand">${esc(it.brand)}</span>
        <span class="name" style="display:block">${esc(it.name)}</span>
        <span class="price">${it.price ? yen(it.price) : ''}${it.size ? ' / ' + esc(it.size) : ''}</span>
        ${Number(it.market) > 0 ? `<span class="market" style="display:block">相場 ${yen(it.market)} <span class="${(Number(it.market) - (Number(it.price) || 0)) >= 0 ? 'pos' : 'neg'}">${(Number(it.market) - (Number(it.price) || 0)) >= 0 ? '+' : '−'}${yen(Math.abs(Number(it.market) - (Number(it.price) || 0)))}</span></span>` : ''}
        ${it.sell ? '<span class="badge">売る候補</span>' : ''}
      </span>
    </button>`).join('');
  $('emptyMsg').style.display = list.length ? 'none' : 'block';
  grid.querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => openDetail(el.dataset.id)));

  const presentCats = [...new Set(items.map((it) => it.category).filter(Boolean))];
  const cats = [...Object.keys(TAXONOMY).filter((c) => presentCats.includes(c)),
    ...presentCats.filter((c) => !Object.prototype.hasOwnProperty.call(TAXONOMY, c))];
  const brands = [...new Set(items.map((it) => it.brand).filter(Boolean))].sort();
  const catSel = $('fCategory'); const curCat = catSel.value;
  catSel.innerHTML = '<option value="">カテゴリ：すべて</option>' + cats.map((c) => `<option ${c===curCat?'selected':''}>${esc(c)}</option>`).join('');
  const brandSel = $('fBrand'); const curBrand = brandSel.value;
  brandSel.innerHTML = '<option value="">ブランド：すべて</option>' + brands.map((b) => `<option ${b===curBrand?'selected':''}>${esc(b)}</option>`).join('');
}

function openEdit(item) {
  editingId = item ? item.id : null;
  pendingPhoto = item ? (item.photo || null) : null;
  $('editTitle').textContent = item ? 'アイテムを編集' : 'アイテムを追加';
  $('fBrandName').value = item?.brand || '';
  $('fName').value = item?.name || '';
  fillCatForm(item?.category || 'トップス', item?.categorySub || '', item?.categoryDetail || '');
  $('fSize').value = item?.size || '';
  $('fColor').value = item?.color || '';
  $('fPrice').value = item?.price ?? '';
  $('fDate').value = item?.date || '';
  $('fMarket').value = item?.market ?? '';
  $('fMarketDate').value = item?.marketDate || '';
  $('fPlace').value = item?.place || '';
  $('fMemo').value = item?.memo || '';
  $('fSellFlag').checked = !!item?.sell;
  $('fPhoto').value = '';
  const prev = $('photoPrev');
  if (pendingPhoto) { prev.src = pendingPhoto; prev.style.display = 'block'; } else { prev.style.display = 'none'; }
  $('editDialog').showModal();
}

function openDetail(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  detailId = id;
  $('dImg').src = it.photo || '';
  $('dImg').style.display = it.photo ? 'block' : 'none';
  $('dBrand').textContent = it.brand || '';
  $('dName').textContent = it.name || '';
  const rows = [
    ['カテゴリ', catPath(it)], ['サイズ', it.size], ['カラー', it.color],
    ['購入価格', it.price ? yen(it.price) : ''], ['購入日', it.date],
    ['購入場所', it.place], ['メモ', it.memo],
    ['中古相場', Number(it.market) > 0 ? yen(it.market) : ''],
    ['相場確認日', it.marketDate || ''],
    ['損益', Number(it.market) > 0 ? ((Number(it.market) - (Number(it.price) || 0)) >= 0 ? '+' : '−') + yen(Math.abs(Number(it.market) - (Number(it.price) || 0))) : ''],
    ['売る候補', it.sell ? 'はい' : ''],
  ].filter(([, v]) => v);
  $('dKv').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('');
  const q = encodeURIComponent([it.brand, it.name].filter(Boolean).join(' '));
  $('dMercari').href = 'https://jp.mercari.com/search?keyword=' + q + '&status=sold_out';
  $('dSnkrdunk').href = 'https://snkrdunk.com/search?keywords=' + q;
  $('detailDialog').showModal();
}

async function saveFromForm(ev) {
  ev.preventDefault();
  const brand = $('fBrandName').value.trim();
  const name = $('fName').value.trim();
  if (!brand || !name) return;
  const old = editingId ? items.find((x) => x.id === editingId) : null;
  const item = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
    brand, name,
    category: $('fCat').value,
    categorySub: $('fCatSub').value,
    categoryDetail: $('fCatDetail').value,
    size: $('fSize').value.trim(),
    color: $('fColor').value.trim(),
    price: Number($('fPrice').value) || 0,
    date: $('fDate').value,
    market: Number($('fMarket').value) || 0,
    marketDate: $('fMarketDate').value,
    place: $('fPlace').value.trim(),
    memo: $('fMemo').value.trim(),
    sell: $('fSellFlag').checked,
    photo: pendingPhoto,
    createdAt: old ? old.createdAt : Date.now(),
  };
  await putItem(item);
  items = await getAll();
  $('editDialog').close();
  render();
}

async function init() {
  await openDb();
  items = await getAll();
  render();

  $('addBtn').addEventListener('click', () => openEdit(null));
  $('cancelEdit').addEventListener('click', () => $('editDialog').close());
  $('editForm').addEventListener('submit', saveFromForm);
  $('fCat').addEventListener('change', () => fillCatForm($('fCat').value, '', ''));
  $('fCatSub').addEventListener('change', () => fillCatForm($('fCat').value, $('fCatSub').value, ''));
  $('fPhoto').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingPhoto = await compressImage(file);
    const prev = $('photoPrev');
    prev.src = pendingPhoto; prev.style.display = 'block';
  });
  ['q', 'fCategory', 'fBrand', 'fSell'].forEach((id) => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  $('closeDetail').addEventListener('click', () => $('detailDialog').close());
  $('editDetail').addEventListener('click', () => {
    const it = items.find((x) => x.id === detailId);
    $('detailDialog').close();
    openEdit(it);
  });
  $('deleteDetail').addEventListener('click', async () => {
    if (!confirm('このアイテムを削除しますか？')) return;
    await deleteItem(detailId);
    items = await getAll();
    $('detailDialog').close();
    render();
  });
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'closet-collection', version: 1, items }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'closet-collection-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.items)) throw new Error('bad format');
      for (const it of data.items) await putItem(it);
      items = await getAll();
      render();
      alert('読み込みました');
    } catch { alert('読み込みに失敗しました。バックアップファイルを選んでください。'); }
    e.target.value = '';
  });
}

init();
