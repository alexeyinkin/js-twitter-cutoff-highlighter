# 280 Twitter Cutoff Highlighter

When you have **X / Twitter Premium**, the composer removes the standard 280-character highlight and lets you write up to 25,000 characters—making it impossible to tell where your post will get truncated behind **"Show more"** in the timeline.

**280 Twitter Cutoff Highlighter** brings back the exact **280-character cutoff highlight** while keeping your full composer working normally.

## Features
- **Non-Destructive Highlight**: Uses the native CSS Custom Highlight API (`::highlight`) + a fallback overlay so it **never** mutates Draft.js DOM nodes or breaks typing/undo/cursor state.
- **Live Counter Pill**: Anchored above the composer toolbar, showing `X / 280 (N left before "Show more")` or how many characters are overflowing past the cutoff.
- **Twitter Weighted Character Counting**: Properly accounts for emojis/CJK (weight = 2), newlines between paragraphs (weight = 1), and URLs wrapped by `t.co` (weight = 23).
- **Customizable Popup**: Click the extension icon in the toolbar to adjust the character cutoff, highlight color, or toggle the counter badge.

## How to Load Locally in Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select the `manifest.json` file inside this folder.
4. Open [x.com](https://x.com) and start typing a post!

## License
MIT-0 (MIT No Attribution) — Copyright 2026 Alexey Inkin
