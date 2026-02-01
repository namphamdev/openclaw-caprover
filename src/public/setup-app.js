function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const PROVIDER_CONFIGS = {
  anthropic: {
    name: 'Anthropic',
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...', required: true },
      { id: 'model', label: 'Model', type: 'text', placeholder: 'claude-sonnet-4-20250514', required: false }
    ]
  },
  openai: {
    name: 'OpenAI',
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', required: true },
      { id: 'model', label: 'Model', type: 'text', placeholder: 'gpt-4o', required: false }
    ]
  },
  google: {
    name: 'Google',
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Google AI API key', required: true },
      { id: 'model', label: 'Model', type: 'text', placeholder: 'gemini-2.0-flash', required: false }
    ]
  },
  openrouter: {
    name: 'OpenRouter',
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-or-...', required: true },
      { id: 'model', label: 'Model', type: 'text', placeholder: 'anthropic/claude-sonnet-4', required: false }
    ]
  },
  ollama: {
    name: 'Ollama',
    fields: [
      { id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'http://localhost:11434', required: true },
      { id: 'model', label: 'Model', type: 'text', placeholder: 'llama3.2', required: false }
    ]
  },
  custom: {
    name: 'Custom',
    fields: [
      { id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.example.com/v1', required: true },
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'API key if required', required: false },
      { id: 'model', label: 'Model', type: 'text', placeholder: 'model-name', required: false }
    ]
  }
};

const elements = {
  statusBanner: document.getElementById('status-banner'),
  statusText: document.getElementById('status-text'),
  configStatus: document.getElementById('config-status'),
  gatewayStatus: document.getElementById('gateway-status'),
  providerSelect: document.getElementById('provider-select'),
  providerForm: document.getElementById('provider-form'),
  saveProviderBtn: document.getElementById('save-provider-btn'),
  gatewayToken: document.getElementById('gateway-token'),
  copyTokenBtn: document.getElementById('copy-token-btn'),
  restartBtn: document.getElementById('restart-btn'),
  resetBtn: document.getElementById('reset-btn'),
  pairingCode: document.getElementById('pairing-code'),
  approvePairingBtn: document.getElementById('approve-pairing-btn'),
  pendingPairings: document.getElementById('pending-pairings')
};

let currentStatus = null;

function showBanner(message, type = 'info') {
  elements.statusBanner.className = `status-banner ${type}`;
  elements.statusText.textContent = message;
  elements.statusBanner.classList.remove('hidden');

  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      elements.statusBanner.classList.add('hidden');
    }, 5000);
  }
}

function hideBanner() {
  elements.statusBanner.classList.add('hidden');
}

async function fetchStatus() {
  try {
    const response = await fetch('/setup/api/status');
    if (!response.ok) throw new Error('Failed to fetch status');
    currentStatus = await response.json();
    updateStatusDisplay();
    return currentStatus;
  } catch (err) {
    console.error('Status fetch error:', err);
    showBanner('Failed to fetch status', 'error');
  }
}

function updateStatusDisplay() {
  if (!currentStatus) return;

  if (currentStatus.configured) {
    elements.configStatus.textContent = 'Configured';
    elements.configStatus.className = 'status-value status-ok';
  } else {
    elements.configStatus.textContent = 'Not configured';
    elements.configStatus.className = 'status-value status-warning';
  }

  if (currentStatus.gatewayRunning) {
    elements.gatewayStatus.textContent = 'Running';
    elements.gatewayStatus.className = 'status-value status-ok';
  } else {
    elements.gatewayStatus.textContent = 'Stopped';
    elements.gatewayStatus.className = 'status-value status-warning';
  }

  elements.gatewayToken.textContent = currentStatus.gatewayToken || 'Not available';
}

function renderProviderForm(provider) {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) return;

  let html = '';
  for (const field of config.fields) {
    const fieldId = escapeHtml(field.id);
    const fieldLabel = escapeHtml(field.label);
    const fieldType = escapeHtml(field.type);
    const fieldPlaceholder = escapeHtml(field.placeholder);
    html += `
      <div class="form-group">
        <label for="provider-${fieldId}">${fieldLabel}${field.required ? ' *' : ''}</label>
        <input
          type="${fieldType}"
          id="provider-${fieldId}"
          placeholder="${fieldPlaceholder}"
          ${field.required ? 'required' : ''}
        >
      </div>
    `;
  }

  elements.providerForm.innerHTML = html;
}

async function saveProvider() {
  const provider = elements.providerSelect.value;
  const config = PROVIDER_CONFIGS[provider];
  if (!config) return;

  const providerConfig = {};
  for (const field of config.fields) {
    const input = document.getElementById(`provider-${field.id}`);
    const value = input?.value?.trim();
    if (value) {
      providerConfig[field.id] = value;
    } else if (field.required) {
      showBanner(`${field.label} is required`, 'error');
      return;
    }
  }

  showBanner('Saving configuration...', 'info');

  try {
    const response = await fetch('/setup/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: { [provider]: providerConfig }
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to save configuration');
    }

    showBanner('Configuration saved', 'success');
    await fetchStatus();
  } catch (err) {
    console.error('Save error:', err);
    showBanner(err.message, 'error');
  }
}

async function saveChannel(channel) {
  let config = {};

  switch (channel) {
    case 'telegram':
      config = {
        token: document.getElementById('telegram-token')?.value?.trim(),
        allowedUsers: document.getElementById('telegram-allowed')?.value?.trim()
      };
      if (!config.token) {
        showBanner('Telegram bot token is required', 'error');
        return;
      }
      break;

    case 'discord':
      config = {
        token: document.getElementById('discord-token')?.value?.trim(),
        allowedUsers: document.getElementById('discord-allowed')?.value?.trim()
      };
      if (!config.token) {
        showBanner('Discord bot token is required', 'error');
        return;
      }
      break;

    case 'slack':
      config = {
        token: document.getElementById('slack-token')?.value?.trim(),
        signingSecret: document.getElementById('slack-signing')?.value?.trim()
      };
      if (!config.token) {
        showBanner('Slack bot token is required', 'error');
        return;
      }
      break;
  }

  showBanner(`Saving ${channel} configuration...`, 'info');

  try {
    const response = await fetch('/setup/api/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, config })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to save channel configuration');
    }

    showBanner(`${channel} configured`, 'success');
    await fetchStatus();
  } catch (err) {
    console.error('Channel save error:', err);
    showBanner(err.message, 'error');
  }
}

async function approvePairing() {
  const code = elements.pairingCode.value?.trim();
  if (!code) {
    showBanner('Please enter a pairing code', 'error');
    return;
  }

  showBanner('Approving pairing...', 'info');

  try {
    const response = await fetch('/setup/api/pairing/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to approve pairing');
    }

    showBanner('Pairing approved', 'success');
    elements.pairingCode.value = '';
    fetchPendingPairings();
  } catch (err) {
    console.error('Pairing approval error:', err);
    showBanner(err.message, 'error');
  }
}

async function fetchPendingPairings() {
  try {
    const response = await fetch('/setup/api/pairing/pending');
    const result = await response.json();

    if (result.pending && result.pending.length > 0) {
      let html = '<ul class="pairing-list">';
      for (const pairing of result.pending) {
        const displayName = escapeHtml(pairing.name || pairing.code);
        const code = escapeHtml(pairing.code);
        html += `
          <li class="pairing-item">
            <span>${displayName}</span>
            <button class="btn btn-small approve-btn" data-code="${code}">Approve</button>
          </li>
        `;
      }
      html += '</ul>';
      elements.pendingPairings.innerHTML = html;

      document.querySelectorAll('.approve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          elements.pairingCode.value = btn.dataset.code;
          await approvePairing();
        });
      });
    } else {
      elements.pendingPairings.innerHTML = '<p class="empty-state">No pending pairing requests</p>';
    }
  } catch (err) {
    console.error('Failed to fetch pending pairings:', err);
  }
}

async function restartGateway() {
  showBanner('Restarting gateway...', 'info');

  try {
    const response = await fetch('/setup/api/restart', {
      method: 'POST'
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to restart gateway');
    }

    showBanner('Gateway restarted', 'success');
    await fetchStatus();
  } catch (err) {
    console.error('Restart error:', err);
    showBanner(err.message, 'error');
  }
}

async function resetConfiguration() {
  if (!confirm('Are you sure you want to reset all configuration? This cannot be undone.')) {
    return;
  }

  showBanner('Resetting configuration...', 'info');

  try {
    const response = await fetch('/setup/api/reset', {
      method: 'POST'
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to reset configuration');
    }

    showBanner('Configuration reset', 'success');
    await fetchStatus();
  } catch (err) {
    console.error('Reset error:', err);
    showBanner(err.message, 'error');
  }
}

async function copyToken() {
  const token = elements.gatewayToken.textContent;
  if (!token || token === 'Loading...' || token === 'Not available') {
    return;
  }

  try {
    await navigator.clipboard.writeText(token);
    showBanner('Token copied', 'success');
  } catch (err) {
    console.error('Copy failed:', err);
    const textArea = document.createElement('textarea');
    textArea.value = token;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showBanner('Token copied', 'success');
  }
}

function setupAccordion() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const content = header.nextElementSibling;
      const icon = header.querySelector('.accordion-icon');

      content.classList.toggle('hidden');
      icon.textContent = content.classList.contains('hidden') ? '+' : '-';
    });
  });
}

function setupEventListeners() {
  elements.providerSelect.addEventListener('change', (e) => {
    renderProviderForm(e.target.value);
  });

  elements.saveProviderBtn.addEventListener('click', saveProvider);

  document.querySelectorAll('.save-channel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      saveChannel(btn.dataset.channel);
    });
  });

  elements.approvePairingBtn.addEventListener('click', approvePairing);
  elements.copyTokenBtn.addEventListener('click', copyToken);
  elements.restartBtn.addEventListener('click', restartGateway);
  elements.resetBtn.addEventListener('click', resetConfiguration);

  setupAccordion();
}

async function init() {
  setupEventListeners();
  renderProviderForm(elements.providerSelect.value);
  await fetchStatus();
  fetchPendingPairings();

  setInterval(fetchStatus, 10000);
  setInterval(fetchPendingPairings, 30000);
}

document.addEventListener('DOMContentLoaded', init);
