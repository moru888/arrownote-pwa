import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAdREbEa1YpJM_Rr0j2k_ZrtOiYlzIpwms',
  authDomain: 'arrownote-12fff.firebaseapp.com',
  projectId: 'arrownote-12fff',
  storageBucket: 'arrownote-12fff.firebasestorage.app',
  messagingSenderId: '439355219434',
  appId: '1:439355219434:web:35fe3fae944864d4c3a693',
  measurementId: 'G-J7X6VGXPBL'
};

const KEYS = {
  sessions: 'arrowNoteLogsV2',
  journals: 'arrowNoteJournalV1',
  deepJournals: 'arrowNoteDeepJournalV1',
  settings: 'arrowNoteSettings',
  tombstones: 'arrowNoteSyncTombstonesV1',
  lastSync: 'arrowNoteCloudLastSyncV1'
};
const COLLECTION_TYPES = ['sessions', 'journals', 'deepJournals'];
const TOMBSTONE_TYPES = new Set(COLLECTION_TYPES);

const byId = id => document.getElementById(id);
const statusText = byId('cloudStatus');
const statusDot = byId('cloudStatusDot');
const accountText = byId('cloudAccount');
const uidText = byId('cloudUid');
const noteText = byId('cloudNote');
const signInButton = byId('cloudSignInButton');
const signOutButton = byId('cloudSignOutButton');
const syncButton = byId('cloudSyncButton');

let auth;
let db;
let currentUser = null;
let syncTimer = null;
let syncing = false;
let rerunRequested = false;

function setStatus(text, tone = '') {
  if (statusText) statusText.textContent = text;
  if (statusDot) statusDot.dataset.tone = tone;
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value == null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function timeOf(value = {}) {
  const time = Date.parse(value.updatedAt || value.deletedAt || value.reflectionUpdatedAt || value.createdAt || '');
  return Number.isFinite(time) ? time : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function sameRecord(a, b) {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

function sameRecordSet(a, b) {
  const ordered = values => [...values].sort((left, right) => left.syncId.localeCompare(right.syncId));
  return sameRecord(ordered(a), ordered(b));
}

function cleanRecords(values) {
  if (!Array.isArray(values)) return [];
  return values.filter(value => value && typeof value === 'object' && typeof value.syncId === 'string' && value.syncId.length > 0);
}

function mergeRecords(localValues, remoteValues) {
  const merged = new Map();
  for (const value of [...cleanRecords(localValues), ...cleanRecords(remoteValues)]) {
    const current = merged.get(value.syncId);
    if (!current || timeOf(value) > timeOf(current)) merged.set(value.syncId, value);
  }
  return [...merged.values()];
}

function cleanTombstones(values) {
  if (!Array.isArray(values)) return [];
  return values.filter(value => value && typeof value.syncId === 'string' && TOMBSTONE_TYPES.has(value.type) && timeOf(value) > 0);
}

function isDeleted(record, tombstoneMap) {
  const tombstone = tombstoneMap.get(record.syncId);
  return tombstone && timeOf(tombstone) >= timeOf(record);
}

function localSnapshot() {
  const journals = readJson(KEYS.journals, {});
  return {
    sessions: cleanRecords(readJson(KEYS.sessions, [])),
    journals: cleanRecords(Object.values(journals && typeof journals === 'object' && !Array.isArray(journals) ? journals : {})),
    deepJournals: cleanRecords(readJson(KEYS.deepJournals, [])),
    settings: readJson(KEYS.settings, null),
    tombstones: cleanTombstones(readJson(KEYS.tombstones, []))
  };
}

function writeLocalSnapshot(snapshot) {
  localStorage.setItem(KEYS.sessions, JSON.stringify(snapshot.sessions.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (+b.id || 0) - (+a.id || 0))));
  localStorage.setItem(KEYS.journals, JSON.stringify(Object.fromEntries(snapshot.journals.filter(entry => entry.date).map(entry => [entry.date, entry]))));
  localStorage.setItem(KEYS.deepJournals, JSON.stringify(snapshot.deepJournals.sort((a, b) => (b.date || '').localeCompare(a.date || ''))));
  if (snapshot.settings) localStorage.setItem(KEYS.settings, JSON.stringify(snapshot.settings));
  localStorage.setItem(KEYS.tombstones, JSON.stringify(snapshot.tombstones));
}

function collectionRef(uid, type) {
  return collection(db, 'users', uid, type);
}

function encodeCloudDocument(value) {
  const payload = JSON.stringify(value);
  if (!payload) throw new Error('クラウド保存用データを作成できませんでした');
  const encoded = {
    syncId: String(value.syncId || 'settings'),
    schemaVersion: 1,
    payload,
    updatedAt: value.updatedAt || value.deletedAt || value.createdAt || new Date().toISOString()
  };
  for (const key of ['createdAt', 'deletedAt', 'date', 'type']) {
    if (typeof value[key] === 'string' && value[key]) encoded[key] = value[key];
  }
  return encoded;
}

function decodeCloudDocument(value) {
  if (!value || typeof value !== 'object' || typeof value.payload !== 'string') return value;
  try {
    const decoded = JSON.parse(value.payload);
    if (!decoded || typeof decoded !== 'object') return null;
    return {
      ...decoded,
      syncId: decoded.syncId || value.syncId,
      updatedAt: decoded.updatedAt || value.updatedAt
    };
  } catch (error) {
    console.warn('ArrowNote cloud document could not be decoded', error);
    return null;
  }
}

async function readRemote(uid) {
  const [sessionsSnap, journalsSnap, deepSnap, tombstonesSnap, settingsSnap] = await Promise.all([
    getDocs(collectionRef(uid, 'sessions')),
    getDocs(collectionRef(uid, 'journals')),
    getDocs(collectionRef(uid, 'deepJournals')),
    getDocs(collectionRef(uid, 'deletions')),
    getDoc(doc(db, 'users', uid, 'settings', 'main'))
  ]);
  return {
    sessions: cleanRecords(sessionsSnap.docs.map(item => decodeCloudDocument(item.data()))),
    journals: cleanRecords(journalsSnap.docs.map(item => decodeCloudDocument(item.data()))),
    deepJournals: cleanRecords(deepSnap.docs.map(item => decodeCloudDocument(item.data()))),
    tombstones: cleanTombstones(tombstonesSnap.docs.map(item => decodeCloudDocument(item.data()))),
    settings: settingsSnap.exists() ? decodeCloudDocument(settingsSnap.data()) : null
  };
}

async function commitOperations(operations) {
  for (let start = 0; start < operations.length; start += 400) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(start, start + 400)) {
      if (operation.kind === 'delete') batch.delete(operation.ref);
      else batch.set(operation.ref, encodeCloudDocument(operation.value));
    }
    await batch.commit();
  }
}

function humanError(error) {
  const code = error?.code || '';
  if (code.includes('unauthorized-domain')) return 'GitHub PagesのドメインがFirebase Authenticationで許可されていません';
  if (code.includes('popup-blocked')) return 'Googleログイン画面がブロックされました。ポップアップを許可して再試行してください';
  if (code.includes('popup-closed')) return 'Googleログインがキャンセルされました';
  if (code.includes('permission-denied')) return 'Firestoreのセキュリティルールで拒否されました';
  if (!navigator.onLine) return 'オフラインです。端末には保存済みで、接続後に再同期します';
  return `同期できませんでした${error?.message ? `：${error.message}` : ''}`;
}

async function syncNow() {
  if (!currentUser) {
    setStatus('Googleログインが必要です');
    return;
  }
  if (!navigator.onLine) {
    setStatus('端末に保存済み・通信待ち', 'busy');
    return;
  }
  if (syncing) {
    rerunRequested = true;
    return;
  }
  syncing = true;
  if (syncButton) syncButton.disabled = true;
  setStatus('同期しています', 'busy');
  try {
    const uid = currentUser.uid;
    const [local, remote] = await Promise.all([Promise.resolve(localSnapshot()), readRemote(uid)]);
    const tombstones = mergeRecords(local.tombstones, remote.tombstones);
    const tombstoneMap = new Map(tombstones.map(value => [value.syncId, value]));
    const merged = { tombstones };
    for (const type of COLLECTION_TYPES) {
      merged[type] = mergeRecords(local[type], remote[type]).filter(record => !isDeleted(record, tombstoneMap));
    }
    if (local.settings && remote.settings) merged.settings = timeOf(remote.settings) > timeOf(local.settings) ? remote.settings : local.settings;
    else merged.settings = local.settings || remote.settings;

    const remoteChangedLocal = COLLECTION_TYPES.some(type => !sameRecordSet(local[type], merged[type]))
      || !sameRecord(local.settings, merged.settings);

    writeLocalSnapshot(merged);
    const operations = [];
    for (const type of COLLECTION_TYPES) {
      const remoteMap = new Map(remote[type].map(record => [record.syncId, record]));
      for (const record of merged[type]) {
        const remoteRecord = remoteMap.get(record.syncId);
        if (!remoteRecord || timeOf(record) > timeOf(remoteRecord) || (timeOf(record) === timeOf(remoteRecord) && !sameRecord(record, remoteRecord))) {
          operations.push({ kind: 'set', ref: doc(collectionRef(uid, type), record.syncId), value: record });
        }
      }
      for (const remoteRecord of remote[type]) {
        const tombstone = tombstoneMap.get(remoteRecord.syncId);
        if (tombstone && timeOf(tombstone) >= timeOf(remoteRecord)) {
          operations.push({ kind: 'delete', ref: doc(collectionRef(uid, type), remoteRecord.syncId) });
        }
      }
    }

    const remoteTombstoneMap = new Map(remote.tombstones.map(value => [value.syncId, value]));
    for (const tombstone of tombstones) {
      const remoteTombstone = remoteTombstoneMap.get(tombstone.syncId);
      if (!remoteTombstone || timeOf(tombstone) > timeOf(remoteTombstone) || !sameRecord(tombstone, remoteTombstone)) {
        operations.push({ kind: 'set', ref: doc(collectionRef(uid, 'deletions'), tombstone.syncId), value: tombstone });
      }
    }
    if (merged.settings && (!remote.settings || timeOf(merged.settings) > timeOf(remote.settings) || !sameRecord(merged.settings, remote.settings))) {
      operations.push({ kind: 'set', ref: doc(db, 'users', uid, 'settings', 'main'), value: merged.settings });
    }

    await commitOperations(operations);
    const completedAt = new Date().toISOString();
    localStorage.setItem(KEYS.lastSync, completedAt);
    if (remoteChangedLocal) window.dispatchEvent(new CustomEvent('arrownote:cloud-applied'));
    setStatus(`同期済み ${new Date(completedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
    if (noteText) noteText.textContent = `端末とクラウドを確認しました（更新 ${operations.length}件）。下書きは端末内だけに保存されます。`;
  } catch (error) {
    console.error('ArrowNote cloud sync failed', error);
    setStatus('要再試行', 'error');
    if (noteText) noteText.textContent = humanError(error);
  } finally {
    syncing = false;
    if (syncButton) syncButton.disabled = !currentUser;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleSync(300);
    }
  }
}

function scheduleSync(delay = 4000) {
  if (!currentUser) return;
  clearTimeout(syncTimer);
  if (!navigator.onLine) {
    setStatus('端末に保存済み・通信待ち', 'busy');
    return;
  }
  setStatus('端末に保存済み・同期待ち', 'busy');
  syncTimer = setTimeout(syncNow, delay);
}

function updateAccount(user) {
  currentUser = user;
  if (signInButton) signInButton.hidden = Boolean(user);
  if (signOutButton) signOutButton.hidden = !user;
  if (syncButton) syncButton.disabled = !user;
  if (uidText) {
    uidText.hidden = !user;
    uidText.textContent = user ? `個人固定用UID：${user.uid}` : '';
  }
  if (accountText) accountText.textContent = user ? `${user.displayName || user.email || 'Googleユーザー'}でログイン中` : 'Googleアカウントには未接続です';
  if (!user) {
    setStatus('未ログイン');
    if (noteText) noteText.textContent = 'ログアウトしても、この端末の記録は削除されません。';
  }
}

async function startCloud() {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);
  signInButton?.addEventListener('click', async () => {
    signInButton.disabled = true;
    setStatus('Googleログインを開いています', 'busy');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      setStatus('ログインできませんでした', 'error');
      if (noteText) noteText.textContent = humanError(error);
    } finally {
      signInButton.disabled = false;
    }
  });
  signOutButton?.addEventListener('click', () => signOut(auth));
  syncButton?.addEventListener('click', syncNow);
  window.addEventListener('arrownote:local-change', () => scheduleSync());
  window.addEventListener('online', () => scheduleSync(300));
  window.addEventListener('offline', () => setStatus('端末に保存済み・通信待ち', 'busy'));
  onAuthStateChanged(auth, user => {
    updateAccount(user);
    if (user) scheduleSync(200);
  });
  window.ArrowNoteCloud = { syncNow, scheduleSync, getUser: () => currentUser };
}

if (location.protocol === 'file:') {
  setStatus('テストページでは同期しません');
  if (accountText) accountText.textContent = 'GoogleログインはGitHub PagesのHTTPS版で確認します';
  if (noteText) noteText.textContent = '画面と端末内保存はテストできます。クラウド接続は公開前の実機テストで有効になります。';
  if (signInButton) signInButton.disabled = true;
  window.ArrowNoteCloud = { syncNow: async () => {}, scheduleSync: () => {}, getUser: () => null };
} else {
  startCloud().catch(error => {
    console.error('ArrowNote Firebase initialization failed', error);
    setStatus('クラウド機能を開始できません', 'error');
    if (noteText) noteText.textContent = humanError(error);
  });
}
