// EA阅读器 app.js
// ─── 全局状态 ────────────────────────────────────
var currentPage       = 1;
var totalPages        = 1;
var paragraphsPerPage = 20;
var allParagraphs     = [];
var fontSize          = 18;
var comments          = {};  // { paragraphIndex: [{selectedText, text, author, timestamp}] }
var bookTitle         = '';
var lastExportedTimestamp = null;
var pendingSelection  = null; // { text, paragraphIndex }
var selDebounceTimer  = null;

// ─── 初始化 ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    loadFromStorage();
    initUpload();
    initButtons();
    initSelectionListener();
});

// ─── 按钮绑定（全部在 JS 里绑，不用 inline onclick）───
function initButtons() {
    document.getElementById('annotateBtn').addEventListener('mousedown',  function(e) { e.preventDefault(); openCommentModal(); });
    document.getElementById('annotateBtn').addEventListener('touchstart', function(e) { e.preventDefault(); openCommentModal(); }, { passive: false });

    document.getElementById('cancelSelBtn').addEventListener('mousedown',  function(e) { e.preventDefault(); clearSel(); });
    document.getElementById('cancelSelBtn').addEventListener('touchstart', function(e) { e.preventDefault(); clearSel(); }, { passive: false });

    document.getElementById('saveBtn').addEventListener('click', saveComment);
    document.getElementById('cancelModalBtn').addEventListener('click', closeCommentModal);

    document.getElementById('exportBtn').addEventListener('click',    exportComments);
    document.getElementById('prevBtnBottom').addEventListener('click', prevPage);
    document.getElementById('nextBtnBottom').addEventListener('click', nextPage);

    // 点击 overlay 背景关闭
    document.getElementById('commentOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeCommentModal();
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
    reader.onload = function(e) { processBook(e.target.result, file.name); };
    reader.onerror = function() { alert('文件读取失败，请重试！'); };
    reader.readAsText(file, 'UTF-8');
}

function processBook(text, filename) {
    bookTitle     = filename.replace(/\.txt$/i, '');
    allParagraphs = text.split(/\n+/)
        .map(function(l) { return l.trim(); })
        .filter(function(l) { return l.length > 0 && !/^[.…\s\-—_=]+$/.test(l); });

    if (allParagraphs.length === 0) { alert('文件内容为空或格式不正确！'); return; }

    totalPages  = Math.ceil(allParagraphs.length / paragraphsPerPage);
    currentPage = 1;
    comments    = {};
    saveToStorage();
    showBook();
}

// ─── 渲染 ────────────────────────────────────────
function showBook() {
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('controls').style.display      = 'flex';
    document.getElementById('bottomNav').classList.add('show');
    renderPage();
}

function renderPage() {
    var start = (currentPage - 1) * paragraphsPerPage;
    var end   = start + paragraphsPerPage;
    var slice = allParagraphs.slice(start, end);
    var html  = '<div class="book-title">' + escHtml(bookTitle) + '</div>';

    slice.forEach(function(text, idx) {
        var gi         = start + idx;
        var hasCmt     = comments[gi] && comments[gi].length > 0;
        var paraHtml   = escHtml(text);

        // 高亮已批注的选段
        if (hasCmt) {
            comments[gi].forEach(function(c) {
                if (c.selectedText) {
                    var esc = escHtml(c.selectedText);
                    // 只替换第一次出现，防止重叠
                    paraHtml = paraHtml.replace(esc, '<mark class="ea-hi">' + esc + '</mark>');
                }
            });
        }

        html += '<div class="paragraph' + (hasCmt ? ' has-comment' : '') + '" data-index="' + gi + '">';
        html += '<div class="paragraph-text" style="font-size:' + fontSize + 'px">' + paraHtml + '</div>';

        if (hasCmt) {
            html += '<div class="comments">';
            comments[gi].forEach(function(c) {
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
}

function updateNav() {
    var pib = document.getElementById('pageInfoBottom');
    var prv = document.getElementById('prevBtnBottom');
    var nxt = document.getElementById('nextBtnBottom');
    if (pib) pib.textContent = currentPage + ' / ' + totalPages;
    if (prv) prv.disabled = (currentPage === 1);
    if (nxt) nxt.disabled = (currentPage === totalPages);
}

// ─── 文字选取 & 浮动按钮 ──────────────────────────
function initSelectionListener() {
    // selectionchange 在手机拖动选择柄后也会触发，最可靠
    document.addEventListener('selectionchange', function() {
        clearTimeout(selDebounceTimer);
        selDebounceTimer = setTimeout(handleSelectionChange, 400);
    });
}

function handleSelectionChange() {
    // 模态框打开时忽略
    var overlay = document.getElementById('commentOverlay');
    if (overlay && overlay.classList.contains('show')) return;

    var sel  = window.getSelection ? window.getSelection() : null;
    var text = sel ? sel.toString().trim() : '';

    if (!text || text.length < 2) { hideSel(); return; }
    if (!sel.rangeCount) { hideSel(); return; }

    var range   = sel.getRangeAt(0);
    var content = document.getElementById('content');
    if (!content || !content.contains(range.commonAncestorContainer)) { hideSel(); return; }

    // 用 startContainer 找段落（跨段落时起点一定在第一个段落里）
    var startNode = range.startContainer;
    if (startNode.nodeType === 3) startNode = startNode.parentNode; // TEXT_NODE
    var paraEl = closest(startNode, '.paragraph');

    // fallback：用 commonAncestorContainer
    if (!paraEl) {
        var anc = range.commonAncestorContainer;
        if (anc.nodeType === 3) anc = anc.parentNode;
        paraEl = closest(anc, '.paragraph');
    }
    if (!paraEl) { hideSel(); return; }

    pendingSelection = {
        text: text,
        paragraphIndex: parseInt(paraEl.getAttribute('data-index'), 10)
    };

    // 定位：显示在选区【下方】，避开系统「复制/全选」菜单（系统菜单出现在上方）
    var rect      = range.getBoundingClientRect();
    var toolbarW  = 130; // 估算工具栏宽度
    var x = Math.max(toolbarW / 2 + 4, Math.min(rect.left + rect.width / 2, window.innerWidth - toolbarW / 2 - 4));
    var yBelow = rect.bottom + 14;
    // 如果下方空间不足，显示在上方
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

function hideSel() {
    document.getElementById('selToolbar').classList.remove('show');
}

function clearSel() {
    pendingSelection = null;
    hideSel();
    try { if (window.getSelection) window.getSelection().removeAllRanges(); } catch(e) {}
}

// 兼容不支持 closest 的旧浏览器
function closest(el, selector) {
    if (!el) return null;
    if (el.closest) return el.closest(selector);
    // polyfill
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

    var gi = pendingSelection.paragraphIndex;
    if (!comments[gi]) comments[gi] = [];
    comments[gi].push({
        selectedText : pendingSelection.text,
        text         : text,
        author       : 'elena',
        timestamp    : new Date().toISOString()
    });

    saveToStorage();
    closeCommentModal();
    renderPage();
}

// ─── 翻页 ────────────────────────────────────────
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        clearSel();
        renderPage();
        saveToStorage();
        window.scrollTo(0, 0);
    }
}

function nextPage() {
    if (currentPage < totalPages) {
        currentPage++;
        clearSel();
        renderPage();
        saveToStorage();
        window.scrollTo(0, 0);
    }
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
        var raw = localStorage.getItem('ea_reader_data');
        if (!raw) return;
        var d = JSON.parse(raw);
        currentPage           = d.currentPage  || 1;
        comments              = d.comments      || {};
        fontSize              = d.fontSize      || 18;
        bookTitle             = d.bookTitle     || '';
        lastExportedTimestamp = d.lastExportedTimestamp || null;
        document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
        if (d.paragraphs && d.paragraphs.length > 0) {
            allParagraphs = d.paragraphs;
            totalPages    = Math.ceil(allParagraphs.length / paragraphsPerPage);
            showBook();
        }
    } catch(e) { console.error('加载失败', e); }
}

function saveToStorage() {
    try {
        localStorage.setItem('ea_reader_data', JSON.stringify({
            currentPage           : currentPage,
            comments              : comments,
            fontSize              : fontSize,
            bookTitle             : bookTitle,
            paragraphs            : allParagraphs,
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
    var key;
    for (key in comments) {
        if (!comments[key]) continue;
        comments[key].forEach(function(c) {
            if (c.author === 'elena') {
                if (!lastExportedTimestamp || new Date(c.timestamp) > new Date(lastExportedTimestamp)) {
                    list.push({ index: parseInt(key, 10), selectedText: c.selectedText, text: c.text, timestamp: c.timestamp });
                }
            }
        });
    }

    if (list.length === 0) { alert('没有新批注需要导出！'); return; }
    list.sort(function(a, b) { return a.index - b.index; });

    var now     = new Date();
    var dateStr = now.toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    var out     = '\u300a' + bookTitle + '\u300b\u6279\u6ce8\u5bfc\u51fa\n\u5bfc\u51fa\u65f6\u95f4\uff1a' + dateStr + '\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';

    list.forEach(function(item) {
        var t = new Date(item.timestamp).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        out += '\u6bb5\u843d ' + (item.index + 1) + '\n';
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
