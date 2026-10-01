import {toRecords, fromRecords, diff, applyPatch} from './shared.mjs';
const API = 'https://delivery-tally-api.yichonezhu.workers.dev';
const DRAFT_KEY = 'deliveryTally_cloud_draft_v1';
export function createCloudSync({getState, setState, setUpdated = () => {}, render, legacy}) {
  const $ = id => document.getElementById(id);
  let base = {}, pending = null, connected = false, sending = false, blocked = false, timer;
  let restored = null;
  try { restored = JSON.parse(sessionStorage.getItem(DRAFT_KEY)); } catch {}
  const records = () => toRecords(getState());
  const hasChanges = () => pending || diff(base, records()).length > 0;
  const status = (text, bad = false) => { $('syncStatus').textContent = text; $('syncStatus').style.color = bad ? 'var(--danger)' : 'var(--muted)'; };
  const lock = locked => { document.querySelector('main').inert = locked; $('storeSel').disabled = locked; };
  function persist() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({base, records:records(), pending})); }
    catch { status('本機備份空間不足，請先完成雲端儲存', true); }
  }
  function apply(recordsValue, updated) {
    if (updated) setUpdated(updated);
    setState(fromRecords(recordsValue, getState().store)); render();
  }
  async function request(method = 'GET', payload) {
    const response = await fetch(API + '/state', {
      method, headers:payload ? {'Content-Type':'application/json'} : {},
      body:payload ? JSON.stringify(payload) : undefined, cache:'no-store', signal:AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || '連線失敗'); error.status = response.status; error.data = result; throw error; }
    return result;
  }
  async function refresh() {
    if (!connected || sending || blocked || hasChanges() || document.hidden) return;
    sending = true;
    const beforeRequest = records();
    try {
      const remote = await request();
      // The user may have edited during the request; never overwrite those changes.
      if (diff(beforeRequest, records()).length || hasChanges()) return;
      base = remote.records; apply(base, remote.updated); persist();
      status('已同步 · ' + new Date().toLocaleTimeString('zh-TW'));
    } catch (error) { status(error.message || '無法同步，請稍後重試', true); }
    finally { sending = false; if (!blocked && hasChanges()) schedule(); }
  }
  function conflict(message) {
    blocked = true; lock(true); $('syncReload').hidden = false;
    status(message + '；未送出的修改仍保留，可先下載備份。', true); persist();
  }
  async function flush() {
    if (!connected || sending || blocked) return;
    const snapshot = records();
    if (!pending) {
      const changes = diff(base, snapshot);
      if (!changes.length) return;
      pending = {id:crypto.randomUUID(), changes}; persist();
    }
    // Recover the exact state represented by this request, even after reload/retry.
    const sent = applyPatch(base, pending.changes);
    if (sent.conflicts) { conflict('草稿版本不一致，請下載備份並重新載入'); return; }
    sending = true; status('儲存中…');
    try {
      const remote = await request('POST', pending);
      const newerLocalChanges = diff(sent.records, records());
      pending = null;
      const rebased = applyPatch(remote.records, newerLocalChanges);
      base = remote.records;
      if (rebased.conflicts) { conflict('儲存期間有人修改了相同資料'); return; }
      apply(rebased.records, remote.updated); persist(); status('已儲存至雲端 · ' + new Date().toLocaleTimeString('zh-TW'));
    } catch (error) {
      if (error.status === 409) { pending = null; conflict(error.message); }
      else status((error.message || '連線中斷') + '；修改尚未確認儲存，請按「重試同步」。', true);
      persist();
    } finally {
      sending = false;
      // Do not endlessly retry an uncertain failed write. Keep its ID for manual retry.
      if (!pending && !blocked && diff(base, records()).length) schedule();
    }
  }
  function schedule() { clearTimeout(timer); if (!pending && !blocked) timer = setTimeout(flush, 1800); }
  function changed() { if (!connected) return; persist(); status('有修改尚未儲存…'); schedule(); }
  async function connect() {
    if (sending) return;
    lock(true); sending = true; status('連接雲端…');
    try {
      const remote = await request();
      connected = true;
      if (restored && (restored.pending || diff(restored.base, restored.records).length)) {
        base = restored.base; pending = restored.pending; apply(restored.records, remote.updated); restored = null;
        status('已恢復未送出的草稿，正在確認儲存狀態…');
      } else { base = remote.records; apply(base, remote.updated); restored = null; status('已連接雲端'); }
      lock(false); persist();
      $('syncImport').hidden = !Object.keys(toRecords(legacy)).length;
    } catch (error) { status(error.message || '無法連接雲端', true); }
    finally { sending = false; }
    if (connected && hasChanges()) await flush();
  }
  $('syncRetry').onclick = () => { if (!connected) connect(); else if (hasChanges()) flush(); else refresh(); };
  $('syncReload').onclick = async () => {
    if (sending || !confirm('重新載入雲端資料會放棄此頁未送出的修改。需要時請先下載備份。確定繼續？')) return;
    sending = true;
    try { const remote = await request(); base = remote.records; pending = null; blocked = false; apply(base, remote.updated); persist(); lock(false); $('syncReload').hidden = true; status('已重新載入雲端資料'); }
    catch (error) { status(error.message, true); }
    finally { sending = false; }
  };
  $('syncExport').onclick = () => {
    const file = new Blob([JSON.stringify({state:getState(), savedBase:base, pending}, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(file), a = document.createElement('a'); a.href = url; a.download = '外送統計備份-' + new Date().toISOString().slice(0,10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('syncImport').onclick = () => {
    if (sending || blocked || hasChanges()) { status('請先完成目前的雲端同步', true); return; }
    const current = records(), old = toRecords(legacy);
    const missing = Object.keys(old).filter(k => !Object.hasOwn(current, k));
    if (!missing.length) { alert('原有資料已存在於雲端，沒有可新增的項目。'); return; }
    if (!confirm(`將此瀏覽器原有的 ${missing.length} 筆資料加入團隊雲端？已有的同名訂單不會覆蓋。`)) return;
    for (const k of missing) current[k] = old[k]; apply(current); changed();
  };
  window.addEventListener('beforeunload', e => {if (connected && hasChanges()) {e.preventDefault(); e.returnValue = '';}});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  return {changed, start() {lock(true); connect(); setInterval(refresh, 3000);}};
}
