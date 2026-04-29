/**
 * Course Video Autoplay Extension - Popup Script
 *
 * Handles the extension popup UI and state management
 */

// ============================================================================
// DOM Elements
// ============================================================================

const enableToggle = document.getElementById('enableToggle');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// ============================================================================
// State Management
// ============================================================================

let extensionEnabled = true;

// ============================================================================
// Logging
// ============================================================================

function log(message, type = 'info') {
  const prefix = '[Popup]';
  console.log(`${prefix} ${message}`);
}

// ============================================================================
// UI Updates
// ============================================================================

/**
 * Update UI based on extension state
 */
function updateUI(enabled) {
  extensionEnabled = enabled;

  // Update toggle
  enableToggle.checked = enabled;

  // Update status indicator
  if (enabled) {
    statusDot.className = 'status-dot enabled';
    statusText.className = 'status-text enabled';
    statusText.textContent = 'Active';
  } else {
    statusDot.className = 'status-dot disabled';
    statusText.className = 'status-text disabled';
    statusText.textContent = 'Disabled';
  }

  log(`UI updated: extension ${enabled ? 'enabled' : 'disabled'}`);
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Send message to content script
 */
async function sendMessageToContent(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.tabs.sendMessage(tab.id, message);
      log(`Message sent to content: ${message.type}`);
    }
  } catch (error) {
    log(`Error sending message: ${error.message}`, 'error');
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle toggle change
 */
async function handleToggleChange(event) {
  const enabled = event.target.checked;
  log(`Toggle changed: ${enabled}`);

  // Save state
  await chrome.storage.local.set({ enabled });

  // Update UI
  updateUI(enabled);

  // Notify content script
  await sendMessageToContent({
    type: 'TOGGLE_EXTENSION',
    enabled: enabled
  });
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize popup
 */
async function initialize() {
  log('Initializing popup');

  // Load saved state
  try {
    const result = await chrome.storage.local.get(['enabled']);
    const enabled = result.enabled !== false;
    updateUI(enabled);
  } catch (error) {
    log(`Error loading state: ${error.message}`, 'error');
    updateUI(true);
  }

  // Add event listeners
  enableToggle.addEventListener('change', handleToggleChange);

  log('Popup initialized');
}

// Run initialization
initialize();