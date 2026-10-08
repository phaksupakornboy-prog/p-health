import { t, has, dateFmt } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, esc } from '../ui.js';
import { getAllMachines, updateMachine, addMachine, getMachineHistory, fromIso, dataMode, getRoutine, setRoutine } from '../store.js';
import { post } from '../remote.js';

let S;
const muscleOf = (m) => (m.muscleKey && has(`machines.${m.muscleKey}`) ? t(`machines.${m.muscleKey}`) : m.muscle);

// Downscale a camera photo before keeping it (mock store is localStorage).
// With Google Drive later, this same blob is what gets uploaded.
async function shrink(file, max = 640) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

// A real photo when there is one; otherwise just the group dot, so 13 rows are not 13 identical tiles.
function thumb(m) {
  return m.photoUrl
    ? `<img class="thumb" src="${m.photoUrl}" alt="" width="56" height="56">`
    : `<span class="dot dot-${m.group} row-dot" aria-hidden="true"></span>`;
}

function row(m) {
  const last = S.last.get(m.id);
  return `<li><button class="machine-row machine-card" data-edit="${m.id}" aria-haspopup="dialog">
    ${thumb(m)}
    <span class="machine-row-text">
      <span class="machine-row-name">${esc(m.name)}</span>
      ${muscleOf(m) ? `<span class="meta clamp-1">${esc(muscleOf(m))}</span>` : ''}
      ${last ? `<span class="meta">${t('machinesScreen.lastUsed', { date: dateFmt.short(fromIso(last)) })}</span>` : `<span class="chip chip-neutral row-chip">${t('machinesScreen.neverUsed')}</span>`}
    </span>
    ${icon('chevronRight', 'chev')}
  </button></li>`;
}

// The order machines come up in the weights log, per group.
function routineCard() {
  const g = S.rtab;
  const r = S.routines[g];
  const name = (id) => esc(S.machines.find((m) => m.id === id)?.name || id);
  const rows = r.routine.map((id, i) => `<li class="routine-row">
      <span class="routine-n" aria-hidden="true">${i + 1}</span>
      <span class="routine-name">${name(id)}</span>
      <button type="button" class="btn-round btn-sm" data-r="up" data-id="${id}" data-fid="up-${id}" aria-label="${t('routine.up', { name: name(id) })}" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp')}</button>
      <button type="button" class="btn-round btn-sm" data-r="down" data-id="${id}" data-fid="down-${id}" aria-label="${t('routine.down', { name: name(id) })}" ${i === r.routine.length - 1 ? 'disabled' : ''}>${icon('chevronDown')}</button>
      <button type="button" class="btn-round btn-sm" data-r="out" data-id="${id}" data-fid="out-${id}" aria-label="${t('routine.out', { name: name(id) })}">${icon('x')}</button>
    </li>`).join('');
  const others = r.others.map((id) => `<li><button type="button" class="chip-btn" data-r="in" data-id="${id}" data-fid="in-${id}">${icon('plus')}<span>${name(id)}</span></button></li>`).join('');
  return `<section class="card" aria-labelledby="r-title">
    <h2 id="r-title" class="label">${t('routine.title')}</h2>
    <p class="meta">${t('routine.hint')}</p>
    <div class="segmented" role="radiogroup" aria-label="${t('routine.group')}">
      ${['upper', 'lower'].map((x) => `<button type="button" role="radio" class="seg seg-${x}" data-rtab="${x}" data-fid="rtab-${x}" aria-checked="${g === x}" tabindex="${g === x ? 0 : -1}"><span class="dot dot-${x}" aria-hidden="true"></span>${t(`category.${x}`)}</button>`).join('')}
    </div>
    ${r.routine.length ? `<ol class="routine">${rows}</ol>` : `<p class="meta">${t('routine.empty')}</p>`}
    ${others ? `<p class="label">${t('routine.notIn')}</p><ul class="chip-wrap">${others}</ul>` : ''}
  </section>`;
}

function render() {
  const fid = document.activeElement?.dataset?.fid;
  const active = S.machines.filter((m) => m.active);
  const hidden = S.machines.filter((m) => !m.active);
  const group = (g) => {
    const list = active.filter((m) => m.group === g);
    return `<section class="session" aria-labelledby="g-${g}">
      <h2 id="g-${g}" class="label section-label"><span class="dot dot-${g}" aria-hidden="true"></span>${t(`category.${g}`)} <span class="meta">${list.length}</span></h2>
      <ul class="machine-list">${list.map(row).join('')}</ul>
    </section>`;
  };
  S.root.innerHTML = `
  <div class="screen machines">
    <header class="top">
      <div><h1 class="title-lg">${t('machinesScreen.title')}</h1><p class="meta">${t('machinesScreen.count', { n: active.length })}</p></div>
      <button class="btn btn-primary btn-compact" data-add>${icon('plus')}<span>${t('machinesScreen.add')}</span></button>
    </header>
    ${routineCard()}
    ${group('upper')}
    ${group('lower')}
    ${hidden.length ? `<section class="session" aria-labelledby="g-hidden">
      <h2 id="g-hidden" class="label section-label">${t('machinesScreen.hiddenSection')} <span class="meta">${hidden.length}</span></h2>
      <p class="meta">${t('machinesScreen.hiddenNote')}</p>
      <ul class="machine-list is-hidden">${hidden.map(row).join('')}</ul>
    </section>` : ''}
  </div>
  <dialog class="sheet" id="editor" aria-labelledby="editor-title"><div class="sheet-body"></div></dialog>`;
  if (fid) S.root.querySelector(`[data-fid="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
}

async function loadRoutines() {
  S.routines = { upper: await getRoutine('upper'), lower: await getRoutine('lower') };
}

async function onRoutine(b) {
  const g = S.rtab;
  const ids = [...S.routines[g].routine];
  const id = b.dataset.id;
  const i = ids.indexOf(id);
  if (b.dataset.r === 'up' && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
  if (b.dataset.r === 'down' && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
  if (b.dataset.r === 'out') ids.splice(i, 1);
  if (b.dataset.r === 'in') ids.push(id);
  await setRoutine(g, ids);
  await loadRoutines();
  render();
  // a moved row keeps focus on its own arrow; an added or removed one hands focus on
  if (b.dataset.r === 'out' || b.dataset.r === 'in') S.root.querySelector('[data-rtab]')?.focus({ preventScroll: true });
}

function openEditor(m) {
  const isNew = !m;
  const cur = m || { id: null, name: '', group: 'upper', muscle: '', muscleKey: '', photoUrl: '', active: true };
  S.photo = cur.photoUrl;
  const dlg = S.root.querySelector('#editor');
  dlg.querySelector('.sheet-body').innerHTML = `
    <div class="sheet-head">
      <h2 id="editor-title" class="title">${isNew ? t('machinesScreen.addTitle') : t('machinesScreen.editTitle')}</h2>
      <button class="btn-round" data-close aria-label="${t('machinesScreen.close')}">${icon('x')}</button>
    </div>
    <form class="create" novalidate data-id="${cur.id || ''}">
      <div class="photo-field">
        <div class="photo-preview" id="photo-preview">${S.photo ? `<img src="${S.photo}" alt="${t('machinesScreen.photoAlt', { name: esc(cur.name) })}">` : `<span class="thumb-empty glow-${cur.group}" aria-hidden="true">${icon('dumbbell')}</span>`}</div>
        <div class="photo-actions">
          <label class="btn btn-outline btn-compact file-btn">${icon('plus')}<span>${S.photo ? t('machinesScreen.changePhoto') : t('machinesScreen.takePhoto')}</span>
            <input type="file" name="photo" accept="image/*" capture="environment" class="sr-only"></label>
          ${S.photo ? `<button type="button" class="btn btn-ghost btn-compact" data-remove-photo>${t('machinesScreen.removePhoto')}</button>` : ''}
        </div>
      </div>
      <label class="field">
        <span class="label">${t('machinesScreen.name')}</span>
        <input name="name" autocomplete="off" value="${esc(cur.name)}">
      </label>
      <fieldset class="field">
        <legend class="label">${t('machinesScreen.group')}</legend>
        <div class="segmented">
          ${['upper', 'lower'].map((g) => `<label class="seg seg-${g}"><input type="radio" name="group" value="${g}" ${g === cur.group ? 'checked' : ''}><span class="dot dot-${g}" aria-hidden="true"></span>${t(`category.${g}`)}</label>`).join('')}
        </div>
      </fieldset>
      <label class="field">
        <span class="label">${t('machinesScreen.muscle')}</span>
        <textarea name="muscle" rows="2" placeholder="${t('machinesScreen.musclePlaceholder')}">${esc(muscleOf(cur) || '')}</textarea>
      </label>
      ${isNew ? '' : `<button type="button" class="btn btn-outline btn-compact toggle-active" data-toggle-active>${icon(cur.active ? 'eyeOff' : 'eye')}<span>${cur.active ? t('machinesScreen.hide') : t('machinesScreen.show')}</span></button>`}
      <div class="sheet-actions">
        <button type="button" class="btn btn-outline" data-close>${t('machinesScreen.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('machinesScreen.save')}</button>
      </div>
    </form>`;
  dlg.showModal();
  dlg.querySelector('input[name="name"]').focus();
}

async function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const name = f.elements.name.value.trim();
  const errId = 'mname-err';
  f.querySelector(`#${errId}`)?.remove();
  if (!name) {
    const p = document.createElement('p');
    p.className = 'error'; p.id = errId;
    p.innerHTML = `${icon('alert')}<span>${t('machinesScreen.nameError')}</span>`;
    f.elements.name.closest('.field').append(p);
    f.elements.name.setAttribute('aria-invalid', 'true');
    f.elements.name.setAttribute('aria-describedby', errId);
    f.elements.name.focus();
    return;
  }
  const group = f.elements.group.value;
  const muscleText = f.elements.muscle.value.trim();
  // With Sheets, a new photo goes to the Drive folder first and the sheet keeps its link.
  if (dataMode() === 'sheets' && S.photo && S.photo.startsWith('data:')) {
    const btn = f.querySelector('[type="submit"]');
    btn.setAttribute('aria-busy', 'true');
    try {
      const up = await post('uploadPhoto', { base64: S.photo.split(',')[1], name });
      S.photo = up.url;
    } catch {
      toast(t('machinesScreen.photoUploadError'));
      S.photo = (S.machines.find((m) => m.id === f.dataset.id) || {}).photoUrl || '';
    } finally {
      btn.removeAttribute('aria-busy');
    }
  }
  const id = f.dataset.id;
  if (id) {
    const before = S.machines.find((m) => m.id === id);
    const keepKey = before.muscleKey && muscleText === muscleOf(before);
    await updateMachine(id, { name, group, photoUrl: S.photo || '', muscle: keepKey ? '' : muscleText, muscleKey: keepKey ? before.muscleKey : '' });
    toast(t('machinesScreen.saved'));
  } else {
    const m = await addMachine({ name, group });
    await updateMachine(m.id, { muscle: muscleText, photoUrl: S.photo || '' });
    toast(t('machinesScreen.added', { name }));
  }
  S.root.querySelector('#editor').close();
  await refresh();
}

async function refresh() {
  S.machines = await getAllMachines();
  await loadRoutines();
  render();
}

export async function renderMachines(el) {
  const root = document.createElement('div');
  el.replaceChildren(root);
  const machines = await getAllMachines();
  const last = new Map();
  await Promise.all(machines.map(async (m) => {
    const h = await getMachineHistory(m.id);
    if (h.length) last.set(m.id, h[h.length - 1].date);
  }));
  S = { root, machines, last, photo: '', rtab: 'upper' };
  await loadRoutines();
  render();

  root.addEventListener('click', async (e) => {
    const rt = e.target.closest('[data-rtab]');
    if (rt) { S.rtab = rt.dataset.rtab; render(); return; }
    const rb = e.target.closest('[data-r]');
    if (rb && !rb.disabled) { await onRoutine(rb); return; }
    const dlg = root.querySelector('#editor');
    if (e.target === dlg) { dlg.close(); return; }
    if (e.target.closest('[data-add]')) return openEditor(null);
    const edit = e.target.closest('[data-edit]');
    if (edit) return openEditor(S.machines.find((m) => m.id === edit.dataset.edit));
    if (e.target.closest('[data-close]')) { dlg.close(); return; }
    if (e.target.closest('[data-remove-photo]')) {
      S.photo = '';
      root.querySelector('#photo-preview').innerHTML = `<span class="thumb-empty" aria-hidden="true">${icon('dumbbell')}</span>`;
      e.target.closest('[data-remove-photo]').remove();
      return;
    }
    const tog = e.target.closest('[data-toggle-active]');
    if (tog) {
      const id = tog.closest('form').dataset.id;
      const m = S.machines.find((x) => x.id === id);
      await updateMachine(id, { active: !m.active });
      dlg.close();
      toast(t('machinesScreen.saved'));
      await refresh();
    }
  });
  root.addEventListener('change', async (e) => {
    if (e.target.name !== 'photo' || !e.target.files[0]) return;
    const file = e.target.files[0];
    const box = root.querySelector('#photo-preview');
    if (!file.type.startsWith('image/')) { box.insertAdjacentHTML('afterend', `<p class="error">${icon('alert')}<span>${t('machinesScreen.photoError')}</span></p>`); return; }
    S.photo = await shrink(file);
    box.innerHTML = `<img src="${S.photo}" alt="">`;
  });
  root.addEventListener('submit', onSubmit);
}
