(() => {
  'use strict';

  const DEFAULT_SETTINGS = {
    limit: 280,
    highlightColor: '#f4212e',
    highlightOpacity: 0.25,
    showBadge: true,
    weightedCounting: true
  };

  let settings = { ...DEFAULT_SETTINGS };
  let activeEditor = null;
  let overlayContainer = null;
  let rafId = null;

  // Load settings from storage
  if (typeof browser !== 'undefined' && browser.storage) {
    browser.storage.local.get(DEFAULT_SETTINGS).then((stored) => {
      settings = { ...DEFAULT_SETTINGS, ...stored };
      applyThemeVariables();
      scheduleUpdate();
    }).catch(() => {});

    browser.storage.onChanged.addListener((changes) => {
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (newValue !== undefined) {
          settings[key] = newValue;
        }
      }
      applyThemeVariables();
      scheduleUpdate();
    });
  } else if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
      settings = { ...DEFAULT_SETTINGS, ...stored };
      applyThemeVariables();
      scheduleUpdate();
    });
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) || 244;
    const g = parseInt(clean.substring(2, 4), 16) || 33;
    const b = parseInt(clean.substring(4, 6), 16) || 46;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyThemeVariables() {
    const bg = hexToRgba(settings.highlightColor, settings.highlightOpacity);
    document.documentElement.style.setProperty('--x-trim-bg', bg);
  }

  applyThemeVariables();

  function ensureOverlayContainer() {
    if (!overlayContainer || !document.body.contains(overlayContainer)) {
      overlayContainer = document.createElement('div');
      overlayContainer.className = 'x-trim-overlay-container';
      document.body.appendChild(overlayContainer);
    }
    return overlayContainer;
  }

  /**
   * Computes X/Twitter's weighted character count for a single code point.
   * Per Twitter's v3 character weight spec:
   * - Code points in 0x0000 - 0x10FF, 0x2000 - 0x200D, 0x2010 - 0x201F, 0x2032 - 0x2037 have weight 1
   * - Everything else (CJK, emojis, etc.) has weight 2
   */
  function getCodePointWeight(cp) {
    if (!settings.weightedCounting) return 1;
    if (
      (cp >= 0x0000 && cp <= 0x10ff) ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037)
    ) {
      return 1;
    }
    return 2;
  }

  /**
   * Extracts ordered text segments (text nodes + synthetic newline markers between Draft.js blocks)
   * from a Twitter Draft.js editor element.
   */
  function extractEditorSegments(editorEl) {
    const blocks = editorEl.querySelectorAll('[data-block="true"]');
    const segments = [];

    if (blocks.length > 0) {
      blocks.forEach((block, blockIdx) => {
        if (blockIdx > 0) {
          segments.push({ type: 'newline', weight: 1 });
        }
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
          // Ignore placeholder text if any
          if (node.parentElement && node.parentElement.closest('.public-DraftEditorPlaceholder-root')) {
            continue;
          }
          // Draft.js uses <br data-text="true"> for empty blocks; text nodes have actual text
          if (node.nodeValue && node.nodeValue.length > 0) {
            segments.push({ type: 'text', node, text: node.nodeValue });
          }
        }
      });
    } else {
      const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement && node.parentElement.closest('.public-DraftEditorPlaceholder-root')) {
          continue;
        }
        if (node.nodeValue && node.nodeValue.length > 0) {
          segments.push({ type: 'text', node, text: node.nodeValue });
        }
      }
    }

    return segments;
  }

  /**
   * Computes total weighted length and finds the exact DOM { node, offset } where
   * the untrimmed limit is exceeded, plus all DOM Ranges for the trimmed overflow text.
   */
  function analyzeEditorText(editorEl) {
    const segments = extractEditorSegments(editorEl);
    const limit = Number(settings.limit) || 280;

    // Concatenate full text first to detect URLs if weightedCounting is enabled
    let fullText = '';
    for (const seg of segments) {
      fullText += seg.type === 'newline' ? '\n' : seg.text;
    }

    // Detect URLs (http:// or https://) so we can weight them as 23 chars like Twitter's t.co wrapper
    const urlRanges = [];
    if (settings.weightedCounting) {
      const urlRegex = /https?:\/\/[^\s]+/gi;
      let match;
      while ((match = urlRegex.exec(fullText)) !== null) {
        urlRanges.push({
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    let totalWeight = 0;
    let globalUTF16Index = 0;
    let cutoffPoint = null; // { node, offset }
    const overflowRanges = [];

    for (const seg of segments) {
      if (seg.type === 'newline') {
        totalWeight += 1;
        globalUTF16Index += 1;
        continue;
      }

      const { node, text } = seg;
      let i = 0;
      let overflowStartOffsetInNode = totalWeight > limit ? 0 : null;

      while (i < text.length) {
        const absIdx = globalUTF16Index + i;
        const activeUrl = urlRanges.find((u) => absIdx >= u.start && absIdx < u.end);

        let stepUTF16 = 1;
        let stepWeight = 1;

        if (activeUrl) {
          // If at the start of URL, add 23 weight once; inside the URL, weight is 0
          if (absIdx === activeUrl.start) {
            stepWeight = 23;
          } else {
            stepWeight = 0;
          }
          stepUTF16 = 1;
        } else {
          const cp = text.codePointAt(i);
          stepUTF16 = cp > 0xffff ? 2 : 1;
          stepWeight = getCodePointWeight(cp);
        }

        if (totalWeight + stepWeight > limit && overflowStartOffsetInNode === null) {
          overflowStartOffsetInNode = i;
          if (!cutoffPoint) {
            cutoffPoint = { node, offset: i };
          }
        }

        totalWeight += stepWeight;
        i += stepUTF16;
      }

      if (overflowStartOffsetInNode !== null && overflowStartOffsetInNode < text.length) {
        const range = document.createRange();
        range.setStart(node, overflowStartOffsetInNode);
        range.setEnd(node, text.length);
        overflowRanges.push(range);
      }

      globalUTF16Index += text.length;
    }

    return {
      totalWeight,
      limit,
      cutoffPoint,
      overflowRanges
    };
  }

  function updateBadge(editorEl, totalWeight, limit) {
    // Find the composer container (either modal dialog or inline composer)
    const composerRoot =
      editorEl.closest('[role="dialog"]') ||
      editorEl.closest('[data-testid="toolBar"]')?.parentElement?.parentElement ||
      editorEl.closest('[data-testid^="tweetTextarea_"]')?.parentElement?.parentElement ||
      editorEl.parentElement;

    if (!composerRoot) return;

    let badge = composerRoot.querySelector('.x-trim-counter-badge');
    if (!settings.showBadge || totalWeight === 0) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'x-trim-counter-badge';
      const dot = document.createElement('span');
      dot.className = 'x-trim-counter-dot';
      const textSpan = document.createElement('span');
      textSpan.className = 'x-trim-counter-text';
      badge.appendChild(dot);
      badge.appendChild(textSpan);
    }

    // Prefer inserting inside the bottom toolbar right next to the progress gauge / Post button,
    // or right above the toolbar so media attachments never overlap it.
    const toolBar = composerRoot.querySelector('[data-testid="toolBar"]');
    if (toolBar && toolBar.parentElement) {
      if (badge.parentElement !== toolBar.parentElement || badge.nextElementSibling !== toolBar) {
        toolBar.parentElement.insertBefore(badge, toolBar);
      }
    } else {
      const textareaWrapper = editorEl.closest('[data-testid^="tweetTextarea_"]') || editorEl;
      if (textareaWrapper.parentElement && badge.parentElement !== textareaWrapper.parentElement) {
        textareaWrapper.parentElement.insertBefore(badge, textareaWrapper.nextSibling);
      }
    }

    const remaining = limit - totalWeight;
    let status = 'safe';
    let label = '';

    if (remaining >= 0) {
      status = remaining <= 20 ? 'near' : 'safe';
      label = `${totalWeight} / ${limit} (${remaining} left before "Show more")`;
    } else {
      status = 'over';
      label = `${totalWeight} / ${limit} (+${Math.abs(remaining)} trimmed behind "Show more")`;
    }

    badge.setAttribute('data-status', status);
    const textEl = badge.querySelector('.x-trim-counter-text');
    if (textEl) {
      textEl.textContent = label;
    }
  }

  function renderHighlights(editorEl) {
    const container = ensureOverlayContainer();
    container.replaceChildren();

    if (!editorEl || !document.body.contains(editorEl)) {
      if (typeof CSS !== 'undefined' && CSS.highlights) {
        CSS.highlights.delete('x-trimmed-overflow');
      }
      return;
    }

    const { totalWeight, limit, cutoffPoint, overflowRanges } = analyzeEditorText(editorEl);
    updateBadge(editorEl, totalWeight, limit);

    // 1. Native CSS Custom Highlight API (Firefox 140+)
    const supportsCssHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
    if (supportsCssHighlights) {
      if (overflowRanges.length > 0) {
        const highlight = new Highlight(...overflowRanges);
        CSS.highlights.set('x-trimmed-overflow', highlight);
      } else {
        CSS.highlights.delete('x-trimmed-overflow');
      }
    }

    // 2. Render floating rectangles (if CSS Custom Highlight API is unsupported)
    if (overflowRanges.length > 0 && !supportsCssHighlights) {
      for (const range of overflowRanges) {
        const rects = range.getClientRects();
        for (const rect of rects) {
          if (rect.width === 0 || rect.height === 0) continue;
          const box = document.createElement('div');
          box.className = 'x-trim-rect';
          box.style.top = `${rect.top}px`;
          box.style.left = `${rect.left}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          container.appendChild(box);
        }
      }
    }
  }

  function findActiveEditor() {
    // Look for focused or visible Twitter composer editor
    const editors = document.querySelectorAll(
      '[data-testid^="tweetTextarea_"][contenteditable="true"], .public-DraftEditor-content[contenteditable="true"]'
    );
    if (editors.length === 0) return null;

    // Prefer the one containing active selection or most text
    const activeEl = document.activeElement;
    for (const ed of editors) {
      if (ed === activeEl || ed.contains(activeEl)) {
        return ed;
      }
    }
    return editors[0];
  }

  function scheduleUpdate() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      activeEditor = findActiveEditor();
      renderHighlights(activeEditor);
    });
  }

  // Listen for input, keyup, scroll, resize, selection changes, and DOM mutations
  document.addEventListener('input', scheduleUpdate, true);
  document.addEventListener('keyup', scheduleUpdate, true);
  document.addEventListener('mouseup', scheduleUpdate, true);
  window.addEventListener('scroll', scheduleUpdate, true);
  window.addEventListener('resize', scheduleUpdate, true);

  const observer = new MutationObserver(() => {
    scheduleUpdate();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  scheduleUpdate();
})();
