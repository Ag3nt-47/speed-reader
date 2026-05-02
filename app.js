(function () {
  "use strict";

  const storageKeys = {
    wpm: "localRsvpReader.wpm",
    groupSize: "localRsvpReader.groupSize",
    orp: "localRsvpReader.orp",
    fontSize: "localRsvpReader.fontSize",
    text: "localRsvpReader.text",
    position: "localRsvpReader.position"
  };

  const limits = {
    minWpm: 60,
    maxWpm: 1200,
    defaultWpm: 300,
    defaultGroupSize: 1,
    minFontSize: 44,
    maxFontSize: 132,
    defaultFontSize: 72
  };

  const state = {
    words: [],
    index: 0,
    isPlaying: false,
    timerId: 0,
    hasStarted: false,
    isComplete: false,
    isFocusMode: false,
    restoredFromStorage: false
  };

  const els = {};
  const readableCharacterPattern = createReadableCharacterPattern();

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    loadSettings();
    bindEvents();
    syncTextStats();

    state.index = clampIndexToReadableStart(state.index);
    if (state.words.length && state.restoredFromStorage) {
      state.hasStarted = true;
      renderCurrentGroup();
      setStatus("Kaydedilen metin ve konum geri yüklendi.");
    } else {
      renderIdleState();
    }

    updateButtons();
  }

  function cacheElements() {
    els.sourceText = document.getElementById("sourceText");
    els.wordCount = document.getElementById("wordCount");
    els.charCount = document.getElementById("charCount");
    els.estimate = document.getElementById("estimate");
    els.readerDisplay = document.getElementById("readerDisplay");
    els.positionLabel = document.getElementById("positionLabel");
    els.percentLabel = document.getElementById("percentLabel");
    els.progressFill = document.getElementById("progressFill");
    els.wpmInput = document.getElementById("wpmInput");
    els.wpmRange = document.getElementById("wpmRange");
    els.fontSizeRange = document.getElementById("fontSizeRange");
    els.fontSizeValue = document.getElementById("fontSizeValue");
    els.groupSize = document.getElementById("groupSize");
    els.orpMode = document.getElementById("orpMode");
    els.previousButton = document.getElementById("previousButton");
    els.playToggleButton = document.getElementById("playToggleButton");
    els.nextButton = document.getElementById("nextButton");
    els.focusModeButton = document.getElementById("focusModeButton");
    els.cleanTextButton = document.getElementById("cleanTextButton");
    els.resetButton = document.getElementById("resetButton");
    els.statusText = document.getElementById("statusText");
  }

  function loadSettings() {
    const savedWpm = readStoredNumber(storageKeys.wpm, limits.defaultWpm);
    const savedGroupSize = readStoredNumber(storageKeys.groupSize, limits.defaultGroupSize);
    const savedFontSize = readStoredNumber(storageKeys.fontSize, limits.defaultFontSize);
    const wpm = clamp(savedWpm, limits.minWpm, limits.maxWpm);
    const groupSize = [1, 2, 3].includes(savedGroupSize) ? savedGroupSize : limits.defaultGroupSize;
    const fontSize = clamp(savedFontSize, limits.minFontSize, limits.maxFontSize);

    els.wpmInput.value = String(wpm);
    els.wpmRange.value = String(wpm);
    els.fontSizeRange.value = String(fontSize);
    els.groupSize.value = String(groupSize);
    els.orpMode.checked = readStoredBoolean(storageKeys.orp, false);
    applyFontSize(fontSize);

    const savedText = readStorage(storageKeys.text) || "";
    if (savedText) {
      els.sourceText.value = savedText;
      state.index = readStoredNumber(storageKeys.position, 0);
      state.restoredFromStorage = true;
    }
  }

  function bindEvents() {
    els.sourceText.addEventListener("input", handleTextInput);
    els.wpmInput.addEventListener("input", handleWpmInput);
    els.wpmRange.addEventListener("input", handleWpmRange);
    els.fontSizeRange.addEventListener("input", handleFontSizeChange);
    els.groupSize.addEventListener("change", handleGroupSizeChange);
    els.orpMode.addEventListener("change", handleOrpChange);
    els.previousButton.addEventListener("click", () => moveByGroups(-1));
    els.playToggleButton.addEventListener("click", toggleReading);
    els.nextButton.addEventListener("click", () => moveByGroups(1));
    els.resetButton.addEventListener("click", resetReading);
    els.focusModeButton.addEventListener("click", toggleFocusMode);
    els.cleanTextButton.addEventListener("click", clearText);
    document.addEventListener("keydown", handleKeyboard);
  }

  function handleTextInput() {
    const wasPlaying = state.isPlaying;
    if (wasPlaying) {
      pauseReading("Metin değiştiği için okuma duraklatıldı.");
    }

    state.words = tokenize(els.sourceText.value);
    state.index = 0;
    state.hasStarted = false;
    state.isComplete = false;
    syncTextStats();
    saveReaderState();
    renderIdleState();
    updateButtons();
  }

  function handleWpmInput() {
    const nextWpm = clamp(parseInt(els.wpmInput.value, 10) || limits.defaultWpm, limits.minWpm, limits.maxWpm);
    setWpm(nextWpm);
  }

  function handleWpmRange() {
    setWpm(parseInt(els.wpmRange.value, 10));
  }

  function handleFontSizeChange() {
    const fontSize = clamp(parseInt(els.fontSizeRange.value, 10) || limits.defaultFontSize, limits.minFontSize, limits.maxFontSize);
    applyFontSize(fontSize);
    writeStorage(storageKeys.fontSize, String(fontSize));
  }

  function setWpm(wpm) {
    const nextWpm = clamp(wpm, limits.minWpm, limits.maxWpm);
    els.wpmInput.value = String(nextWpm);
    els.wpmRange.value = String(nextWpm);
    writeStorage(storageKeys.wpm, String(nextWpm));
    syncTextStats();
    restartTimerIfPlaying();
  }

  function handleGroupSizeChange() {
    writeStorage(storageKeys.groupSize, els.groupSize.value);
    state.index = clampIndexToReadableStart(state.index);
    renderCurrentGroup();
    restartTimerIfPlaying();
  }

  function handleOrpChange() {
    writeStorage(storageKeys.orp, els.orpMode.checked ? "1" : "0");
    renderCurrentGroup();
  }

  function applyFontSize(fontSize) {
    const nextFontSize = clamp(fontSize, limits.minFontSize, limits.maxFontSize);
    document.documentElement.style.setProperty("--reader-size", `${nextFontSize}px`);
    els.fontSizeRange.value = String(nextFontSize);
    els.fontSizeValue.textContent = `${nextFontSize} px`;
  }

  function toggleReading() {
    if (state.isPlaying) {
      pauseReading();
      return;
    }

    startReading();
  }

  function startReading() {
    if (!state.words.length) {
      state.words = tokenize(els.sourceText.value);
    }

    if (!state.words.length) {
      setStatus("Önce okunacak bir metin yapıştırın.");
      updateButtons();
      return;
    }

    if (state.isComplete) {
      state.index = 0;
      state.isComplete = false;
    }

    state.hasStarted = true;
    state.isPlaying = true;
    renderCurrentGroup();
    scheduleNextStep();
    setStatus("Okuma başladı. Space: duraklat, oklar: ileri/geri, F: focus mode.");
    updateButtons();
  }

  function pauseReading(message) {
    clearTimer();
    state.isPlaying = false;
    if (message) {
      setStatus(message);
    } else if (state.words.length) {
      setStatus("Duraklatıldı. Space veya Başlat ile devam edin. F: focus mode.");
    }
    updateButtons();
  }

  function resetReading() {
    clearTimer();
    state.index = 0;
    state.isPlaying = false;
    state.isComplete = false;
    state.hasStarted = state.words.length > 0;
    renderCurrentGroup();
    saveReaderState();
    setStatus(state.words.length ? "Başa alındı." : "Önce okunacak bir metin yapıştırın.");
    updateButtons();
  }

  function scheduleNextStep() {
    clearTimer();
    if (!state.isPlaying || !state.words.length) {
      return;
    }

    const group = getCurrentGroup();
    const delay = getDelayForGroup(group);
    state.timerId = window.setTimeout(function () {
      if (!state.isPlaying) {
        return;
      }

      if (isOnLastGroup()) {
        finishReading();
        return;
      }

      state.index = clampIndexToReadableStart(state.index + getGroupSize());
      renderCurrentGroup();
      updateButtons();
      scheduleNextStep();
    }, delay);
  }

  function finishReading() {
    clearTimer();
    state.isPlaying = false;
    state.isComplete = true;
    renderCurrentGroup();
    setStatus("Okuma tamamlandı. Sıfırla ile başa dönebilirsiniz.");
    updateButtons();
  }

  function moveByGroups(direction) {
    if (!state.words.length) {
      state.words = tokenize(els.sourceText.value);
    }

    if (!state.words.length) {
      return;
    }

    const wasPlaying = state.isPlaying;
    clearTimer();
    state.hasStarted = true;
    state.isComplete = false;
    state.index = clampIndexToReadableStart(state.index + direction * getGroupSize());
    renderCurrentGroup();
    setStatus(direction > 0 ? "Bir grup ileri gidildi." : "Bir grup geri gidildi.");

    if (wasPlaying) {
      state.isPlaying = true;
      scheduleNextStep();
    }

    updateButtons();
  }

  function clearText() {
    clearTimer();
    els.sourceText.value = "";
    state.words = [];
    state.index = 0;
    state.isPlaying = false;
    state.hasStarted = false;
    state.isComplete = false;
    state.restoredFromStorage = false;
    syncTextStats();
    renderIdleState();
    clearStoredTextAndPosition();
    setStatus("Metin temizlendi.");
    updateButtons();
    els.sourceText.focus();
  }

  function toggleFocusMode() {
    state.isFocusMode = !state.isFocusMode;
    document.body.classList.toggle("focus-mode", state.isFocusMode);
    updateButtons();
  }

  function restartTimerIfPlaying() {
    if (state.isPlaying) {
      renderCurrentGroup();
      scheduleNextStep();
    }
  }

  function renderIdleState() {
    if (!state.words.length || state.hasStarted) {
      if (!state.words.length) {
        setReaderText("Hazır");
        updateProgress(0, 0);
      }
      return;
    }

    state.index = 0;
    renderCurrentGroup();
    setStatus("Başlat düğmesine basın. Space: başlat/duraklat, oklar: ileri/geri, R: sıfırla, F: focus mode.");
  }

  function renderCurrentGroup() {
    if (!state.words.length) {
      renderIdleState();
      return;
    }

    const group = getCurrentGroup();
    renderWords(group);
    updateProgress(getVisibleEndIndex(), state.words.length);
  }

  function renderWords(words) {
    els.readerDisplay.replaceChildren();

    if (!words.length) {
      setReaderText("Hazır");
      return;
    }

    const groupSize = getGroupSize();

    words.forEach(function (word, index) {
      const wordNode = document.createElement("span");
      wordNode.className = "reader-word";

      if (shouldApplyOrpToWord(index, groupSize)) {
        appendOrpWord(wordNode, word);
      } else {
        wordNode.textContent = word;
      }

      els.readerDisplay.appendChild(wordNode);
    });
  }

  function shouldApplyOrpToWord(index, groupSize) {
    if (!els.orpMode.checked) {
      return false;
    }

    if (groupSize === 1) {
      return true;
    }

    if (groupSize === 2) {
      return index === 0;
    }

    return false;
  }

  function appendOrpWord(parent, word) {
    const characters = Array.from(word);
    const readablePositions = [];

    characters.forEach(function (character, index) {
      if (isReadableCharacter(character)) {
        readablePositions.push(index);
      }
    });

    const targetIndex = readablePositions[Math.floor((readablePositions.length - 1) / 2)];

    characters.forEach(function (character, index) {
      const node = document.createElement("span");
      node.textContent = character;
      if (index === targetIndex) {
        node.className = "orp-letter";
      }
      parent.appendChild(node);
    });
  }

  function setReaderText(text) {
    els.readerDisplay.textContent = text;
  }

  function updateProgress(visibleWordCount, totalWords) {
    if (!totalWords) {
      els.positionLabel.textContent = "0 / 0";
      els.percentLabel.textContent = "0%";
      els.progressFill.style.width = "0%";
      saveReaderPosition();
      return;
    }

    const start = Math.min(state.index + 1, totalWords);
    const end = Math.min(visibleWordCount, totalWords);
    const percent = Math.min(100, Math.round((end / totalWords) * 100));

    els.positionLabel.textContent = start === end ? `${end} / ${totalWords}` : `${start}–${end} / ${totalWords}`;
    els.percentLabel.textContent = `${percent}%`;
    els.progressFill.style.width = `${percent}%`;
    saveReaderPosition();
  }

  function syncTextStats() {
    const text = els.sourceText.value;
    const words = tokenize(text);
    const wpm = getWpm();
    const minutes = words.length ? words.length / wpm : 0;

    state.words = words;
    state.index = clampIndexToReadableStart(state.index);

    if (!words.length) {
      state.hasStarted = false;
      state.isComplete = false;
    }

    els.charCount.textContent = String(text.length);
    els.wordCount.textContent = String(words.length);
    els.estimate.textContent = `Süre: ${formatMinutes(minutes)}`;
  }

  function updateButtons() {
    const hasWords = state.words.length > 0 || tokenize(els.sourceText.value).length > 0;
    const isAtStart = !state.words.length || state.index <= 0;
    const isAtEnd = !state.words.length || isOnLastGroup();
    els.previousButton.disabled = !hasWords || isAtStart;
    els.playToggleButton.disabled = !hasWords;
    els.playToggleButton.textContent = state.isPlaying ? "Duraklat" : "Başlat";
    els.playToggleButton.setAttribute("aria-pressed", state.isPlaying ? "true" : "false");
    els.nextButton.disabled = !hasWords || isAtEnd;
    els.resetButton.disabled = !hasWords;
    els.focusModeButton.textContent = state.isFocusMode ? "Focus'tan çık" : "Focus Mode";
    els.focusModeButton.setAttribute("aria-pressed", state.isFocusMode ? "true" : "false");
    els.cleanTextButton.disabled = !els.sourceText.value.trim();
  }

  function handleKeyboard(event) {
    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      if (state.isPlaying) {
        pauseReading();
      } else {
        startReading();
      }
      return;
    }

    if (event.code === "ArrowRight") {
      event.preventDefault();
      moveByGroups(1);
      return;
    }

    if (event.code === "ArrowLeft") {
      event.preventDefault();
      moveByGroups(-1);
      return;
    }

    if (event.code === "KeyR") {
      event.preventDefault();
      resetReading();
      return;
    }

    if (event.code === "KeyF") {
      event.preventDefault();
      toggleFocusMode();
    }
  }

  function getCurrentGroup() {
    return state.words.slice(state.index, state.index + getGroupSize());
  }

  function getVisibleEndIndex() {
    return Math.min(state.index + getCurrentGroup().length, state.words.length);
  }

  function isOnLastGroup() {
    return state.index + getGroupSize() >= state.words.length;
  }

  function getDelayForGroup(group) {
    const basePerWord = 60000 / getWpm();
    const lastWord = group[group.length - 1] || "";
    let bonus = 0;

    if (/[.!?…]+["')\]}»”’]*$/u.test(lastWord)) {
      bonus = Math.min(basePerWord * 0.65, 260);
    } else if (/[,;:]+["')\]}»”’]*$/u.test(lastWord)) {
      bonus = Math.min(basePerWord * 0.35, 140);
    }

    return Math.round(basePerWord * Math.max(1, group.length) + bonus);
  }

  function tokenize(text) {
    return text.trim().match(/\S+/g) || [];
  }

  function getWpm() {
    return clamp(parseInt(els.wpmInput.value, 10) || limits.defaultWpm, limits.minWpm, limits.maxWpm);
  }

  function getGroupSize() {
    return parseInt(els.groupSize.value, 10) || limits.defaultGroupSize;
  }

  function clampIndexToReadableStart(index) {
    if (!state.words.length) {
      return 0;
    }

    const lastStart = Math.max(0, state.words.length - getGroupSize());
    return clamp(index, 0, lastStart);
  }

  function clearTimer() {
    if (state.timerId) {
      window.clearTimeout(state.timerId);
      state.timerId = 0;
    }
  }

  function setStatus(message) {
    els.statusText.textContent = message;
  }

  function saveReaderState() {
    writeStorage(storageKeys.text, els.sourceText.value);
    saveReaderPosition();
  }

  function saveReaderPosition() {
    writeStorage(storageKeys.position, String(clampIndexToReadableStart(state.index)));
  }

  function clearStoredTextAndPosition() {
    removeStorage(storageKeys.text);
    removeStorage(storageKeys.position);
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName.toLowerCase();
    return target.isContentEditable || tagName === "textarea" || tagName === "input" || tagName === "select";
  }

  function formatMinutes(minutes) {
    if (!minutes) {
      return "0 dk";
    }

    if (minutes < 1) {
      return "<1 dk";
    }

    return `${Math.ceil(minutes)} dk`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function createReadableCharacterPattern() {
    try {
      return new RegExp("[\\p{L}\\p{N}]", "u");
    } catch (error) {
      return /[A-Za-z0-9À-ž]/;
    }
  }

  function isReadableCharacter(character) {
    return readableCharacterPattern.test(character);
  }

  function readStoredNumber(key, fallback) {
    const value = readStorage(key);
    const number = parseInt(value || "", 10);
    return Number.isFinite(number) ? number : fallback;
  }

  function readStoredBoolean(key, fallback) {
    const value = readStorage(key);
    if (value === null) {
      return fallback;
    }
    return value === "1";
  }

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Local storage may be blocked in hardened browsers; the app still works without persistence.
    }
  }

  function removeStorage(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Local storage may be blocked in hardened browsers; the app still works without persistence.
    }
  }
})();
