const TOTP_INTERVAL = 30000;
const HISTORY_STORAGE_KEY = '2fa_history';
const THEME_STORAGE_KEY = 'theme_preference';
const MAX_HISTORY_ITEMS = 20;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const elements = {
  themeToggle: document.getElementById('themeToggle'),
  secretInput: document.getElementById('secretInput'),
  generateButton: document.getElementById('generateButton'),
  resultSection: document.getElementById('resultSection'),
  resultCode: document.getElementById('resultCode'),
  timerBar: document.getElementById('timerBar'),
  timerText: document.getElementById('timerText'),
  copyButton: document.getElementById('copyButton'),
  copyText: document.getElementById('copyText'),
  historyList: document.getElementById('historyList'),
  clearButton: document.getElementById('clearButton'),
  modalOverlay: document.getElementById('modalOverlay'),
  modalClose: document.getElementById('modalClose'),
  modalCancel: document.getElementById('modalCancel'),
  modalSave: document.getElementById('modalSave'),
  nameInput: document.getElementById('nameInput'),
  nameInputField: document.getElementById('nameInputField'),
  hideSecretOption: document.getElementById('hideSecretOption'),
  privacyToggle: document.getElementById('privacyToggle'),
  privacyIcon: document.getElementById('privacyIcon')
};

let state = {
  currentSecret: '',
  currentCode: '',
  timerInterval: null,
  historyTimers: new Map(),
  editingHistoryId: null,
  isGenerating: false
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function isValidBase32(str) {
  const cleaned = str.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z2-7]+$/.test(cleaned) && cleaned.length > 0;
}

function cleanBase32(str) {
  return str.replace(/\s+/g, '').toUpperCase();
}

function base32ToBuffer(base32) {
  const alphabet = BASE32_ALPHABET;
  let bits = '';
  const cleaned = cleanBase32(base32);
  
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error('Invalid Base32 character');
    bits += index.toString(2).padStart(5, '0');
  }
  
  const buffer = [];
  for (let i = 0; i < bits.length; i += 8) {
    if (i + 8 <= bits.length) {
      buffer.push(parseInt(bits.substr(i, 8), 2));
    }
  }
  
  return new Uint8Array(buffer);
}

async function hmacSha1(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(signature);
}

async function generateTOTP(secret, timeWindow = Math.floor(Date.now() / TOTP_INTERVAL)) {
  try {
    const key = base32ToBuffer(secret);
    
    const timeBuffer = new ArrayBuffer(8);
    const timeView = new DataView(timeBuffer);
    timeView.setUint32(4, timeWindow, false);
    
    const hmac = await hmacSha1(key, timeBuffer);
    
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) |
                 ((hmac[offset + 1] & 0xff) << 16) |
                 ((hmac[offset + 2] & 0xff) << 8) |
                 (hmac[offset + 3] & 0xff);
    
    return (code % 1000000).toString().padStart(6, '0');
  } catch (error) {
    throw new Error('Código secreto inválido');
  }
}

function getStoredHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.warn('Failed to load history from localStorage:', error);
    return [];
  }
}

function setStoredHistory(history) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn('Failed to save history to localStorage:', error);
  }
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
  } catch (error) {
    return 'dark';
  }
}

function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn('Failed to save theme preference:', error);
  }
}

function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  setStoredTheme(theme);
}

function toggleTheme() {
  const currentTheme = document.body.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  updateThemeLabel(newTheme);
}

function updateThemeLabel(theme) {
  const label = document.getElementById('themeToggleLabel');
  if (label) {
    label.textContent = theme === 'dark' ? 'Dark mode' : 'Light mode';
  }
}

function initializeTheme() {
  const savedTheme = getStoredTheme();
  setTheme(savedTheme);
  updateThemeLabel(savedTheme);
}

function updateMainTimer() {
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = 30 - (now % 30);
  const progress = (timeLeft / 30) * 100;
  
  elements.timerBar.style.width = `${progress}%`;
  elements.timerText.textContent = `${timeLeft}s`;
  
  if (timeLeft === 30 && state.currentSecret && !state.isGenerating) {
    generateMainCode();
  }
}

function updateHistoryTimer(id, secret) {
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = 30 - (now % 30);
  const progress = (timeLeft / 30) * 100;
  
  const item = document.querySelector(`[data-history-id="${id}"]`);
  if (!item) return;
  
  const timerBar = item.querySelector('.history-timer-bar');
  const timerText = item.querySelector('.history-timer-text');
  const codeElement = item.querySelector('.history-code');
  
  if (timerBar && timerText) {
    timerBar.style.width = `${progress}%`;
    timerText.textContent = `${timeLeft}s`;
  }
  
  // Atualizar código quando o timer reinicia ou se estiver em modo privacidade
  if (timeLeft === 30 && codeElement) {
    generateHistoryCode(id, secret);
  } else if (state.privacyMode && codeElement) {
    // Garantir que o código esteja oculto se estiver em modo privacidade
    codeElement.textContent = '***';
  }
}

function startMainTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
  }
  
  state.timerInterval = setInterval(updateMainTimer, 1000);
  updateMainTimer();
}

function stopMainTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function startHistoryTimer(id, secret) {
  if (state.historyTimers.has(id)) {
    clearInterval(state.historyTimers.get(id));
  }
  
  const timer = setInterval(() => updateHistoryTimer(id, secret), 1000);
  state.historyTimers.set(id, timer);
  updateHistoryTimer(id, secret);
}

function stopHistoryTimer(id) {
  if (state.historyTimers.has(id)) {
    clearInterval(state.historyTimers.get(id));
    state.historyTimers.delete(id);
  }
}

function stopAllHistoryTimers() {
  state.historyTimers.forEach(timer => clearInterval(timer));
  state.historyTimers.clear();
}

async function generateMainCode() {
  if (state.isGenerating) return;
  
  try {
    state.isGenerating = true;
    elements.generateButton.classList.add('loading');
    elements.generateButton.disabled = true;
    
    const code = await generateTOTP(state.currentSecret);
    state.currentCode = code;
    
    elements.resultCode.textContent = state.privacyMode ? '***' : code;
    elements.resultCode.classList.remove('error');
    
    elements.resultSection.classList.add('show');
    
    startMainTimer();
    
    addToHistory(state.currentSecret);
    
  } catch (error) {
    console.error('Code generation failed:', error);
    elements.resultCode.textContent = 'ERRO';
    elements.resultCode.classList.add('error');
    
    setTimeout(() => {
      elements.resultCode.classList.remove('error');
    }, 3000);
  } finally {
    state.isGenerating = false;
    elements.generateButton.classList.remove('loading');
    elements.generateButton.disabled = false;
  }
}

async function generateHistoryCode(id, secret) {
  try {
    const code = await generateTOTP(secret);
    const item = document.querySelector(`[data-history-id="${id}"]`);
    if (item) {
      const codeElement = item.querySelector('.history-code');
      if (codeElement) {
        codeElement.textContent = state.privacyMode ? '***' : code;
        codeElement.classList.remove('error');
      }
    }
  } catch (error) {
    console.error('History code generation failed:', error);
    const item = document.querySelector(`[data-history-id="${id}"]`);
    if (item) {
      const codeElement = item.querySelector('.history-code');
      if (codeElement) {
        codeElement.textContent = state.privacyMode ? '***' : 'ERRO';
        codeElement.classList.add('error');
      }
    }
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch (fallbackError) {
      console.error('Clipboard copy failed:', fallbackError);
      return false;
    }
  }
}

async function copyMainCode() {
  if (!state.currentCode) return;
  
  const success = await copyToClipboard(state.currentCode);
  
  if (success) {
    elements.copyText.textContent = 'Copiado!';
    elements.copyButton.classList.add('copied');
    
    setTimeout(() => {
      elements.copyText.textContent = 'Copiar Código';
      elements.copyButton.classList.remove('copied');
    }, 2000);
  }
}

async function copyHistoryCode(button, code) {
  const success = await copyToClipboard(code);
  
  if (success) {
    const originalText = button.textContent;
    button.textContent = 'Copiado!';
    button.classList.add('copied');
    
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 2000);
  }
}

async function copyHistorySeed(button, seed) {
  if (!seed || seed === '***') return;
  
  const success = await copyToClipboard(seed);
  
  if (success) {
    const textElement = button.querySelector('.copy-seed-text');
    if (textElement) {
      const originalText = textElement.textContent;
      textElement.textContent = 'Copiado!';
      button.classList.add('copied');
      
      setTimeout(() => {
        textElement.textContent = originalText;
        button.classList.remove('copied');
      }, 2000);
    }
  }
}

function addToHistory(secret) {
  const history = getStoredHistory();
  
  const existingIndex = history.findIndex(item => item.fullSecret === secret);
  if (existingIndex !== -1) {
    const existingItem = history.splice(existingIndex, 1)[0];
    history.unshift(existingItem);
    setStoredHistory(history);
    return;
  }
  
  let name = `Consulta ${history.length + 1}`;
  if (elements.nameInputField) {
    const customName = elements.nameInputField.value.trim();
    if (customName) {
      name = customName;
    }
  }
  
  const showSeed = elements.hideSecretOption && elements.hideSecretOption.checked;
  
  const historyItem = {
    id: generateId(),
    name: name,
    fullSecret: secret,
    showSeed: showSeed,
    createdAt: new Date().toISOString()
  };
  
  history.unshift(historyItem);
  
  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(MAX_HISTORY_ITEMS);
  }
  
  setStoredHistory(history);
  renderHistory();
  
  // Resetar campo de nome para padrão
  if (elements.nameInputField) {
    const history = getStoredHistory();
    const nextDefaultName = `Consulta ${history.length + 1}`;
    elements.nameInputField.value = '';
    elements.nameInputField.placeholder = nextDefaultName;
  }
}

async function renderHistory() {
  const history = getStoredHistory();
  
  stopAllHistoryTimers();
  
  if (history.length === 0) {
    elements.historyList.innerHTML = '<div class="history-empty">Nenhuma consulta realizada ainda</div>';
    return;
  }
  
  elements.historyList.innerHTML = '';
  
  for (const item of history) {
    const historyItem = await createHistoryItemElement(item);
    elements.historyList.appendChild(historyItem);
    
    startHistoryTimer(item.id, item.fullSecret);
  }
}

async function createHistoryItemElement(item) {
  const div = document.createElement('div');
  div.className = 'history-item';
  div.setAttribute('data-history-id', item.id);
  
  let initialCode = '000000';
  try {
    initialCode = await generateTOTP(item.fullSecret);
  } catch (error) {
    initialCode = 'ERRO';
  }
  
  div.innerHTML = `
    <div class="history-item-header">
      <div class="history-name" title="Clique para editar">${escapeHtml(item.name)}</div>
      <div class="history-actions">
        <button class="history-action-button history-edit-button" title="Editar nome" aria-label="Editar nome">
          ✏️
        </button>
        <button class="history-action-button history-delete-button" title="Excluir" aria-label="Excluir">
          🗑️
        </button>
      </div>
    </div>
    
    <div class="history-code-section">
      <div class="history-code">${initialCode}</div>
      <button class="history-copy-button" type="button">Copiar</button>
    </div>
    
    <div class="history-timer">
      <div class="history-timer-progress">
        <div class="history-timer-bar"></div>
      </div>
      <span class="history-timer-text">30s</span>
    </div>
    
    ${(() => {
      // Compatibilidade com histórico antigo
      const showSeed = item.showSeed !== undefined ? item.showSeed : (item.hideSecret === false);
      const shouldShowSeed = showSeed && !state.privacyMode;
      return shouldShowSeed 
        ? `<div class="history-seed-preview">
            <span>Seed: ${escapeHtml(item.fullSecret)}</span>
            <button class="history-copy-seed-button" type="button" title="Copiar seed" aria-label="Copiar seed" data-seed="${escapeHtml(item.fullSecret)}">
              <span class="copy-seed-text">Copiar</span>
            </button>
          </div>` 
        : '<div class="history-seed-preview">Seed: ***</div>';
    })()}
  `;
  
  addHistoryItemListeners(div, item);
  
  return div;
}

function addHistoryItemListeners(element, item) {
  const editButton = element.querySelector('.history-edit-button');
  editButton.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(item.id);
  });
  
  const deleteButton = element.querySelector('.history-delete-button');
  deleteButton.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteHistoryItem(item.id);
  });
  
  const copyButton = element.querySelector('.history-copy-button');
  copyButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    const codeElement = element.querySelector('.history-code');
    const code = codeElement.textContent;
    await copyHistoryCode(copyButton, code);
  });
  
  const nameElement = element.querySelector('.history-name');
  nameElement.addEventListener('click', () => {
    openEditModal(item.id);
  });
  
  const copySeedButton = element.querySelector('.history-copy-seed-button');
  if (copySeedButton) {
    copySeedButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const seed = copySeedButton.getAttribute('data-seed');
      if (seed && seed !== '***') {
        await copyHistorySeed(copySeedButton, seed);
      }
    });
  }
}

function deleteHistoryItem(id) {
  if (!confirm('Tem certeza que deseja excluir esta consulta?')) return;
  
  let history = getStoredHistory();
  history = history.filter(item => item.id !== id);
  setStoredHistory(history);
  
  stopHistoryTimer(id);
  renderHistory();
}

function clearAllHistory() {
  if (!confirm('Tem certeza que deseja limpar todo o histórico?')) return;
  
  setStoredHistory([]);
  stopAllHistoryTimers();
  renderHistory();
}

function openEditModal(id) {
  const history = getStoredHistory();
  const item = history.find(h => h.id === id);
  
  if (!item) return;
  
  state.editingHistoryId = id;
  elements.nameInput.value = item.name;
  elements.modalOverlay.classList.remove('hidden');
  
  setTimeout(() => {
    elements.nameInput.focus();
    elements.nameInput.select();
  }, 100);
}

function closeEditModal() {
  elements.modalOverlay.classList.add('hidden');
  state.editingHistoryId = null;
  elements.nameInput.value = '';
}

function saveEditedName() {
  if (!state.editingHistoryId || !elements.nameInput.value.trim()) return;
  
  const history = getStoredHistory();
  const itemIndex = history.findIndex(h => h.id === state.editingHistoryId);
  
  if (itemIndex === -1) return;
  
  history[itemIndex].name = elements.nameInput.value.trim();
  setStoredHistory(history);
  renderHistory();
  closeEditModal();
}

function validateAndCleanInput() {
  const input = elements.secretInput.value;
  const cleaned = input.replace(/[^A-Za-z2-7\s]/g, '').toUpperCase();
  
  if (cleaned !== input) {
    elements.secretInput.value = cleaned;
  }
  
  if (isValidBase32(cleaned)) {
    elements.secretInput.classList.remove('input-error');
  }
}

function validateSecret() {
  const secret = cleanBase32(elements.secretInput.value);
  
  if (!secret) {
    elements.secretInput.classList.add('input-error');
    elements.secretInput.focus();
    return false;
  }
  
  if (!isValidBase32(secret)) {
    elements.secretInput.classList.add('input-error');
    elements.secretInput.focus();
    return false;
  }
  
  elements.secretInput.classList.remove('input-error');
  return true;
}

async function handleGenerate() {
  if (!validateSecret()) return;
  
  const secret = cleanBase32(elements.secretInput.value);
  state.currentSecret = secret;
  
  await generateMainCode();
}

function handleInputKeyPress(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleGenerate();
  }
}

function handleModalKeyPress(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveEditedName();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeEditModal();
  }
}

function handleModalOverlayClick(e) {
  if (e.target === elements.modalOverlay) {
    closeEditModal();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function toggleAccordion(button) {
  const accordion = button.closest('.info-accordion, .options-accordion');
  if (!accordion) return;
  
  const isActive = accordion.classList.contains('active');
  
  // Fechar todos os accordions do mesmo tipo
  const accordionType = accordion.classList.contains('info-accordion') ? '.info-accordion' : '.options-accordion';
  document.querySelectorAll(accordionType).forEach(acc => {
    acc.classList.remove('active');
  });
  
  if (!isActive) {
    accordion.classList.add('active');
  }
}

function togglePrivacyMode() {
  state.privacyMode = !state.privacyMode;
  
  // Atualizar ícone SVG
  if (elements.privacyIcon) {
    if (state.privacyMode) {
      // Olho fechado (oculto) - eye-slash
      elements.privacyIcon.setAttribute('viewBox', '0 0 16 16');
      elements.privacyIcon.innerHTML = '<path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829"/><path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/>';
      elements.privacyToggle.setAttribute('title', 'Mostrar dados sensíveis');
    } else {
      // Olho aberto (visível) - eye
      elements.privacyIcon.setAttribute('viewBox', '0 0 16 16');
      elements.privacyIcon.innerHTML = '<path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/>';
      elements.privacyToggle.setAttribute('title', 'Ocultar dados sensíveis');
    }
  }
  
  // Atualizar código principal
  if (elements.resultCode && state.currentCode) {
    elements.resultCode.textContent = state.privacyMode ? '***' : state.currentCode;
  }
  
  // Atualizar todos os códigos do histórico imediatamente
  document.querySelectorAll('.history-code').forEach(codeElement => {
    if (state.privacyMode) {
      codeElement.textContent = '***';
    } else {
      // Recarregar código real do histórico
      const historyItem = codeElement.closest('.history-item');
      if (historyItem) {
        const historyId = historyItem.getAttribute('data-history-id');
        const history = getStoredHistory();
        const item = history.find(h => h.id === historyId);
        if (item) {
          generateHistoryCode(historyId, item.fullSecret);
        }
      }
    }
  });
  
  // Re-renderizar histórico para garantir que tudo está atualizado
  renderHistory();
}

function addEventListeners() {
  elements.themeToggle.addEventListener('click', toggleTheme);
  
  elements.secretInput.addEventListener('input', validateAndCleanInput);
  elements.secretInput.addEventListener('keypress', handleInputKeyPress);
  
  elements.generateButton.addEventListener('click', handleGenerate);
  
  elements.copyButton.addEventListener('click', copyMainCode);
  
  elements.clearButton.addEventListener('click', clearAllHistory);
  
  elements.modalClose.addEventListener('click', closeEditModal);
  elements.modalCancel.addEventListener('click', closeEditModal);
  elements.modalSave.addEventListener('click', saveEditedName);
  elements.modalOverlay.addEventListener('click', handleModalOverlayClick);
  elements.nameInput.addEventListener('keypress', handleModalKeyPress);
  
  document.querySelectorAll('.info-accordion-header').forEach(button => {
    button.addEventListener('click', () => toggleAccordion(button));
  });
  
  document.querySelectorAll('.options-accordion-header').forEach(button => {
    button.addEventListener('click', () => toggleAccordion(button));
  });
  
  // Botão de privacidade
  if (elements.privacyToggle) {
    elements.privacyToggle.addEventListener('click', togglePrivacyMode);
  }
}

function initialize() {
  initializeTheme();
  addEventListeners();
  renderHistory();
  
  // Inicializar placeholder do campo de nome
  if (elements.nameInputField) {
    const history = getStoredHistory();
    const defaultName = `Consulta ${history.length + 1}`;
    elements.nameInputField.placeholder = defaultName;
  }
  
  elements.secretInput.focus();
}

function cleanup() {
  stopMainTimer();
  stopAllHistoryTimers();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

window.addEventListener('beforeunload', cleanup);