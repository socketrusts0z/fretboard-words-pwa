const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const STRINGS = [
  { name: 'e', open: 64, full: 'high E' },
  { name: 'B', open: 59, full: 'B' },
  { name: 'G', open: 55, full: 'G' },
  { name: 'D', open: 50, full: 'D' },
  { name: 'A', open: 45, full: 'A' },
  { name: 'E', open: 40, full: 'low E' }
];
const FAMILIAR = [
  { name: 'G major', notes: ['G', 'B', 'D'] },
  { name: 'A minor', notes: ['A', 'C', 'E'] },
  { name: 'C major', notes: ['C', 'E', 'G'] },
  { name: 'E minor', notes: ['E', 'G', 'B'] },
  { name: 'D minor', notes: ['D', 'F', 'A'] },
  { name: 'F major', notes: ['F', 'A', 'C'] },
  { name: 'Up the scale', notes: ['C', 'D', 'E', 'F'] },
  { name: 'Back down', notes: ['G', 'F', 'E', 'D'] }
];
const $ = id => document.getElementById(id);
const state = { range: 'starter', maxFret: 5, selectedStrings: new Set([50, 45, 40]), selectedNotes: new Set(NOTES), deck: 'familiar', word: null, index: 0, words: 0, attempts: 0, hits: 0, streak: 0, best: 0, sound: true, locked: true, lastWord: '', audio: null, nextTimer: null, session: null, history: [], storage: null, storageReady: false, saveQueue: Promise.resolve(), promptStartedMono: 0 };
const DB_NAME = 'fretboard-words-history';
const FALLBACK_KEY = 'fretboard-words-history-v1';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function databaseRequest(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', mode);
    const request = operation(transaction.objectStore('sessions'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
async function initializeStorage() {
  try {
    const db = await openDatabase();
    state.storage = { kind: 'indexeddb', db };
    state.history = await databaseRequest(db, 'readonly', store => store.getAll());
    $('storageMessage').textContent = 'Saved in this browser on this device. Export a copy for backup.';
  } catch (_) {
    try {
      state.history = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]');
      if (!Array.isArray(state.history)) throw new Error('Invalid saved history');
      state.storage = { kind: 'localstorage' };
      $('storageMessage').textContent = 'Saved in this browser on this device. Export a copy for backup.';
    } catch (_) {
      state.history = [];
      state.storage = { kind: 'memory' };
      $('storageMessage').textContent = 'Browser storage is unavailable. Export your data before closing this page.';
    }
  }
  state.storageReady = true;
  const draft = state.history.filter(session => session.status === 'active').sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  if (draft) restoreSession(draft);
  else showIdle();
  renderDashboard();
}
async function saveRecord(record) {
  if (state.storage.kind === 'indexeddb') await databaseRequest(state.storage.db, 'readwrite', store => store.put(record));
  else if (state.storage.kind === 'localstorage') localStorage.setItem(FALLBACK_KEY, JSON.stringify(state.history));
}
function queueSave() {
  if (!state.session) return;
  const snapshot = JSON.parse(JSON.stringify(state.session));
  const existing = state.history.findIndex(item => item.id === snapshot.id);
  if (existing < 0) state.history.push(snapshot);
  else state.history[existing] = snapshot;
  state.saveQueue = state.saveQueue.catch(() => {}).then(() => saveRecord(snapshot)).catch(() => {
    state.storage = { kind: 'memory' };
    $('storageMessage').textContent = 'Saving failed. Export your data before closing this page.';
  });
}

function noteFor(midi) { return NOTES[midi % 12]; }
function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function drawFromBag(bag, choices, previous = null) {
  if (!bag.length) {
    bag.push(...shuffled(choices));
    if (bag.length > 1 && bag[bag.length - 1] === previous) {
      [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
  }
  return bag.pop();
}
function emptySchedule() { return { noteBag: [], stringBags: {}, familiarBag: [], lastNote: null }; }
function describeStep(step) { return step.stringOpen === null ? step.note : `${step.note} on the ${step.stringLabel} string`; }
function playableNotes() {
  const reachable = new Set();
  STRINGS.filter(string => state.selectedStrings.has(string.open)).forEach(string => {
    for (let fret = 0; fret <= state.maxFret; fret++) reachable.add(noteFor(string.open + fret));
  });
  return NOTES.filter(note => state.selectedNotes.has(note) && reachable.has(note));
}
function configSnapshot() { return { range: state.range, maxFret: state.maxFret, selectedStrings: [...state.selectedStrings], selectedNotes: [...state.selectedNotes], deck: state.deck }; }
function sessionSummary(session) {
  const prompts = (session.prompts || []).filter(prompt => prompt.answers?.length);
  const answers = prompts.flatMap(prompt => prompt.answers);
  const correct = answers.filter(answer => answer.correct);
  const responseTimes = prompts.map(prompt => prompt.answers.find(answer => answer.correct)?.responseMs).filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(responseTimes.length / 2);
  const medianMs = responseTimes.length ? responseTimes.length % 2 ? responseTimes[middle] : (responseTimes[middle - 1] + responseTimes[middle]) / 2 : null;
  return { attempts: answers.length, correct: correct.length, accuracy: answers.length ? Math.round(correct.length / answers.length * 100) : null, firstTry: prompts.length ? Math.round(prompts.filter(prompt => prompt.answers[0].correct).length / prompts.length * 100) : null, medianMs, completedWords: session.completedWords || 0, durationMs: Math.max(0, Date.parse(session.endedAt || new Date().toISOString()) - Date.parse(session.startedAt)) };
}
function resetLiveStats() {
  Object.assign(state, { words: 0, attempts: 0, hits: 0, streak: 0, best: 0, lastWord: '', index: 0 });
  updateStats();
}
function updateControls() {
  const active = !!state.session && state.session.status === 'active';
  $('startSession').hidden = active;
  $('endSession').hidden = !active;
  $('startSession').disabled = !state.storageReady || active || playableNotes().length === 0;
  $('range').disabled = active;
  $('deck').disabled = active;
  for (const id of ['allStrings', 'allNotes', 'naturalNotes', 'clearNotes']) $(id).disabled = active;
  document.querySelectorAll('.choice-chip').forEach(button => button.disabled = active);
  document.querySelectorAll('.fret-button').forEach(button => button.disabled = active && (state.locked || !state.word));
  $('hint').disabled = !active || state.locked || !state.word;
  $('exportData').disabled = active;
  $('importData').disabled = active;
  $('sessionState').textContent = active ? 'Session in progress' : 'Ready when you are';
  $('sessionStatus').textContent = active ? 'Recording' : 'Not started';
  $('boardInstruction').textContent = active ? 'Tap a fret to answer' : 'Tap a fret to reveal its note';
}
function showIdle(message = 'Tap any fret to reveal its note, or start a session.') {
  state.word = null;
  state.locked = true;
  $('wordName').textContent = message.startsWith('Session saved') ? 'Session saved' : 'Ready to practice';
  $('wordNumber').textContent = 'PRESS START';
  $('noteSequence').replaceChildren();
  $('feedback').textContent = message;
  $('feedback').className = 'feedback';
  clearBoardMarkers();
  updateControls();
  if (message.startsWith('Session saved')) $('sessionStatus').textContent = 'Saved';
}
function updateTimer() {
  if (!state.session || state.session.status !== 'active') return;
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(state.session.startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  $('sessionTimer').textContent = `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
function recordPrompt() {
  if (!state.session || !state.word) return;
  const step = state.word.steps[state.index];
  state.session.currentWord = state.word;
  state.session.currentIndex = state.index;
  state.session.prompts.push({ id: `${state.session.id}-${state.session.prompts.length + 1}`, wordName: state.word.name, note: step.note, stringOpen: step.stringOpen, stringLabel: step.stringLabel, shownAt: new Date().toISOString(), answers: [] });
  state.promptStartedMono = performance.now();
  queueSave();
}
function startSession() {
  if (!state.storageReady || state.session || playableNotes().length === 0) return;
  if (state.nextTimer) clearTimeout(state.nextTimer);
  resetLiveStats();
  state.session = { id: window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`, status: 'active', startedAt: new Date().toISOString(), endedAt: null, config: configSnapshot(), prompts: [], completedWords: 0, currentWord: null, currentIndex: 0, schedule: emptySchedule() };
  $('sessionTimer').textContent = '00:00';
  chooseWord();
  updateTimer();
}
function restoreSession(session) {
  state.session = session;
  session.schedule ||= emptySchedule();
  state.range = session.config.range;
  state.maxFret = session.config.maxFret;
  state.selectedStrings = new Set(session.config.selectedStrings);
  state.selectedNotes = new Set(session.config.selectedNotes);
  state.deck = session.config.deck;
  $('range').value = state.range;
  $('deck').value = state.deck;
  renderChoices();
  renderBoard();
  resetLiveStats();
  state.words = session.completedWords || 0;
  for (const answer of session.prompts.flatMap(prompt => prompt.answers || [])) {
    state.attempts++;
    if (answer.correct) { state.hits++; state.streak++; state.best = Math.max(state.best, state.streak); }
    else state.streak = 0;
  }
  state.word = session.currentWord;
  state.lastWord = state.word?.name || '';
  state.index = session.currentIndex || 0;
  if (state.word) {
    state.locked = false;
    renderSequence();
    $('wordName').textContent = state.word.name;
    $('wordNumber').textContent = `WORD ${String(state.words + 1).padStart(2, '0')}`;
    $('feedback').textContent = `Session restored. Find ${describeStep(state.word.steps[state.index])}.`;
  } else chooseWord();
  state.promptStartedMono = performance.now();
  updateStats();
  updateControls();
  updateTimer();
}
async function endSession() {
  if (!state.session || state.session.status !== 'active') return;
  if (state.nextTimer) clearTimeout(state.nextTimer);
  const finished = state.session;
  finished.status = 'finished';
  finished.endedAt = new Date().toISOString();
  finished.currentWord = null;
  finished.summary = sessionSummary(finished);
  queueSave();
  await state.saveQueue;
  state.session = null;
  $('sessionTimer').textContent = `${Math.floor(finished.summary.durationMs / 60000).toString().padStart(2, '0')}:${Math.floor(finished.summary.durationMs % 60000 / 1000).toString().padStart(2, '0')}`;
  showIdle(`Session saved. Accuracy: ${finished.summary.accuracy === null ? '—' : `${finished.summary.accuracy}%`}. Your history is below.`);
  renderDashboard();
}
function chooseWord() {
  const pool = playableNotes();
  if (!pool.length) {
    state.word = null;
    state.locked = true;
    $('wordName').textContent = 'Choose a playable note';
    $('wordNumber').textContent = 'READY WHEN YOU ARE';
    $('noteSequence').replaceChildren();
    $('feedback').textContent = state.selectedNotes.size ? 'No selected notes occur in this area. Change the strings, frets, or notes.' : 'Select at least one note above to begin.';
    $('feedback').className = 'feedback';
    clearBoardMarkers();
    return;
  }
  let word;
  const schedule = state.session.schedule ||= emptySchedule();
  if (state.deck === 'familiar') {
    const choices = FAMILIAR.filter(item => item.notes.every(note => pool.includes(note)));
    if (choices.length) {
      const name = drawFromBag(schedule.familiarBag, choices.map(item => item.name), state.lastWord);
      const chosen = choices.find(item => item.name === name);
      word = { name: chosen.name, steps: chosen.notes.map(note => ({ note, stringOpen: null, stringLabel: null })) };
    }
  }
  if (!word) {
    const steps = [];
    const count = pool.length === 1 && state.selectedStrings.size === 1 ? 3 : 4;
    while (steps.length < count) {
      const note = drawFromBag(schedule.noteBag, pool, schedule.lastNote);
      schedule.lastNote = note;
      const strings = STRINGS.filter(string => state.selectedStrings.has(string.open) &&
        Array.from({ length: state.maxFret + 1 }, (_, fret) => noteFor(string.open + fret)).includes(note));
      const bag = schedule.stringBags[note] ||= [];
      const stringOpen = drawFromBag(bag, strings.map(string => string.open));
      const string = strings.find(item => item.open === stringOpen);
      steps.push({ note, stringOpen, stringLabel: string.full });
    }
    word = { name: pool.length === 1 ? `Find ${pool[0]}` : 'Your note mix', steps };
  }
  state.lastWord = word.name;
  state.word = word;
  state.index = 0;
  state.locked = false;
  $('wordName').textContent = word.name;
  $('wordNumber').textContent = `WORD ${String(state.words + 1).padStart(2, '0')}`;
  $('feedback').textContent = `Find ${describeStep(word.steps[0])}. Tap the matching fret.`;
  $('feedback').className = 'feedback';
  renderSequence();
  clearBoardMarkers();
  recordPrompt();
  updateControls();
}
function renderSequence() {
  const root = $('noteSequence');
  root.replaceChildren();
  state.word.steps.forEach((step, i) => {
    if (i) {
      const arrow = document.createElement('span');
      arrow.className = 'note-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      root.append(arrow);
    }
    const token = document.createElement('span');
    token.className = `note-token${i < state.index ? ' done' : i === state.index ? ' active' : ''}`;
    if (step.stringOpen === null) token.textContent = step.note;
    else {
      token.classList.add('with-string');
      const note = document.createElement('span');
      note.className = 'note-main';
      note.textContent = step.note;
      const string = document.createElement('span');
      string.className = 'note-string';
      string.textContent = `${step.stringLabel} string`;
      token.append(note, string);
    }
    token.setAttribute('aria-current', i === state.index ? 'step' : 'false');
    root.append(token);
  });
}
function makeFretCell(string, fret) {
  const midi = string.open + fret;
  const cell = document.createElement('td');
  cell.className = `fret-cell${fret === 0 ? ' open' : ''}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fret-button';
  button.setAttribute('aria-label', `${string.full} string, fret ${fret}, ${noteFor(midi)}`);
  button.dataset.note = noteFor(midi);
  button.dataset.stringOpen = String(string.open);
  button.dataset.fret = String(fret);
  button.dataset.midi = String(midi);
  button.dataset.location = `${string.full} string, ${fret === 0 ? 'open' : `fret ${fret}`}`;
  button.addEventListener('click', () => answer(button));
  cell.append(button);
  return cell;
}
function renderBoard() {
  const maxFret = state.maxFret;
  const strings = STRINGS.filter(string => state.selectedStrings.has(string.open));
  const table = document.createElement('table');
  table.className = `fretboard horizontal ${maxFret === 12 ? 'full' : 'starter'}`;
  table.setAttribute('aria-label', 'Guitar strings as rows and frets as columns');
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const stringHead = document.createElement('th');
  stringHead.textContent = 'STRING';
  headerRow.append(stringHead);
  for (let fret = 0; fret <= maxFret; fret++) {
    const th = document.createElement('th');
    th.textContent = fret === 0 ? 'OPEN' : String(fret).padStart(2, '0');
    headerRow.append(th);
  }
  head.append(headerRow);
  table.append(head);
  const body = document.createElement('tbody');
  strings.forEach(string => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'string-name';
    nameCell.textContent = string.name;
    row.append(nameCell);
    for (let fret = 0; fret <= maxFret; fret++) row.append(makeFretCell(string, fret));
    body.append(row);
  });
  table.append(body);

  const vertical = document.createElement('table');
  vertical.className = 'fretboard vertical';
  vertical.setAttribute('aria-label', 'Guitar strings as columns and frets as rows');
  const verticalHead = document.createElement('thead');
  const verticalHeadRow = document.createElement('tr');
  const fretHead = document.createElement('th');
  fretHead.textContent = 'FRET';
  verticalHeadRow.append(fretHead);
  const leftToRightStrings = [...strings].reverse();
  leftToRightStrings.forEach(string => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = `${string.name}${STRINGS.indexOf(string) + 1}`;
    th.setAttribute('aria-label', `${string.full} string`);
    verticalHeadRow.append(th);
  });
  verticalHead.append(verticalHeadRow);
  vertical.append(verticalHead);
  const verticalBody = document.createElement('tbody');
  for (let fret = 0; fret <= maxFret; fret++) {
    const row = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.className = 'fret-number';
    label.textContent = fret === 0 ? 'OPEN' : String(fret).padStart(2, '0');
    row.append(label);
    leftToRightStrings.forEach(string => row.append(makeFretCell(string, fret)));
    verticalBody.append(row);
  }
  vertical.append(verticalBody);
  $('fretboard').replaceChildren(table, vertical);
  $('rangeCaption').textContent = `${strings.map(string => string.full.toUpperCase()).join(' / ')} · FRETS 0–${maxFret}`;
}
function renderChoices() {
  const stringRoot = $('stringChoices');
  stringRoot.replaceChildren();
  STRINGS.forEach(string => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'choice-chip';
    chip.textContent = string.full === 'high E' ? 'High E' : string.full === 'low E' ? 'Low E' : string.name;
    chip.setAttribute('aria-pressed', String(state.selectedStrings.has(string.open)));
    chip.setAttribute('aria-label', `${string.full} string`);
    chip.addEventListener('click', () => {
      if (state.selectedStrings.has(string.open)) {
        if (state.selectedStrings.size === 1) { $('selectionStatus').textContent = 'Keep at least one string selected.'; return; }
        state.selectedStrings.delete(string.open);
      } else state.selectedStrings.add(string.open);
      state.range = 'custom';
      $('range').value = 'custom';
      selectionChanged();
    });
    stringRoot.append(chip);
  });
  const noteRoot = $('noteChoices');
  noteRoot.replaceChildren();
  NOTES.forEach(note => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'choice-chip';
    chip.textContent = note;
    chip.setAttribute('aria-pressed', String(state.selectedNotes.has(note)));
    chip.setAttribute('aria-label', `${note} note`);
    chip.addEventListener('click', () => {
      if (state.selectedNotes.has(note)) state.selectedNotes.delete(note);
      else state.selectedNotes.add(note);
      selectionChanged();
    });
    noteRoot.append(chip);
  });
  const count = playableNotes().length;
  $('selectionStatus').textContent = state.selectedNotes.size === 0 ? 'Select one or more notes to begin.' : count === 0 ? 'No selected notes are reachable here.' : `${state.selectedStrings.size} string${state.selectedStrings.size === 1 ? '' : 's'} · ${count} playable note${count === 1 ? '' : 's'}`;
}
function selectionChanged() { if (state.session) return; renderChoices(); renderBoard(); resetLiveStats(); showIdle(); }
function clearBoardMarkers() {
  document.querySelectorAll('.fret-button').forEach(button => {
    if (button.classList.contains('revealed')) button.textContent = '';
    button.classList.remove('hint', 'wrong', 'correct-hit', 'revealed');
  });
}
function play(midi) {
  if (!state.sound) return;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    state.audio ||= new Context();
    if (state.audio.state === 'suspended') state.audio.resume();
    const now = state.audio.currentTime;
    const oscillator = state.audio.createOscillator();
    const gain = state.audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    oscillator.connect(gain).connect(state.audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.5);
  } catch (_) { /* Sound is optional; practice still works. */ }
}
function updateStats() {
  $('completed').textContent = state.words;
  $('accuracy').textContent = state.attempts ? `${Math.round(state.hits / state.attempts * 100)}%` : '—';
  $('streak').textContent = state.best;
}
function answer(button) {
  if (!state.session) {
    const note = button.dataset.note;
    document.querySelectorAll('.fret-button').forEach(other => {
      if (other.dataset.stringOpen === button.dataset.stringOpen && other.dataset.fret === button.dataset.fret) {
        other.textContent = note;
        other.classList.add('revealed');
      }
    });
    play(Number(button.dataset.midi));
    $('feedback').textContent = `${note} at ${button.dataset.location}.`;
    $('feedback').className = 'feedback';
    return;
  }
  if (state.locked || !state.word) return;
  clearBoardMarkers();
  const played = button.dataset.note;
  const target = state.word.steps[state.index];
  const correct = played === target.note && (target.stringOpen === null || Number(button.dataset.stringOpen) === target.stringOpen);
  const prompt = state.session.prompts[state.session.prompts.length - 1];
  prompt.answers.push({ at: new Date().toISOString(), note: played, stringOpen: Number(button.dataset.stringOpen), fret: Number(button.dataset.fret), midi: Number(button.dataset.midi), correct, responseMs: Math.max(0, Math.round(performance.now() - state.promptStartedMono)) });
  state.attempts++;
  play(Number(button.dataset.midi));
  if (!correct) {
    state.streak = 0;
    button.classList.add('wrong');
    $('feedback').textContent = played === target.note ? `That’s ${played}, but on the wrong string. Find it on the ${target.stringLabel} string.` : `That’s ${played} at ${button.dataset.location}. Find ${describeStep(target)} and try again.`;
    $('feedback').className = 'feedback incorrect';
    updateStats();
    queueSave();
    return;
  }
  state.hits++;
  state.streak++;
  state.best = Math.max(state.best, state.streak);
  button.classList.add('correct-hit');
  state.index++;
  if (state.index === state.word.steps.length) {
    state.words++;
    state.session.completedWords = state.words;
    state.session.currentWord = null;
    state.session.currentIndex = 0;
    state.locked = true;
    $('feedback').textContent = `Word complete! Last note: ${target.note} at ${button.dataset.location}.`;
    $('feedback').className = 'feedback correct';
    renderSequence();
    updateStats();
    queueSave();
    updateControls();
    state.nextTimer = setTimeout(chooseWord, 1050);
  } else {
    $('feedback').textContent = `Yes — ${target.note} at ${button.dataset.location}. Next: ${describeStep(state.word.steps[state.index])}.`;
    $('feedback').className = 'feedback correct';
    renderSequence();
    updateStats();
    recordPrompt();
  }
}
function configKey(config) { return JSON.stringify({ maxFret: config.maxFret, strings: [...config.selectedStrings].sort((a, b) => a - b), notes: [...config.selectedNotes].sort(), deck: config.deck }); }
function configLabel(config) {
  const strings = STRINGS.filter(string => config.selectedStrings.includes(string.open)).map(string => string.full).join(', ');
  const notes = config.selectedNotes.length === 12 ? 'all notes' : config.selectedNotes.join(', ');
  return `${strings} · frets 0–${config.maxFret} · ${notes} · ${config.deck === 'random' ? 'note mix' : 'shapes'}`;
}
function formatDate(value) { return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function formatTime(ms) { return ms === null || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(1)}s`; }
function createElement(tag, className, value) { const element = document.createElement(tag); if (className) element.className = className; if (value !== undefined) element.textContent = value; return element; }
function renderBarChart(id, sessions, kind) {
  const root = $(id);
  root.replaceChildren();
  const points = sessions.slice(-10).map(session => ({ session, value: kind === 'accuracy' ? sessionSummary(session).accuracy : sessionSummary(session).medianMs }));
  if (!points.some(point => point.value !== null)) { root.append(createElement('p', 'empty-state', 'Finish a session to see your trend.')); return; }
  const max = kind === 'accuracy' ? 100 : Math.max(1000, ...points.map(point => point.value || 0)) * 1.1;
  const chart = createElement('div', `bar-chart${kind === 'speed' ? ' speed' : ''}`);
  points.forEach(point => {
    const column = createElement('div', 'bar-column');
    const value = createElement('span', 'bar-value', point.value === null ? '—' : kind === 'accuracy' ? `${point.value}%` : formatTime(point.value));
    const bar = createElement('div', 'bar-fill');
    bar.style.height = point.value === null ? '4px' : `${Math.max(5, point.value / max * 112)}px`;
    const date = createElement('span', 'bar-date', new Date(point.session.startedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }));
    column.append(value, bar, date);
    chart.append(column);
  });
  root.append(chart);
}
function renderHeatmap(sessions) {
  const root = $('noteHeatmap');
  root.replaceChildren();
  const counts = new Map();
  for (const session of sessions) for (const prompt of session.prompts) {
    if (prompt.stringOpen === null || !prompt.answers?.length) continue;
    const key = `${prompt.note}:${prompt.stringOpen}`;
    const entry = counts.get(key) || { tried: 0, first: 0 };
    entry.tried++;
    if (prompt.answers[0].correct) entry.first++;
    counts.set(key, entry);
  }
  if (!counts.size) { root.append(createElement('p', 'empty-state', 'Play a “Random selected notes” session to see note-by-string accuracy.')); return; }
  const table = createElement('table', 'heatmap');
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  header.append(createElement('th', '', 'NOTE'));
  STRINGS.forEach(string => header.append(createElement('th', '', string.full === 'high E' ? 'HIGH E' : string.full === 'low E' ? 'LOW E' : string.name)));
  head.append(header);
  table.append(head);
  const body = document.createElement('tbody');
  NOTES.forEach(note => {
    const row = document.createElement('tr');
    row.append(createElement('th', '', note));
    STRINGS.forEach(string => {
      const cell = document.createElement('td');
      const entry = counts.get(`${note}:${string.open}`);
      if (entry) {
        const percent = Math.round(entry.first / entry.tried * 100);
        cell.className = `has-data${percent < 50 ? ' low' : percent < 80 ? ' mid' : ''}`;
        cell.textContent = `${percent}%`;
        cell.title = `${note} on ${string.full}: ${entry.first}/${entry.tried} correct on the first try`;
      } else { cell.className = 'no-data'; cell.textContent = '—'; }
      row.append(cell);
    });
    body.append(row);
  });
  table.append(body);
  root.append(table);
}
function renderHistory(sessions) {
  const root = $('sessionHistory');
  root.replaceChildren();
  if (!sessions.length) { root.append(createElement('p', 'empty-state', 'Your finished sessions will appear here.')); return; }
  [...sessions].reverse().forEach(session => {
    const metrics = sessionSummary(session);
    const item = createElement('details', 'history-item');
    const heading = document.createElement('summary');
    const left = document.createElement('div');
    left.append(createElement('strong', '', formatDate(session.startedAt)), createElement('span', '', configLabel(session.config)));
    heading.append(left, createElement('b', '', metrics.accuracy === null ? '—' : `${metrics.accuracy}%`));
    item.append(heading);
    const detail = createElement('div', 'history-details');
    detail.append(createElement('p', '', `${metrics.completedWords} words · ${metrics.attempts} taps · ${metrics.firstTry ?? '—'}% first try · ${formatTime(metrics.medianMs)} median · ${Math.round(metrics.durationMs / 1000)}s session`));
    session.prompts.forEach(prompt => {
      const target = prompt.stringOpen === null ? `${prompt.note} on any selected string` : `${prompt.note} on ${prompt.stringLabel}`;
      const row = createElement('div', 'trial-row');
      row.append(createElement('b', '', target));
      const attempts = prompt.answers?.length ? prompt.answers.map(answer => {
        const string = STRINGS.find(item => item.open === answer.stringOpen)?.full || 'unknown string';
        return `${answer.note} · ${string} fret ${answer.fret} ${answer.correct ? '✓' : '×'} at ${formatTime(answer.responseMs)}`;
      }).join('  →  ') : 'Not attempted';
      row.append(createElement('small', '', `${prompt.wordName}: ${attempts}`));
      detail.append(row);
    });
    item.append(detail);
    root.append(item);
  });
}
function renderDashboard() {
  const finished = state.history.filter(session => session.status === 'finished' && session.config && Array.isArray(session.prompts)).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const filter = $('historyFilter');
  const previous = filter.value || 'all';
  filter.replaceChildren(new Option('All sessions', 'all'));
  const configs = new Map();
  finished.forEach(session => configs.set(configKey(session.config), configLabel(session.config)));
  configs.forEach((label, key) => filter.append(new Option(label, key)));
  filter.value = [...filter.options].some(option => option.value === previous) ? previous : 'all';
  const selected = filter.value === 'all' ? finished : finished.filter(session => configKey(session.config) === filter.value);
  const prompts = selected.flatMap(session => session.prompts).filter(prompt => prompt.answers?.length);
  const answers = prompts.flatMap(prompt => prompt.answers);
  const times = prompts.map(prompt => prompt.answers.find(answer => answer.correct)?.responseMs).filter(Number.isFinite).sort((a, b) => a - b);
  const median = times.length ? times.length % 2 ? times[Math.floor(times.length / 2)] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2 : null;
  const overall = [
    [String(selected.length), 'finished sessions'],
    [answers.length ? `${Math.round(answers.filter(answer => answer.correct).length / answers.length * 100)}%` : '—', 'overall accuracy'],
    [prompts.length ? `${Math.round(prompts.filter(prompt => prompt.answers[0].correct).length / prompts.length * 100)}%` : '—', 'first-try accuracy'],
    [formatTime(median), 'median time to correct note']
  ];
  $('dashboardSummary').replaceChildren(...overall.map(([value, label]) => { const tile = createElement('div', 'summary-tile'); tile.append(createElement('strong', '', value), createElement('span', '', label)); return tile; }));
  renderBarChart('accuracyChart', selected, 'accuracy');
  renderBarChart('speedChart', selected, 'speed');
  renderHeatmap(selected);
  renderHistory(selected);
}
function exportHistory() {
  const sessions = state.history.filter(session => session.status === 'finished');
  const blob = new Blob([JSON.stringify({ format: 'fretboard-words', version: 1, exportedAt: new Date().toISOString(), sessions }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `fretboard-words-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function normalizeImportedSession(value) {
  if (!value || typeof value.id !== 'string' || value.status !== 'finished' || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.endedAt)) || !value.config || !Array.isArray(value.prompts) || value.prompts.length > 10000) return null;
  const config = value.config;
  if (!Array.isArray(config.selectedStrings) || !Array.isArray(config.selectedNotes) || ![5, 12].includes(config.maxFret)) return null;
  const selectedStrings = [...new Set(config.selectedStrings)].filter(open => STRINGS.some(string => string.open === open));
  const selectedNotes = [...new Set(config.selectedNotes)].filter(note => NOTES.includes(note));
  if (!selectedStrings.length || !selectedNotes.length) return null;
  const prompts = [];
  for (const prompt of value.prompts) {
    if (!prompt || !NOTES.includes(prompt.note) || !Array.isArray(prompt.answers) || prompt.answers.length > 1000) return null;
    const string = STRINGS.find(item => item.open === prompt.stringOpen);
    if (prompt.stringOpen !== null && !string) return null;
    prompts.push({ id: String(prompt.id || ''), wordName: String(prompt.wordName || 'Note word'), note: prompt.note, stringOpen: prompt.stringOpen, stringLabel: string?.full || null, shownAt: String(prompt.shownAt || value.startedAt), answers: prompt.answers.filter(answer => answer && NOTES.includes(answer.note) && STRINGS.some(item => item.open === answer.stringOpen) && Number.isInteger(answer.fret) && answer.fret >= 0 && answer.fret <= 12 && Number.isFinite(answer.responseMs) && answer.responseMs >= 0 && typeof answer.correct === 'boolean').map(answer => ({ at: String(answer.at || ''), note: answer.note, stringOpen: answer.stringOpen, fret: answer.fret, midi: Number(answer.midi) || 0, correct: answer.correct, responseMs: answer.responseMs })) });
  }
  const session = { id: value.id, status: 'finished', startedAt: value.startedAt, endedAt: value.endedAt, config: { range: ['starter', 'middle', 'full', 'custom'].includes(config.range) ? config.range : 'custom', maxFret: config.maxFret, selectedStrings, selectedNotes, deck: config.deck === 'random' ? 'random' : 'familiar' }, prompts, completedWords: Math.max(0, Math.floor(Number(value.completedWords) || 0)), currentWord: null, currentIndex: 0 };
  session.summary = sessionSummary(session);
  return session;
}
async function importHistory(file) {
  if (!file) return;
  try {
    if (file.size > 20_000_000) throw new Error('That file is too large.');
    const bundle = JSON.parse(await file.text());
    if (bundle.format !== 'fretboard-words' || bundle.version !== 1 || !Array.isArray(bundle.sessions)) throw new Error('This is not a Fretboard Words backup.');
    let added = 0;
    for (const item of bundle.sessions) {
      const session = normalizeImportedSession(item);
      if (!session || state.history.some(existing => existing.id === session.id)) continue;
      state.history.push(session);
      await saveRecord(session);
      added++;
    }
    $('storageMessage').textContent = `Imported ${added} session${added === 1 ? '' : 's'}. Data stays in this browser.`;
    renderDashboard();
  } catch (error) { $('storageMessage').textContent = `Import failed: ${error.message}`; }
  $('importFile').value = '';
}
$('hint').addEventListener('click', () => {
  if (state.locked || !state.word) return;
  clearBoardMarkers();
  const target = state.word.steps[state.index];
  const matching = [...document.querySelectorAll('.fret-button')].filter(button => button.dataset.note === target.note && (target.stringOpen === null || Number(button.dataset.stringOpen) === target.stringOpen));
  matching.forEach(button => button.classList.add('hint'));
  $('feedback').textContent = `Highlighted spots play ${describeStep(target)}. Pick any one.`;
  $('feedback').className = 'feedback';
});
$('range').addEventListener('change', event => {
  state.range = event.target.value;
  if (state.range === 'starter') { state.selectedStrings = new Set([50, 45, 40]); state.maxFret = 5; }
  if (state.range === 'middle') { state.selectedStrings = new Set(STRINGS.map(string => string.open)); state.maxFret = 5; }
  if (state.range === 'full') { state.selectedStrings = new Set(STRINGS.map(string => string.open)); state.maxFret = 12; }
  selectionChanged();
});
$('deck').addEventListener('change', event => { state.deck = event.target.value; selectionChanged(); });
$('allStrings').addEventListener('click', () => { state.selectedStrings = new Set(STRINGS.map(string => string.open)); state.range = 'custom'; $('range').value = 'custom'; selectionChanged(); });
$('allNotes').addEventListener('click', () => { state.selectedNotes = new Set(NOTES); selectionChanged(); });
$('naturalNotes').addEventListener('click', () => { state.selectedNotes = new Set(NOTES.filter(note => !note.includes('♯'))); selectionChanged(); });
$('clearNotes').addEventListener('click', () => { state.selectedNotes = new Set(); selectionChanged(); });
$('startSession').addEventListener('click', startSession);
$('endSession').addEventListener('click', endSession);
$('historyFilter').addEventListener('change', renderDashboard);
$('exportData').addEventListener('click', exportHistory);
$('importData').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', event => importHistory(event.target.files[0]));
$('sound').addEventListener('click', () => {
  state.sound = !state.sound;
  $('sound').setAttribute('aria-pressed', String(state.sound));
  $('sound').innerHTML = `<span aria-hidden="true">♪</span> Sound ${state.sound ? 'on' : 'off'}`;
});
renderChoices();
renderBoard();
resetLiveStats();
showIdle();
initializeStorage();
setInterval(updateTimer, 1000);
