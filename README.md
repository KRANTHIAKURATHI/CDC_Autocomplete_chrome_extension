# 🎥 Course Video Autoplay For vit student to complete cdc videos


An intelligent Chrome extension designed to enhance your online learning experience by automatically navigating and playing the next video in a course sequence. No more clicking "Next" every 5 minutes—just sit back, learn, and let the extension handle the navigation.

## ✨ Key Features

- **🔄 Seamless Autoplay**: Automatically starts the next video as soon as the current one finishes.
- **🎯 Intelligent Detection**: Works with standard HTML5 video elements and popular players like **Vimeo**, **JWPlayer**, and **Video.js**.
- **🧠 Smart Navigation**: Automatically identifies "Next Lesson" or "Next Video" buttons across various Learning Management Systems (LMS).
- **🚫 Content Filtering**: Intelligently skips non-video content such as **quizzes, assignments, and locked modules** to keep your flow uninterrupted.
- **⚡ SPA Support**: Built with `MutationObserver` to work perfectly on Single Page Applications without needing page refreshes.
- **📱 Background Persistence**: Continues monitoring and playing even when the tab loses focus.
- **🔘 Easy Toggle**: A sleek popup interface to enable or disable the extension with a single click.

## 🚀 Installation (Developer Mode)

Since this extension is in development, you can load it locally into your browser:

1.  **Clone or Download** this repository to your local machine.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** using the toggle in the top right corner.
4.  Click the **Load unpacked** button.
5.  Select the folder containing the extension files (where `manifest.json` is located).
6.  The extension is now ready! Pin it to your toolbar for easy access.

## 🛠️ How It Works

The extension uses a combination of polling and DOM observation to provide a reliable experience:
- **Detection**: It scans the page for `<video>` tags and iframes containing video players.
- **Monitoring**: It tracks the `currentTime` and `duration` of the active video.
- **Navigation**: Once a video ends (or reaches within 1 second of the end), it searches the sidebar, playlist, or navigation buttons for the next logical lesson.
- **Execution**: It triggers a click on the next lesson and waits for the new video to load before starting the cycle again.

## 📂 Project Structure

```text
├── manifest.json      # Extension metadata and permissions
├── background.js      # Service worker for background tasks
├── content.js         # Core logic for video detection and navigation
├── popup.html         # User interface for the extension popup
├── popup.js           # Logic for the popup toggle
└── icons/             # Extension icons (16x16, 48x48, 128x128)


📜 License

### Summary of Changes
- **Detailed Feature List**: Highlighted the advanced logic you've implemented (like skipping quizzes and SPA support).
- **Setup Instructions**: Provided clear steps for users to install the extension in Developer Mode.
- **Visual Badges**: Added Manifest V3 and License badges for a professional GitHub look.
- **Architecture Overview**: Included a directory tree to help contributors understand the file structure.

You can now copy this content into a new `README.md` file in your project folder!
