import { supabase } from './supabase.js';

let currentChatId = null;
let chats = [];
let userSession = null;
let userProfile = {}; 
let currentMessages = []; // Untuk menyimpan memori chat aktif
let uploadedFilesData = []; // Variabel global untuk menampung data upload
let pendingPlan = null;
let isGenerating = false;
let abortController = null;
let usageChart = null;
let collapsedFolders = new Set();
const SEND_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>`;
const STOP_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>`;

function formatTimestamp(dateString) {
    const date = new Date(dateString);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
window.onload = async () => {
    // 1. Listener Utama Status Login
    supabase.auth.onAuthStateChange(async (event, session) => {
        console.log(`[Auth Event] ${event}`);
        userSession = session;
        
        if (session) {
            // Tampilan jika sudah login
            document.getElementById('auth-overlay').style.display = 'none';
            document.getElementById('auth-nav').style.display = 'none';
            document.getElementById('user-email').innerText = session.user.email;
            document.getElementById('user-avatar').innerText = session.user.email.charAt(0).toUpperCase();
            
            await loadMemory();
            await syncHistory();
            updateUsageUI();
        } else {
            // Tampilan jika logout / belum login
            document.getElementById('auth-nav').style.display = 'flex';
            document.getElementById('chat').innerHTML = "";
            document.getElementById('welcome').style.display = "block";
            
            if (event === 'SIGNED_OUT') {
                console.log("[Auth] User signed out.");
            }
        }
    });    

    // 3. Cek Session awal saat page load
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        console.log("[Auth] No active session found on load.");
    }

    // Inisialisasi Midtrans Snap setelah client key tersedia
    if (window.MIDTRANS_CLIENT_KEY && typeof Snap !== 'undefined') {
        Snap.setClientKey(window.MIDTRANS_CLIENT_KEY);
    }
};

// EKSPOS FUNGSI KE GLOBAL (PENTING: Agar onclick di HTML berfungsi)
window.handleAuth = handleAuth;
window.showAuthForm = showAuthForm;
window.toggleSidebar = toggleSidebar;
window.newChat = newChat;
window.send = send;
window.loadChat = loadChat;
window.toggleTheme = toggleTheme;
window.exportToPDF = exportToPDF;
window.renderHistory = renderHistory;
window.deleteChatFromMenu = deleteChatFromMenu;
window.startVoice = startVoice;
window.closePreview = closePreview;
window.editMessage = editMessage;
window.branchChat = branchChat;
window.handleLogout = handleLogout;
window.toggleAttachMenu = toggleAttachMenu;
window.triggerFileSelect = triggerFileSelect;
window.handleFileSelect = handleFileSelect;
window.shareChat = shareChat;
window.saveMemory = saveMemory;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.switchSettingsTab = switchSettingsTab;
window.changeFontSize = changeFontSize;
window.buyPlan = buyPlan;
window.resetPlan = resetPlan;
window.claimPromoCode = claimPromoCode;
window.showUsageDetail = showUsageDetail;
window.closeUsageDetail = closeUsageDetail;
window.createNewFolder = createNewFolder;
window.toggleFolder = toggleFolder;
window.loginWithGoogle = loginWithGoogle;
window.openUsageSettings = openUsageSettings;

// Debounce Helper untuk Performa Pencarian
function debounce(func, timeout = 300){
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}
window.debouncedRender = debounce(() => renderHistory());

function toggleAttachMenu(e) {
    if (e) e.stopPropagation();
    document.getElementById('attach-menu').classList.toggle('active');
}

function triggerFileSelect(type) {
    const input = document.getElementById('image-input');
    input.accept = type;
    input.click();
    toggleAttachMenu();
}

async function handleFileSelect(input) {
    const container = document.getElementById('file-preview-container');
    const sendBtn = document.getElementById('send-btn');
    const MAX_SIZE = 500 * 1024 * 1024; // 500MB
    
    container.innerHTML = "";
    uploadedFilesData = []; // Reset data lama
    
    if (input.files.length > 0) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = "0.5";
        sendBtn.style.cursor = "not-allowed";

        container.style.display = "flex";
        container.innerHTML = `
            <div class="upload-loader">
                <div class="loader-text" style="display:flex; justify-content:space-between;">
                    <span>⏳ Memproses File...</span>
                    <span id="upload-percent">0%</span>
                </div>
                <div class="progress-bar-container">
                    <div id="upload-progress-bar" class="progress-bar"></div>
                </div>
            </div>
        `;

        const progressBar = document.getElementById('upload-progress-bar');
        const percentText = document.getElementById('upload-percent');
        const files = Array.from(input.files);
        const totalSize = files.reduce((acc, f) => acc + f.size, 0);
        let loadedSoFar = 0;

        try {
            for (let file of files) {
                if (file.size > MAX_SIZE) {
                    alert(`File "${file.name}" melewati batas 500MB.`);
                    continue;
                }

                const result = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    let fileLoaded = 0;

                    reader.onprogress = (e) => {
                        if (e.lengthComputable) {
                            const newlyLoaded = e.loaded - fileLoaded;
                            fileLoaded = e.loaded;
                            loadedSoFar += newlyLoaded;
                            const totalPercent = Math.round((loadedSoFar / totalSize) * 100);
                            progressBar.style.width = totalPercent + "%";
                            percentText.innerText = totalPercent + "%";
                        }
                    };

                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;

                    if (file.type.startsWith('image/')) reader.readAsDataURL(file);
                    else reader.readAsText(file);
                });

                if (file.type.startsWith('image/')) uploadedFilesData.push(result);
                else uploadedFilesData.push({ type: 'document', name: file.name, content: result });
            }

            // Tampilkan Preview setelah semua selesai dibaca
            container.innerHTML = "";
            uploadedFilesData.forEach(data => {
                const el = document.createElement(typeof data === 'string' ? 'img' : 'div');
                if (typeof data === 'string') el.src = data;
                else el.innerText = "📄";
                el.className = "preview-thumb";
                if (typeof data !== 'string') Object.assign(el.style, {display:'flex', alignItems:'center', justifyContent:'center', fontSize:'20px'});
                container.appendChild(el);
            });

        } catch (err) {
            console.error("Gagal memproses gambar:", err);
        } finally {
            // Hapus loader dan aktifkan kembali tombol kirim
            const loader = container.querySelector('.upload-loader');
            if (loader) loader.remove();
            sendBtn.disabled = false;
            sendBtn.style.opacity = "1";
            sendBtn.style.cursor = "pointer";
        }
    } else {
        container.style.display = "none";
    }
}

document.addEventListener('click', () => {
    const menu = document.getElementById('attach-menu');
    if (menu) menu.classList.remove('active');
});

async function handleLogout() {
    if (confirm("Apakah Anda yakin ingin keluar?")) {
        await supabase.auth.signOut();
        location.reload();
    }
}

function showAuthForm(type) {
    console.log(`[showAuthForm] Displaying form: ${type}`);
    console.log(`[Auth] showAuthForm called with type: ${type}`);
    // Sembunyikan semua form dan nonaktifkan tab
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
    
    // Tampilkan form yang dipilih dan aktifkan tab-nya
    document.getElementById(`${type}-form`).classList.add('active');
    document.getElementById(`tab-${type}`).classList.add('active');
    document.getElementById('auth-error').innerText = '';
    document.getElementById('auth-error').style.backgroundColor = 'transparent';
    document.getElementById('auth-error').style.display = 'none'; // Sembunyikan jika kosong
}

async function handleAuth(type) {
    console.log(`[handleAuth] Attempting ${type}`);
    console.log(`[Auth] handleAuth called with type: ${type}`);
    const errorEl = document.getElementById('auth-error');
    errorEl.innerText = '';
    errorEl.style.color = '#ef4444'; // Reset error color to red
    errorEl.style.backgroundColor = 'transparent'; // Clear background

    // Add a temporary loading indicator (optional, but good for UX)
    errorEl.innerText = "Memproses...";

    // Ambil data berdasarkan form yang aktif
    const email = document.getElementById(`${type}-email`).value;
    const password = document.getElementById(`${type}-password`).value;

    if (type === 'register') {
        const confirm = document.getElementById('register-confirm-password').value;
        if (password !== confirm) {
            document.getElementById('auth-error').style.display = 'block';
            console.log("[Auth] Password confirmation mismatch.");
            return errorEl.innerText = "Konfirmasi password tidak cocok!";
        }
    }

    try {
        console.log(`[Auth] Attempting ${type} for email: ${email}`);

        const { data, error } = type === 'register' 
            ? await supabase.auth.signUp({ email, password })
            : await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            errorEl.innerText = error.message;
            errorEl.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            return;
        }

        if (type === 'register' && data.user && !data.session) {
            errorEl.innerText = "Registrasi berhasil! Cek email untuk konfirmasi.";
            errorEl.style.color = "#16a34a";
            return;
        }
    } catch (e) {
        console.error("[Auth] Unhandled error in handleAuth:", e);
        errorEl.innerText = "Terjadi kesalahan tak terduga. Silakan coba lagi.";
        errorEl.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
    } finally {
        // errorEl.innerText = ''; // Clear "Memproses..." after completion
    }
}

async function loginWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin
        }
    });
    if (error) alert("Gagal login dengan Google: " + error.message);
}

// Helper function to add favicons to links within an element
function addFaviconsToLinks(element) {
    const links = element.querySelectorAll('a');
    links.forEach(link => {
        try {
            const url = new URL(link.href);
            const domain = url.hostname;
            if (domain && !link.querySelector('.favicon-inline')) { // Prevent adding multiple favicons
                const faviconImg = document.createElement('img');
                faviconImg.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`; // Google's favicon service
                faviconImg.className = 'favicon-inline'; // New class for inline favicons
                faviconImg.alt = 'favicon';
                faviconImg.onerror = () => { faviconImg.style.display = 'none'; }; // Hide if favicon fails to load
                link.prepend(faviconImg); // Add favicon before the link text
            }
        } catch (e) {
            // console.warn("Invalid URL for favicon:", link.href, e); // Log warning for invalid URLs
        }
    });
}
async function send(overwriteText = null) {
    console.log("[send] Function called.");

    // Feedback getaran (vibrate) singkat untuk mobile
    if (navigator.vibrate) {
        navigator.vibrate(15);
    }

    // CEK APAKAH USER SUDAH LOGIN
    if (!userSession) {
        showAuthForm('login');
        document.getElementById('auth-overlay').style.display = 'flex';
        return; // Hentikan fungsi agar AI tidak merespon
    }

    if (isGenerating) {
        if (abortController) abortController.abort();
        return;
    }

    const input = document.getElementById("msg");
    const chat = document.getElementById("chat");
    const sendBtn = document.getElementById("send-btn");
    const welcome = document.getElementById("welcome");
    const imageInput = document.getElementById("image-input");
    let model = document.getElementById("model-select").value;
    const isReasoning = document.getElementById("reasoning-mode").checked;

    isGenerating = true;
    abortController = new AbortController();

    if (isReasoning) model = "deepseek/deepseek-r1";

    try { // Start try block for send function
        // Ubah UI ke mode Generating (Stop)
        sendBtn.innerHTML = STOP_ICON;
        sendBtn.classList.add('stop-active');
        input.disabled = true;

        const text = overwriteText || input.value.trim();
        
        // Gunakan data file yang sudah diproses dari handleFileSelect
        let imagesForAI = uploadedFilesData.filter(item => typeof item === 'string' && item.startsWith('data:image/'));
        let documentsForAI = uploadedFilesData.filter(item => typeof item === 'object' && item.type === 'document');
        
        let imageBase64 = imagesForAI.length > 0 ? imagesForAI[0] : null; // Kirim hanya gambar pertama ke AI
        let fileContext = "";
        documentsForAI.forEach(doc => {
            fileContext += `\n[File: ${doc.name}]\n${doc.content}\n`;
        });

        if(!text && uploadedFilesData.length === 0) return;

        // Kosongkan input dan reset tinggi textarea segera untuk mencegah duplikat
        input.value = "";
        input.style.height = "auto";

        // Clear file input element (penting agar tidak mengunggah ulang)
        imageInput.value = "";
        document.getElementById('file-preview-container').innerHTML = "";
        document.getElementById('file-preview-container').style.display = "none";

        if (!currentChatId) {
            const autoTitle = text.length > 25 ? text.substring(0, 25) + "..." : text;
            const { data, error: chatErr } = await supabase.from('chats').insert({
                title: autoTitle,
                user_id: userSession.user.id
            }).select().single();
            
            if (chatErr) throw new Error("Gagal membuat chat: " + chatErr.message);
            currentChatId = data.id;
            currentMessages = [];
            await syncHistory();
        }

        // SIMPAN PESAN USER SEGERA (Agar riwayat tersimpan meski AI gagal/di-stop)
        const { data: userMsgData, error: saveUserErr } = await supabase.from('messages').insert([
            { role: 'user', content: text, chat_id: currentChatId }
        ]).select().single();
        
        if (saveUserErr) console.error("Gagal simpan pesan user:", saveUserErr.message || saveUserErr);
        if (userMsgData) currentMessages.push(userMsgData);

        welcome.style.display = "none";

        const userDiv = document.createElement("div");
        userDiv.className = "message user";
        userDiv.dataset.content = text;
        userDiv.innerHTML = `
            ${imagesForAI.length > 0 ? imagesForAI.map(img => `<img src="${img}" style="max-width:150px; border-radius:8px; margin:4px;">`).join('') : ''}
            <div>${marked.parse(text)}</div>
            <div class="message-actions">
                <span onclick="editMessage(this.parentElement.parentElement)">✏️ Edit</span>
                <span onclick="branchChat(this.parentElement.parentElement)">🌿 Branch</span>
                <span class="timestamp">${formatTimestamp(new Date())}</span>
            </div>
        `;
        chat.appendChild(userDiv);
        
        chat.scrollTop = chat.scrollHeight;

        const loading = document.createElement("div");
        loading.className = "message ai";
        loading.innerText = uploadedFilesData.length > 0 ? "Menganalisis..." : "Mengetik...";
        chat.appendChild(loading);
        chat.scrollTop = chat.scrollHeight;

        const history = getChatHistory();
        const response = await fetch(`${window.API_BASE_URL}/chat`, {
            method:"POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${userSession?.access_token}`
            },
            credentials: 'include',
            body:JSON.stringify({
                message: text + (fileContext ? "\n\nAttachment Contents:\n" + fileContext : ""),
                image: imageBase64, // Kirim gambar pertama yang sudah diproses
                history: history,
                model: model,
               userMemory: document.getElementById('user-memory').value,
                userId: userSession.user.id
            }),
            signal: abortController.signal
        });

        // CEK APAKAH RESPON BERHASIL (PENTING: Menangkap error limit/auth dari server)
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Gagal menghubungi AI.");
        }

        loading.remove();
        const aiMessage = document.createElement("div");
        aiMessage.className = "message ai";
        chat.appendChild(aiMessage);
        chat.scrollTop = chat.scrollHeight;

        // REAL STREAMING LOGIC
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullAIResponse = "";
        let buffer = ""; // Tambahkan buffer untuk menangani data yang terpotong

        let isStreamFinished = false;
        while (!isStreamFinished) {
            const { done, value } = await reader.read();
            if (done) isStreamFinished = true;

            const chunk = decoder.decode(value || new Uint8Array(), { stream: !isStreamFinished });
            buffer += chunk;
            
            const lines = buffer.split("\n");
            buffer = lines.pop(); // Simpan baris terakhir yang mungkin belum lengkap
            
            for (const line of lines) {
                const cleanedLine = line.trim();
                if (cleanedLine.startsWith("data: ")) {
                    const dataStr = cleanedLine.slice(6);
                    
                    if (!dataStr || dataStr === "[DONE]") {
                        isStreamFinished = true;
                        break;
                    }
                    
                    try {
                        const json = JSON.parse(dataStr);
                        
                        // Tangkap error yang datang dari API OpenRouter di dalam stream
                        if (json.error) {
                            fullAIResponse += `\n\n❌ **AI Error:** ${json.error.message || "Terjadi kesalahan pada model."}`;
                            aiMessage.innerHTML = marked.parse(fullAIResponse);
                            continue;
                        }

                        // Proteksi agar error usage tidak menghentikan chat
                        if (json.usage) { 
                            try { trackUsage(model, json.usage); } catch(e) {} 
                        }

                        // Ambil konten secara aman (termasuk reasoning jika pakai DeepSeek R1)
                        const delta = json.choices?.[0]?.delta;
                        const content = delta?.content || "";
                        const reasoning = delta?.reasoning_content || "";

                        if (!content && !reasoning) continue;

                        // Gabungkan reasoning dan content secara berurutan
                        fullAIResponse += (reasoning + content);
                        aiMessage.innerHTML = marked.parse(fullAIResponse);

                        addFaviconsToLinks(aiMessage); 
                        
                        if (fullAIResponse.includes("```html") || fullAIResponse.includes("```svg")) {
                            detectAndRunArtifact(fullAIResponse);
                        }

                        chat.scrollTop = chat.scrollHeight;
                    } catch (e) {
                        console.error("[send] Error parsing streaming chunk:", e);
                    }
                }
            }
        }

        // Terapkan highlight pada pesan AI yang baru selesai
        aiMessage.querySelectorAll("pre code").forEach((el) => hljs.highlightElement(el));
        addCopyButtons(aiMessage);

        const aiActions = document.createElement("div");
        aiActions.className = "message-actions ai-actions";
        aiActions.innerHTML = `
            <span onclick="shareChat()">🔗 Share</span>
            <span class="timestamp">${formatTimestamp(new Date())}</span>`;
        aiMessage.appendChild(aiActions);

        // SIMPAN PESAN AI
        const { data: aiMsgData, error: saveAiErr } = await supabase.from('messages').insert([
            { role: 'assistant', content: fullAIResponse, chat_id: currentChatId }
        ]).select().single();
        
        if (saveAiErr) console.error("Gagal simpan pesan AI:", saveAiErr.message || saveAiErr);
        if (aiMsgData) currentMessages.push(aiMsgData);

        setTimeout(() => loadMemory(), 500); // Beri jeda sedikit agar DB selesai update
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log("[send] Generasi dihentikan oleh pengguna.");
        } else {
            console.error("[send] Unhandled error in send function:", error);
            alert("Terjadi kesalahan saat mengirim pesan: " + error.message);
        }
        
        // Remove loading indicator if it exists
        const loadingEl = chat.querySelector('.message.ai:last-child');
        if (loadingEl && (loadingEl.innerText === "Mengetik..." || loadingEl.innerText === "Menganalisis...")) {
            loadingEl.remove();
        }
    } finally {
        isGenerating = false;
        sendBtn.innerHTML = SEND_ICON;
        sendBtn.classList.remove('stop-active');
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
        uploadedFilesData = []; // Clear data upload
    }
}

function newChat() {
    console.log("[newChat] Function called.");
    currentChatId = null;
    currentMessages = [];
    document.getElementById('file-preview-container').innerHTML = ""; // Clear previews
    document.getElementById('file-preview-container').style.display = "none"; // Hide container
    uploadedFilesData = []; // Clear uploaded data
    document.getElementById("chat").innerHTML = "";
    document.getElementById("welcome").style.display = "block";
    if(document.querySelector('.sidebar').classList.contains('open')) toggleSidebar();
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.querySelector('.overlay').classList.toggle('active');
}

async function saveToStorage(userMsg, aiMsg) {
    // Ambil data kembali setelah insert agar kita punya 'id' dan 'created_at' dari DB
    const { data, error } = await supabase.from('messages').insert([
        { role: 'user', content: userMsg, chat_id: currentChatId },
        { role: 'assistant', content: aiMsg, chat_id: currentChatId }
    ]).select();
    
    if (error) console.error("Gagal simpan pesan:", error);
    if (data) {
        // Update memori lokal dengan data asli dari database
        currentMessages.push(...data);
    }
}

async function syncHistory() {
    console.log("[syncHistory] Function called.");
    // Optimasi: Ambil hanya kolom yang diperlukan untuk sidebar
    const { data } = await supabase
        .from('chats')
        .select('id, title, created_at, folder')
        .eq('user_id', userSession.user.id)
        .order('created_at', { ascending: false });
    chats = data || [];
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById("history-list");
    if (!list) { console.error("[renderHistory] history-list element not found."); return; }
    const searchTerm = document.getElementById("search-chat").value.toLowerCase();
    list.innerHTML = "";

    // Grouping logic
    const filtered = chats.filter(c => c.title.toLowerCase().includes(searchTerm));
    const groups = {};

    filtered.forEach(chat => {
        const folderName = chat.folder || "Utama";
        if (!groups[folderName]) groups[folderName] = [];
        groups[folderName].push(chat);
    });

    Object.keys(groups).sort().forEach(folderName => {
        const folderDiv = document.createElement("div");
        folderDiv.className = "folder-group";
        
        const isCollapsed = collapsedFolders.has(folderName);
        
        folderDiv.innerHTML = `
            <div class="folder-header" onclick="toggleFolder('${folderName}')">
                <span>${isCollapsed ? '▶' : '▼'}</span>
                <span>${folderName}</span>
            </div>
            <div class="folder-items" style="display: ${isCollapsed ? 'none' : 'block'}"></div>
        `;

        const itemContainer = folderDiv.querySelector(".folder-items");
        groups[folderName].forEach(chat => {
            const div = document.createElement("div");
            div.className = `history-item ${chat.id === currentChatId ? 'active' : ''}`;
            div.dataset.id = chat.id;
            div.innerText = chat.title;
            div.onclick = () => loadChat(chat.id);
            itemContainer.appendChild(div);
        });

        list.appendChild(folderDiv);
    });
}

function toggleFolder(name) {
    if (collapsedFolders.has(name)) collapsedFolders.delete(name);
    else collapsedFolders.add(name);
    renderHistory();
}

async function createNewFolder() {
    const name = prompt("Nama folder baru:");
    if (!name) return;
    // Simulasi: buat chat baru di folder tersebut agar folder muncul
    alert(`Folder "${name}" dibuat. Gunakan Edit pada chat untuk memindahkan chat ke folder ini.`);
}

async function loadChat(id, isAutoLoad = false) {
    console.log(`[loadChat] Loading chat ID: ${id}`);
    currentChatId = id;

    const { data: messages, error } = await supabase.from('messages').select('*').eq('chat_id', id).order('created_at', { ascending: true });
    
    if (error) {
        console.error("[loadChat] Error fetching messages:", error);
        return;
    }

    renderHistory(); 
    
    currentMessages = messages || []; 
    
    const chatBox = document.getElementById("chat");
    const welcome = document.getElementById("welcome");

    if (welcome) welcome.style.display = "none";
    chatBox.innerHTML = "";
    
    if (currentMessages.length === 0) {
        chatBox.innerHTML = `<div style="text-align:center; opacity:0.5; margin-top:20px;">Belum ada pesan di percakapan ini.</div>`;
    }

    currentMessages.forEach(msg => {
        const msgDiv = document.createElement("div");
        const roleClass = (msg.role === 'user') ? 'user' : 'ai';
        msgDiv.className = `message ${roleClass}`;
        if (msg.role === 'user') msgDiv.dataset.content = msg.content;
        
        msgDiv.innerHTML = `
            ${msg.role === 'user' ? (msg.content || '') : marked.parse(msg.content || '')}
            <div class="message-actions ${roleClass === 'ai' ? 'ai-actions' : ''}">
                ${msg.role === 'user' ? `
                    <span onclick="editMessage(this.parentElement.parentElement)">✏️ Edit</span>
                    <span onclick="branchChat(this.parentElement.parentElement)">🌿 Branch</span>
                ` : `
                    <span onclick="shareChat()">🔗 Share</span>
                `}
                <span class="timestamp">${formatTimestamp(msg.created_at)}</span>
            </div>
        `;
        chatBox.appendChild(msgDiv);
    });

    // Terapkan highlight dan tombol copy pada pesan yang dimuat
    chatBox.querySelectorAll("pre code").forEach((el) => hljs.highlightElement(el));
    addCopyButtons(chatBox);

    chatBox.scrollTop = chatBox.scrollHeight;
    
    // Tutup sidebar otomatis di mobile setelah pilih chat
    if (!isAutoLoad && window.innerWidth <= 768) toggleSidebar();
}

function detectAndRunArtifact(text) {
    console.log("[detectAndRunArtifact] Checking for artifact.");
    const htmlMatch = text.match(/```html([\s\S]*?)```/);
    const svgMatch = text.match(/```svg([\s\S]*?)```/);
    
    if (htmlMatch && htmlMatch[1]) {
        openArtifact(htmlMatch[1]);
    } else if (svgMatch && svgMatch[1]) {
        openArtifact(svgMatch[1]);
    }
}

function openArtifact(content) {
    console.log("[openArtifact] Opening artifact panel.");
    const panel = document.getElementById("preview-container");
    const frame = document.getElementById("preview-frame");
    panel.style.display = "flex";
    frame.srcdoc = content;
}

function closeArtifact() {
    console.log("[closeArtifact] Closing artifact panel.");
    document.getElementById("preview-container").style.display = "none";
}

function getChatHistory() {
    console.log("[getChatHistory] Getting chat history.");
    // Gunakan memori lokal untuk riwayat chat ke AI
    return currentMessages.map(m => ({ role: m.role, content: m.content }));
}

function addCopyButtons(container){

    (container || document).querySelectorAll("pre").forEach((block)=>{

        if(block.querySelector(".copy-btn")) return;

        const code = block.querySelector("code");

        // COPY BUTTON
        const copyBtn = document.createElement("button");
        copyBtn.innerText = "Copy";
        copyBtn.className = "copy-btn";
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(code.innerText);
            copyBtn.innerText = "Copied!";
            setTimeout(()=>{
                copyBtn.innerText = "Copy";
            },2000);
        };
        block.appendChild(copyBtn);

        // Cek bahasa kode
        const isWeb = code.classList.contains('language-html') || 
                      code.classList.contains('language-css') || 
                      code.classList.contains('language-javascript') ||
                      code.classList.contains('language-svg');

        // Hanya tambahkan tombol Run jika itu pesan dari AI
        const messageDiv = block.closest('.message');
        const isAI = messageDiv && messageDiv.classList.contains('ai');

        if (isWeb && isAI) {
            const runBtn = document.createElement("button");
            runBtn.innerHTML = "▶"; // Icon play
            runBtn.className = "run-btn";
            runBtn.title = "Jalankan Kode";

            // Cari tahu bahasa kodenya untuk penanganan khusus di runCode
            const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
            
            runBtn.onclick = () => {
                runCode(code.innerText, langClass);
            };
            block.appendChild(runBtn);
        }
    });
}

// Auto-resize textarea
document.getElementById("msg").addEventListener("input", function() {
    this.style.height = "auto";
    this.style.height = (this.scrollHeight) + "px";
});

// Kirim pesan saat Enter ditekan (tanpa Shift)
document.getElementById("msg").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
    }
});

function runCode(code, langClass) {
    console.log("[runCode] Running code in preview.");
    const container = document.getElementById("preview-container");
    const frame = document.getElementById("preview-frame");
    
    let finalContent = code;
    // Bungkus kode jika hanya potongan (snippet) CSS atau JS
    if (langClass === 'language-css') finalContent = `<style>${code}</style>`;
    else if (langClass === 'language-javascript') finalContent = `<script>${code}</script>`;
    
    container.style.display = "flex";
    frame.srcdoc = finalContent;
}

function closePreview() {
    console.log("[closePreview] Closing preview panel.");
    const container = document.getElementById("preview-container");
    container.style.display = "none";
}

// Logika Custom Context Menu (Klik Kanan)
console.log("[script.js] Setting up context menu listener.");
document.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.history-item');
    const menu = document.getElementById('context-menu');

    if (item) {
        e.preventDefault();
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.dataset.selectedId = item.dataset.id;
    } else {
        menu.style.display = 'none';
    }
});

// Sembunyikan menu jika klik di mana saja
document.addEventListener('click', () => {
    document.getElementById('context-menu').style.display = 'none';
});

function deleteChatFromMenu() {
    console.log("[deleteChatFromMenu] Deleting chat from menu.");
    const menu = document.getElementById('context-menu');
    const id = menu.dataset.selectedId; // UUID adalah string, jangan diubah ke Number
    
    if (id) {
        // Hapus dari database (Opsional: Tambahkan await supabase logic di sini)
        supabase.from('chats').delete().eq('id', id).then(() => {
            syncHistory();
        });

        // Jika chat yang dihapus adalah yang sedang dibuka, reset tampilan
        if (currentChatId === id) {
            newChat();
        } else {
            renderHistory();
        }
    }
}

async function claimPromoCode() {
    const codeInput = document.getElementById('promo-code-input');
    const code = codeInput.value.trim();

    if (!code) return alert("Masukkan kode terlebih dahulu!");

    try {
        const res = await fetch(`${window.API_BASE_URL}/redeem`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${userSession?.access_token}`
            },
            body: JSON.stringify({ code: code })
        });

        const result = await res.json();

        if (result.error) throw new Error(result.error);

        const formattedDate = new Date(result.expiry).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        alert(`🎉 Sukses! Akun Anda telah di-upgrade ke ${result.plan.toUpperCase()}.\n\nAktif hingga: ${formattedDate}`);
        codeInput.value = "";
        await loadMemory();
    } catch (err) {
        alert("❌ Error: " + err.message);
    }
}

async function toggleTheme(isInit = false) {
    console.log(`[toggleTheme] Toggling theme (init: ${isInit}).`);
    const body = document.body;
    const btn = document.getElementById('theme-toggle');
    
    if (!isInit) {
        btn.classList.add('rotate-animation');
        setTimeout(() => btn.classList.remove('rotate-animation'), 500);

        const isDark = body.getAttribute('data-theme') === 'dark';
        const newTheme = isDark ? 'light' : 'dark';
        body.setAttribute('data-theme', newTheme);
        
        // Simpan ke Cloud (Supabase)
        if (userSession) {
            await supabase.from('profiles').update({ theme: newTheme }).eq('id', userSession.user.id);
            userProfile.theme = newTheme;
        }
    } else {
        const saved = userProfile.theme || 'light';
        if (saved) body.setAttribute('data-theme', saved);
    }
    
    const currentTheme = body.getAttribute('data-theme');
    if (btn) btn.innerText = currentTheme === 'dark' ? '☀️' : '🌙';
}

async function editMessage(el) {
    console.log("[editMessage] Editing message.");
    const oldText = el.dataset.content || "";
    const originalHTML = el.innerHTML;

    // Tampilkan UI Edit di dalam bubble chat
    el.innerHTML = `
        <textarea class="edit-textarea">${oldText}</textarea>
        <div class="edit-actions">
            <button class="edit-cancel-btn">Cancel</button>
            <button class="edit-save-btn">Send</button>
        </div>
    `;

    const textarea = el.querySelector('.edit-textarea');
    const saveBtn = el.querySelector('.edit-save-btn');
    const cancelBtn = el.querySelector('.edit-cancel-btn');

    // Fokus ke textarea dan posisikan kursor di akhir teks
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    
    // Auto-resize textarea saat mengetik
    textarea.style.height = textarea.scrollHeight + 'px';
    textarea.oninput = function() { this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'; };

    cancelBtn.onclick = () => { el.innerHTML = originalHTML; };

    saveBtn.onclick = async () => {
        const newText = textarea.value.trim();
        if (newText && newText !== oldText) {
            const chatBox = document.getElementById("chat");
            const index = Array.from(chatBox.children).indexOf(el);

            // Hapus pesan dari DB dan UI (logic cabang/edit)
            const messagesToDelete = currentMessages.slice(index);
            if (messagesToDelete.length > 0 && messagesToDelete[0].created_at) {
                await supabase.from('messages')
                    .delete()
                    .eq('chat_id', currentChatId)
                    .gte('created_at', messagesToDelete[0].created_at);
            }

            currentMessages = currentMessages.slice(0, index);
            while (chatBox.children.length > index) {
                chatBox.lastElementChild.remove();
            }
            send(newText);
        } else {
            el.innerHTML = originalHTML;
        }
    };
}

async function branchChat(el) {
    console.log("[branchChat] Branching chat.");
    const chatBox = document.getElementById("chat");
    const messages = Array.from(chatBox.children);
    const index = messages.indexOf(el);
    
    const parentChat = chats.find(c => c.id === currentChatId);
    if (!parentChat) return;

    // Ambil history pesan sampai titik yang dipilih
    const newHistory = currentMessages.slice(0, index + 1);
    const newTitle = "🌿 " + parentChat.title;

    if (newHistory.length === 0) {
        alert("Tidak ada riwayat pesan untuk dicabangkan.");
        return;
    }

    try {
        // 1. Buat Chat baru
        const { data: newChat, error: chatErr } = await supabase.from('chats').insert({
            title: newTitle,
            user_id: userSession.user.id
        }).select().single();

        if (chatErr) throw chatErr;

        // 2. Petakan pesan lama ke ID chat yang baru
        const branchMsgs = newHistory.map(m => ({ 
            role: m.role,
            content: m.content,
            chat_id: newChat.id 
        }));

        const { error: msgErr } = await supabase.from('messages').insert(branchMsgs);
        if (msgErr) throw msgErr;

        // 3. Muat chat baru tersebut
        await syncHistory();
        loadChat(newChat.id);
    } catch (err) {
        console.error("[branchChat] Error:", err);
        alert("Gagal mencabangkan chat: " + err.message);
    }
}

function startVoice() {
    alert("Coming Soon!");
}

function exportToPDF() {
    console.log("[exportToPDF] Exporting chat to PDF.");
    const element = document.getElementById('chat');
    const opt = { margin: 1, filename: `Chat-${currentChatId}.pdf`, html2canvas: { scale: 2 } };
    html2pdf().set(opt).from(element).save();
}

async function shareChat() {
    if (!currentChatId) {
        alert("Mulailah percakapan terlebih dahulu sebelum membagikan.");
        return;
    }
    const shareUrl = `${window.location.origin}/share/${currentChatId}`;
    try {
        await navigator.clipboard.writeText(shareUrl);
        alert("Tautan percakapan berhasil disalin! 🔗\n\nOrang lain sekarang bisa melihat chat ini melalui:\n" + shareUrl);
    } catch (err) {
        console.error("Gagal menyalin link:", err);
        alert("Gagal menyalin link secara otomatis. Link Anda: " + shareUrl);
    }
}

// --- LOGIKA COST DASHBOARD ---
const PRICES = {
    "deepseek/deepseek-chat": { in: 0.14, out: 0.28 }, // per 1M tokens
    "google/gemini-2.0-flash-001": { in: 0.10, out: 0.40 },
    "openai/gpt-4o-mini": { in: 0.15, out: 0.60 },
    "anthropic/claude-3-haiku": { in: 0.25, out: 1.25 }
};

async function trackUsage(model, usage) {
    if (!userSession) return;
    const today = new Date().toDateString();
    let history = userProfile.usage_history || [];

    let stats = history.find(s => s.date === today);
    if (!stats) {
        stats = { date: today, input: 0, output: 0, cost: 0, models: {} };
        history.push(stats);
    }

    // Inisialisasi object models jika belum ada (untuk data lama)
    if (!stats.models) stats.models = {};

    // Simpan maksimal 7 hari
    if (history.length > 7) history.shift();

    const modelPrice = PRICES[model] || { in: 0.2, out: 0.6 }; // Default price
    
    const sessionInput = usage.prompt_tokens;
    const sessionOutput = usage.completion_tokens;
    const sessionCost = ((sessionInput * modelPrice.in) / 1000000) + ((sessionOutput * modelPrice.out) / 1000000);

    stats.input += sessionInput;
    stats.output += sessionOutput;
    stats.cost += sessionCost;

    // Simpan rincian per model
    if (!stats.models[model]) {
        stats.models[model] = { input: 0, output: 0, cost: 0, count: 0 };
    }
    stats.models[model].input += sessionInput;
    stats.models[model].output += sessionOutput;
    stats.models[model].cost += sessionCost;
    stats.models[model].count += 1;

    // Update ke Cloud
    const { error } = await supabase.from('profiles').update({ usage_history: history }).eq('id', userSession.user.id);
    if (!error) userProfile.usage_history = history;

    updateUsageUI();
}

function updateUsageUI() {
    const history = userProfile.usage_history || [];
    const stats = history[history.length - 1] || { input: 0, output: 0, cost: 0 };
    
    const inputEl = document.getElementById('usage-input');
    const outputEl = document.getElementById('usage-output');
    const costEl = document.getElementById('usage-cost');

    if (inputEl) inputEl.innerText = stats.input.toLocaleString();
    if (outputEl) outputEl.innerText = stats.output.toLocaleString();
    if (costEl) costEl.innerText = `$${stats.cost.toFixed(4)}`;

    renderUsageChart(history);
}

function renderUsageChart(history) {
    // Targetkan kedua canvas jika ada
    const chartIds = ['usageChart', 'accountUsageChart'];
    
    chartIds.forEach(id => {
        const ctx = document.getElementById(id);
        if (!ctx) return;

        const labels = history.map(h => h.date.split(' ')[1] + ' ' + h.date.split(' ')[2]);
        const data = history.map(h => h.input + h.output);

        // Gunakan instance chart yang berbeda untuk setiap ID jika perlu, 
        // tapi untuk kesederhanaan kita buat baru setiap render
        if (ctx._chartInstance) ctx._chartInstance.destroy();

        ctx._chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Token',
                    data: data,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { font: { size: 10 } } },
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } }
                }
            }
        });
    });
}

async function loadMemory() {
    const { data } = await supabase.from('profiles').select('*').eq('id', userSession.user.id).single();
    if (data) {
        userProfile = data;
        document.getElementById('user-memory').value = data.memory || "";
        updatePlanUI(data);
        updateUsageUI();
        
        // Aplikasikan Preferensi Tampilan dari DB
        if (data.theme) toggleTheme(true);
        if (data.font_size) applyFontSize(data.font_size);
    }
}

function updatePlanUI(profile) {
    const PLAN_LIMITS = { free: 9000, premium: 20000, super: 99000, galaxy: 900000, free_unlimited: 999999999 };
    const currentPlan = profile.plan || 'free';
    const limit = PLAN_LIMITS[currentPlan];
    const usage = profile.daily_usage || 0;
    
    const isUnlimited = currentPlan === 'free_unlimited';
    const percent = isUnlimited ? 0 : Math.min((usage / limit) * 100, 100);
    
    let planNameText = isUnlimited ? "FREE UNLIMITED" : currentPlan.toUpperCase() + " PLAN";
    
    // Tampilkan info expiry jika ada
    if (isUnlimited && profile.plan_expiry) {
        const date = new Date(profile.plan_expiry).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        planNameText += ` (Hingga ${date})`;
    }

    document.getElementById('user-plan-name').innerText = planNameText;
    document.getElementById('daily-used').innerText = usage.toLocaleString();
    document.getElementById('daily-limit').innerText = isUnlimited ? "∞" : limit.toLocaleString();
    document.getElementById('usage-bar-fill').style.width = percent + "%";
    
    // BATASI AKSES TAB DEVELOPER: Hanya untuk email tertentu
    const devTabBtn = document.getElementById('set-tab-developer');
    if (devTabBtn) {
        const adminEmail = "aaufaamanullah@gmail.com"; // GANTI DENGAN EMAIL ABANG
        if (userSession && userSession.user.email === adminEmail) {
            devTabBtn.style.display = 'flex';
            devTabBtn.innerHTML = `🧪 Developer (🪙 ${usage.toLocaleString()})`;
        } else {
            devTabBtn.style.display = 'none'; // Sembunyikan jika bukan admin
        }
    }

    // Tambahkan atribut data ke container dashboard agar CSS bisa berubah
    const dashboard = document.querySelector('.settings-panel .usage-dashboard');
    if (dashboard) {
        dashboard.dataset.plan = currentPlan;
        
        // Bersihkan bintang lama jika ada
        dashboard.querySelectorAll('.star').forEach(s => s.remove());

        // Jika plan Galaxy, buat 19 bintang jatuh
        if (currentPlan === 'galaxy') {
            for (let i = 0; i < 19; i++) {
                const star = document.createElement('div');
                star.className = 'star';
                star.style.left = `${Math.random() * 100}%`;
                star.style.animationDelay = `${Math.random() * 8}s`; // Delay acak sampai 8 detik
                star.style.animationDuration = `${2 + Math.random() * 4}s`; // Kecepatan acak
                dashboard.appendChild(star);
            }
        }
    }

    const badge = document.getElementById('plan-badge');
    if (isUnlimited) {
        badge.className = `plan-badge plan-free`;
        badge.innerText = "UNLIMITED";
        badge.style.background = "linear-gradient(45deg, #94a3b8, #2563eb)";
    } else {
        badge.className = `plan-badge plan-${currentPlan}`;
        badge.innerText = currentPlan.toUpperCase();
    }
}

function showUsageDetail() {
    const history = userProfile.usage_history || [];
    const todayStats = history[history.length - 1];
    const container = document.getElementById('model-detail-list');
    const modal = document.getElementById('usage-detail-modal');
    
    container.innerHTML = "";
    
    if (!todayStats || !todayStats.models || Object.keys(todayStats.models).length === 0) {
        container.innerHTML = "<p style='text-align:center; opacity:0.5; padding:20px;'>Belum ada data penggunaan hari ini.</p>";
    } else {
        Object.entries(todayStats.models).forEach(([modelName, data]) => {
            const shortName = modelName.split('/').pop();
            const item = document.createElement('div');
            item.className = 'model-detail-item';
            item.innerHTML = `
                <div class="model-info">
                    <b style="text-transform: capitalize;">${shortName}</b>
                    <span>${data.count} Pesan</span>
                </div>
                <div class="model-stats">
                    <div class="stat-pill">In: ${data.input.toLocaleString()}</div>
                    <div class="stat-pill">Out: ${data.output.toLocaleString()}</div>
                    <b style="color: #16a34a;">$${data.cost.toFixed(4)}</b>
                </div>
            `;
            container.appendChild(item);
        });
    }
    modal.style.display = 'flex';
}

function closeUsageDetail() {
    document.getElementById('usage-detail-modal').style.display = 'none';
}

function openUsageSettings() {
    openSettings();
    // Otomatis pindah ke tab 'developer' karena usage dashboard sudah di sana
    const devTab = document.getElementById('set-tab-developer');
    if (devTab) switchSettingsTab(devTab, 'developer');
}

async function saveMemory() {
    const memoryText = document.getElementById('user-memory').value;
    const { error } = await supabase
        .from('profiles')
        .upsert({ 
            id: userSession.user.id, 
            memory: memoryText,
            updated_at: new Date()
        });
    
    if (error) console.error("Gagal menyimpan memori:", error);
}

function openSettings() {
    const modal = document.getElementById('settings-overlay');
    modal.style.display = 'flex';
    
    // Pastikan data kuota terbaru muncul saat setting dibuka
    loadMemory();
    
    // Update Data di Settings
    document.getElementById('set-email').innerText = userSession.user.email;
    document.getElementById('set-avatar').innerText = userSession.user.email.charAt(0).toUpperCase();
    
    // Ambil data dari userProfile dan hitung totalnya
    const history = userProfile.usage_history || [];
    const totalStats = history.reduce((acc, curr) => ({
        tokens: acc.tokens + (curr.input + curr.output),
        cost: acc.cost + curr.cost
    }), { tokens: 0, cost: 0 });

    document.getElementById('set-total-chats').innerText = chats.length;
    document.getElementById('set-total-tokens').innerText = totalStats.tokens.toLocaleString();
    document.getElementById('set-total-cost').innerText = `$${totalStats.cost.toFixed(2)}`;

    // Render chart saat settings dibuka
    renderUsageChart(history);
}

function closeSettings() {
    document.getElementById('settings-overlay').style.display = 'none';
}

function switchSettingsTab(element, tabId) {
    // Nav Tabs
    document.querySelectorAll('.settings-tab-link').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    
    // Panels
    document.querySelectorAll('.settings-panel').forEach(el => el.classList.remove('active'));
    document.getElementById(`set-panel-${tabId}`).classList.add('active');
}


function applyFontSize(size) {
    const sizes = { 'small': '13px', 'medium': '15px', 'large': '18px' };
    document.documentElement.style.setProperty('--chat-font-size', sizes[size] || '15px');
}

async function changeFontSize(size) {
    applyFontSize(size);
    if (userSession) {
        await supabase.from('profiles').update({ font_size: size }).eq('id', userSession.user.id);
        userProfile.font_size = size;
    }
}

async function resetPlan() {
    if (!userSession) return;
    
    const confirmReset = confirm("Apakah abang yakin mau reset plan ke FREE? \n(Semua akses Unlimited akan dihapus)");
    
    if (confirmReset) {
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ 
                    plan: 'free', 
                    plan_expiry: null,
                    daily_usage: 0 // Opsional: reset juga penggunaan hari ini
                })
                .eq('id', userSession.user.id);

            if (error) throw error;

            alert("🚀 Akun berhasil di-reset ke Plan FREE! \nSekarang abang bisa klaim kode promo lagi.");
            await loadMemory(); // Refresh tampilan UI
        } catch (err) {
            console.error("Gagal reset plan:", err);
            alert("Waduh, gagal reset plan: " + err.message);
        }
    }
}

window.downloadMyData = async function() {
    const { data } = await supabase.from('messages').select('role, content, chats(title)').order('created_at', { ascending: true });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-ai-chat-${new Date().toLocaleDateString()}.json`;
    a.click();
};

async function buyPlan(plan) {
    const prices = { 'premium': 30000, 'super': 99000, 'galaxy': 2000000 };
    const waNumber = "628139943781"; // Pastikan ini nomor asli abang (awali dengan 62)
    const message = encodeURIComponent(`Halo Admin, saya ingin membeli Kode Redeem paket ${plan.toUpperCase()} seharga Rp ${prices[plan].toLocaleString('id-ID')}.`);
    
    document.getElementById('wa-link').href = `https://wa.me/${waNumber}?text=${message}`;
    document.getElementById('wa-overlay').style.display = 'flex';
}