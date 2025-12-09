const TOTP_INTERVAL = 30000;
const HISTORY_STORAGE_KEY = '2fa_history';
const THEME_STORAGE_KEY = 'theme_preference';
const AUTO_SAVE_KEY = '2fa_autosave';
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

function getSystemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'system';
  } catch (error) {
    return 'system';
  }
}

function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn('Failed to save theme preference:', error);
  }
}

function getEffectiveTheme() {
  const preference = getStoredTheme();
  if (preference === 'system') {
    return getSystemTheme();
  }
  return preference;
}

function setTheme(preference) {
  const effectiveTheme = preference === 'system' ? getSystemTheme() : preference;
  document.body.setAttribute('data-theme', effectiveTheme);
  setStoredTheme(preference);
  updateThemeIcon(effectiveTheme);
  updateThemeDropdown(preference);
}

function updateThemeIcon(effectiveTheme) {
  const preference = getStoredTheme();
  const sunIcon = document.querySelector('.theme-icon-sun');
  const moonIcon = document.querySelector('.theme-icon-moon');
  const systemIcon = document.querySelector('.theme-icon-system');
  
  if (sunIcon) {
    sunIcon.style.display = 'none';
    sunIcon.style.opacity = '0';
  }
  if (moonIcon) {
    moonIcon.style.display = 'none';
    moonIcon.style.opacity = '0';
  }
  if (systemIcon) {
    systemIcon.style.display = 'none';
    systemIcon.style.opacity = '0';
  }
  
  if (preference === 'system') {
    if (systemIcon) {
      systemIcon.style.display = 'block';
      systemIcon.style.opacity = '1';
    }
  } else if (preference === 'light') {
    if (sunIcon) {
      sunIcon.style.display = 'block';
      sunIcon.style.opacity = '1';
    }
  } else if (preference === 'dark') {
    if (moonIcon) {
      moonIcon.style.display = 'block';
      moonIcon.style.opacity = '1';
    }
  }
}

function updateThemeDropdown(preference) {
  const options = document.querySelectorAll('.theme-option');
  options.forEach(option => {
    if (option.dataset.theme === preference) {
      option.classList.add('active');
    } else {
      option.classList.remove('active');
    }
  });
}

function toggleThemeDropdown() {
  const dropdown = document.getElementById('themeDropdown');
  if (dropdown) {
    dropdown.classList.toggle('active');
  }
}

function closeThemeDropdown() {
  const dropdown = document.getElementById('themeDropdown');
  if (dropdown) {
    dropdown.classList.remove('active');
  }
}

function selectTheme(themePreference) {
  setTheme(themePreference);
  closeThemeDropdown();
}

function initializeTheme() {
  const savedPreference = getStoredTheme();
  setTheme(savedPreference);
  
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      if (getStoredTheme() === 'system') {
        const newTheme = e.matches ? 'dark' : 'light';
        document.body.setAttribute('data-theme', newTheme);
        updateThemeIcon(newTheme);
      }
    });
  }
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
  if (elements.privacyToggle) {
    elements.privacyToggle.classList.toggle('active', state.privacyMode);
    elements.privacyToggle.setAttribute('title', state.privacyMode ? 'Mostrar dados sensíveis' : 'Ocultar dados sensíveis');
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

// Reset Page Function
function resetPage() {
  if (confirm('Tem certeza que deseja descarregar todos os dados? Isso irá limpar todo o histórico e dados salvos, resetando a página para o estado padrão.')) {
    // Limpar todos os dados do localStorage
    localStorage.removeItem(HISTORY_STORAGE_KEY);
    localStorage.removeItem(AUTO_SAVE_KEY);
    
    // Recarregar a página para resetar tudo
    window.location.reload();
  }
}

function addEventListeners() {
  elements.themeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleThemeDropdown();
  });
  
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      selectTheme(option.dataset.theme);
    });
  });
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.theme-dropdown-wrapper')) {
      closeThemeDropdown();
    }
  });
  
  // Reset button
  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.addEventListener('click', resetPage);
  }
  
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

// Auto-save Functions
function saveFormData() {
  const formData = {
    name: elements.nameInputField?.value || '',
    secret: elements.secretInput?.value || '',
    hideSecret: elements.hideSecretOption?.checked || false
  };
  
  try {
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(formData));
  } catch (error) {
    console.error('Erro ao salvar dados:', error);
  }
}

function loadFormData() {
  try {
    const saved = localStorage.getItem(AUTO_SAVE_KEY);
    if (!saved) return;
    
    const formData = JSON.parse(saved);
    
    if (elements.nameInputField && formData.name) {
      elements.nameInputField.value = formData.name;
    }
    
    if (elements.secretInput && formData.secret) {
      elements.secretInput.value = formData.secret;
    }
    
    if (elements.hideSecretOption && formData.hideSecret !== undefined) {
      elements.hideSecretOption.checked = formData.hideSecret;
    }
  } catch (error) {
    console.error('Erro ao carregar dados salvos:', error);
  }
}

function setupAutoSave() {
  if (elements.nameInputField) {
    elements.nameInputField.addEventListener('input', saveFormData);
  }
  
  if (elements.secretInput) {
    elements.secretInput.addEventListener('input', saveFormData);
  }
  
  if (elements.hideSecretOption) {
    elements.hideSecretOption.addEventListener('change', saveFormData);
  }
}

function initialize() {
  initializeTheme();
  addEventListeners();
  setupAutoSave();
  loadFormData();
  renderHistory();
  
  // Inicializar placeholder do campo de nome
  if (elements.nameInputField) {
    const history = getStoredHistory();
    const defaultName = `Consulta ${history.length + 1}`;
    if (!elements.nameInputField.value) {
      elements.nameInputField.placeholder = defaultName;
    }
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