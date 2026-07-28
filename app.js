// EA阅读器 app.js — v2 支持智能分章 / 目录 / 多编码识别
// ─── 全局状态 ────────────────────────────────────
var book              = { title: '', chapters: [] }; // chapters: [{title, paragraphs:[...]}]
var currentChapter    = 0;
var currentPage       = 1;
var paragraphsPerPage = 12;
var fontSize          = 18;
var comments          = {};  // { "chapterIdx_paraIdx": [{selectedText, text, author, timestamp}] }
var notes             = {};  // { chapterIdx: "剧情笔记文字" }
var lastExportedTimestamp = null;
var pendingSelection  = null; // { chapterIdx, paraIdx, text }
var selDebounceTimer  = null;

// ─── 初始化 ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    loadFromStorage();
    initUpload();
    initButtons();
    initSelectionListener();
});

// ─── 按钮绑定 ─────────────────────────────────────
function initButtons() {
    document.getElementById('annotateBtn').addEventListener('mousedown',  function(e) { e.preventDefault(); openCommentModal(); });
    document.getElementById('annotateBtn').addEventListener('touchstart', function(e) { e.preventDefault(); openCommentModal(); }, { passive: false });

    document.getElementById('cancelSelBtn').addEventListener('mousedown',  function(e) { e.preventDefault(); clearSel(); });
    document.getElementById('cancelSelBtn').addEventListener('touchstart', function(e) { e.preventDefault(); clearSel(); }, { passive: false });

    document.getElementById('saveBtn').addEventListener('click', saveComment);
    document.getElementById('cancelModalBtn').addEventListener('click', closeCommentModal);

    document.getElementById('exportBtn').addEventListener('click', exportComments);
    document.getElementById('importBtn').addEventListener('click', openImportModal);
    document.getElementById('importSaveBtn').addEventListener('click', importAshReplies);
    document.getElementById('importCancelBtn').addEventListener('click', closeImportModal);

    document.getElementById('noteBtn').addEventListener('click', openNoteModal);
    document.getElementById('noteSaveBtn').addEventListener('click', saveNote);
    document.getElementById('noteCancelBtn').addEventListener('click', closeNoteModal);

    document.getElementById('tocBtn').addEventListener('click', openToc);
    document.getElementById('tocOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeToc();
    });

    document.getElementById('prevBtnBottom').addEventListener('click', prevPage);
    document.getElementById('nextBtnBottom').addEventListener('click', nextPage);

    document.getElementById('commentOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeCommentModal();
    });
    document.getElementById('importOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeImportModal();
    });
    document.getElementById('noteOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeNoteModal();
    });
}

// ─── 上传 ────────────────────────────────────────
function initUpload() {
    var uploadArea = document.getElementById('uploadArea');
    var fileInput  = document.getElementById('fileInput');

    uploadArea.addEventListener('click', function() { fileInput.click(); });
    fileInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) loadBook(e.target.files[0]);
    });
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', function() { uploadArea.classList.remove('dragover'); });
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) loadBook(e.dataTransfer.files[0]);
    });
}

function loadBook(file) {
    if (file.name.slice(-4).toLowerCase() !== '.txt') {
        alert('请上传 TXT 格式的文件！');
        return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
        var text = decodeBookText(e.target.result);
        processBook(text, file.name);
    };
    reader.onerror = function() { alert('文件读取失败，请重试！'); };
    reader.readAsArrayBuffer(file);
}

// ─── 多编码识别：UTF-8 / GB18030(兼容GBK) / Big5 / UTF-16 ──
function decodeBookText(buffer) {
    var bytes = new Uint8Array(buffer);

    if (bytes.length >= 2) {
        if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(buffer);
        if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(buffer);
    }
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(buffer);
    }

    var tryOrder = ['utf-8', 'gb18030', 'big5'];
    for (var i = 0; i < tryOrder.length; i++) {
        try {
            var dec = new TextDecoder(tryOrder[i], { fatal: true });
            return dec.decode(buffer);
        } catch (e) { /* 换下一种编码再试 */ }
    }
    return new TextDecoder('utf-8').decode(buffer);
}

// ─── 智能拆章 ─────────────────────────────────────
var CHAPTER_HEADING_RE = /^\s*(第[0-9零〇一二两三四五六七八九十百千万]+[章节回卷集部篇]|序章|序言|楔子|引子|尾声|终章|后记|番外[一二三四五六七八九十0-9]*|Chapter\s*\d+)/;

function splitChapters(text) {
    var lines = text.split(/\r\n|\r|\n/);
    var chapters = [];
    var current  = null;

    lines.forEach(function(line) {
        var t = line.trim();
        if (!t) return;
        if (CHAPTER_HEADING_RE.test(t) && t.length < 40) {
            current = { title: t, paragraphs: [] };
            chapters.push(current);
        } else {
            if (!current) { current = { title: '', paragraphs: [] }; chapters.push(current); }
            current.paragraphs.push(t);
        }
    });

    if (chapters.length < 2) {
        return fallbackSplit(lines);
    }
    return chapters;
}

function fallbackSplit(lines) {
    var paras = lines.map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    var perChunk = 60;
    var chapters = [];
    for (var i = 0; i < paras.length; i += perChunk) {
        chapters.push({ title: '第 ' + (chapters.length + 1) + ' 部分', paragraphs: paras.slice(i, i + perChunk) });
    }
    if (chapters.length === 0) chapters.push({ title: '', paragraphs: [] });
    return chapters;
}

function processBook(text, filename) {
    var title    = filename.replace(/\.txt$/i, '');
    var chapters = splitChapters(text);

    if (chapters.length === 0 || chapters.every(function(c) { return c.paragraphs.length === 0; })) {
        alert('文件内容为空或格式不正确！');
        return;
    }

    book            = { title: title, chapters: chapters };
    currentChapter  = 0;
    currentPage     = 1;
    comments        = {};
    notes           = {};
    saveToStorage();
    showBook();
}

// ─── 渲染 ────────────────────────────────────────
function showBook() {
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('controls').style.display      = 'flex';
    document.getElementById('bottomNav').classList.add('show');
    document.getElementById('tocBtn').style.display = 'inline-flex';
    renderPage();
}

function totalPagesInChapter(ci) {
    var chapter = book.chapters[ci];
    if (!chapter) return 1;
    return Math.max(1, Math.ceil(chapter.paragraphs.length / paragraphsPerPage));
}

function renderPage() {
    var chapter = book.chapters[currentChapter];
    if (!chapter) return;

    var totalP = totalPagesInChapter(currentChapter);
    if (currentPage > totalP) currentPage = totalP;
    if (currentPage < 1) currentPage = 1;

    var start = (currentPage - 1) * paragraphsPerPage;
    var end   = start + paragraphsPerPage;
    var slice = chapter.paragraphs.slice(start, end);

    var html = '<div class="book-title">' + escHtml(book.title) + '</div>';
    if (chapter.title) html += '<div class="chapter-title">' + escHtml(chapter.title) + '</div>';

    var note = notes[currentChapter];
    if (note) {
        html += '<div class="chapter-note">📝 <span class="note-label">剧情笔记</span><div class="note-text">' + escHtml(note) + '</div></div>';
    }

    slice.forEach(function(text, idx) {
        var pi       = start + idx;
        var key      = currentChapter + '_' + pi;
        var hasCmt   = comments[key] && comments[key].length > 0;
        var paraHtml = escHtml(text);

        if (hasCmt) {
            comments[key].forEach(function(c) {
                if (c.selectedText) {
                    var esc = escHtml(c.selectedText);
                    paraHtml = paraHtml.replace(esc, '<mark class="ea-hi">' + esc + '</mark>');
                }
            });
        }

        html += '<div class="paragraph' + (hasCmt ? ' has-comment' : '') + '" data-para="' + pi + '">';
        html += '<div class="paragraph-text" style="font-size:' + fontSize + 'px">' + paraHtml + '</div>';

        if (hasCmt) {
            html += '<div class="comments">';
            comments[key].forEach(function(c) {
                var quote = c.selectedText
                    ? '<div class="comment-quote">\u201c' + escHtml(c.selectedText) + '\u201d</div>' : '';
                var author = c.author === 'elena' ? '\ud83d\udc97 Elena' : '\ud83d\udc99 Ash';
                html += '<div class="comment ' + c.author + '">'
                      + '<div class="comment-author">' + author + '</div>'
                      + quote
                      + '<div class="comment-text">' + escHtml(c.text) + '</div>'
                      + '</div>';
            });
            html += '</div>';
        }

        html += '</div>';
    });

    document.getElementById('content').innerHTML = html;
    updateNav();
    renderToc();
}

function updateNav() {
    var totalP = totalPagesInChapter(currentChapter);
    var pib = document.getElementById('pageInfoBottom');
    var prv = document.getElementById('prevBtnBottom');
    var nxt = document.getElementById('nextBtnBottom');
    if (pib) pib.textContent = (currentChapter + 1) + '章 · ' + currentPage + '/' + totalP;
    if (prv) prv.disabled = (currentChapter === 0 && currentPage === 1);
    if (nxt) nxt.disabled = (currentChapter === book.chapters.length - 1 && currentPage === totalP);

    var bar = document.getElementById('progressFill');
    if (bar && book.chapters.length > 0) {
        var pct = ((currentChapter + (currentPage / totalP)) / book.chapters.length) * 100;
        bar.style.width = Math.min(100, pct) + '%';
    }
}

// ─── 目录 ────────────────────────────────────────
function openToc() {
    renderToc();
    document.getElementById('tocOverlay').classList.add('show');
}
function closeToc() {
    document.getElementById('tocOverlay').classList.remove('show');
}
function renderToc() {
    var list = document.getElementById('tocList');
    if (!list || !book.chapters) return;
    var html = '';
    book.chapters.forEach(function(c, i) {
        var active = (i === currentChapter) ? ' active' : '';
        html += '<div class="toc-item' + active + '" data-chapter="' + i + '">'
              + (c.title ? escHtml(c.title) : ('第 ' + (i + 1) + ' 部分'))
              + '</div>';
    });
    list.innerHTML = html;
    var items = list.querySelectorAll('.toc-item');
    for (var i = 0; i < items.length; i++) {
        items[i].addEventListener('click', function() {
            currentChapter = parseInt(this.getAttribute('data-chapter'), 10);
            currentPage = 1;
            saveToStorage();
            renderPage();
            closeToc();
            window.scrollTo(0, 0);
        });
    }
}

// ─── 剧情笔记（手动粘贴） ──────────────────────────
function openNoteModal() {
    document.getElementById('noteInput').value = notes[currentChapter] || '';
    document.getElementById('noteOverlay').classList.add('show');
}
function closeNoteModal() {
    document.getElementById('noteOverlay').classList.remove('show');
}
function saveNote() {
    var text = document.getElementById('noteInput').value.trim();
    if (text) notes[currentChapter] = text;
    else delete notes[currentChapter];
    saveToStorage();
    closeNoteModal();
    renderPage();
}

// ─── 文字选取 & 浮动按钮 ──────────────────────────
function initSelectionListener() {
    document.addEventListener('selectionchange', function() {
        clearTimeout(selDebounceTimer);
        selDebounceTimer = setTimeout(handleSelectionChange, 400);
    });
}

function handleSelectionChange() {
    var overlay = document.getElementById('commentOverlay');
    if (overlay && overlay.classList.contains('show')) return;

    var sel  = window.getSelection ? window.getSelection() : null;
    var text = sel ? sel.toString().trim() : '';

    if (!text || text.length < 2) { hideSel(); return; }
    if (!sel.rangeCount) { hideSel(); return; }

    var range   = sel.getRangeAt(0);
    var content = document.getElementById('content');
    if (!content || !content.contains(range.commonAncestorContainer)) { hideSel(); return; }

    var startNode = range.startContainer;
    if (startNode.nodeType === 3) startNode = startNode.parentNode;
    var paraEl = closest(startNode, '.paragraph');

    if (!paraEl) {
        var anc = range.commonAncestorContainer;
        if (anc.nodeType === 3) anc = anc.parentNode;
        paraEl = closest(anc, '.paragraph');
    }
    if (!paraEl) { hideSel(); return; }

    pendingSelection = {
        chapterIdx : currentChapter,
        paraIdx    : parseInt(paraEl.getAttribute('data-para'), 10),
        text       : text
    };

    var rect     = range.getBoundingClientRect();
    var toolbarW = 130;
    var x = Math.max(toolbarW / 2 + 4, Math.min(rect.left + rect.width / 2, window.innerWidth - toolbarW / 2 - 4));
    var yBelow = rect.bottom + 14;
    var y = (yBelow + 52 < window.innerHeight - 60) ? yBelow : (rect.top - 52);
    y = Math.max(y, 10);

    showSel(x, y);
}

function showSel(x, y) {
    var tb = document.getElementById('selToolbar');
    tb.style.left = x + 'px';
    tb.style.top  = y + 'px';
    tb.classList.add('show');
}
function hideSel() { document.getElementById('selToolbar').classList.remove('show'); }
function clearSel() {
    pendingSelection = null;
    hideSel();
    try { if (window.getSelection) window.getSelection().removeAllRanges(); } catch(e) {}
}

function closest(el, selector) {
    if (!el) return null;
    if (el.closest) return el.closest(selector);
    var cur = el;
    while (cur && cur !== document) {
        if (cur.matches && cur.matches(selector)) return cur;
        if (cur.msMatchesSelector && cur.msMatchesSelector(selector)) return cur;
        cur = cur.parentNode;
    }
    return null;
}

// ─── 批注 Modal ───────────────────────────────────
function openCommentModal() {
    if (!pendingSelection) return;
    hideSel();
    document.getElementById('modalQuote').textContent  = pendingSelection.text;
    document.getElementById('commentInput').value      = '';
    document.getElementById('commentOverlay').classList.add('show');
    setTimeout(function() {
        var inp = document.getElementById('commentInput');
        if (inp) inp.focus();
    }, 250);
}
function closeCommentModal() {
    document.getElementById('commentOverlay').classList.remove('show');
    clearSel();
}

function saveComment() {
    var text = document.getElementById('commentInput').value.trim();
    if (!text) { alert('请输入批注内容！'); return; }
    if (!pendingSelection) return;

    var key = pendingSelection.chapterIdx + '_' + pendingSelection.paraIdx;
    if (!comments[key]) comments[key] = [];
    comments[key].push({
        selectedText : pendingSelection.text,
        text         : text,
        author       : 'elena',
        timestamp    : new Date().toISOString()
    });

    saveToStorage();
    closeCommentModal();
    renderPage();
}

// ─── 粘贴 Ash 回复 ─────────────────────────────────
function openImportModal() {
    document.getElementById('importInput').value = '';
    document.getElementById('importOverlay').classList.add('show');
    setTimeout(function() {
        var inp = document.getElementById('importInput');
        if (inp) inp.focus();
    }, 250);
}
function closeImportModal() { document.getElementById('importOverlay').classList.remove('show'); }

function importAshReplies() {
    var raw = document.getElementById('importInput').value.trim();
    if (!raw) { alert('先把 Ash 给你的 JSON 粘贴进来呀！'); return; }

    var list;
    try { list = JSON.parse(raw); }
    catch (e) {
        alert('格式不太对，需要是 [{"chapter":0,"index":4,"text":".."}] 这样的 JSON 数组哦');
        return;
    }
    if (!Array.isArray(list) || list.length === 0) { alert('没有解析到有效的回复内容'); return; }

    var added = 0;
    list.forEach(function(item) {
        if (typeof item.index !== 'number' || !item.text) return;
        var ci  = typeof item.chapter === 'number' ? item.chapter : currentChapter;
        var key = ci + '_' + item.index;
        if (!comments[key]) comments[key] = [];
        comments[key].push({
            selectedText : item.selectedText || '',
            text         : item.text,
            author       : 'ash',
            timestamp    : new Date().toISOString()
        });
        added++;
    });

    if (added === 0) { alert('没有解析到有效的回复内容，检查一下 chapter / index / text 字段'); return; }

    saveToStorage();
    closeImportModal();
    renderPage();
    alert('💙 已导入 ' + added + ' 条 Ash 的回复！');
}

// ─── 翻页（支持跨章连续翻） ─────────────────────────
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
    } else if (currentChapter > 0) {
        currentChapter--;
        currentPage = totalPagesInChapter(currentChapter);
    } else {
        return;
    }
    clearSel();
    renderPage();
    saveToStorage();
    window.scrollTo(0, 0);
}

function nextPage() {
    var totalP = totalPagesInChapter(currentChapter);
    if (currentPage < totalP) {
        currentPage++;
    } else if (currentChapter < book.chapters.length - 1) {
        currentChapter++;
        currentPage = 1;
    } else {
        return;
    }
    clearSel();
    renderPage();
    saveToStorage();
    window.scrollTo(0, 0);
}

document.addEventListener('keydown', function(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (e.key === 'ArrowLeft')  prevPage();
    if (e.key === 'ArrowRight') nextPage();
});

// ─── 字号 ────────────────────────────────────────
function increaseFontSize() {
    if (fontSize < 28) { fontSize += 2; applyFontSize(); saveToStorage(); }
}
function decreaseFontSize() {
    if (fontSize > 12) { fontSize -= 2; applyFontSize(); saveToStorage(); }
}
function applyFontSize() {
    document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
    var els = document.querySelectorAll('.paragraph-text');
    for (var i = 0; i < els.length; i++) els[i].style.fontSize = fontSize + 'px';
}

// ─── 存储 ────────────────────────────────────────
function loadFromStorage() {
    try {
        var raw = localStorage.getItem('ea_reader_data_v2');
        if (!raw) { loadLegacyStorage(); return; }
        var d = JSON.parse(raw);
        book                   = d.book || { title: '', chapters: [] };
        currentChapter         = d.currentChapter || 0;
        currentPage            = d.currentPage    || 1;
        comments               = d.comments       || {};
        notes                  = d.notes          || {};
        fontSize               = d.fontSize       || 18;
        lastExportedTimestamp  = d.lastExportedTimestamp || null;
        document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
        if (book.chapters && book.chapters.length > 0) showBook();
    } catch(e) { console.error('加载失败', e); }
}

// 兼容旧版本（v1 单章平铺格式）数据，避免升级后丢失之前的书和批注
function loadLegacyStorage() {
    try {
        var raw = localStorage.getItem('ea_reader_data');
        if (!raw) return;
        var d = JSON.parse(raw);
        if (!d.paragraphs || d.paragraphs.length === 0) return;

        book = { title: d.bookTitle || '', chapters: [{ title: '', paragraphs: d.paragraphs }] };
        comments = {};
        var oldComments = d.comments || {};
        Object.keys(oldComments).forEach(function(k) {
            comments['0_' + k] = oldComments[k];
        });
        fontSize = d.fontSize || 18;
        currentChapter = 0;
        currentPage = d.currentPage || 1;
        document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
        saveToStorage();
        showBook();
    } catch(e) { console.error('旧数据迁移失败', e); }
}

function saveToStorage() {
    try {
        localStorage.setItem('ea_reader_data_v2', JSON.stringify({
            book                  : book,
            currentChapter        : currentChapter,
            currentPage           : currentPage,
            comments              : comments,
            notes                 : notes,
            fontSize              : fontSize,
            lastExportedTimestamp : lastExportedTimestamp,
            savedAt               : new Date().toISOString()
        }));
    } catch(e) {
        console.error('保存失败', e);
        alert('保存失败，可能是存储空间不足！');
    }
}

// ─── 导出 ────────────────────────────────────────
function exportComments() {
    var list = [];
    Object.keys(comments).forEach(function(key) {
        var parts = key.split('_');
        var ci = parseInt(parts[0], 10);
        var pi = parseInt(parts[1], 10);
        comments[key].forEach(function(c) {
            if (c.author === 'elena') {
                if (!lastExportedTimestamp || new Date(c.timestamp) > new Date(lastExportedTimestamp)) {
                    list.push({ chapter: ci, index: pi, selectedText: c.selectedText, text: c.text, timestamp: c.timestamp });
                }
            }
        });
    });

    if (list.length === 0) { alert('没有新批注需要导出！'); return; }
    list.sort(function(a, b) { return a.chapter - b.chapter || a.index - b.index; });

    var now     = new Date();
    var dateStr = now.toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    var out     = '\u300a' + book.title + '\u300b\u6279\u6ce8\u5bfc\u51fa\n\u5bfc\u51fa\u65f6\u95f4\uff1a' + dateStr + '\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';

    list.forEach(function(item) {
        var t = new Date(item.timestamp).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        var chapterTitle = (book.chapters[item.chapter] && book.chapters[item.chapter].title) || ('第' + (item.chapter + 1) + '部分');
        out += chapterTitle + ' \u00b7 \u6bb5\u843d ' + (item.index + 1) + '\uff08chapter:' + item.chapter + ', index:' + item.index + '\uff09\n';
        if (item.selectedText) out += '\u539f\u6587\uff1a\u201c' + item.selectedText + '\u201d\n\n';
        out += '\ud83d\udc97 Elena\uff08' + t + '\uff09\uff1a\n' + item.text + '\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';
    });
    out += '\u5171 ' + list.length + ' \u6761\u65b0\u6279\u6ce8';

    var finish = function() {
        lastExportedTimestamp = now.toISOString();
        saveToStorage();
        alert('\u2705 \u6210\u529f\u590d\u5236 ' + list.length + ' \u6761\u65b0\u6279\u6ce8\uff01\n\n\u73b0\u5728\u53ef\u4ee5\u53d1\u7ed9Ash\u554a \ud83d\udc95');
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(out).then(finish).catch(function() { fallbackCopy(out, finish); });
    } else {
        fallbackCopy(out, finish);
    }
}

function fallbackCopy(text, callback) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); callback(); }
    catch(e) { alert('复制失败，请手动复制'); }
    document.body.removeChild(ta);
}

// ─── 工具 ────────────────────────────────────────
function escHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
