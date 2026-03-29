// EA阅读器 - 主逻辑
let currentPage        = 1;
let totalPages         = 1;
let paragraphsPerPage  = 20;
let allParagraphs      = [];
let fontSize           = 18;
let comments           = {};   // { globalIndex: [{selectedText, text, author, timestamp}] }
let bookTitle          = '';
let lastExportedTimestamp = null;

// 当前选取状态
let pendingSelection = null;   // { text, paragraphIndex }

// ─────────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    loadFromStorage();
    initUpload();
    initSelectionListener();
});

// ─────────────────────────────────────────────
// 上传
// ─────────────────────────────────────────────
function initUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput  = document.getElementById('fileInput');

    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) loadBook(e.dataTransfer.files[0]);
    });
}

function handleFileSelect(e) {
    if (e.target.files[0]) loadBook(e.target.files[0]);
}

function loadBook(file) {
    if (!file.name.endsWith('.txt')) { alert('请上传 TXT 格式的文件！'); return; }
    const reader = new FileReader();
    reader.onload  = (e) => processBook(e.target.result, file.name);
    reader.onerror = ()  => alert('文件读取失败，请重试！');
    reader.readAsText(file, 'UTF-8');
}

function processBook(text, filename) {
    bookTitle     = filename.replace('.txt', '');
    allParagraphs = text.split(/\n+/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !/^[\.…\s\-—_=]+$/.test(l));

    if (allParagraphs.length === 0) { alert('文件内容为空或格式不正确！'); return; }

    totalPages  = Math.ceil(allParagraphs.length / paragraphsPerPage);
    currentPage = 1;
    comments    = {};
    saveToStorage();
    showBook();
}

function showBook() {
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('controls').style.display      = 'flex';
    document.getElementById('bottomNav').classList.add('show');
    renderPage();
}

// ─────────────────────────────────────────────
// 渲染
// ─────────────────────────────────────────────
function renderPage() {
    const start = (currentPage - 1) * paragraphsPerPage;
    const end   = start + paragraphsPerPage;
    const slice = allParagraphs.slice(start, end);

    let html = `<div class="book-title">${escapeHtml(bookTitle)}</div>`;

    slice.forEach((text, idx) => {
        const gi         = start + idx;
        const hasComment = comments[gi] && comments[gi].length > 0;

        // Build paragraph text with highlights for every saved selection
        let paraHtml = escapeHtml(text);
        if (hasComment) {
            comments[gi].forEach(c => {
                if (c.selectedText) {
                    const esc = escapeHtml(c.selectedText);
                    // Replace first occurrence only (avoid double-wrapping)
                    paraHtml = paraHtml.replace(esc,
                        `<mark class="ea-hi">${esc}</mark>`);
                }
            });
        }

        html += `<div class="paragraph ${hasComment ? 'has-comment' : ''}" data-index="${gi}">
            <div class="paragraph-text" style="font-size:${fontSize}px">${paraHtml}</div>`;

        if (hasComment) {
            html += '<div class="comments">';
            comments[gi].forEach(c => {
                const quoteHtml = c.selectedText
                    ? `<div class="comment-quote">"${escapeHtml(c.selectedText)}"</div>` : '';
                html += `
                    <div class="comment ${c.author}">
                        <div class="comment-author">${c.author === 'elena' ? '💗 Elena' : '💙 Ash'}</div>
                        ${quoteHtml}
                        <div class="comment-text">${escapeHtml(c.text)}</div>
                    </div>`;
            });
            html += '</div>';
        }

        html += '</div>';
    });

    document.getElementById('content').innerHTML = html;

    // Update nav (null-safe)
    const setEl = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
    setEl('pageInfoBottom',  el => el.textContent = `${currentPage} / ${totalPages}`);
    setEl('prevBtnBottom',   el => el.disabled = currentPage === 1);
    setEl('nextBtnBottom',   el => el.disabled = currentPage === totalPages);
    setEl('pageInfo',        el => el.textContent = `${currentPage} / ${totalPages}`);
    setEl('prevBtn',         el => el.disabled = currentPage === 1);
    setEl('nextBtn',         el => el.disabled = currentPage === totalPages);
}

// ─────────────────────────────────────────────
// 文字选取 & 浮动批注按钮
// ─────────────────────────────────────────────
function initSelectionListener() {
    // selectionchange 在用户调整选择柄后也会触发，比 touchend 更可靠
    document.addEventListener('selectionchange', debounce(handleSelectionChange, 350));
}

function debounce(fn, delay) {
    var timer;
    return function() {
        clearTimeout(timer);
        timer = setTimeout(fn, delay);
    };
}

function handleSelectionChange() {
    // 模态框打开时不处理
    if (document.getElementById('commentOverlay').classList.contains('visible')) return;

    var sel  = window.getSelection();
    var text = sel ? sel.toString().trim() : '';

    if (!text || text.length < 2) {
        hideSelToolbar();
        return;
    }

    // 确认选区在阅读内容区域内
    if (!sel.rangeCount) { hideSelToolbar(); return; }
    var range   = sel.getRangeAt(0);
    var content = document.getElementById('content');
    if (!content || !content.contains(range.commonAncestorContainer)) {
        hideSelToolbar();
        return;
    }

    // 找到所在段落
    // 优先用 startContainer（选区起点）找段落，这样跨段落时也能归到第一个段落
    var startNode = range.startContainer;
    if (startNode.nodeType === Node.TEXT_NODE) startNode = startNode.parentElement;
    var paraEl = startNode.closest ? startNode.closest('.paragraph') : null;

    // 如果起点也不在段落里（极少数情况），再试 commonAncestorContainer
    if (!paraEl) {
        var ancestor = range.commonAncestorContainer;
        if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement;
        paraEl = ancestor.closest ? ancestor.closest('.paragraph') : null;
    }

    if (!paraEl) { hideSelToolbar(); return; }

    pendingSelection = {
        text: text,
        paragraphIndex: parseInt(paraEl.dataset.index)
    };

    // 定位工具栏：显示在选区【下方】，避开手机系统「复制/全选」菜单（它出现在上方）
    // rect 是视口坐标，工具栏 position:fixed，不能加 scrollY
    var rect      = range.getBoundingClientRect();
    var x         = Math.max(70, Math.min(rect.left + rect.width / 2, window.innerWidth - 70));
    var yBelow    = rect.bottom + 12;
    var navHeight = 60; // 底部导航栏高度
    // 如果下方空间不够（离底部导航太近），就显示在上方
    var y = (yBelow + 44 + navHeight < window.innerHeight) ? yBelow : rect.top - 52;
    showSelToolbar(x, Math.max(y, 10));
}

function showSelToolbar(x, y) {
    var tb = document.getElementById('selToolbar');
    tb.style.left = x + 'px';
    tb.style.top  = y + 'px';
    tb.classList.add('visible');
}

function hideSelToolbar() {
    document.getElementById('selToolbar').classList.remove('visible');
}

// mousedown/touchstart on toolbar buttons — prevents selection from clearing
function onAnnotateBtnDown(e) {
    e.preventDefault();
    openCommentModal();
}

function onCancelBtnDown(e) {
    e.preventDefault();
    clearPendingSelection();
}

function clearPendingSelection() {
    pendingSelection = null;
    hideSelToolbar();
    if (window.getSelection) window.getSelection().removeAllRanges();
}

// ─────────────────────────────────────────────
// 批注 Modal
// ─────────────────────────────────────────────
function openCommentModal() {
    if (!pendingSelection) return;
    hideSelToolbar();

    document.getElementById('modalQuote').textContent = pendingSelection.text;
    document.getElementById('commentInput').value     = '';
    document.getElementById('notionStatus').textContent = '';
    document.getElementById('notionStatus').className   = 'notion-status';

    document.getElementById('commentOverlay').classList.add('visible');

    setTimeout(() => document.getElementById('commentInput').focus(), 200);
}

function closeCommentModal() {
    document.getElementById('commentOverlay').classList.remove('visible');
    clearPendingSelection();
}

// Tap overlay background to close
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('commentOverlay').addEventListener('click', function (e) {
        if (e.target === this) closeCommentModal();
    });
    document.getElementById('settingsOverlay').addEventListener('click', function (e) {
        if (e.target === this) closeSettings();
    });
});

async function saveSelectionComment() {
    const text = document.getElementById('commentInput').value.trim();
    if (!text) { alert('请输入批注内容！'); return; }
    if (!pendingSelection) return;

    const gi = pendingSelection.paragraphIndex;
    if (!comments[gi]) comments[gi] = [];

    const entry = {
        selectedText : pendingSelection.text,
        text         : text,
        author       : 'elena',
        timestamp    : new Date().toISOString()
    };
    comments[gi].push(entry);

    saveToStorage();

    // 同步到 Notion
    const statusEl = document.getElementById('notionStatus');
    const notionCfg = getNotionConfig();
    if (notionCfg.apiKey && notionCfg.dbId) {
        statusEl.textContent = '同步到 Notion 中...';
        statusEl.className   = 'notion-status syncing';
        const ok = await syncToNotion(pendingSelection.text, text, notionCfg);
        if (ok) {
            statusEl.textContent = '✅ 已同步到 Notion';
            statusEl.className   = 'notion-status ok';
        } else {
            statusEl.textContent = '⚠️ Notion 同步失败，批注已本地保存';
            statusEl.className   = 'notion-status err';
        }
        // 稍等再关闭
        setTimeout(() => {
            closeCommentModal();
            renderPage();
        }, 1000);
    } else {
        closeCommentModal();
        renderPage();
    }
}

// ─────────────────────────────────────────────
// Notion 集成
// ─────────────────────────────────────────────
function getNotionConfig() {
    try {
        const s = localStorage.getItem('ea_notion_cfg');
        return s ? JSON.parse(s) : { apiKey: '', dbId: '' };
    } catch { return { apiKey: '', dbId: '' }; }
}

async function syncToNotion(selectedText, comment, cfg) {
    // 用 corsproxy.io 绕过浏览器 CORS 限制
    const url = 'https://corsproxy.io/?https://api.notion.com/v1/pages';

    const body = {
        parent: { database_id: cfg.dbId.replace(/-/g, '') },
        properties: {
            '原文': {
                title: [{ text: { content: selectedText } }]
            },
            'Elena批注': {
                rich_text: [{ text: { content: comment } }]
            },
            'Ash批注': {
                rich_text: []
            }
        }
    };

    try {
        const resp = await fetch(url, {
            method : 'POST',
            headers: {
                'Content-Type'  : 'application/json',
                'Authorization' : `Bearer ${cfg.apiKey}`,
                'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify(body)
        });
        return resp.ok;
    } catch (err) {
        console.error('Notion sync error:', err);
        return false;
    }
}

// ─────────────────────────────────────────────
// Settings Modal
// ─────────────────────────────────────────────
function openSettings() {
    const cfg = getNotionConfig();
    document.getElementById('notionApiKey').value = cfg.apiKey || '';
    document.getElementById('notionDbId').value   = cfg.dbId   || '';
    document.getElementById('settingsOverlay').classList.add('visible');
}

function closeSettings() {
    document.getElementById('settingsOverlay').classList.remove('visible');
}

function saveSettings() {
    const apiKey = document.getElementById('notionApiKey').value.trim();
    const dbId   = document.getElementById('notionDbId').value.trim();
    localStorage.setItem('ea_notion_cfg', JSON.stringify({ apiKey, dbId }));
    closeSettings();
    alert(apiKey && dbId ? '✅ Notion 设置已保存！' : '设置已保存（未填写则不同步）');
}

// ─────────────────────────────────────────────
// 翻页 & 字号
// ─────────────────────────────────────────────
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        clearPendingSelection();
        renderPage();
        saveToStorage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function nextPage() {
    if (currentPage < totalPages) {
        currentPage++;
        clearPendingSelection();
        renderPage();
        saveToStorage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function increaseFontSize() {
    if (fontSize < 28) { fontSize += 2; updateFontSizeDisplay(); applyFontSize(); saveToStorage(); }
}

function decreaseFontSize() {
    if (fontSize > 12) { fontSize -= 2; updateFontSizeDisplay(); applyFontSize(); saveToStorage(); }
}

function updateFontSizeDisplay() {
    document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
}

function applyFontSize() {
    document.querySelectorAll('.paragraph-text').forEach(p => p.style.fontSize = fontSize + 'px');
}

// ─────────────────────────────────────────────
// 本地存储
// ─────────────────────────────────────────────
function loadFromStorage() {
    try {
        const saved = localStorage.getItem('ea_reader_data');
        if (!saved) return;
        const data = JSON.parse(saved);
        currentPage           = data.currentPage  || 1;
        comments              = data.comments      || {};
        fontSize              = data.fontSize      || 18;
        bookTitle             = data.bookTitle     || '';
        lastExportedTimestamp = data.lastExportedTimestamp || null;

        if (data.paragraphs && data.paragraphs.length > 0) {
            allParagraphs = data.paragraphs;
            totalPages    = Math.ceil(allParagraphs.length / paragraphsPerPage);
            showBook();
        }
        updateFontSizeDisplay();
    } catch (e) { console.error('加载数据失败:', e); }
}

function saveToStorage() {
    try {
        localStorage.setItem('ea_reader_data', JSON.stringify({
            currentPage, comments, fontSize, bookTitle,
            paragraphs: allParagraphs,
            lastExportedTimestamp,
            savedAt: new Date().toISOString()
        }));
    } catch (e) {
        console.error('保存失败:', e);
        alert('保存失败，可能是存储空间不足！');
    }
}

// ─────────────────────────────────────────────
// 导出批注（复制到剪贴板）
// ─────────────────────────────────────────────
function exportNewComments() {
    const list = [];

    for (const index in comments) {
        (comments[index] || []).forEach(c => {
            if (c.author === 'elena') {
                if (!lastExportedTimestamp || new Date(c.timestamp) > new Date(lastExportedTimestamp)) {
                    list.push({ index: parseInt(index), ...c });
                }
            }
        });
    }

    if (list.length === 0) { alert('没有新批注需要导出！'); return; }

    list.sort((a, b) => a.index - b.index);

    const now     = new Date();
    const dateStr = now.toLocaleString('zh-CN', {
        year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit'
    });

    let out = `《${bookTitle}》批注导出\n导出时间：${dateStr}\n\n━━━━━━━━━━━━━━━━\n\n`;

    list.forEach(item => {
        const t = new Date(item.timestamp).toLocaleString('zh-CN',
            { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        out += `段落 ${item.index + 1}\n`;
        if (item.selectedText) out += `原文："${item.selectedText}"\n\n`;
        out += `💗 Elena（${t}）：\n${item.text}\n\n━━━━━━━━━━━━━━━━\n\n`;
    });

    out += `共 ${list.length} 条新批注`;

    const doAfterCopy = () => {
        lastExportedTimestamp = now.toISOString();
        saveToStorage();
        alert(`✅ 成功复制 ${list.length} 条新批注！\n\n现在可以发给Ash啦 💕`);
    };

    navigator.clipboard.writeText(out).then(doAfterCopy).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = out; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); doAfterCopy(); }
        catch { alert('复制失败，请手动复制'); console.log(out); }
        document.body.removeChild(ta);
    });
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────
function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// 键盘快捷键
document.addEventListener('keydown', e => {
    if (e.target.matches('textarea, input')) return;
    if (e.key === 'ArrowLeft')  prevPage();
    if (e.key === 'ArrowRight') nextPage();
});
