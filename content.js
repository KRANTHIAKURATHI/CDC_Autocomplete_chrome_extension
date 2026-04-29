/**
 * Course Video Autoplay Extension - Content Script
 *
 * Handles video detection, automatic playback, and navigation to next video
 * Uses MutationObserver for SPA behavior and time-based polling for video end detection
 */

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  NEXT_VIDEO_DELAY: 2000,
  POLLING_INTERVAL: 1000,  // Increased from 500ms to reduce main thread load
  MAX_NAVIGATION_ATTEMPTS: 5,
  NAVIGATION_RETRY_DELAY: 500
};

const MESSAGE_TYPES = {
  NAVIGATE_NEXT: 'COURSE_VIDEO_AUTOPLAY_NAVIGATE_NEXT'
};

// ============================================================================
// State Management
// ============================================================================

let extensionEnabled = true;
let isProcessingVideoEnd = false;
let currentVideo = null;
let nextVideoTimeout = null;
let videoPollingInterval = null;
let lastVideoTime = 0;
let videoEndedDetected = false;
let videoObserver = null;

// ============================================================================
// Logging Utility
// ============================================================================

function log(message, type = 'info') {
  const prefix = '[CourseVideoAutoplay]';
  const timestamp = new Date().toISOString();

  switch (type) {
    case 'error':
      console.error(`${prefix} ${timestamp} - ${message}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${timestamp} - ${message}`);
      break;
    case 'debug':
      console.debug(`${prefix} ${timestamp} - ${message}`);
      break;
    default:
      console.log(`${prefix} ${timestamp} - ${message}`);
  }
}

// ============================================================================
// Storage Management
// ============================================================================

async function loadState() {
  try {
    const result = await chrome.storage.local.get(['enabled']);
    extensionEnabled = result.enabled !== false;
    log(`State loaded: extensionEnabled = ${extensionEnabled}`);
  } catch (error) {
    log(`Error loading state: ${error.message}`, 'error');
  }
}

async function saveState() {
  try {
    await chrome.storage.local.set({ enabled: extensionEnabled });
  } catch (error) {
    log(`Error saving state: ${error.message}`, 'error');
  }
}

// ============================================================================
// Message Handling
// ============================================================================

function handleMessage(event) {
  if (event.data?.type === 'TOGGLE_EXTENSION') {
    extensionEnabled = event.data.enabled;
    saveState();

    if (extensionEnabled) {
      log('Extension enabled');
      startVideoMonitoring();
    } else {
      log('Extension disabled');
      stopVideoMonitoring();
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TOGGLE_EXTENSION') {
    extensionEnabled = message.enabled;
    saveState();

    if (extensionEnabled) {
      log('Extension enabled via runtime message');
      startVideoMonitoring();
    } else {
      log('Extension disabled via runtime message');
      stopVideoMonitoring();
    }

    sendResponse({ success: true });
  }
});

// ============================================================================
// Video Element Management
// ============================================================================

function findVideoElements() {
  // Try standard video elements first
  const videos = Array.from(document.querySelectorAll('video'));

  // Also check for common video player frameworks
  if (videos.length === 0) {
    const playerContainers = document.querySelectorAll('.video-js, .jwplayer, .vjs-player, video[class*="player"]');
    if (playerContainers.length > 0) {
      log(`Found ${playerContainers.length} video player container(s)`, 'debug');
      playerContainers.forEach(container => {
        const vid = container.querySelector('video');
        if (vid && !videos.includes(vid)) {
          videos.push(vid);
        }
      });
    }
  }

  return videos;
}

function findVideoIframes() {
  const iframeSelectors = [
    'iframe[src*="player.vimeo.com" i]',
    'iframe[src*="vimeo.com" i]',
    'iframe[src*="/video/"]',
    'iframe[src*="/player/"]'
  ];

  const iframes = iframeSelectors.flatMap(selector => Array.from(document.querySelectorAll(selector)));
  const uniqueIframes = Array.from(new Set(iframes));

  if (uniqueIframes.length > 0) {
    log(`Found ${uniqueIframes.length} video iframe(s)`, 'debug');
  }

  return uniqueIframes;
}

function autoPlayIframeVideo(iframe) {
  if (!iframe || !iframe.contentWindow) return false;

  try {
    iframe.contentWindow.postMessage({ method: 'play' }, '*');
    log(`Sent postMessage play to iframe: ${iframe.src}`, 'debug');
    return true;
  } catch (error) {
    log(`Iframe auto-play failed: ${error.message}`, 'warn');
    return false;
  }
}

function isValidVideo(video) {
  if (!video) return false;
  if (typeof video.currentTime !== 'number' || typeof video.duration !== 'number') return false;

  return video.readyState >= 1 &&
    video.duration > 0 &&
    !video.ended;
}

function isSkipableContent(videoElement) {
  const parent = videoElement.closest('[data-type]') ||
                 videoElement.closest('[class*="assignment"]') ||
                 videoElement.closest('[class*="quiz"]') ||
                 videoElement.closest('[class*="locked"]') ||
                 videoElement.closest('[class*="preview"]');

  if (parent) {
    const className = parent.className?.toLowerCase() || '';
    const dataType = parent.getAttribute('data-type')?.toLowerCase() || '';

    return className.includes('assignment') ||
           className.includes('quiz') ||
           className.includes('locked') ||
           className.includes('preview') ||
           dataType === 'assignment' ||
           dataType === 'quiz';
  }

  const src = videoElement.src?.toLowerCase() || '';
  if (src.includes('assignment') || src.includes('quiz') || src.includes('locked')) {
    return true;
  }

  return false;
}

function isCrossOriginIframe() {
  if (window.self === window.top) {
    return false;
  }

  try {
    return window.parent.location.host !== window.location.host;
  } catch (error) {
    return true;
  }
}

function notifyTopFrameToNavigateNext() {
  try {
    const message = {
      type: MESSAGE_TYPES.NAVIGATE_NEXT,
      source: 'course-video-autoplay'
    };
    window.top.postMessage(message, '*');
    log('Sent navigate-next request to top frame', 'debug');
  } catch (error) {
    log(`Unable to message top frame: ${error.message}`, 'warn');
  }
}

function startVideoObserver() {
  if (videoObserver) {
    videoObserver.disconnect();
  }

  videoObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if a video element was added
            if (node.tagName === 'VIDEO') {
              log('New video element detected, attempting auto-play', 'debug');
              attemptAutoPlay(node);
            }
            // Check for iframes that might contain videos
            else if (node.tagName === 'IFRAME' && (node.src.includes('video') || node.src.includes('player') || node.src.includes('vimeo.com'))) {
              log('New video iframe detected', 'debug');
              if (!autoPlayIframeVideo(node)) {
                setTimeout(() => {
                  const videos = findVideoElements();
                  videos.forEach(video => attemptAutoPlay(video));
                }, 1000);
              }
            }
            // Check descendants for videos
            else {
              const videos = node.querySelectorAll ? node.querySelectorAll('video') : [];
              videos.forEach(video => {
                log('New video element in subtree detected, attempting auto-play', 'debug');
                attemptAutoPlay(video);
              });
            }
          }
        });
      }
    }
  });

  videoObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  log('Video observer started');
}

function attemptAutoPlay(video) {
  if (!extensionEnabled || !video || video.ended || !video.paused) return;
  if (typeof video.currentTime !== 'number' || typeof video.duration !== 'number' || video.duration <= 0) return;

  log(`Attempting to auto-play video: paused=${video.paused}, ended=${video.ended}, readyState=${video.readyState}`, 'debug');

  // First, try to find and click a play button overlay
  const playButton = document.querySelector('[id^="play"], .play-button, [class*="play"], [aria-label*="play" i]');
  if (playButton && isClickable(playButton)) {
    log('Found play button, clicking it', 'debug');
    clickElement(playButton);
    return;
  }

  // Fallback to direct play
  setTimeout(() => {
    if (video.paused && !video.ended && video.readyState >= 1) {
      video.play().then(() => {
        log('Video auto-play succeeded', 'debug');
      }).catch(err => {
        log(`Video auto-play failed: ${err.message}`, 'warn');
      });
    }
  }, 500);
}

function autoPlayAvailableIframes() {
  const iframes = findVideoIframes();
  iframes.forEach(iframe => autoPlayIframeVideo(iframe));
}

// ============================================================================
// Video Polling for End Detection
// ============================================================================

function startVideoMonitoring() {
  if (videoPollingInterval) {
    clearInterval(videoPollingInterval);
  }

  videoPollingInterval = setInterval(() => {
    // Skip polling if page is hidden to reduce CPU usage
    if (document.hidden) return;

    if (!extensionEnabled || isProcessingVideoEnd) return;

    const videos = findVideoElements();
    if (videos.length === 0) {
      autoPlayAvailableIframes();
    }

    for (const video of videos) {
      if (isValidVideo(video)) {
        const currentTime = video.currentTime;
        const duration = video.duration;

        // Check if video ended (currentTime near duration)
        if (duration > 0 && currentTime >= duration - 1) {
          if (!videoEndedDetected) {
            videoEndedDetected = true;
            log(`Video ended detected via polling (time: ${currentTime}/${duration})`);
            onVideoEnded(video);
          }
        } else {
          // Video is playing
          videoEndedDetected = false;
          lastVideoTime = currentTime;
        }

        // Auto-play if paused if the video is ready enough to play
        if (extensionEnabled && video.paused && !video.ended && video.readyState >= 1 && video.duration > 0) {
          video.play().then(() => {
            log('Video auto-play succeeded in polling', 'debug');
          }).catch(err => {
            log(`Video auto-play failed in polling: ${err.message}`, 'warn');
          });
        }
      }
    }
  }, CONFIG.POLLING_INTERVAL);

  // Start observing for new video elements
  startVideoObserver();

  log('Video polling started');
}

function stopVideoMonitoring() {
  if (videoPollingInterval) {
    clearInterval(videoPollingInterval);
    videoPollingInterval = null;
  }

  if (videoObserver) {
    videoObserver.disconnect();
    videoObserver = null;
  }

  log('Video polling stopped');
}

function onVideoEnded(video) {
  if (!extensionEnabled) return;

  if (isSkipableContent(video)) {
    log('Skipping - detected assignment/quiz/locked content');
    setTimeout(() => navigateToNextVideo(), CONFIG.NEXT_VIDEO_DELAY);
    return;
  }

  log('Video ended, initiating navigation to next video');

  if (window.self !== window.top && isCrossOriginIframe()) {
    log('Running in cross-origin iframe, sending request to top frame instead of navigating locally', 'debug');
    notifyTopFrameToNavigateNext();
    return;
  }

  if (nextVideoTimeout) {
    clearTimeout(nextVideoTimeout);
  }

  nextVideoTimeout = setTimeout(() => {
    navigateToNextVideo();
  }, CONFIG.NEXT_VIDEO_DELAY);
}

// ============================================================================
// Next Video Navigation
// ============================================================================

async function findNextVideoButton() {
  const selectors = [
    'button[data-testid="next-lesson"]',
    'button[class*="next-lesson"]',
    'button[class*="next-video"]',
    'a[class*="next-lesson"]',
    'a[class*="next-video"]',
    '[class*="next-lesson"] button',
    '[class*="next-video"] button',
    '[data-testid="next"]',
    '[aria-label="Next"]',
    'button[aria-label="Next"]',
    '[class*="playlist"] [class*="next"]',
    '[data-position="next"]',
    '[data-click="next"]',
    '.next-button',
    '.next-btn',
    'button[aria-label*="next" i]',
    'a[aria-label*="next" i]'
  ];

  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element && isClickable(element)) {
        log(`Found next button: ${selector}`);
        return element;
      }
    } catch (e) {}
  }

  const buttons = document.querySelectorAll('button, a');
  for (const button of buttons) {
    const text = button.textContent?.toLowerCase() || '';
    if (text.includes('next') && (text.includes('lesson') || text.includes('video') || text.includes('module'))) {
      if (isClickable(button)) {
        log(`Found next button by text: ${text}`);
        return button;
      }
    }
  }

  log('Next video button not found', 'warn');
  return null;
}

function isClickable(element) {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  if (element.disabled) {
    return false;
  }

  return true;
}


function isHiddenElement(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || element.hidden;
}

function findAccordionToggle(item) {
  if (!item || !(item instanceof Element)) return null;

  let current = item;
  while (current && current !== document.body) {
    if (current.matches('[role="button"], button, [data-toggle], .container.modpointer, .accordHeadright, .accordHeadLeft')) {
      if (isClickable(current)) {
        return current;
      }
    }
    current = current.parentElement;
  }

  const toggle = item.querySelector('[role="button"], button, [data-toggle], .container.modpointer, .accordHeadright, .accordHeadLeft');
  return toggle && isClickable(toggle) ? toggle : null;
}

function isSectionHeader(item) {
  if (!item || !(item instanceof Element)) return false;
  const className = item.className?.toString().toLowerCase() || '';
  const text = (item.textContent || '').trim().toLowerCase();

  if (item.matches('.modonhover, .accEach1, .selectedAcd, .selectedacd')) {
    return false;
  }

  if (item.matches('[role="button"], button, .container.modpointer, .accordHeadright, .accordHeadLeft')) {
    return true;
  }

  if (className.includes('accordion') || className.includes('accordian') || className.includes('section') || className.includes('chapter')) {
    return true;
  }

  if (/^(module|section|chapter|unit|topic|lesson)/i.test(text)) {
    return true;
  }

  return false;
}

function findFirstLessonInSection(section) {
  if (!section || !(section instanceof Element)) return null;

  const selectors = [
    '.t-my-5.modonhover',
    '.accEach1',
    '.selectedAcd',
    '.selectedacd',
    'a[href]:not([href="#"])',
    'button[data-href]',
    'button[data-url]',
    '[role="button"][data-href]',
    '[role="button"][data-url]'
  ];

  const roots = [
    section,
    section.nextElementSibling,
    section.parentElement,
    section.closest('app-accordian, .container, .acrBord, .submod, .course-outline, .module-list, .chapter-list')
  ];
  const seen = new Set();

  for (const root of roots) {
    if (!root || seen.has(root)) continue;
    seen.add(root);

    for (const selector of selectors) {
      const candidate = root.querySelector(selector);
      if (candidate && isClickable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function findNextLessonInSiblingSections(currentItem) {
  if (!currentItem || !(currentItem instanceof Element)) return null;

  const sidebarRoot = currentItem.closest('app-accordian, .sidebar, aside, nav, #teamsID, app-mycourse-details, .course-outline, .module-list, .chapter-list, .playlist, .course-list, .lesson-list');
  const searchRoot = sidebarRoot || document.body;

  const elements = Array.from(searchRoot.querySelectorAll(
    'a[href], button[data-href], [role="button"][data-href], [data-url], [data-href], .modonhover, .accEach1, .selectedAcd, .selectedacd, .container.modpointer, .accordHeadright, .accordHeadLeft, .chapter, .module, .section, .unit, .topic'
  )).filter(el => el instanceof Element && (el.textContent || '').trim().length > 0);

  const startIndex = elements.indexOf(currentItem);
  if (startIndex < 0) return null;

  for (let i = startIndex + 1; i < elements.length; i++) {
    const element = elements[i];

    if (isSectionHeader(element)) {
      const lesson = getClickableFromPlaylistItem(element);
      if (lesson) {
        return lesson;
      }
      const toggle = findAccordionToggle(element);
      if (toggle) {
        return toggle;
      }
      continue;
    }

    const clickable = getClickableFromPlaylistItem(element);
    if (clickable) {
      return clickable;
    }
  }

  return null;
}

function isActionableElement(element) {
  if (!element) return false;

  const tagName = element.tagName?.toUpperCase();
  const className = element.className?.toString().toLowerCase() || '';
  if (tagName === 'A' || tagName === 'BUTTON') {
    return true;
  }

  if (element.getAttribute('role') === 'button') {
    return true;
  }

  if (element.hasAttribute('onclick') || element.tabIndex >= 0) {
    return true;
  }

  if (className.includes('modonhover') || className.includes('acceach1') || className.includes('selectedacd') || className.includes('cursor-pointer')) {
    return true;
  }

  return false;
}

function clickElement(element) {
  if (!element) return false;

  if (typeof element.click === 'function') {
    try {
      element.click();
      return true;
    } catch (error) {
      log(`Native click failed: ${error.message}`, 'warn');
    }
  }

  try {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    element.dispatchEvent(event);
    return true;
  } catch (error) {
    log(`Dispatch click event failed: ${error.message}`, 'warn');
  }

  const href = element.href || element.getAttribute('data-href') || element.getAttribute('data-url');
  if (href) {
    window.location.href = href;
    return true;
  }

  return false;
}

async function isValidNextTarget(button) {
  const href = button.href ||
    button.getAttribute('data-href') ||
    button.getAttribute('data-url');

  if (href) {
    const lowerHref = href.toLowerCase();
    if (lowerHref.includes('assignment') ||
        lowerHref.includes('quiz') ||
        lowerHref.includes('locked') ||
        lowerHref.includes('assessment')) {
      log('Skipping - next target appears to be assignment/quiz/locked', 'warn');
      return false;
    }
  }

  return true;
}

async function navigateToNextVideo() {
  if (isProcessingVideoEnd) {
    log('Already processing video end, skipping');
    return;
  }

  isProcessingVideoEnd = true;

  try {
    let nextButton = await findNextVideoButton();

    if (!nextButton) {
      log('No next video button found, trying playlist', 'warn');
      nextButton = await findNextInPlaylist();
    }

    if (!nextButton) {
      log('Could not find next video', 'error');
      isProcessingVideoEnd = false;
      return;
    }

    if (!(await isValidNextTarget(nextButton))) {
      log('Next target is skipable content', 'warn');
      nextButton = await findNextInPlaylist();
      if (!nextButton) {
        isProcessingVideoEnd = false;
        return;
      }
    }

    log(`Final next target: <${nextButton.tagName.toLowerCase()}> ${nextButton.className || nextButton.textContent?.trim()}`);
    log('Clicking next video button');

    if (!clickElement(nextButton)) {
      log('Failed to trigger native click or navigation', 'warn');
    }

    if (isSectionHeader(nextButton)) {
      setTimeout(() => {
        const sectionParent = nextButton.closest('app-accordian, .container, .acrBord, .submod');
        const lessonInSection = findFirstLessonInSection(sectionParent || nextButton.parentElement);
        if (lessonInSection && lessonInSection !== nextButton) {
          log('Clicking first lesson inside expanded section', 'debug');
          clickElement(lessonInSection);
        }
      }, 500);
    }

    log(`Navigation triggered, waiting ${CONFIG.NEXT_VIDEO_DELAY}ms`);

    setTimeout(() => {
      isProcessingVideoEnd = false;
      videoEndedDetected = false;
      startVideoMonitoring();
    }, CONFIG.NEXT_VIDEO_DELAY);

  } catch (error) {
    log(`Error navigating to next video: ${error.message}`, 'error');
    isProcessingVideoEnd = false;
  }
}

function normalizeHref(href) {
  if (!href) return null;
  const anchor = document.createElement('a');
  anchor.href = href;
  return anchor.href.replace(/#.*$/, '');
}

function isCurrentPlaylistItem(item) {
  if (!item) return false;

  const className = item.className?.toString().toLowerCase() || '';
  if (className.includes('active') ||
      className.includes('current') ||
      className.includes('playing') ||
      className.includes('selected') ||
      className.includes('completed') ||
      className.includes('selectedacd')) {
    return true;
  }

  if (item.getAttribute('aria-current') === 'true' ||
      item.getAttribute('aria-selected') === 'true' ||
      item.getAttribute('data-current') === 'true' ||
      item.getAttribute('data-active') === 'true') {
    return true;
  }

  const link = item.querySelector('a[href], button[data-href], [role="button"][data-href]');
  const itemHref = link?.href || link?.getAttribute('data-href') || link?.getAttribute('data-url');
  if (itemHref && normalizeHref(itemHref) === normalizeHref(window.location.href)) {
    return true;
  }

  if (item.tagName === 'A' && normalizeHref(item.href) === normalizeHref(window.location.href)) {
    return true;
  }

  return false;
}

function matchesLessonSidebarItem(item) {
  if (!item || !(item instanceof Element)) return false;
  const className = item.className?.toString().toLowerCase() || '';
  const text = (item.textContent || '').trim().toLowerCase();

  if (className.includes('modonhover') || className.includes('acceach1') || className.includes('selectedacd')) {
    return true;
  }

  if (/\b(lesson|video|assessment|reference|practice|chapter|module|if_else|if_elseif|nested_if)\b/i.test(text)) {
    return true;
  }

  return false;
}

function getNextPlaylistElement(items, currentItem) {
  const itemsArray = Array.from(items);
  const currentIndex = itemsArray.indexOf(currentItem);
  if (currentIndex >= 0 && currentIndex < itemsArray.length - 1) {
    return itemsArray[currentIndex + 1];
  }
  return null;
}

function getClickableFromPlaylistItem(item) {
  if (!item) return null;

  if (isSectionHeader(item)) {
    const lesson = findFirstLessonInSection(item)
      || findFirstLessonInSection(item.nextElementSibling)
      || findFirstLessonInSection(item.parentElement);
    if (lesson) {
      log('Section header detected, using first lesson inside section', 'debug');
      return lesson;
    }
  }

  const link = item.querySelector('a, button, [role="button"], [onclick]');
  if (link) {
    if (isClickable(link)) {
      return link;
    }
    log('Found hidden link inside playlist item, using it as fallback', 'debug');
    return link;
  }

  const innerClickable = item.querySelector('.accEach1, .t-text-default, .t-flex');
  if (innerClickable) {
    if (isClickable(innerClickable)) {
      return innerClickable;
    }
    log('Found hidden inner clickable element inside playlist item, using it as fallback', 'debug');
    return innerClickable;
  }

  const className = item.className?.toString().toLowerCase() || '';
  if (isActionableElement(item)) {
    if (isClickable(item)) {
      return item;
    }
    log('Found actionable playlist item that is not visible, using it as fallback', 'debug');
    return item;
  }

  // If the next item is hidden inside a collapsed section, find the accordion toggle
  const sectionToggle = findAccordionToggle(item);
  if (sectionToggle) {
    log('Found section toggle for hidden next item', 'debug');
    return sectionToggle;
  }

  return null;
}

function findNextInSidebarCards() {
  const cards = Array.from(document.querySelectorAll('.t-my-5.selectedAcd.modonhover, .t-my-5.modonhover, .selectedAcd.modonhover, .modonhover'))
    .filter(item => item.textContent.trim().length > 0 && matchesLessonSidebarItem(item));

  if (cards.length < 2) return null;

  let currentItem = cards.find(isCurrentPlaylistItem);
  if (!currentItem) {
    currentItem = cards.find(item => item.className.toString().toLowerCase().includes('selectedacd'));
  }

  if (!currentItem) return null;

  const nextItem = getNextPlaylistElement(cards, currentItem);
  if (!nextItem) return null;

  log('Found next lesson card in sidebar');
  return getClickableFromPlaylistItem(nextItem);
}

async function findNextInPlaylist() {
  const sidebarCardTarget = findNextInSidebarCards();
  if (sidebarCardTarget) {
    return sidebarCardTarget;
  }

  const sidebarContainer = document.querySelector('#teamsID, app-mycourse-details, app-accordian, [id="teamsID"]');
  if (sidebarContainer) {
    const items = Array.from(sidebarContainer.querySelectorAll('.modonhover, .accEach1, .selectedAcd, .selectedacd'))
      .filter(item => item !== sidebarContainer && item.textContent.trim().length > 0 && matchesLessonSidebarItem(item));

    if (items.length > 1) {
      log(`Found lesson sidebar items count ${items.length}`, 'debug');
      let currentItem = items.find(isCurrentPlaylistItem);
      if (!currentItem) {
        currentItem = items.find(item => item.className.toString().toLowerCase().includes('selectedacd'));
      }
      if (!currentItem) {
        currentItem = items.find(item => {
          const text = (item.textContent || '').toLowerCase();
          return text.includes('current') || text.includes('now') || text.includes('playing');
        });
      }
      if (currentItem) {
        const nextItem = getNextPlaylistElement(items, currentItem);
        if (nextItem) {
          log('Found next playlist item in lesson sidebar');
          const clickTarget = getClickableFromPlaylistItem(nextItem);
          if (clickTarget) return clickTarget;
        }

        const siblingSectionTarget = findNextLessonInSiblingSections(currentItem);
        if (siblingSectionTarget) {
          log('Found next lesson by scanning sibling sections after current item', 'debug');
          return siblingSectionTarget;
        }
      }
    }
  }

  const playlistSelectors = [
    '[class*="playlist"] [class*="item"]',
    '[data-testid="playlist"] [class*="item"]',
    '[class*="course-outline"] [class*="lesson"]',
    '[class*="module"] [class*="lesson"]',
    '[class*="sequence"] [class*="item"]',
    'app-course-content app-module-list li',
    '[class*="lesson-list"] [class*="lesson-item"]',
    'ul li[role="listitem"]',
    '[class*="sidebar"] li',
    '[class*="chapter-list"] li',
    '[class*="course-list"] li',
    '[class*="lesson"]',
    '[class*="video"]',
    '[class*="chapter"]',
    '[data-lesson]',
    '[data-module]'
  ];

  for (const selector of playlistSelectors) {
    const items = document.querySelectorAll(selector);
    if (items.length === 0) continue;

    log(`Found playlist with ${items.length} items using selector ${selector}`, 'debug');

    let currentItem = Array.from(items).find(isCurrentPlaylistItem);
    if (!currentItem) {
      currentItem = Array.from(items).find(item => {
        const itemHref = item.querySelector('a[href], button[data-href], [role="button"][data-href]')?.href ||
                         item.querySelector('a[href], button[data-href], [role="button"][data-url]')?.getAttribute('data-url');
        return itemHref && normalizeHref(itemHref) === normalizeHref(window.location.href);
      });
    }

    if (!currentItem) {
      const linkMatch = Array.from(items).find(item => {
        const text = (item.textContent || '').toLowerCase();
        return text.includes('current') || text.includes('now') || text.includes('playing');
      });
      if (linkMatch) currentItem = linkMatch;
    }

    if (!currentItem) continue;

    const nextItem = getNextPlaylistElement(items, currentItem);
    if (nextItem) {
      log(`Found next playlist item after selector ${selector}`);
      const clickTarget = getClickableFromPlaylistItem(nextItem);
      if (clickTarget) {
        return clickTarget;
      }

      const visibleChild = nextItem.querySelector('a, button, [role="button"]');
      if (visibleChild && isClickable(visibleChild)) {
        log('Found clickable child of next playlist item', 'debug');
        return visibleChild;
      }

      const toggle = findAccordionToggle(nextItem);
      if (toggle) {
        log('Found accordion toggle for next playlist item', 'debug');
        return toggle;
      }
    }

    const siblingSectionTarget = findNextLessonInSiblingSections(currentItem);
    if (siblingSectionTarget) {
      log(`Found next lesson by scanning sibling sections after current item within selector ${selector}`, 'debug');
      return siblingSectionTarget;
    }
  }

  const sidebarContains = [
    'aside',
    'nav',
    '[class*="sidebar"]',
    '[class*="playlist"]',
    '[class*="course-outline"]',
    '[class*="module-list"]',
    '[class*="chapter-list"]'
  ];

  for (const containerSelector of sidebarContains) {
    const container = document.querySelector(containerSelector);
    if (!container) continue;

    const items = Array.from(container.querySelectorAll('li, [role="listitem"], [class*="lesson"], [class*="item"], [data-lesson], [data-module]'))
      .filter(item => item !== container && item.textContent.trim().length > 0);

    if (items.length < 2) continue;

    let currentItem = items.find(isCurrentPlaylistItem);
    if (!currentItem) {
      currentItem = items.find(item => {
        const itemHref = item.querySelector('a[href]')?.href ||
                         item.querySelector('button[data-href]')?.getAttribute('data-href') ||
                         item.querySelector('[role="button"][data-url]')?.getAttribute('data-url');
        return itemHref && normalizeHref(itemHref) === normalizeHref(window.location.href);
      });
    }

    if (!currentItem) {
      const linkMatch = items.find(item => {
        const text = (item.textContent || '').toLowerCase();
        return text.includes('current') || text.includes('now') || text.includes('playing');
      });
      if (linkMatch) currentItem = linkMatch;
    }

    if (!currentItem) continue;

    const nextItem = getNextPlaylistElement(items, currentItem);
    if (nextItem) {
      log(`Found next playlist item inside sidebar container ${containerSelector}`);
      const clickTarget = getClickableFromPlaylistItem(nextItem);
      if (clickTarget) {
        return clickTarget;
      }

      const visibleChild = nextItem.querySelector('a, button, [role="button"]');
      if (visibleChild && isClickable(visibleChild)) {
        log('Found clickable child of next playlist item', 'debug');
        return visibleChild;
      }

      const toggle = findAccordionToggle(nextItem);
      if (toggle) {
        log('Found accordion toggle for next playlist item', 'debug');
        return toggle;
      }
    }
  }

  // Last-ditch fallback: find all lesson links and choose the next one by order
  const lessonLinks = Array.from(document.querySelectorAll('a[href], button[data-href], [role="button"][data-href]'))
    .filter(el => isClickable(el) && /(lesson|module|chapter|video)/i.test(el.textContent || el.href || ''));
  for (let i = 0; i < lessonLinks.length - 1; i++) {
    const currentLink = lessonLinks[i];
    if (normalizeHref(currentLink.href || currentLink.getAttribute('data-href') || currentLink.getAttribute('data-url')) === normalizeHref(window.location.href)) {
      return lessonLinks[i + 1];
    }
  }

  return null;
}

// ============================================================================
// Visibility Handling
// ============================================================================

function handleVisibilityChange() {
  if (!extensionEnabled) return;

  if (!document.hidden) {
    const videos = findVideoElements();
    for (const video of videos) {
      if (isValidVideo(video) && video.paused && video.buffered.length > 0) {
        video.play().catch(() => {});
      }
    }
  }
}

// ============================================================================
// Initialization
// ============================================================================

function handleWindowMessage(event) {
  if (event?.data?.type === MESSAGE_TYPES.NAVIGATE_NEXT) {
    log('Received navigate-next request from iframe', 'debug');
    navigateToNextVideo();
  }
}

async function initialize() {
  log('Initializing Course Video Autoplay extension');

  await loadState();

  window.addEventListener('message', handleMessage);
  window.addEventListener('message', handleWindowMessage);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Start video monitoring
  startVideoMonitoring();
  autoPlayAvailableIframes();

  log(`Extension initialized (enabled: ${extensionEnabled})`);
}

function cleanup() {
  stopVideoMonitoring();

  if (nextVideoTimeout) {
    clearTimeout(nextVideoTimeout);
  }

  log('Cleanup completed');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

window.addEventListener('pagehide', cleanup);