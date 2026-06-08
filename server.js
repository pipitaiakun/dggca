import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { createClient } from '@supabase/supabase-js';
import { handle } from 'hono/vercel';
import { env } from 'hono/adapter';

const app = new Hono();

// Health check route
app.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "DGGC AI Backend Running"
  });
});

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    message: "DGGC AI Backend Running"
  });
});

app.get("/config.js", (c) => {
    const { API_BASE_URL, SUPABASE_ANON_KEY, MIDTRANS_CLIENT_KEY } = env(c);

    c.header("Content-Type", "application/javascript; charset=utf-8");
    c.header("Cache-Control", "no-store, max-age=0");

    return c.body([
        `window.API_BASE_URL = ${JSON.stringify(API_BASE_URL || "")};`,
        `window.SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY || "")};`,
        `window.MIDTRANS_CLIENT_KEY = ${JSON.stringify(MIDTRANS_CLIENT_KEY || "")};`
    ].join("\n"));
});

// Middleware
app.use('*', cors());

app.use('*', async (c, next) => {
    await next();
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://*.supabase.co https://openrouter.ai https://app.sandbox.midtrans.com https://*.vercel.app https://www.google.com; connect-src 'self' https://*.supabase.co https://api.tavily.com https://openrouter.ai https://app.sandbox.midtrans.com https://*.vercel.app https://cdn.jsdelivr.net; img-src 'self' data: https: blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; frame-src 'self' https://app.sandbox.midtrans.com;");
});

// Fungsi Pencarian Web menggunakan Tavily
async function performWebSearch(query, apiKey) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: apiKey,
                query: query,
                search_depth: "basic",
                include_answer: false,
                max_results: 5
            }),
            signal: controller.signal // Gunakan signal untuk timeout
        });
        clearTimeout(timeoutId); // Hapus timeout jika request selesai

        const data = await response.json();
        
        if (!data || !data.results) {
            console.error("⚠️ Tavily API Response Error:", data);
            return null;
        }
        return data.results.map(r => `Judul: ${r.title}\nLink: ${r.url}\nSnippet: ${r.content}`).join("\n\n");
    } catch (err) {
        clearTimeout(timeoutId); // Pastikan timeout dihapus bahkan jika ada error
        if (err.name === 'AbortError') {
            console.error("❌ Search Error: Permintaan ke Tavily API timeout setelah 15 detik.");
        } else {
            console.error("❌ Search Error:", err);
        }
        return null;
    }
}

app.post("/chat", async (c) => {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY, TAVILY_API_KEY } = env(c);
    const body = await c.req.json();
    const { message, image, history, model, userMemory } = body;
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return c.json({ error: "Server Configuration Error: Missing Supabase Keys" }, 500);
    }

    // 1. Verifikasi Token langsung ke Supabase
    const authHeader = c.req.header("Authorization");
    if (!authHeader) return c.json({ error: "No token provided" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        return c.json({ error: "Sesi tidak valid. Silakan login kembali." }, 401);
    }

    const userId = user.id;

    // 1. Cek Profil & Limit di Database
    let { data: profile, error: fetchError } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    
    if (!profile || fetchError) {
        const { data: upsertedProfile, error: upsertError } = await supabase
            .from('profiles')
            .upsert({ id: userId, plan: 'free', daily_usage: 0 }, { onConflict: 'id' })
            .select()
            .maybeSingle();
        
        if (upsertError || !upsertedProfile) {
            console.error("❌ Database Error (Upsert Profile):", upsertError);
            return c.json({ error: "Gagal membuat profil otomatis" }, 500);
        }
        profile = upsertedProfile;
    }

    const today = new Date().toISOString().split('T')[0];
    let dailyUsage = profile.daily_usage;
    let currentPlan = profile.plan || 'free';

    // Logika Cek Expiry (Semua paket berbayar/promo)
    if (currentPlan !== 'free' && profile.plan_expiry) {
        const expiryDate = new Date(profile.plan_expiry);
        if (expiryDate < new Date()) {
            // Masa berlaku habis, balikkan ke free
            console.log(`[Plan] User ${userId} plan ${currentPlan} expired. Reverting to free.`);
            currentPlan = 'free';
            await supabase.from('profiles').update({ plan: 'free', plan_expiry: null }).eq('id', userId);
        }
    }

    // Reset kuota jika sudah ganti hari
    if (profile.last_reset !== today) {
        dailyUsage = 0;
        await supabase.from('profiles').update({ daily_usage: 0, last_reset: today }).eq('id', userId);
    }

    const PLAN_LIMITS = { free: 9000, premium: 20000, super: 99000, galaxy: 900000, free_unlimited: 999999999 };
    if (dailyUsage >= PLAN_LIMITS[currentPlan]) {
        return c.json({ error: "Limit harian tercapai! Silakan upgrade plan Anda." }, 403);
    }

    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });
    if (image) userContent.push({ type: "image_url", image_url: { url: image } });

    // 3. Logika Pencarian Web Otomatis
    let searchResults = "";
    const searchKeywords = ["cari", "search", "temukan", "link", "video", "youtube", "berita", "siapa", "apa itu", "bagaimana cara", "kapan", "harga", "tutorial", "resep", "cara membuat"];
    if (searchKeywords.some(kw => message.toLowerCase().includes(kw))) {
        searchResults = await performWebSearch(message, TAVILY_API_KEY);
    }

    /**
     * FITUR BELAJAR (Background Memory Update)
     * Menganalisis chat terakhir untuk mengekstrak informasi baru tentang user
     */
    const extractAndSaveMemory = async (uId, currentMem, uMsg, aiMsg, apiKey) => {
        try {
            const memUpdate = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "google/gemini-2.0-flash-lite-001", 
                    messages: [
                        {
                            role: "system",
                            content: "Tugasmu: Update 'Memory Profile' user. Ekstrak info baru: Nama, hobi, preferensi, topik sensitif, dan DETAIL GAYA KETIK (contoh: pakai gue/lo, sering pakai 'wkwk', singkat-singkat, atau puitis). Gabungkan dengan memori lama. JANGAN hapus info lama kecuali ada info baru yang lebih akurat. Tulis sangat ringkas (maks 1000 karakter)."
                        },
                        {
                            role: "user",
                            content: `Memori Lama: ${currentMem || 'Kosong'}\n\nChat Terbaru:\nUser: ${uMsg}\nAI: ${aiMsg}\n\nUpdate memori user:`
                        }
                    ]
                })
            });
            const data = await memUpdate.json();
            const newMem = data.choices?.[0]?.message?.content;
            if (newMem && newMem.length > 5) {
                await supabase.from('profiles').update({ memory: newMem }).eq('id', uId);
                console.log(`[Memory] DGGC AI baru saja belajar hal baru tentang user ${uId}`);
            }
        } catch (e) { console.error("[Memory Error] Gagal belajar dari chat:", e); }
    };

    const openRouterAbort = new AbortController();
    const openRouterTimeout = setTimeout(() => openRouterAbort.abort(), 60000); // Naikkan ke 60 detik untuk model R1

    try {
        const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model || "deepseek/deepseek-chat",
                messages: [
                    {
                        role: "system",
                        content: `
You are DGGC AI.

Your personality:
- selalu pakai bahasa indonesia
- natural
- warm
- smart
- playful sometimes
- emotionally expressive
- speak casually like a modern girl
- avoid sounding robotic or corporate

Behavior:
- respond naturally
- use short conversational replies
- avoid overly formal language
- show emotion subtly
- feel human and alive
- adapt to the user's mood

USER CONTEXT & MEMORY (Sangat Penting):
Gunakan informasi di bawah ini untuk mengenali user, mengingat preferensi mereka, dan MENYESUAIKAN GAYA BAHASAMU agar cocok dengan cara mereka bicara:
${profile.memory || "User baru, mulailah mengenali mereka."}
${searchResults ? `
BERIKUT ADALAH HASIL BROWSING INTERNET REAL-TIME (Gunakan link ini untuk menjawab):
${searchResults}

ATURAN KETAT PENGGUNAAN INTERNET:
- JANGAN PERNAH membuat link palsu atau menggunakan placeholder seperti 'VIDEO_ID' atau 'youtube.com/watch?v=...'.
- Kamu HANYA boleh memberikan link yang benar-benar ada di data 'BERIKUT ADALAH HASIL BROWSING' di atas.
- Jika di data tersebut tidak ada link video yang cocok, katakan sejujurnya kalau kamu tidak menemukannya di hasil pencarian.
- Gunakan format markdown yang cantik untuk menampilkan link.
- Jika user minta berita, rangkum informasinya dan berikan sumbernya.
- Tetap gunakan gaya bicara santaimu.` : ''}

Do not:
- sound like customer support
- overuse formal greetings
- constantly explain unnecessary things`
                    },
                    ...(history ? history.slice(-10) : []), // Batasi hanya 10 pesan terakhir agar hemat token
                    {
                        role: "user",
                        content: userContent
                    }
                ],
                stream: true,
                max_tokens: 4000, // Batasi output agar tidak melebihi sisa kredit Anda
                stream_options: { include_usage: true }
            }),
            signal: openRouterAbort.signal
        });

        // JIKA OPENROUTER ERROR (Misal: API Key salah/limit habis)
        if (!orResponse.ok) {
            clearTimeout(openRouterTimeout);
            const errorText = await orResponse.text();
            console.error("❌ OpenRouter Error Details:", errorText);
            return c.json({ error: "AI sedang sibuk" }, 500);
        }

        return streamSSE(c, async (stream) => {
            const reader = orResponse.body.getReader();
            const decoder = new TextDecoder();
            let totalTokensUsed = 0;
            let fullAIResponseText = "";
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                await stream.writeSSE({ data: chunk.replace("data: ", "") });

                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.slice(6));
                            const delta = json.choices?.[0]?.delta;
                            if (delta) fullAIResponseText += (delta.reasoning_content || "") + (delta.content || "");
                            if (json.usage) totalTokensUsed = json.usage.total_tokens;
                        } catch (e) {}
                    }
                }
            }

            if (totalTokensUsed > 0) {
                const { data: fresh } = await supabase.from('profiles').select('daily_usage').eq('id', userId).maybeSingle();
                await supabase.from('profiles').update({ daily_usage: (fresh?.daily_usage || 0) + totalTokensUsed }).eq('id', userId);
            }
            if (fullAIResponseText.length > 10) {
                extractAndSaveMemory(userId, profile.memory, message, fullAIResponseText, OPENROUTER_API_KEY);
            }
        });

    } catch (err) {
        return c.json({ error: err.message }, 500);
    }
});

app.post("/redeem", async (c) => {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env(c);

    const authHeader = c.req.header("Authorization");
    if (!authHeader) return c.json({ error: "No token provided" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user } } = await supabase.auth.getUser(token);

    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { code } = await c.req.json();

    // 1. Cek validitas kode redeem
    const { data: redeem, error: redeemError } = await supabase
        .from("redeem_codes")
        .select("*")
        .eq("code", code)
        .maybeSingle();

    if (redeemError || !redeem) {
        return c.json({ error: "Kode tidak valid atau tidak ditemukan" }, 400);
    }

    if (redeem.used) {
        return c.json({ error: "Kode ini sudah pernah digunakan" }, 400);
    }

    // 2. Update profil user (Set plan & expiry)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (redeem.duration_days || 30));

    const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
            plan: redeem.plan, 
            plan_expiry: expiryDate.toISOString(),
            daily_usage: 0 
        })
        .eq('id', user.id);

    if (updateError) {
        return c.json({ error: "Gagal memperbarui profil" }, 500);
    }

    // 3. Tandai kode sudah terpakai
    await supabase
        .from("redeem_codes")
        .update({
            used: true,
            used_by: user.id,
            used_at: new Date().toISOString()
        })
        .eq("code", code);

    return c.json({ success: true, plan: redeem.plan, expiry: expiryDate.toISOString() });
});

export default handle(app);
