# Course Video Autoplay Extension

A production-ready Chrome extension (Manifest V3) that automatically plays the next video in a course sequence when the current video ends.

## Features

- **Auto-play next video**: Automatically navigates to the next video when current video finishes
- **Smart skipping**: Skips assignments, quizzes, and locked content
- **Focus playback**: Videos continue playing even when browser tab loses focus
- **Toggle control**: Enable/disable autoplay from extension popup
- **SPA support**: Works with dynamic content using MutationObserver
- **Console logging**: Debug logs for troubleshooting

## Folder Structure

```
extension/
├── manifest.json          # Extension manifest (MV3)
├── content.js            # Main content script
├── background.js         # Background service worker
├── popup.html            # Extension popup UI
├── popup.js              # Popup logic
├── icons/
│   ├── icon16.png        # 16x16 icon
│   ├── icon48.png        # 48x48 icon
│   ├── icon128.png       # 128x128 icon
│   └── icon.svg          # Source SVG
└── INSTRUCTIONS.md       # This file
```

## Installation

### Option 1: Load Unpacked Extension (Recommended for Development)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked** button
4. Select the `extension` folder
5. The extension icon will appear in your toolbar

### Option 2: Pack Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Pack extension**
4. Select the `extension` folder (leave private key blank)
5. A `.crx` file will be created in the parent directory

## Usage

1. **Enable/Disable**: Click the extension icon in the toolbar and toggle the switch
2. **Auto-play**: When enabled, the extension automatically clicks "Next" when a video ends
3. **Navigation delay**: 2-second buffer before navigating to next video
4. **Console logs**: Open DevTools (F12) and check the Console tab for debug messages

## Technical Details

### Content Script Features

- `MutationObserver` detects dynamically loaded videos (SPA support)
- Event listeners: `ended`, `pause`, `timeupdate`, `waiting`, `canplay`
- Smart detection of next video button using multiple selector strategies
- Skips assignment/quiz/locked content by analyzing page structure and URLs
- Auto-resumes paused videos when tab regains focus
- Delay buffer (2 seconds) before moving to next video

### State Management

- Extension state stored in `chrome.storage.local`
- State synced across popup and content script via messaging

### Browser Compatibility

- Chrome 88+ (Manifest V3)
- Other Chromium-based browsers (Edge, Brave, etc.)

## Troubleshooting

### Extension not working?

1. Check console logs in DevTools (F12 → Console)
2. Verify extension is enabled (check popup status)
3. Refresh the course page
4. Make sure the video is in a playlist structure

### Videos not auto-playing?

1. Verify the website allows autoplay
2. Check if the video has DRM protection
3. Look for console error messages

### Next video not found?

1. The extension supports common course platform selectors
2. Check console for "Next video button not found" message
3. The playlist structure may need custom selectors

## Security Considerations

- No authentication or backend API access
- No DRM bypassing
- Only UI-level automation
- Respects browser security policies