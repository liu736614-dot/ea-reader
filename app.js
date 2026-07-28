// EA阅读器 app.js — v3 书架(多本书) / 智能分章 / 目录 / 多编码识别 / 批注往返
var PARAGRAPHS_PER_PAGE = 12;

// ─── 全局状态 ────────────────────────────────────
var library      = {};   // { slug: { title, chapters, comments, notes, currentChapter, currentPage, lastExportedTimestamp, addedAt } }
var currentSlug  = null;
var fontSize     = 18;
var pendingSelection = null; // { paraIdx, text }
var selDebounceTimer = null;

function curBook() { return currentSlug ? library[currentSlug] : null; }

// ─── 初始化 ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    loadFromStorage();
    initUpload();
    initButtons();
    initSelectionListener();
    renderShelf();
});

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
    document.getElementById('tocOverlay').addEventListener('click', function(e) { if (e.target === this) closeToc(); });
    document.getElementById('homeBtn').addEventListener('click', goShelf);

    document.getElementById('prevBtnBottom').addEventListener('click', prevPage);
    document.getElementById('nextBtnBottom').addEventListener('click', nextPage);

    document.getElementById('commentOverlay').addEventListener('click', function(e) { if (e.target === this) closeCommentModal(); });
    document.getElementById('importOverlay').addEventListener('click', function(e) { if (e.target === this) closeImportModal(); });
    document.getElementById('noteOverlay').addEventListener('click', function(e) { if (e.target === this) closeNoteModal(); });

    document.getElementById('addBookBtn').addEventListener('click', function() { document.getElementById('fileInput').click(); });
}

// ─── 上传 ────────────────────────────────────────
function initUpload() {
    var fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) loadBookFile(e.target.files[0]);
        fileInput.value = '';
    });

    var shelf = document.getElementById('shelfScreen');
    shelf.addEventListener('dragover', function(e) { e.preventDefault(); shelf.classList.add('dragover'); });
    shelf.addEventListener('dragleave', function() { shelf.classList.remove('dragover'); });
    shelf.addEventListener('drop', function(e) {
        e.preventDefault();
        shelf.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) loadBookFile(e.dataTransfer.files[0]);
    });
}

function loadBookFile(file) {
    if (file.name.slice(-4).toLowerCase() !== '.txt') { alert('请上传 TXT 格式的文件！'); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
        var text = decodeBookText(e.target.result);
        addBookToLibrary(text, file.name);
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
        try { return new TextDecoder(tryOrder[i], { fatal: true }).decode(buffer); }
        catch (e) { /* 换下一种编码再试 */ }
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
    if (chapters.length < 2) return fallbackSplit(lines);
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

function slugify(title) {
    var base = title.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '') || 'book';
    var slug = base;
    var n = 1;
    while (library[slug]) { slug = base + '_' + (++n); }
    return slug;
}

function addBookToLibrary(text, filename) {
    var title    = filename.replace(/\.txt$/i, '');
    var chapters = splitChapters(text);
    if (chapters.length === 0 || chapters.every(function(c) { return c.paragraphs.length === 0; })) {
        alert('文件内容为空或格式不正确！');
        return;
    }
    var slug = slugify(title);
    library[slug] = {
        title: title, chapters: chapters, comments: {}, notes: {},
        currentChapter: 0, currentPage: 1, lastExportedTimestamp: null,
        addedAt: new Date().toISOString()
    };
    saveToStorage();
    enterBook(slug);
}

// ─── 书架 ────────────────────────────────────────
function renderShelf() {
    var slugs = Object.keys(library);
    var grid  = document.getElementById('shelfGrid');
    var empty = document.getElementById('shelfEmpty');

    if (slugs.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    slugs.sort(function(a, b) { return new Date(library[b].addedAt) - new Date(library[a].addedAt); });

    var html = '';
    slugs.forEach(function(slug) {
        var b = library[slug];
        var totalCh = b.chapters.length;
        var progressPct = totalCh > 1 ? Math.round(((b.currentChapter) / totalCh) * 100) : 0;
        var contLabel = (b.currentChapter > 0 || b.currentPage > 1)
            ? '继续读 · 第' + (b.currentChapter + 1) + '章'
            : '开始读';
        html += '<div class="book-card" data-slug="' + slug + '">'
              + '<div class="bc-title">' + escHtml(b.title) + '</div>'
              + '<div class="bc-meta">' + totalCh + ' 章 · ' + b.addedAt.slice(0, 10) + '</div>'
              + '<div class="bc-progress-track"><div class="bc-progress-fill" style="width:' + progressPct + '%"></div></div>'
              + '<div class="bc-actions">'
              + '<button class="bc-btn primary" data-act="open" data-slug="' + slug + '">' + contLabel + '</button>'
              + '<button class="bc-btn danger" data-act="del" data-slug="' + slug + '">删除</button>'
              + '</div></div>';
    });
    grid.innerHTML = html;

    var buttons = grid.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener('click', function() {
            var slug = this.getAttribute('data-slug');
            var act  = this.getAttribute('data-act');
            if (act === 'open') enterBook(slug);
            else if (act === 'del') deleteBook(slug);
        });
    }
}

function deleteBook(slug) {
    var b = library[slug];
    if (!b) return;
    if (!confirm('确定要删除《' + b.title + '》吗？批注也会一起删掉哦')) return;
    delete library[slug];
    saveToStorage();
    renderShelf();
}

function enterBook(slug) {
    if (!library[slug]) return;
    currentSlug = slug;
    document.getElementById('shelfScreen').style.display   = 'none';
    document.getElementById('readerScreen').style.display  = 'block';
    document.getElementById('controls').style.display      = 'flex';
    document.getElementById('bottomNav').classList.add('show');
    document.getElementById('tocBtn').style.display   = 'inline-flex';
    document.getElementById('homeBtn').style.display  = 'inline-flex';
    renderPage();
    saveToStorage();
}

function goShelf() {
    currentSlug = null;
    document.getElementById('readerScreen').style.display = 'none';
    document.getElementById('shelfScreen').style.display   = 'block';
    document.getElementById('controls').style.display      = 'none';
    document.getElementById('bottomNav').classList.remove('show');
    document.getElementById('tocBtn').style.display   = 'none';
    document.getElementById('homeBtn').style.display  = 'none';
    renderShelf();
}

// ─── 渲染阅读页 ───────────────────────────────────
function totalPagesInChapter(ci) {
    var b = curBook();
    var chapter = b && b.chapters[ci];
    if (!chapter) return 1;
    return Math.max(1, Math.ceil(chapter.paragraphs.length / PARAGRAPHS_PER_PAGE));
}

function renderPage() {
    var b = curBook();
    if (!b) return;
    var chapter = b.chapters[b.currentChapter];
    if (!chapter) return;

    var totalP = totalPagesInChapter(b.currentChapter);
    if (b.currentPage > totalP) b.currentPage = totalP;
    if (b.currentPage < 1) b.currentPage = 1;

    var start = (b.currentPage - 1) * PARAGRAPHS_PER_PAGE;
    var end   = start + PARAGRAPHS_PER_PAGE;
    var slice = chapter.paragraphs.slice(start, end);

    var html = '<div class="book-title">' + escHtml(b.title) + '</div>';
    if (chapter.title) html += '<div class="chapter-title">' + escHtml(chapter.title) + '</div>';

    var note = b.notes[b.currentChapter];
    if (note) {
        html += '<div class="chapter-note">📝 <span class="note-label">剧情笔记</span><div class="note-text">' + escHtml(note) + '</div></div>';
    }

    slice.forEach(function(text, idx) {
        var pi     = start + idx;
        var key    = b.currentChapter + '_' + pi;
        var hasCmt = b.comments[key] && b.comments[key].length > 0;
        var paraHtml = escHtml(text);

        if (hasCmt) {
            b.comments[key].forEach(function(c) {
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
            b.comments[key].forEach(function(c) {
                var quote = c.selectedText ? '<div class="comment-quote">\u201c' + escHtml(c.selectedText) + '\u201d</div>' : '';
                var author = c.author === 'elena' ? '\ud83d\udc97 Elena' : '\ud83d\udc99 Ash';
                html += '<div class="comment ' + c.author + '">'
                      + '<div class="comment-author">' + author + '</div>' + quote
                      + '<div class="comment-text">' + escHtml(c.text) + '</div></div>';
            });
            html += '</div>';
        }
        html += '</div>';
    });

    document.getElementById('content').innerHTML = html;
    updateNav();
}

function updateNav() {
    var b = curBook();
    if (!b) return;
    var totalP = totalPagesInChapter(b.currentChapter);
    var pib = document.getElementById('pageInfoBottom');
    var prv = document.getElementById('prevBtnBottom');
    var nxt = document.getElementById('nextBtnBottom');
    if (pib) pib.textContent = (b.currentChapter + 1) + '章 · ' + b.currentPage + '/' + totalP;
    if (prv) prv.disabled = (b.currentChapter === 0 && b.currentPage === 1);
    if (nxt) nxt.disabled = (b.currentChapter === b.chapters.length - 1 && b.currentPage === totalP);

    var bar = document.getElementById('progressFill');
    if (bar && b.chapters.length > 0) {
        var pct = ((b.currentChapter + (b.currentPage / totalP)) / b.chapters.length) * 100;
        bar.style.width = Math.min(100, pct) + '%';
    }
}

// ─── 目录 ────────────────────────────────────────
function openToc() {
    renderToc();
    document.getElementById('tocOverlay').classList.add('show');
}
function closeToc() { document.getElementById('tocOverlay').classList.remove('show'); }

function renderToc() {
    var b = curBook();
    var list = document.getElementById('tocList');
    if (!list || !b) return;
    var html = '';
    b.chapters.forEach(function(c, i) {
        var active = (i === b.currentChapter) ? ' active' : '';
        html += '<div class="toc-item' + active + '" data-chapter="' + i + '">'
              + (c.title ? escHtml(c.title) : ('第 ' + (i + 1) + ' 部分')) + '</div>';
    });
    list.innerHTML = html;
    var items = list.querySelectorAll('.toc-item');
    for (var i = 0; i < items.length; i++) {
        items[i].addEventListener('click', function() {
            var b2 = curBook();
            b2.currentChapter = parseInt(this.getAttribute('data-chapter'), 10);
            b2.currentPage = 1;
            saveToStorage();
            renderPage();
            closeToc();
            window.scrollTo(0, 0);
        });
    }
}

// ─── 剧情笔记（手动粘贴） ──────────────────────────
function openNoteModal() {
    var b = curBook();
    if (!b) return;
    document.getElementById('noteInput').value = b.notes[b.currentChapter] || '';
    document.getElementById('noteOverlay').classList.add('show');
}
function closeNoteModal() { document.getElementById('noteOverlay').classList.remove('show'); }
function saveNote() {
    var b = curBook();
    if (!b) return;
    var text = document.getElementById('noteInput').value.trim();
    if (text) b.notes[b.currentChapter] = text;
    else delete b.notes[b.currentChapter];
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
    if (!curBook()) return;
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

    pendingSelection = { paraIdx: parseInt(paraEl.getAttribute('data-para'), 10), text: text };

    var rect = range.getBoundingClientRect();
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
    document.getElementById('modalQuote').textContent = pendingSelection.text;
    document.getElementById('commentInput').value = '';
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
    var b = curBook();
    var text = document.getElementById('commentInput').value.trim();
    if (!text) { alert('请输入批注内容！'); return; }
    if (!pendingSelection || !b) return;

    var key = b.currentChapter + '_' + pendingSelection.paraIdx;
    if (!b.comments[key]) b.comments[key] = [];
    b.comments[key].push({ selectedText: pendingSelection.text, text: text, author: 'elena', timestamp: new Date().toISOString() });

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
    var b = curBook();
    if (!b) return;
    var raw = document.getElementById('importInput').value.trim();
    if (!raw) { alert('先把 Ash 给你的 JSON 粘贴进来呀！'); return; }

    var list;
    try { list = JSON.parse(raw); }
    catch (e) { alert('格式不太对，需要是 [{"chapter":0,"index":4,"text":".."}] 这样的 JSON 数组哦'); return; }
    if (!Array.isArray(list) || list.length === 0) { alert('没有解析到有效的回复内容'); return; }

    var added = 0;
    list.forEach(function(item) {
        if (typeof item.index !== 'number' || !item.text) return;
        var ci  = typeof item.chapter === 'number' ? item.chapter : b.currentChapter;
        var key = ci + '_' + item.index;
        if (!b.comments[key]) b.comments[key] = [];
        b.comments[key].push({ selectedText: item.selectedText || '', text: item.text, author: 'ash', timestamp: new Date().toISOString() });
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
    var b = curBook();
    if (!b) return;
    if (b.currentPage > 1) b.currentPage--;
    else if (b.currentChapter > 0) { b.currentChapter--; b.currentPage = totalPagesInChapter(b.currentChapter); }
    else return;
    clearSel(); renderPage(); saveToStorage(); window.scrollTo(0, 0);
}

function nextPage() {
    var b = curBook();
    if (!b) return;
    var totalP = totalPagesInChapter(b.currentChapter);
    if (b.currentPage < totalP) b.currentPage++;
    else if (b.currentChapter < b.chapters.length - 1) { b.currentChapter++; b.currentPage = 1; }
    else return;
    clearSel(); renderPage(); saveToStorage(); window.scrollTo(0, 0);
}

document.addEventListener('keydown', function(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (!curBook()) return;
    if (e.key === 'ArrowLeft')  prevPage();
    if (e.key === 'ArrowRight') nextPage();
});

// ─── 字号 ────────────────────────────────────────
function increaseFontSize() { if (fontSize < 28) { fontSize += 2; applyFontSize(); saveToStorage(); } }
function decreaseFontSize() { if (fontSize > 12) { fontSize -= 2; applyFontSize(); saveToStorage(); } }
function applyFontSize() {
    document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
    var els = document.querySelectorAll('.paragraph-text');
    for (var i = 0; i < els.length; i++) els[i].style.fontSize = fontSize + 'px';
}

// ─── 存储 ────────────────────────────────────────
function loadFromStorage() {
    try {
        var raw = localStorage.getItem('ea_reader_library_v3');
        if (!raw) { loadLegacyStorage(); return; }
        var d = JSON.parse(raw);
        library     = d.library || {};
        fontSize    = d.fontSize || 18;
        document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
    } catch(e) { console.error('加载失败', e); }
}

// 兼容旧版本数据（v1 单章平铺 / v2 单本书），迁移进书架，避免升级后丢失内容
function loadLegacyStorage() {
    try {
        var raw2 = localStorage.getItem('ea_reader_data_v2');
        if (raw2) {
            var d2 = JSON.parse(raw2);
            if (d2.book && d2.book.chapters && d2.book.chapters.length > 0) {
                var slug = slugify(d2.book.title || '旧书');
                library[slug] = {
                    title: d2.book.title || '旧书', chapters: d2.book.chapters,
                    comments: d2.comments || {}, notes: d2.notes || {},
                    currentChapter: d2.currentChapter || 0, currentPage: d2.currentPage || 1,
                    lastExportedTimestamp: d2.lastExportedTimestamp || null,
                    addedAt: new Date().toISOString()
                };
                fontSize = d2.fontSize || 18;
                document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
                saveToStorage();
                return;
            }
        }
        var raw1 = localStorage.getItem('ea_reader_data');
        if (raw1) {
            var d1 = JSON.parse(raw1);
            if (d1.paragraphs && d1.paragraphs.length > 0) {
                var oldComments = {};
                Object.keys(d1.comments || {}).forEach(function(k) { oldComments['0_' + k] = d1.comments[k]; });
                var slug1 = slugify(d1.bookTitle || '旧书');
                library[slug1] = {
                    title: d1.bookTitle || '旧书',
                    chapters: [{ title: '', paragraphs: d1.paragraphs }],
                    comments: oldComments, notes: {},
                    currentChapter: 0, currentPage: d1.currentPage || 1,
                    lastExportedTimestamp: null, addedAt: new Date().toISOString()
                };
                fontSize = d1.fontSize || 18;
                document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
                saveToStorage();
            }
        }
    } catch(e) { console.error('旧数据迁移失败', e); }
}

function saveToStorage() {
    try {
        localStorage.setItem('ea_reader_library_v3', JSON.stringify({
            library: library, fontSize: fontSize, savedAt: new Date().toISOString()
        }));
    } catch(e) {
        console.error('保存失败', e);
        alert('保存失败，可能是存储空间不足！');
    }
}

// ─── 导出 ────────────────────────────────────────
function exportComments() {
    var b = curBook();
    if (!b) return;
    var list = [];
    Object.keys(b.comments).forEach(function(key) {
        var parts = key.split('_');
        var ci = parseInt(parts[0], 10);
        var pi = parseInt(parts[1], 10);
        b.comments[key].forEach(function(c) {
            if (c.author === 'elena') {
                if (!b.lastExportedTimestamp || new Date(c.timestamp) > new Date(b.lastExportedTimestamp)) {
                    list.push({ chapter: ci, index: pi, selectedText: c.selectedText, text: c.text, timestamp: c.timestamp });
                }
            }
        });
    });

    if (list.length === 0) { alert('没有新批注需要导出！'); return; }
    list.sort(function(a, b2) { return a.chapter - b2.chapter || a.index - b2.index; });

    var now = new Date();
    var dateStr = now.toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    var out = '\u300a' + b.title + '\u300b\u6279\u6ce8\u5bfc\u51fa\n\u5bfc\u51fa\u65f6\u95f4\uff1a' + dateStr + '\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';

    list.forEach(function(item) {
        var t = new Date(item.timestamp).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        var chapterTitle = (b.chapters[item.chapter] && b.chapters[item.chapter].title) || ('第' + (item.chapter + 1) + '部分');
        out += chapterTitle + ' \u00b7 \u6bb5\u843d ' + (item.index + 1) + '\uff08chapter:' + item.chapter + ', index:' + item.index + '\uff09\n';
        if (item.selectedText) out += '\u539f\u6587\uff1a\u201c' + item.selectedText + '\u201d\n\n';
        out += '\ud83d\udc97 Elena\uff08' + t + '\uff09\uff1a\n' + item.text + '\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';
    });
    out += '\u5171 ' + list.length + ' \u6761\u65b0\u6279\u6ce8';

    var finish = function() {
        b.lastExportedTimestamp = now.toISOString();
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
