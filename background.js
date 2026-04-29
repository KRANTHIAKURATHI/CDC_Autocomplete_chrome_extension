/**
 * Course Video Autoplay Extension - Background Service Worker
 *
 * Handles extension lifecycle, storage, and messaging
 */

// ============================================================================
// Logging
// ============================================================================

function log(message, type = 'info') {
  const prefix = '[Background]';

  switch (type) {
    case 'error':
      console.error(`${prefix} ${message}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}`);
      break;
    default:
      console.log(`${prefix} ${message}`);
  }
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log(`Received message: ${message.type}`);

  switch (message.type) {
    case 'GET_STATE':
      // Return current state
      chrome.storage.local.get(['enabled']).then(result => {
        sendResponse({ enabled: result.enabled !== false });
      });
      return true; // Keep message channel open for async response

    case 'SET_STATE':
      // Set extension state
      chrome.storage.local.set({ enabled: message.enabled }).then(() => {
        sendResponse({ success: true });
      });
      return true;

    default:
      log(`Unknown message type: ${message.type}`, 'warn');
      sendResponse({ error: 'Unknown message type' });
      return false;
  }
});

// ============================================================================
// Extension Installation
// ============================================================================

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  log(`Extension installed: ${details.reason}`);

  if (details.reason === 'install') {
    // Set default state on first install
    chrome.storage.local.set({ enabled: true }).then(() => {
      log('Default state set to enabled');
    });
  }
});

// ============================================================================
// Service Worker Lifecycle
// ============================================================================

/**
 * Handle service worker startup
 */
chrome.runtime.onStartup.addListener(() => {
  log('Service worker started');
});

// ============================================================================
// Storage Change Monitoring
// ============================================================================

/**
 * Monitor storage changes
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.enabled) {
    log(`Storage changed: enabled = ${changes.enabled.newValue}`);
  }
});

log('Background service worker initialized');