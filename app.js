// EA阅读器 - 主逻辑
let currentPage = 1;
let totalPages = 1;
let paragraphsPerPage = 20;
let allParagraphs = [];
let fontSize = 18;
let comments = {};
let bookTitle = '';
let activeInputParagraph = null;
let lastExportedTimestamp = null; // 记录上次导出批注的时间

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    loadFromStorage();
    initUpload();
});

// 初始化上传功能
function initUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect);

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            loadBook(files[0]);
        }
    });
}

// 处理文件选择
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        loadBook(file);
    }
}

// 加载书籍文件
function loadBook(file) {
    if (!file.name.endsWith('.txt')) {
        alert('请上传 TXT 格式的文件！');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        processBook(text, file.name);
    };
    
    // 尝试多种编码
    reader.onerror = function() {
        alert('文件读取失败，请重试！');
    };
    
    reader.readAsText(file, 'UTF-8');
}

// 处理书籍内容
function processBook(text, filename) {
    bookTitle = filename.replace('.txt', '');
    
    // 分段处理：按空行或多个换行符分段
    const lines = text.split(/\n+/);
    allParagraphs = lines
        .map(line => line.trim())
        .filter(line => {
            // 过滤空行和只有符号的行
            return line.length > 0 && !line.match(/^[\.…\s\-—_=]+$/);
        });

    if (allParagraphs.length === 0) {
        alert('文件内容为空或格式不正确！');
        return;
    }

    totalPages = Math.ceil(allParagraphs.length / paragraphsPerPage);
    currentPage = 1;
    comments = {};
    
    saveToStorage();
    showBook();
}

// 显示书籍界面
function showBook() {
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('bottomNav').classList.add('show');
    renderPage();
}

// 渲染当前页面
function renderPage() {
    const start = (currentPage - 1) * paragraphsPerPage;
    const end = start + paragraphsPerPage;
    const pageParagraphs = allParagraphs.slice(start, end);

    let html = `<div class="book-title">${escapeHtml(bookTitle)}</div>`;

    pageParagraphs.forEach((text, index) => {
        const globalIndex = start + index;
        const hasComment = comments[globalIndex] && comments[globalIndex].length > 0;
        const commentClass = hasComment ? 'has-comment' : '';
        
        html += `<div class="paragraph ${commentClass}" onclick="toggleCommentInput(${globalIndex})">
            <div class="paragraph-text" style="font-size: ${fontSize}px">${escapeHtml(text)}</div>`;
        
        if (hasComment) {
            html += '<div class="comments">';
            comments[globalIndex].forEach(comment => {
                html += `
                    <div class="comment ${comment.author}">
                        <div class="comment-author">${comment.author === 'elena' ? '💗 Elena' : '💙 Ash'}</div>
                        <div class="comment-text">${escapeHtml(comment.text)}</div>
                    </div>
                `;
            });
            html += '</div>';
        }
        
        html += '</div>';
    });

    document.getElementById('content').innerHTML = html;
    document.getElementById('pageInfo').textContent = `${currentPage} / ${totalPages}`;
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = currentPage === totalPages;
    
    // 同时更新底部导航栏
    if (document.getElementById('pageInfoBottom')) {
        document.getElementById('pageInfoBottom').textContent = `${currentPage} / ${totalPages}`;
        document.getElementById('prevBtnBottom').disabled = currentPage === 1;
        document.getElementById('nextBtnBottom').disabled = currentPage === totalPages;
    }
}

// 切换批注输入框
function toggleCommentInput(index) {
    if (activeInputParagraph === index) {
        activeInputParagraph = null;
        renderPage();
        return;
    }

    activeInputParagraph = index;
    const paragraphs = document.querySelectorAll('.paragraph');
    const localIndex = index - (currentPage - 1) * paragraphsPerPage;
    const paragraph = paragraphs[localIndex];
    
    if (!paragraph) return;

    paragraph.classList.add('active');

    if (!paragraph.querySelector('.comment-input-area')) {
        const inputArea = document.createElement('div');
        inputArea.className = 'comment-input-area';
        inputArea.innerHTML = `
            <textarea class="comment-input" placeholder="Elena，在这里写下你的想法..." onclick="event.stopPropagation()"></textarea>
            <div class="comment-buttons">
                <button class="comment-btn" onclick="saveComment(${index}, event)">发送 🐾</button>
                <button class="comment-btn cancel" onclick="cancelComment(${index}, event)">取消</button>
            </div>
        `;
        paragraph.appendChild(inputArea);
        
        // 聚焦到输入框
        setTimeout(() => {
            const textarea = inputArea.querySelector('textarea');
            if (textarea) {
                textarea.focus();
            }
        }, 100);
    }
}

// 保存批注
function saveComment(index, e) {
    e.stopPropagation();
    const paragraph = e.target.closest('.paragraph');
    const textarea = paragraph.querySelector('.comment-input');
    const text = textarea.value.trim();
    
    if (!text) {
        alert('请输入批注内容！');
        return;
    }

    if (!comments[index]) {
        comments[index] = [];
    }

    comments[index].push({
        author: 'elena',
        text: text,
        timestamp: new Date().toISOString()
    });

    saveToStorage();
    activeInputParagraph = null;
    renderPage();
}

// 取消批注
function cancelComment(index, e) {
    e.stopPropagation();
    activeInputParagraph = null;
    renderPage();
}

// 上一页
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        activeInputParagraph = null;
        renderPage();
        saveToStorage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// 下一页
function nextPage() {
    if (currentPage < totalPages) {
        currentPage++;
        activeInputParagraph = null;
        renderPage();
        saveToStorage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// 增大字号
function increaseFontSize() {
    if (fontSize < 28) {
        fontSize += 2;
        updateFontSizeDisplay();
        applyFontSize();
        saveToStorage();
    }
}

// 减小字号
function decreaseFontSize() {
    if (fontSize > 12) {
        fontSize -= 2;
        updateFontSizeDisplay();
        applyFontSize();
        saveToStorage();
    }
}

// 更新字号显示
function updateFontSizeDisplay() {
    document.getElementById('fontSizeDisplay').textContent = fontSize + 'px';
}

// 应用字号到所有段落
function applyFontSize() {
    const paragraphs = document.querySelectorAll('.paragraph-text');
    paragraphs.forEach(p => {
        p.style.fontSize = fontSize + 'px';
    });
}

// 从localStorage加载数据
function loadFromStorage() {
    try {
        const saved = localStorage.getItem('ea_reader_data');
        if (saved) {
            const data = JSON.parse(saved);
            currentPage = data.currentPage || 1;
            comments = data.comments || {};
            fontSize = data.fontSize || 18;
            bookTitle = data.bookTitle || '';
            lastExportedTimestamp = data.lastExportedTimestamp || null;
            
            if (data.paragraphs && data.paragraphs.length > 0) {
                allParagraphs = data.paragraphs;
                totalPages = Math.ceil(allParagraphs.length / paragraphsPerPage);
                showBook();
            }
            
            updateFontSizeDisplay();
        }
    } catch (e) {
        console.error('加载数据失败:', e);
    }
}

// 保存到localStorage
function saveToStorage() {
    try {
        const data = {
            currentPage,
            comments,
            fontSize,
            bookTitle,
            paragraphs: allParagraphs,
            lastExportedTimestamp,
            savedAt: new Date().toISOString()
        };
        localStorage.setItem('ea_reader_data', JSON.stringify(data));
    } catch (e) {
        console.error('保存数据失败:', e);
        alert('保存失败，可能是存储空间不足！');
    }
}

// HTML转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 键盘快捷键
document.addEventListener('keydown', function(e) {
    // 左箭头 - 上一页
    if (e.key === 'ArrowLeft' && !e.target.matches('textarea, input')) {
        prevPage();
    }
    // 右箭头 - 下一页
    if (e.key === 'ArrowRight' && !e.target.matches('textarea, input')) {
        nextPage();
    }
});

// 导出新批注到剪贴板
function exportNewComments() {
    // 获取所有批注
    const allCommentsList = [];
    
    for (let index in comments) {
        if (comments[index] && comments[index].length > 0) {
            comments[index].forEach(comment => {
                // 只导出Elena的批注
                if (comment.author === 'elena') {
                    // 如果有上次导出时间，只导出新批注
                    if (!lastExportedTimestamp || new Date(comment.timestamp) > new Date(lastExportedTimestamp)) {
                        allCommentsList.push({
                            index: parseInt(index),
                            text: allParagraphs[index],
                            comment: comment.text,
                            timestamp: comment.timestamp
                        });
                    }
                }
            });
        }
    }
    
    if (allCommentsList.length === 0) {
        alert('没有新批注需要导出！');
        return;
    }
    
    // 按段落编号排序
    allCommentsList.sort((a, b) => a.index - b.index);
    
    // 格式化输出
    const now = new Date();
    const dateStr = now.toLocaleString('zh-CN', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    let output = `《${bookTitle}》批注导出\n`;
    output += `导出时间：${dateStr}\n`;
    output += `\n━━━━━━━━━━━━━━━━\n\n`;
    
    allCommentsList.forEach((item, idx) => {
        const commentTime = new Date(item.timestamp).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        output += `段落 ${item.index + 1}\n`;
        output += `原文：${item.text}\n\n`;
        output += `💗 Elena（${commentTime}）：\n${item.comment}\n`;
        output += `\n━━━━━━━━━━━━━━━━\n\n`;
    });
    
    output += `共 ${allCommentsList.length} 条新批注`;
    
    // 复制到剪贴板
    navigator.clipboard.writeText(output).then(() => {
        // 更新最后导出时间
        lastExportedTimestamp = now.toISOString();
        saveToStorage();
        
        alert(`✅ 成功复制 ${allCommentsList.length} 条新批注！\n\n现在可以发给Ash啦 💕`);
    }).catch(err => {
        console.error('复制失败:', err);
        // 如果复制失败，显示文本让用户手动复制
        const textarea = document.createElement('textarea');
        textarea.value = output;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            lastExportedTimestamp = now.toISOString();
            saveToStorage();
            alert(`✅ 成功复制 ${allCommentsList.length} 条新批注！\n\n现在可以发给Ash啦 💕`);
        } catch (e) {
            alert('复制失败，请手动复制批注内容');
            console.log(output);
        }
        document.body.removeChild(textarea);
    });
}
